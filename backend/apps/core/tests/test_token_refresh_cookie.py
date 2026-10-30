"""
SYSPCC-034: token refresh over the cookie-based JWT flow.

The login stores the refresh token in the HttpOnly `refresh_token` cookie and
the SPA refreshes with an EMPTY body (+ X-CSRFToken). SimpleJWT's stock
`TokenRefreshView` only reads the body, so every refresh answered 400 and the
user was logged out when the 15-minute access token expired.

As in test_csrf_enforcement.py, these tests use `APIClient(enforce_csrf_checks=
True)` and the real login endpoint (never `force_authenticate`).
"""

import jwt
import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from apps.core.throttling import AnonThrottle
from apps.core.views.auth import TokenRefreshThrottle

CSRF_URL = '/api/v1/auth/csrf/'
LOGIN_URL = '/api/v1/auth/login/'
REFRESH_URL = '/api/v1/auth/token/refresh/'
ME_URL = '/api/v1/users/me/'

USER_PASSWORD = 'TestPass2026!'


def _logged_in_client(user):
    """CSRF-enforcing client that went through the real login.
    Returns (client, csrf_token)."""
    client = APIClient(enforce_csrf_checks=True)
    csrf = client.get(CSRF_URL).cookies['csrftoken'].value
    response = client.post(
        LOGIN_URL,
        {'username': user.username, 'password': USER_PASSWORD},
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == status.HTTP_200_OK
    return client, csrf


def _jti(raw_refresh):
    # Unverified decode: RefreshToken() itself refuses blacklisted tokens.
    return jwt.decode(raw_refresh, options={'verify_signature': False})['jti']


def _assert_cookies_untouched(response):
    # A failed refresh must not clear the cookies: another tab may have just
    # rotated them (see CookieTokenRefreshView).
    assert 'access_token' not in response.cookies
    assert 'refresh_token' not in response.cookies


@pytest.mark.django_db
class TestRefreshByCookie:
    def test_empty_body_with_csrf_header_returns_200_and_new_cookies(self, user):
        client, csrf = _logged_in_client(user)
        old_access = client.cookies['access_token'].value
        old_refresh = client.cookies['refresh_token'].value

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK
        # Tokens travel only in cookies, never in the JSON body.
        assert 'access' not in response.data
        assert 'refresh' not in response.data
        assert response.cookies['access_token'].value
        assert response.cookies['refresh_token'].value
        assert response.cookies['refresh_token'].value != old_refresh
        assert client.cookies['access_token'].value != old_access

    def test_cookie_attributes_match_the_login(self, user, settings):
        settings.DEBUG = False  # prod-like: Secure must be on
        client = APIClient(enforce_csrf_checks=True)
        csrf = client.get(CSRF_URL).cookies['csrftoken'].value
        login = client.post(
            LOGIN_URL,
            {'username': user.username, 'password': USER_PASSWORD},
            HTTP_X_CSRFTOKEN=csrf,
        )

        refreshed = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert refreshed.status_code == status.HTTP_200_OK
        for name in ('access_token', 'refresh_token'):
            before, after = login.cookies[name], refreshed.cookies[name]
            for attr in ('max-age', 'path', 'httponly', 'secure', 'samesite', 'domain'):
                assert after[attr] == before[attr], f'{name}: {attr} differs'
        assert refreshed.cookies['access_token']['secure'] is True

    def test_new_access_cookie_authenticates_requests(self, user):
        client, csrf = _logged_in_client(user)
        client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        response = client.get(ME_URL)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['username'] == user.username

    def test_works_when_the_access_cookie_is_already_gone(self, user):
        """The real scenario: the 15-min access cookie expired and the
        browser dropped it, only refresh_token (+ csrftoken) remain."""
        client, csrf = _logged_in_client(user)
        del client.cookies['access_token']

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK
        assert response.cookies['access_token'].value

    def test_works_when_the_access_cookie_is_expired_garbage(self, user):
        client, csrf = _logged_in_client(user)
        client.cookies['access_token'] = 'expired.or.invalid'

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK

    def test_rotation_blacklists_the_old_refresh_and_reuse_is_401(self, user):
        client, csrf = _logged_in_client(user)
        old_refresh = client.cookies['refresh_token'].value

        first = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)
        assert first.status_code == status.HTTP_200_OK
        assert BlacklistedToken.objects.filter(token__jti=_jti(old_refresh)).exists()

        # Replay the rotated-out token (cookie path).
        client.cookies['refresh_token'] = old_refresh
        replay = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert replay.status_code == status.HTTP_401_UNAUTHORIZED
        _assert_cookies_untouched(replay)

    def test_losing_tab_of_a_concurrent_refresh_keeps_the_winner_session(self, user):
        client, csrf = _logged_in_client(user)
        old_refresh = client.cookies['refresh_token'].value

        winner = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)
        assert winner.status_code == status.HTTP_200_OK
        fresh_refresh = client.cookies['refresh_token'].value

        loser = APIClient(enforce_csrf_checks=True)
        loser.cookies['refresh_token'] = old_refresh
        loser.cookies['csrftoken'] = csrf
        assert loser.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code == 401

        # The browser keeps the winner's cookies, which still work.
        assert client.cookies['refresh_token'].value == fresh_refresh
        assert client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code == 200

    def test_refresh_keeps_working_across_consecutive_rotations(self, user):
        client, csrf = _logged_in_client(user)

        for _ in range(3):
            response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)
            assert response.status_code == status.HTTP_200_OK

    def test_user_with_must_change_password_can_still_refresh(self, user):
        client, csrf = _logged_in_client(user)
        user.must_change_password = True
        user.save(update_fields=['must_change_password'])

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestRefreshWithoutValidToken:
    def test_no_cookie_is_401_with_uniform_error(self):
        client = APIClient(enforce_csrf_checks=True)

        response = client.post(REFRESH_URL, {}, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data['error'] is True
        assert response.data['status_code'] == 401
        assert 'refresco' in response.data['detail']
        assert response.has_header('WWW-Authenticate')

    def test_invalid_cookie_token_is_401_and_keeps_cookies(self, user):
        client, csrf = _logged_in_client(user)
        client.cookies['refresh_token'] = 'not-a-jwt'

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data['error'] is True
        assert response.data['code'] == 'token_not_valid'
        _assert_cookies_untouched(response)

    def test_blacklisted_cookie_token_is_401_and_keeps_cookies(self, user):
        client, csrf = _logged_in_client(user)
        RefreshToken(client.cookies['refresh_token'].value).blacklist()

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        _assert_cookies_untouched(response)

    def test_after_logout_the_old_refresh_cannot_be_used(self, user):
        client, csrf = _logged_in_client(user)
        old_refresh = client.cookies['refresh_token'].value
        assert client.post('/api/v1/auth/logout/', HTTP_X_CSRFTOKEN=csrf).status_code == 200

        client.cookies['refresh_token'] = old_refresh
        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestRefreshCookieOnly:
    """The body is never read: no fallback, so no way around the CSRF check."""

    def test_cookie_plus_empty_json_body_returns_200(self, user):
        """What the SPA really sends: JSON content type with `{}`."""
        client, csrf = _logged_in_client(user)

        response = client.post(REFRESH_URL, {}, format='json', HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK

    def test_refresh_in_body_without_cookie_is_401(self, user):
        refresh = str(RefreshToken.for_user(user))
        client = APIClient(enforce_csrf_checks=True)

        response = client.post(REFRESH_URL, {'refresh': refresh}, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert 'refresh_token' not in response.cookies
        assert not BlacklistedToken.objects.filter(token__jti=_jti(refresh)).exists()

    def test_body_token_is_ignored_when_the_cookie_is_present(self, user):
        client, csrf = _logged_in_client(user)
        other = str(RefreshToken.for_user(user))

        response = client.post(REFRESH_URL, {'refresh': other}, format='json',
                               HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_200_OK
        assert not BlacklistedToken.objects.filter(token__jti=_jti(other)).exists()

    def test_access_token_used_as_refresh_is_401(self, user):
        client, csrf = _logged_in_client(user)
        client.cookies['refresh_token'] = client.cookies['access_token'].value

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data['code'] == 'token_not_valid'
        _assert_cookies_untouched(response)


@pytest.mark.django_db
class TestRefreshUserState:
    def test_inactive_user_is_401_without_rotating(self, user):
        client, csrf = _logged_in_client(user)
        refresh = client.cookies['refresh_token'].value
        user.is_active = False
        user.save(update_fields=['is_active'])

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data['code'] == 'token_not_valid'
        _assert_cookies_untouched(response)
        assert not BlacklistedToken.objects.filter(token__jti=_jti(refresh)).exists()

    def test_deleted_user_is_401_without_rotating(self, user):
        client, csrf = _logged_in_client(user)
        refresh = client.cookies['refresh_token'].value
        jti = _jti(refresh)
        user.delete()

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.data['code'] == 'token_not_valid'
        _assert_cookies_untouched(response)
        assert not BlacklistedToken.objects.filter(token__jti=jti).exists()

    def test_reactivated_user_can_refresh_again(self, user):
        client, csrf = _logged_in_client(user)
        user.is_active = False
        user.save(update_fields=['is_active'])
        assert client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code == 401
        user.is_active = True
        user.save(update_fields=['is_active'])

        assert client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code == 200


@pytest.mark.django_db
class TestRefreshThrottle:
    @pytest.fixture(autouse=True)
    def _clean_cache(self):
        cache.clear()
        yield
        cache.clear()

    def test_rate_is_declared_in_settings(self, settings):
        # base.py (inherited by production) and development.py both declare it.
        assert settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['token_refresh'] == '300/min'

    def test_refresh_does_not_share_the_anon_bucket_with_csrf(self, user, monkeypatch):
        """With prod rates (anon 30/min), more than 30 refreshes from one IP
        (an office behind a NAT) must all succeed."""
        monkeypatch.setitem(AnonThrottle.THROTTLE_RATES, 'anon', '30/min')
        monkeypatch.setitem(TokenRefreshThrottle.THROTTLE_RATES, 'token_refresh', '300/min')
        client, csrf = _logged_in_client(user)

        statuses = [client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code for _ in range(31)]

        assert statuses == [status.HTTP_200_OK] * 31

    def test_refresh_is_still_rate_limited(self, user, monkeypatch):
        monkeypatch.setitem(TokenRefreshThrottle.THROTTLE_RATES, 'token_refresh', '3/min')
        client, csrf = _logged_in_client(user)

        statuses = [client.post(REFRESH_URL, HTTP_X_CSRFTOKEN=csrf).status_code for _ in range(5)]

        assert statuses == [200, 200, 200, 429, 429]


@pytest.mark.django_db
class TestRefreshCsrf:
    def test_cookie_refresh_without_csrf_header_is_rejected(self, user):
        client, _csrf = _logged_in_client(user)
        old_refresh = client.cookies['refresh_token'].value

        response = client.post(REFRESH_URL)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'CSRF' in response.data['detail']
        # Rejected before touching the token: not rotated nor blacklisted.
        assert not BlacklistedToken.objects.filter(token__jti=_jti(old_refresh)).exists()

    def test_cookie_refresh_with_wrong_csrf_header_is_rejected(self, user):
        client, _csrf = _logged_in_client(user)

        response = client.post(REFRESH_URL, HTTP_X_CSRFTOKEN='not-the-real-token')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'CSRF' in response.data['detail']

    def test_csrf_failure_does_not_clear_the_session_cookies(self, user):
        client, _csrf = _logged_in_client(user)

        response = client.post(REFRESH_URL)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'refresh_token' not in response.cookies
