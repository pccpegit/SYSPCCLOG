"""
Custom JWT authentication that reads access tokens from httpOnly cookies
instead of the Authorization header.
"""

from rest_framework_simplejwt.authentication import JWTAuthentication


class CookieJWTAuthentication(JWTAuthentication):
    """
    Reads the JWT access token from the 'access_token' httpOnly cookie.
    Falls back gracefully (returns None) when no cookie is present so that
    DRF can try other authentication backends if configured.

    SYSPCC-011 (CSRF, evaluated — not changed here): because auth is
    cookie-based, mutating requests ride the browser's ambient cookie jar the
    same way a session-auth request would, but this class never calls
    `enforce_csrf()` — DRF's `APIView.as_view()` is CSRF-exempt by default and
    only `SessionAuthentication` re-enables the check, so effectively no CSRF
    token is required today. Mitigating factor: both auth cookies are set with
    `SameSite=Lax` (see apps/core/views/auth.py), which blocks the cookie from
    being sent on cross-site POST/PUT/PATCH/DELETE from another origin in
    modern browsers — a real but partial protection, not equivalent to a
    verified anti-CSRF token. Forcing `enforce_csrf()` here would 403 every
    mutating request the React SPA makes today, since the client does not
    currently send X-CSRFToken. Fixing this properly needs a coordinated
    frontend change (read the csrftoken cookie, send X-CSRFToken on every
    mutating call) alongside enabling enforcement here — deferred as a
    follow-up ticket rather than done as part of SYSPCC-011.
    """

    def authenticate(self, request):
        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
