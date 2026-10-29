"""
SYSPCC-026 (Fase 1, revisión): the throttle counters of the rq tests are private.

`TestCatalogRateLimit::test_the_dedicated_limit_answers_429` failed intermittently
(`[200, 200, 429]`): its counter lived in the Redis shared with every other run and
was keyed by a user pk that repeats from test to test. `apps/rq/tests/conftest.py`
now moves the throttle alias to a LocMem cache that is new for each test; these
tests keep that from regressing.
"""
import pytest
from django.conf import settings
from django.core.cache import caches
from django.core.cache.backends.locmem import LocMemCache

from apps.rq.tests.catalog_fixtures import client_for, make_inventory

CATALOG_URL = '/api/v1/request-catalog/'


@pytest.mark.django_db
class TestThrottleCountersArePrivate:
    def test_the_throttle_alias_is_not_the_shared_default_cache(self):
        assert settings.THROTTLE_CACHE_ALIAS != 'default'
        assert isinstance(caches[settings.THROTTLE_CACHE_ALIAS], LocMemCache)

    def test_a_request_is_counted_in_the_private_cache(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')

        client_for(requester).get(CATALOG_URL, {'search': 'casco'})

        private = caches[settings.THROTTLE_CACHE_ALIAS]
        assert private.get(f'throttle_rq_catalog_{requester.pk}') is not None
        assert private.get(f'throttle_user_{requester.pk}') is not None

    def test_a_test_starts_with_empty_counters(self, requester):
        """The one before this (or a parallel run) leaves nothing behind."""
        private = caches[settings.THROTTLE_CACHE_ALIAS]
        assert private.get(f'throttle_rq_catalog_{requester.pk}') is None
        assert private.get(f'throttle_user_{requester.pk}') is None

    def test_the_count_is_exactly_what_this_test_made(self, requester):
        """
        DRF keeps the history of request times for the scope: five requests leave
        five entries, not five plus whatever earlier tests (or another run on the
        same machine) added for the same user pk.
        """
        make_inventory('EPP-0001', 'Casco de seguridad')
        client = client_for(requester)
        for _ in range(5):
            client.get(CATALOG_URL, {'search': 'casco'})

        history = caches[settings.THROTTLE_CACHE_ALIAS].get(f'throttle_rq_catalog_{requester.pk}')
        assert len(history) == 5
