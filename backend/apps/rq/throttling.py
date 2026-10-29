"""
Throttles specific to the rq app (SYSPCC-026).
"""

from rest_framework.throttling import UserRateThrottle

from apps.core.throttling import ThrottleCacheMixin


class RequestCatalogThrottle(ThrottleCacheMixin, UserRateThrottle):
    """
    Per-user limit for the type-ahead catalog search (scope ``rq_catalog``).

    The catalog is open to every authenticated user (requesters pick their lines
    from it), so on top of the global per-user limit it gets its own, tighter
    ceiling against scraping. A debounced search box stays well under it.
    The default applies when the scope is not configured in the REST_FRAMEWORK
    settings, so no settings change is required to deploy it.
    """

    scope = 'rq_catalog'
    DEFAULT_RATE = '120/min'

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope) or self.DEFAULT_RATE
