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
    """

    def authenticate(self, request):
        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
