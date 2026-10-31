"""Throttles of the warehouse module (SYSPCC-025). Rates live in settings (base + development)."""
from rest_framework.throttling import UserRateThrottle

from apps.core.throttling import ThrottleCacheMixin


class WarehouseLookupThrottle(ThrottleCacheMixin, UserRateThrottle):
    """Worker lookup used by the EPP delivery combobox (scope ``warehouse_lookup``)."""

    scope = 'warehouse_lookup'


class WarehouseImportThrottle(ThrottleCacheMixin, UserRateThrottle):
    """Workbook upload (preview) of the inventory importer (scope ``warehouse_import``)."""

    scope = 'warehouse_import'


class WarehouseDeliveryThrottle(ThrottleCacheMixin, UserRateThrottle):
    """
    Partial deliveries and reversals against an RQ (SYSPCC-029, scope ``warehouse_delivery``).

    Each call writes stock movements and documents under row locks, so it gets its own, tighter
    bucket on top of the global per-user limit. Falls back to ``DEFAULT_RATE`` when a deployment
    (or a test that replaces ``THROTTLE_RATES``) does not define the scope.
    """

    scope = 'warehouse_delivery'
    DEFAULT_RATE = '60/min'

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope) or self.DEFAULT_RATE


class WarehouseExitThrottle(ThrottleCacheMixin, UserRateThrottle):
    """
    Free exits (``batch-exit``, ``exit``, ``epp-delivery``; SYSPCC-041, scope ``warehouse_exit``).

    Every exit holds the row of the yearly guide counter until it commits, so one user flooding
    this endpoint would queue the whole company's exits. A tighter bucket than the global per-user
    limit. Falls back to ``DEFAULT_RATE`` when a deployment (or a test) does not define the scope.
    """

    scope = 'warehouse_exit'
    DEFAULT_RATE = '30/min'

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope) or self.DEFAULT_RATE
