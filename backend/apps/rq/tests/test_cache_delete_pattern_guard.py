"""
SYSPCC-012 FIX 1: apps.rq.cache.safe_delete_pattern must not blow up with
AttributeError when the configured cache backend doesn't implement
`delete_pattern` (a django-redis-only method) — it should log a warning and
continue instead of raising.
"""
from unittest import mock

from apps.rq.cache import safe_delete_pattern, invalidate_dashboard_cache, invalidate_workflow_cache


class _CacheWithoutDeletePattern:
    """Stand-in for a cache backend that lacks delete_pattern (e.g. LocMemCache)."""


class _CacheWithDeletePattern:
    def __init__(self):
        self.calls = []

    def delete_pattern(self, pattern):
        self.calls.append(pattern)


class TestDeletePatternGuard:
    def test_backend_missing_delete_pattern_logs_warning_and_does_not_raise(self):
        fake_cache = _CacheWithoutDeletePattern()
        with mock.patch('apps.rq.cache.cache', fake_cache), \
             mock.patch('apps.rq.cache.logger.warning') as mock_warning:
            safe_delete_pattern('*workflow_steps:*')  # must not raise

        mock_warning.assert_called_once()
        assert mock_warning.call_args[0][0] == 'cache.delete_pattern.unsupported'

    def test_backend_with_delete_pattern_is_called_normally(self):
        fake_cache = _CacheWithDeletePattern()
        with mock.patch('apps.rq.cache.cache', fake_cache), \
             mock.patch('apps.rq.cache.logger.warning') as mock_warning:
            safe_delete_pattern('*workflow_steps:*')

        assert fake_cache.calls == ['*workflow_steps:*']
        mock_warning.assert_not_called()

    def test_invalidate_workflow_cache_all_flows_uses_guard(self):
        fake_cache = _CacheWithoutDeletePattern()
        with mock.patch('apps.rq.cache.cache', fake_cache):
            invalidate_workflow_cache()  # must not raise even without delete_pattern

    def test_invalidate_dashboard_cache_all_users_uses_guard(self):
        fake_cache = _CacheWithoutDeletePattern()
        with mock.patch('apps.rq.cache.cache', fake_cache):
            invalidate_dashboard_cache()  # must not raise even without delete_pattern
