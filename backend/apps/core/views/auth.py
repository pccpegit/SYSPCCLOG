"""
Authentication views for login and logout.
"""

import logging

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer

from apps.core.authentication import enforce_csrf
from apps.core.serializers.auth import CustomTokenObtainPairSerializer
from apps.core.throttling import LoginUsernameThrottle, ThrottleCacheMixin

logger = logging.getLogger(__name__)

ACCESS_COOKIE_NAME = 'access_token'
REFRESH_COOKIE_NAME = 'refresh_token'
ACCESS_COOKIE_MAX_AGE = 60 * 15          # 15 minutes (ACCESS_TOKEN_LIFETIME)
REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24    # 1 day (REFRESH_TOKEN_LIFETIME)


def _auth_cookie_kwargs():
    """Attributes shared by the login and refresh cookies. Keeping them in
    one place guarantees a refreshed cookie overwrites the login one in the
    browser (same name + path + domain) instead of living next to it."""
    return {
        'httponly': True,
        'secure': not settings.DEBUG,
        'samesite': 'Lax',
        'path': '/',
    }


def set_auth_cookies(response, access_token=None, refresh_token=None):
    """Write the JWT cookies on `response`. Tokens never go in the body."""
    if access_token:
        response.set_cookie(
            key=ACCESS_COOKIE_NAME,
            value=access_token,
            max_age=ACCESS_COOKIE_MAX_AGE,
            **_auth_cookie_kwargs(),
        )
    if refresh_token:
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=refresh_token,
            max_age=REFRESH_COOKIE_MAX_AGE,
            **_auth_cookie_kwargs(),
        )


def clear_auth_cookies(response):
    """Expire both JWT cookies (path must match the one used to set them)."""
    response.delete_cookie(ACCESS_COOKIE_NAME, path='/')
    response.delete_cookie(REFRESH_COOKIE_NAME, path='/')


@method_decorator(ensure_csrf_cookie, name='get')
class CsrfCookieView(APIView):
    """
    SYSPCC-015: bootstrap endpoint for the CSRF double-submit pattern.

    The SPA calls this once on startup, before any mutating request
    (including login), so the browser receives the `csrftoken` cookie.
    `ensure_csrf_cookie` forces Django to set the cookie on the response even
    though a plain GET would not otherwise trigger it. The view itself never
    mutates state and requires no prior authentication.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        tags=['auth'],
        summary='Bootstrap CSRF cookie',
        description=(
            'Sets the `csrftoken` cookie. Call this before any mutating '
            'request (including login) and echo the cookie value back via '
            'the `X-CSRFToken` header on every POST/PUT/PATCH/DELETE.'
        ),
        request=None,
    )
    def get(self, request):
        return Response({'detail': 'CSRF cookie set'}, status=status.HTTP_200_OK)


class LoginRateThrottle(ThrottleCacheMixin, AnonRateThrottle):
    """Strict per-IP throttle applied only to the login endpoint."""
    scope = 'login'


class TokenRefreshThrottle(ThrottleCacheMixin, SimpleRateThrottle):
    """
    Per-IP throttle for the token refresh (scope ``token_refresh``, 300/min).

    Its own bucket on purpose: the view has no authenticators, so the default
    ``AnonThrottle`` (30/min, shared with /auth/csrf/) would answer 429 to a
    whole office behind one NAT when all the access tokens expire together.
    """
    scope = 'token_refresh'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Login endpoint.  Sets JWT access and refresh tokens as httpOnly cookies.
    Returns user profile data in the response body — never the raw tokens.
    """

    serializer_class = CustomTokenObtainPairSerializer
    # Per IP (5/min) AND per username (10/min): rotating IPs does not allow
    # unlimited guessing against a single account.
    throttle_classes = [LoginRateThrottle, LoginUsernameThrottle]

    @extend_schema(
        tags=['auth'],
        summary='Login - obtain JWT tokens (set as httpOnly cookies)',
        description=(
            'Authenticate with username/password. '
            'Access and refresh tokens are stored in httpOnly cookies. '
            'Only the user profile is returned in the response body.'
        ),
    )
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Extract tokens produced by the serializer
        data = serializer.validated_data
        access_token = data.pop('access', None)
        refresh_token = data.pop('refresh', None)

        # Build response with user data only (tokens stay in cookies)
        response = Response(data, status=status.HTTP_200_OK)

        set_auth_cookies(response, access_token, refresh_token)

        return response


class CookieTokenRefreshView(APIView):
    """
    SYSPCC-034: access-token refresh for the cookie-based JWT flow.

    SimpleJWT's stock `TokenRefreshView` only reads `refresh` from the request
    body, but the login stores the refresh token in the HttpOnly
    `refresh_token` cookie and the SPA calls this endpoint with an empty body
    - so every refresh answered 400 and users were thrown out after 15 minutes.

    The refresh token comes ONLY from the `refresh_token` cookie (the request
    body is never read). Rotation + blacklist follow SIMPLE_JWT. New tokens are
    written as cookies with the login's exact attributes and are never returned
    in the body. A token whose user no longer exists or is inactive is refused
    before rotating.

    Authentication classes are empty on purpose: the access cookie is expired
    or gone by the time the SPA refreshes, and `CookieJWTAuthentication` would
    reject the request before reaching this view. Because the refresh cookie is
    an ambient credential, CSRF (double-submit) is enforced here explicitly.
    A failed refresh leaves the cookies untouched (two tabs refreshing at once:
    the loser must not wipe the winner's fresh cookies).
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [TokenRefreshThrottle]

    def get_authenticate_header(self, request):
        # Without authenticators DRF would turn the 401 into a 403.
        return '{} realm="api"'.format(jwt_settings.AUTH_HEADER_TYPES[0])

    @staticmethod
    def _invalid_token(request, cause):
        # Never log the token itself; only who asked and why it was refused.
        logger.warning(
            'auth.refresh.invalid_token',
            extra={'cause': cause, 'ip': request.META.get('REMOTE_ADDR')},
        )
        return AuthenticationFailed(
            'La sesión expiró o el token de refresco no es válido. '
            'Inicie sesión nuevamente.',
            code='token_not_valid',
        )

    @extend_schema(
        tags=['auth'],
        summary='Refresh the access token (cookie-based)',
        description=(
            'Reads the refresh token from the `refresh_token` httpOnly cookie '
            '(the body is ignored), rotates it and rewrites the `access_token` '
            '/ `refresh_token` cookies. Requires the `X-CSRFToken` header. '
            'A missing, invalid or blacklisted token, or one whose user is '
            'inactive or deleted, answers 401 (cookies untouched).'
        ),
        request=None,
        responses={
            200: inline_serializer(
                name='TokenRefreshResponse',
                fields={'detail': serializers.CharField()},
            ),
            401: OpenApiResponse(description='Refresh token missing, invalid or blacklisted.'),
            403: OpenApiResponse(description='CSRF token missing or invalid.'),
        },
    )
    def post(self, request):
        refresh_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if not refresh_token:
            raise NotAuthenticated('No se proporcionó el token de refresco.')

        enforce_csrf(request)

        # Validate first (signature, expiry, token type, blacklist) and make
        # sure the user is still allowed in, so nothing is rotated otherwise.
        try:
            token = RefreshToken(refresh_token)
        except (TokenError, InvalidToken):
            raise self._invalid_token(request, 'invalid_or_blacklisted')

        User = get_user_model()
        user_id = token.get(jwt_settings.USER_ID_CLAIM)
        user = User.objects.filter(**{jwt_settings.USER_ID_FIELD: user_id}).first() if user_id is not None else None
        if user is None:
            raise self._invalid_token(request, 'user_missing')
        if not user.is_active:
            raise self._invalid_token(request, 'user_inactive')

        serializer = TokenRefreshSerializer(data={'refresh': refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken):
            # Lost a race between the check above and the rotation.
            raise self._invalid_token(request, 'invalid_or_blacklisted')
        except Exception:
            # Last barrier (e.g. blacklist DB failure): log with stack trace
            # and let DRF answer 500.
            logger.exception('auth.refresh.unexpected')
            raise

        data = serializer.validated_data
        response = Response({'detail': 'Sesión renovada.'}, status=status.HTTP_200_OK)
        # `refresh` is only present when ROTATE_REFRESH_TOKENS is on.
        set_auth_cookies(response, data.get('access'), data.get('refresh'))
        return response


class LogoutView(APIView):
    """
    Logout endpoint. Blacklists the refresh token and clears auth cookies.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=['auth'],
        summary='Logout - blacklist refresh token and clear cookies',
        request=None,
    )
    def post(self, request):
        # Prefer cookie-based refresh token; fall back to request body for
        # clients that still send the token in JSON during migration.
        refresh_token = request.COOKIES.get('refresh_token') or request.data.get('refresh')

        response = Response({'detail': 'Sesión cerrada exitosamente.'}, status=status.HTTP_200_OK)

        # Always clear cookies regardless of blacklist outcome
        clear_auth_cookies(response)

        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                token.blacklist()
            except (TokenError, InvalidToken):
                # Token already expired, malformed, or already blacklisted —
                # an expected, recoverable case. Cookies are cleared anyway
                # so the client ends up logged out regardless.
                logger.warning(
                    'auth.logout.invalid_token',
                    extra={'user_id': request.user.id},
                )
            except Exception:
                # Unexpected failure (e.g. blacklist app DB error) — last
                # barrier: log with stack trace but do not fail the logout,
                # cookies are still cleared below.
                logger.exception(
                    'auth.logout.unexpected',
                    extra={'user_id': request.user.id},
                )
        else:
            response.data = {'detail': 'No se proporcionó token de refresco; cookies eliminadas.'}

        return response
