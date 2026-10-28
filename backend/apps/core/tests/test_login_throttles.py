"""SYSPCC-024: login brute-force protection beyond the per-IP limit.

* Per-username throttle (``login_user``): rotating the source IP must not allow
  unlimited password guessing against one account.
* Throttle counters live in ``settings.THROTTLE_CACHE_ALIAS``.
"""

import pytest
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory

from apps.core.throttling import AnonThrottle, LoginUsernameThrottle, UserThrottle
from apps.core.views.auth import LoginRateThrottle

LOGIN_URL = '/api/v1/auth/login/'


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def _attempt(username, ip, password='wrong-password'):
    client = APIClient()
    return client.post(
        LOGIN_URL,
        {'username': username, 'password': password},
        format='json',
        HTTP_X_FORWARDED_FOR=ip,  # dev settings trust XFF as sent: simulates IP rotation
    )


@pytest.fixture
def tight_username_limit(monkeypatch):
    monkeypatch.setitem(LoginUsernameThrottle.THROTTLE_RATES, 'login_user', '3/min')
    monkeypatch.setitem(LoginRateThrottle.THROTTLE_RATES, 'login', '1000/min')


@pytest.mark.django_db
class TestLoginUsernameThrottle:
    def test_rotating_ips_cannot_bypass_the_per_username_limit(self, tight_username_limit):
        statuses = [_attempt('victim', f'198.51.100.{n}').status_code for n in range(1, 7)]

        assert statuses[:3] == [status.HTTP_401_UNAUTHORIZED] * 3
        assert statuses[3:] == [status.HTTP_429_TOO_MANY_REQUESTS] * 3

    def test_username_match_is_case_and_space_insensitive(self, tight_username_limit):
        for n, name in enumerate(['Victim', ' victim', 'VICTIM']):
            _attempt(name, f'198.51.100.{n}')

        assert _attempt('victim ', '198.51.100.99').status_code == status.HTTP_429_TOO_MANY_REQUESTS

    def test_other_usernames_are_not_affected(self, tight_username_limit):
        for n in range(4):
            _attempt('victim', f'198.51.100.{n}')

        assert _attempt('someone-else', '198.51.100.50').status_code == status.HTTP_401_UNAUTHORIZED

    def test_legitimate_login_still_works_below_the_limit(self, tight_username_limit, requester):
        response = _attempt(requester.username, '203.0.113.5', password='TestPass2026!')

        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.parametrize('body', [{}, {'username': ''}, {'username': '   '}, {'username': ['a']}, {'username': None}])
    def test_requests_without_a_usable_username_are_not_counted(self, tight_username_limit, body):
        factory = APIRequestFactory()
        request = factory.post(LOGIN_URL, body, format='json')
        throttle = LoginUsernameThrottle()

        assert throttle.get_cache_key(Request(request, parsers=[JSONParser()]), None) is None

    def test_malformed_body_does_not_crash_the_throttle(self, tight_username_limit):
        client = APIClient()
        response = client.post(LOGIN_URL, '{not json', content_type='application/json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_cache_key_never_contains_the_raw_username(self):
        request = APIRequestFactory().post(LOGIN_URL, {'username': 'Secret.Name'}, format='json')
        key = LoginUsernameThrottle().get_cache_key(Request(request, parsers=[JSONParser()]), None)

        assert 'secret' not in key.lower()
        assert key.startswith('throttle_login_user_')

    def test_default_rate_applies_when_the_scope_is_not_configured(self, monkeypatch):
        monkeypatch.delitem(LoginUsernameThrottle.THROTTLE_RATES, 'login_user', raising=False)

        assert LoginUsernameThrottle().get_rate() == '10/min'
        assert LoginUsernameThrottle().num_requests == 10


class TestThrottleCacheAlias:
    @pytest.mark.parametrize('klass', [AnonThrottle, UserThrottle, LoginRateThrottle, LoginUsernameThrottle])
    def test_default_alias_is_the_default_cache(self, klass):
        from django.core.cache import caches

        assert klass().cache is caches['default']

    @pytest.mark.parametrize('klass', [AnonThrottle, UserThrottle, LoginRateThrottle, LoginUsernameThrottle])
    def test_alias_is_resolved_from_settings(self, klass):
        from django.core.cache import caches

        with override_settings(
            THROTTLE_CACHE_ALIAS='throttle',
            CACHES={
                'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'a'},
                'throttle': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'b'},
            },
        ):
            assert klass().cache is caches['throttle']
            assert klass().cache is not caches['default']

    def test_drf_defaults_use_the_alias_aware_throttles(self):
        from django.conf import settings as dj_settings

        assert dj_settings.REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] == [
            'apps.core.throttling.AnonThrottle',
            'apps.core.throttling.UserThrottle',
        ]
