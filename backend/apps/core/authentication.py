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
    """

    def authenticate(self, request):
        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)

        if request.method not in SAFE_METHODS:
            self.enforce_csrf(request)

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
