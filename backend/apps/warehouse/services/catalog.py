"""
Catalog helpers shared by the inventory API and the importer (SYSPCC-025).
"""
import re

from django.db.models import DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce

from apps.core.enums import ItemTypeChoices
from apps.warehouse.services import locations

# "T: L", "T:XL", "T: 42" at the end of the description (size of an EPP item).
_SIZE_RE = re.compile(r'\bT:\s*([A-Z0-9./-]{1,8})\s*$', re.IGNORECASE)

MAX_BIGINT = 2 ** 63 - 1      # a larger id would overflow the database parameter, not match nothing
EPP_PREFIX = 'EPP'
CATEGORY_EPP = 'EPP'
CATEGORY_OTHER = 'Otros'


def normalize_product_code(value) -> str:
    """Strip + uppercase; numbers coming from Excel are rendered without '.0'."""
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip().upper()


def derive_size(description: str) -> str:
    """Size ('L', 'XL', '42'...) derived from a trailing ``T: <size>``; '' if none."""
    m = _SIZE_RE.search(description or '')
    return m.group(1).upper() if m else ''


def code_prefix(product_code: str) -> str:
    """Leading letters of a code (``EPP000217`` -> ``EPP``)."""
    m = re.match(r'^[A-Z]+', normalize_product_code(product_code))
    return m.group(0) if m else ''


def classify_code(product_code: str) -> tuple[str, str, bool]:
    """
    Derive ``(category, item_type, classified)`` from the code prefix.

    ``EPP`` -> ('EPP', EPP, True). Any other prefix -> ('Otros', MATERIAL, False):
    the third element lets the importer report an informative notice.
    """
    if code_prefix(product_code) == EPP_PREFIX:
        return CATEGORY_EPP, ItemTypeChoices.EPP, True
    return CATEGORY_OTHER, ItemTypeChoices.MATERIAL, False


def annotate_total_stock(qs):
    """Annotate ``total_stock`` (sum over every stock row) without row duplication."""
    return qs.annotate(
        total_stock=Coalesce(
            Sum('stocks__quantity'),
            Value(0),
            output_field=DecimalField(),
        )
    )


def exact_location_q() -> Q:
    """Q matching items whose ``location`` is a valid layout location."""
    return Q(location__regex=locations.db_exact_location_regex())


def filter_location_status(qs, status_value: str):
    """
    Filter by derived location status: exact | floor_only | none | pending
    (pending = floor_only or none). Unknown values leave the queryset unchanged.
    """
    status_value = (status_value or '').lower()
    exact = exact_location_q()
    if status_value == 'exact':
        return qs.filter(exact)
    if status_value == 'floor_only':
        return qs.filter(~exact, floor__isnull=False)
    if status_value == 'none':
        return qs.filter(~exact, floor__isnull=True)
    if status_value == 'pending':
        return qs.filter(~exact)
    return qs


def apply_catalog_filters(qs, params):
    """
    Filters shared by the catalog list/export and the movement summary.
    ``params`` is any mapping with ``.get`` (QueryDict or dict).
    Does not annotate stock; see ``annotate_total_stock``.
    """
    category = params.get('category')
    item_type = params.get('item_type')
    search = params.get('search')
    floor = params.get('floor')
    project = params.get('project')
    location_status = params.get('location_status')

    if category:
        qs = qs.filter(category__iexact=category)
    if item_type:
        qs = qs.filter(item_type=item_type)
    if search:
        qs = qs.filter(
            Q(product_code__icontains=search)
            | Q(description__icontains=search)
            | Q(brand__icontains=search)
            | Q(order_number__icontains=search)
            | Q(purchase_order_ref__icontains=search)
            | Q(packing_list__icontains=search)
        )
    if floor in ('1', '2'):
        qs = qs.filter(floor=int(floor))
    if project and str(project).isascii() and str(project).isdigit() and 0 < int(project) <= MAX_BIGINT:
        qs = qs.filter(project_id=int(project))
    if location_status:
        qs = filter_location_status(qs, location_status)
    return qs


def apply_stock_filters(qs, params):
    """Filters that need the ``total_stock`` annotation (low_stock, has_stock)."""
    low_stock = params.get('low_stock')
    has_stock = params.get('has_stock')
    if low_stock == 'true':
        qs = qs.filter(total_stock__lte=F('min_stock'))
    if has_stock == 'true':
        qs = qs.filter(total_stock__gt=0)
    elif has_stock == 'false':
        qs = qs.filter(total_stock__lte=0)
    return qs
