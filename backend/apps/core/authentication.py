"""
Custom JWT authentication that reads access tokens from httpOnly cookies
instead of the Authorization header.
"""

from django.middleware.csrf import CsrfViewMiddleware
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication

# Methods that never mutate state — CSRF enforcement does not apply to them,
# mirroring Django's own CsrfViewMiddleware.
SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')

# SYSPCC-018: while `User.must_change_password` is True, every request is
# blocked EXCEPT the handful of paths the forced-password-change flow itself
# needs (view/patch own profile, change own password, log out, refresh the
# CSRF cookie, refresh the access token). Exact paths, trailing slash
# included — must match the routers in `apps/core/urls/*.py`.
MUST_CHANGE_PASSWORD_ALLOWLIST = frozenset({
    '/api/v1/users/me/',
    '/api/v1/users/me/change-password/',
    '/api/v1/auth/logout/',
    '/api/v1/auth/csrf/',
    '/api/v1/auth/token/refresh/',
})


class CSRFCheck(CsrfViewMiddleware):
    """Runs the real CsrfViewMiddleware logic but returns the failure reason
    instead of short-circuiting into an HttpResponse — same trick DRF's own
    `rest_framework.authentication.CSRFCheck` uses for SessionAuthentication."""

    def _reject(self, request, reason):
        return reason


class CookieJWTAuthentication(JWTAuthentication):
    """
    Reads the JWT access token from the 'access_token' httpOnly cookie.
    Falls back gracefully (returns None) when no cookie is present so that
    DRF can try other authentication backends if configured.

    SYSPCC-015 (CSRF enforcement): because auth is cookie-based, mutating
    requests ride the browser's ambient cookie jar the same way a
    session-auth request would, so this class now enforces CSRF the same way
    `rest_framework.authentication.SessionAuthentication` does for
    non-safe methods (POST/PUT/PATCH/DELETE) — GET/HEAD/OPTIONS stay exempt.
    The frontend must call `GET /api/v1/auth/csrf/` once on startup (before
    login) to receive the `csrftoken` cookie, then echo it back via the
    `X-CSRFToken` header on every mutating request, including login itself.

    SYSPCC-018 (forced password change): this is the only authentication
    class registered in `DEFAULT_AUTHENTICATION_CLASSES` and no ViewSet
    overrides it, making it the single global hook available to enforce
    `User.must_change_password` — a DRF global permission would go unused
    by any ViewSet that sets its own `permission_classes` (nearly all of
    them do), and Django middleware cannot see `request.user` since auth
    here is JWT-by-cookie, not session-based.
    """

    def authenticate(self, request):
        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)

        if request.method not in SAFE_METHODS:
            self.enforce_csrf(request)

        if user.must_change_password and request.path not in MUST_CHANGE_PASSWORD_ALLOWLIST:
            raise exceptions.PermissionDenied(
                detail='Debe actualizar su contraseña antes de continuar.',
                code='must_change_password',
            )

        return user, validated_token

    def enforce_csrf(self, request):
        """
        Validate the double-submit CSRF token for a non-safe request.
        Raises `exceptions.PermissionDenied` (-> 403) if missing/invalid.
        """

        def dummy_get_response(request):  # pragma: no cover - required by CsrfViewMiddleware's signature
            return None

        check = CSRFCheck(dummy_get_response)
        # Populates request.META['CSRF_COOKIE'], read by process_view() below.
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied('CSRF Failed: %s' % reason)
