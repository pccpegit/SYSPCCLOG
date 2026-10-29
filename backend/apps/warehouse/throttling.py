"""Throttles of the warehouse module (SYSPCC-025). Rates live in settings (base + development)."""
from rest_framework.throttling import UserRateThrottle

from apps.core.throttling import ThrottleCacheMixin


class WarehouseLookupThrottle(ThrottleCacheMixin, UserRateThrottle):
    """Worker lookup used by the EPP delivery combobox (scope ``warehouse_lookup``)."""

    scope = 'warehouse_lookup'


class WarehouseImportThrottle(ThrottleCacheMixin, UserRateThrottle):
    """Workbook upload (preview) of the inventory importer (scope ``warehouse_import``)."""

    scope = 'warehouse_import'
