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
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
from drf_spectacular.utils import extend_schema

from apps.core.serializers.auth import CustomTokenObtainPairSerializer

logger = logging.getLogger(__name__)


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


class LoginRateThrottle(AnonRateThrottle):
    """Strict per-IP throttle applied only to the login endpoint."""
    scope = 'login'


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Login endpoint.  Sets JWT access and refresh tokens as httpOnly cookies.
    Returns user profile data in the response body — never the raw tokens.
    """

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]

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

        secure = not settings.DEBUG

        samesite = 'Lax'

        # Access token cookie — 15 minutes
        response.set_cookie(
            key='access_token',
            value=access_token,
            max_age=60 * 15,
            httponly=True,
            secure=secure,
            samesite=samesite,
            path='/',
        )

        # Refresh token cookie — 1 day
        response.set_cookie(
            key='refresh_token',
            value=refresh_token,
            max_age=60 * 60 * 24,
            httponly=True,
            secure=secure,
            samesite=samesite,
            path='/',
        )

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
        response.delete_cookie('access_token', path='/')
        response.delete_cookie('refresh_token', path='/')

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
