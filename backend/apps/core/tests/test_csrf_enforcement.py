"""
SYSPCC-015: CSRF enforcement for cookie-based JWT auth.

Because auth lives in httpOnly cookies (`CookieJWTAuthentication`), mutating
requests ride the browser's ambient cookie jar exactly like session auth
would. DRF's `APIView.as_view()` marks every view CSRF-exempt at the Django
middleware level, so the only place enforcement can live is inside
`CookieJWTAuthentication.authenticate()` itself (apps/core/authentication.py),
mirroring `rest_framework.authentication.SessionAuthentication.enforce_csrf`.

Contract under test (shared with the frontend, do not change silently):
  - Cookie: `csrftoken` (Django default), CSRF_COOKIE_HTTPONLY=False so JS can
    read it, CSRF_COOKIE_SAMESITE='Lax'.
  - Header: `X-CSRFToken` (Django default).
  - Bootstrap: GET /api/v1/auth/csrf/ sets the cookie, called before any
    mutating request including login.
  - Enforcement applies only to non-safe methods (POST/PUT/PATCH/DELETE).

These tests use `APIClient(enforce_csrf_checks=True)` (default is False,
which is a Django/DRF *test-only* convenience that silently disables CSRF
checking) and real login via POST, never `force_authenticate` — the latter
sets `request._force_auth_user` directly and never calls
`CookieJWTAuthentication.authenticate()` at all, so it would make the whole
enforcement path untestable.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

CSRF_BOOTSTRAP_URL = '/api/v1/auth/csrf/'
LOGIN_URL = '/api/v1/auth/login/'
LOGOUT_URL = '/api/v1/auth/logout/'
ME_URL = '/api/v1/users/me/'

USER_PASSWORD = 'TestPass2026!'


def _bootstrap_csrf(client):
    """GET the bootstrap endpoint and return the csrftoken cookie value."""
    response = client.get(CSRF_BOOTSTRAP_URL)
    assert response.status_code == status.HTTP_200_OK
    assert 'csrftoken' in response.cookies
    return response.cookies['csrftoken'].value


def _login(client, user, csrf_token):
    """Log in via the real endpoint (never force_authenticate — see module
    docstring) so the client ends up with real access_token/refresh_token
    cookies, exactly like a browser would."""
    return client.post(
        LOGIN_URL,
        {'username': user.username, 'password': USER_PASSWORD},
        HTTP_X_CSRFTOKEN=csrf_token,
    )


def _authenticated_client(user):
    """A CSRF-enforcing client that has completed the real login flow:
    GET /auth/csrf/ -> POST /auth/login/ with X-CSRFToken -> JWT cookies set.
    Returns (client, csrf_token) so callers can choose whether to send the
    header on their own follow-up requests."""
    client = APIClient(enforce_csrf_checks=True)
    csrf_token = _bootstrap_csrf(client)
    login_response = _login(client, user, csrf_token)
    assert login_response.status_code == status.HTTP_200_OK
    assert 'access_token' in login_response.cookies
    return client, csrf_token


@pytest.mark.django_db
class TestCsrfBootstrapEndpoint:
    def test_get_csrf_returns_200_and_sets_cookie(self):
        client = APIClient(enforce_csrf_checks=True)

        response = client.get(CSRF_BOOTSTRAP_URL)

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {'detail': 'CSRF cookie set'}
        assert 'csrftoken' in response.cookies
        assert response.cookies['csrftoken'].value  # non-empty token

    def test_csrf_bootstrap_requires_no_prior_authentication(self):
        """AllowAny — an anonymous visitor must be able to bootstrap the
        cookie before ever logging in."""
        client = APIClient(enforce_csrf_checks=True)

        response = client.get(CSRF_BOOTSTRAP_URL)

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestCsrfEnforcementOnMutatingRequests:
    def test_authenticated_post_without_csrf_header_is_rejected(self, user):
        client, _csrf_token = _authenticated_client(user)

        # Deliberately omit X-CSRFToken on this follow-up mutating request —
        # the csrftoken *cookie* still rides along automatically (the test
        # client persists cookies across requests), but that alone must not
        # be enough: the double-submit header is required.
        response = client.post(LOGOUT_URL)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'CSRF' in response.data['detail']

    def test_authenticated_post_with_wrong_csrf_header_is_rejected(self, user):
        client, _csrf_token = _authenticated_client(user)

        response = client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN='not-the-real-token')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'CSRF' in response.data['detail']

    def test_authenticated_post_with_correct_csrf_header_succeeds(self, user):
        client, csrf_token = _authenticated_client(user)

        response = client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN=csrf_token)

        assert response.status_code == status.HTTP_200_OK

    def test_authenticated_get_without_csrf_header_succeeds(self, user):
        """Safe methods (GET/HEAD/OPTIONS) are exempt from enforcement."""
        client, _csrf_token = _authenticated_client(user)

        response = client.get(ME_URL)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['username'] == user.username


@pytest.mark.django_db
class TestLoginUnaffectedByCsrfEnforcement:
    def test_login_succeeds_when_client_sends_csrf_token(self, user):
        """The documented frontend contract: GET /auth/csrf/ first, then send
        X-CSRFToken on the login POST itself."""
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = _bootstrap_csrf(client)

        response = _login(client, user, csrf_token)

        assert response.status_code == status.HTTP_200_OK
        assert 'access_token' in response.cookies
        assert 'refresh_token' in response.cookies

    def test_login_is_not_blocked_even_without_a_csrf_header(self, user):
        """Documents *why* login is unaffected: CookieJWTAuthentication only
        calls enforce_csrf() once an access_token cookie already exists
        (`raw_token is not None`). At login time there is no such cookie yet,
        so this authenticator never runs enforce_csrf for the login request
        itself — this is not a special-cased exemption, it falls out of the
        authenticator only guarding requests that are already
        cookie-authenticated. Login-CSRF (forcing a victim into an
        attacker's account) is a separate, lower-severity concern out of
        scope for SYSPCC-015."""
        client = APIClient(enforce_csrf_checks=True)
        _bootstrap_csrf(client)

        response = client.post(LOGIN_URL, {'username': user.username, 'password': USER_PASSWORD})

        assert response.status_code == status.HTTP_200_OK
