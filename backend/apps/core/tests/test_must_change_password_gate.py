"""
SYSPCC-018 — the forced-password-change gate.

`CookieJWTAuthentication.authenticate()` blocks every request from a user
with `must_change_password=True` except a small allowlist of paths (own
profile, change own password, logout, CSRF bootstrap, token refresh). This
lives inside the authenticator itself (see the design rationale in
`authentication.py` and `FASE 0 §2` of the handoff) — the ONE hook that
always runs regardless of which `permission_classes` a given ViewSet sets.

Every test here uses a REAL login (`APIClient(enforce_csrf_checks=True)` +
`POST /auth/login/`), never `force_authenticate` — the latter sets
`request._force_auth_user` directly and never calls
`CookieJWTAuthentication.authenticate()` at all, which would make the gate
itself untestable (confirmed in FASE 1/FASE 3 of the handoff). Pattern
mirrors `test_csrf_enforcement.py`.
"""

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

CSRF_URL = '/api/v1/auth/csrf/'
LOGIN_URL = '/api/v1/auth/login/'
LOGOUT_URL = '/api/v1/auth/logout/'
REFRESH_URL = '/api/v1/auth/token/refresh/'
ME_URL = '/api/v1/users/me/'
CHANGE_PASSWORD_URL = '/api/v1/users/me/change-password/'
PROJECTS_URL = '/api/v1/projects/'  # any endpoint outside the allowlist

USER_PASSWORD = 'TestPass2026!'


def _bootstrap_csrf(client):
    response = client.get(CSRF_URL)
    assert response.status_code == status.HTTP_200_OK
    return response.cookies['csrftoken'].value


def _authenticated_client(user):
    """Real login flow — see module docstring for why this can't be
    `force_authenticate`. Returns (client, csrf_token, refresh_token_value).

    `refresh_token_value` is only obtainable here because the test client
    can read `login_response.cookies` directly — a real browser could not
    (the cookie is httpOnly), which is exactly why `TokenRefreshView` being
    a *stock* simplejwt view that reads `request.data['refresh']` instead of
    the cookie is a pre-existing, out-of-scope gap (not touched by
    SYSPCC-018): the frontend's `refreshToken()` never sends a body. Tests
    below use the value directly to exercise the allowlisted endpoint for
    real, sidestepping that unrelated gap.
    """
    client = APIClient(enforce_csrf_checks=True)
    csrf_token = _bootstrap_csrf(client)
    login_response = client.post(
        LOGIN_URL,
        {'username': user.username, 'password': USER_PASSWORD},
        HTTP_X_CSRFTOKEN=csrf_token,
    )
    assert login_response.status_code == status.HTTP_200_OK
    refresh_token_value = login_response.cookies['refresh_token'].value
    return client, csrf_token, refresh_token_value


@pytest.fixture(autouse=True)
def _reset_login_throttle():
    """Every test in this file logs in for real (see module docstring), all
    against `LoginRateThrottle` (scope 'login', keyed by client IP). That
    throttle's counter lives in the cache backend (Redis in dev), which —
    unlike the DB — is NOT reset between separate `pytest` invocations by
    pytest-django's per-test transaction rollback. Without this, running the
    suite twice back-to-back within the same rate-limit window makes later
    tests here fail with 429s that have nothing to do with the behavior
    under test. Clearing it before each test keeps this file deterministic
    regardless of recent history."""
    cache.clear()
    yield


@pytest.fixture
def forced_user(user):
    """The `user` fixture, flagged for forced password change post-login."""
    user.must_change_password = True
    user.save(update_fields=['must_change_password'])
    return user


@pytest.mark.django_db
class TestGateBlocksOutsideAllowlist:
    def test_get_outside_allowlist_returns_403_with_code(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)

        response = client.get(PROJECTS_URL)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data['code'] == 'must_change_password'
        assert response.data['error'] is True

    def test_post_outside_allowlist_returns_403_with_code(self, forced_user, project):
        client, csrf_token, _refresh_token = _authenticated_client(forced_user)

        response = client.post(
            f'/api/v1/projects/{project.id}/activate/', HTTP_X_CSRFTOKEN=csrf_token
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data['code'] == 'must_change_password'

    def test_gate_does_not_apply_when_flag_is_false(self, user):
        """Sanity check: a normal user (flag False, the fixture default) is
        never touched by this gate."""
        client, _csrf, _refresh_token = _authenticated_client(user)

        response = client.get(PROJECTS_URL)

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestAllowlistPassesThrough:
    def test_get_me_passes(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)
        response = client.get(ME_URL)
        assert response.status_code == status.HTTP_200_OK

    def test_logout_passes(self, forced_user):
        client, csrf_token, _refresh_token = _authenticated_client(forced_user)
        response = client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN=csrf_token)
        assert response.status_code == status.HTTP_200_OK

    def test_csrf_bootstrap_passes(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)
        response = client.get(CSRF_URL)
        assert response.status_code == status.HTTP_200_OK

    def test_token_refresh_passes(self, forced_user):
        client, csrf_token, refresh_token = _authenticated_client(forced_user)
        # `TokenRefreshView` is a stock simplejwt view — it reads `refresh`
        # from the request body, not the cookie (see `_authenticated_client`
        # docstring), so the token is passed explicitly here to get a real
        # 200 and prove the gate's allowlist truly lets this endpoint work,
        # not just "doesn't 403".
        response = client.post(
            REFRESH_URL, {'refresh': refresh_token}, HTTP_X_CSRFTOKEN=csrf_token
        )
        assert response.status_code == status.HTTP_200_OK

    def test_change_password_endpoint_itself_is_reachable(self, forced_user):
        client, csrf_token, _refresh_token = _authenticated_client(forced_user)
        response = client.post(
            CHANGE_PASSWORD_URL,
            {
                'old_password': USER_PASSWORD,
                'new_password': 'NuevaPass2026super!',
                'new_password_confirm': 'NuevaPass2026super!',
            },
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestChangePasswordExitsForcedFlow:
    def test_successful_change_clears_flag_and_restores_general_access(self, forced_user):
        client, csrf_token, _refresh_token = _authenticated_client(forced_user)

        # Blocked before changing the password.
        blocked = client.get(PROJECTS_URL)
        assert blocked.status_code == status.HTTP_403_FORBIDDEN

        change_response = client.post(
            CHANGE_PASSWORD_URL,
            {
                'old_password': USER_PASSWORD,
                'new_password': 'NuevaPass2026super!',
                'new_password_confirm': 'NuevaPass2026super!',
            },
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert change_response.status_code == status.HTTP_200_OK

        forced_user.refresh_from_db()
        assert forced_user.must_change_password is False

        # The very same session, now allowed through.
        unblocked = client.get(PROJECTS_URL)
        assert unblocked.status_code == status.HTTP_200_OK

    def test_wrong_old_password_does_not_clear_flag(self, forced_user):
        client, csrf_token, _refresh_token = _authenticated_client(forced_user)

        response = client.post(
            CHANGE_PASSWORD_URL,
            {
                'old_password': 'esto-no-es-la-temporal',
                'new_password': 'NuevaPass2026super!',
                'new_password_confirm': 'NuevaPass2026super!',
            },
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        forced_user.refresh_from_db()
        assert forced_user.must_change_password is True


@pytest.mark.django_db
class TestGateBypassAttempts:
    """Security-auditor-verified paths, pinned as regression tests: the gate
    keys off `request.path` (query-string-free, exact match, trailing slash
    required) — none of these should leak a blocked endpoint."""

    def test_missing_trailing_slash_redirects_but_still_ends_up_blocked(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)

        direct = client.get('/api/v1/projects')  # no trailing slash
        assert direct.status_code == status.HTTP_301_MOVED_PERMANENTLY

        followed = client.get('/api/v1/projects', follow=True)
        assert followed.status_code == status.HTTP_403_FORBIDDEN
        assert followed.data['code'] == 'must_change_password'

    def test_double_slash_is_not_a_valid_route(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)

        response = client.get('/api/v1/projects//')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_query_string_on_blocked_endpoint_stays_blocked(self, forced_user):
        client, _csrf, _refresh_token = _authenticated_client(forced_user)

        response = client.get(f'{PROJECTS_URL}?is_active=true')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data['code'] == 'must_change_password'

    def test_query_string_on_allowlisted_endpoint_still_passes(self, forced_user):
        """Proves the allowlist match is on the path alone (Django already
        strips the query string into `request.path`), not accidentally
        stricter than intended."""
        client, _csrf, _refresh_token = _authenticated_client(forced_user)

        response = client.get(f'{ME_URL}?noop=1')

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestLoginPayloadIncludesForcedChangeFields:
    def test_login_response_includes_is_superuser_and_must_change_password(self, user):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = _bootstrap_csrf(client)

        response = client.post(
            LOGIN_URL,
            {'username': user.username, 'password': USER_PASSWORD},
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['is_superuser'] is False
        assert response.data['user']['must_change_password'] is False

    def test_login_response_reflects_true_flag_for_forced_user(self, forced_user):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = _bootstrap_csrf(client)

        response = client.post(
            LOGIN_URL,
            {'username': forced_user.username, 'password': USER_PASSWORD},
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['must_change_password'] is True

    def test_login_response_reflects_is_superuser_true(self, superuser):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = _bootstrap_csrf(client)

        response = client.post(
            LOGIN_URL,
            {'username': superuser.username, 'password': USER_PASSWORD},
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['is_superuser'] is True
