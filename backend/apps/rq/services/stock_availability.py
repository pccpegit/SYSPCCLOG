"""
Stock availability of a request's lines against the CENTRAL pool (SYSPCC-026).

Read-only helper for the logistics stock-check screen (the endpoint is restricted to
logistics roles: the figures include demand from other projects). It answers, line by line: how much was asked for, which catalog
product the line is linked to, how much of it the CENTRAL pool holds, how much
of that is already promised to OTHER requests, and whether what is left covers
the line fully, partially or not at all.

It is advisory only: the stock-check decision (`has_stock`) stays with
logistics and the WorkflowEngine processes it exactly as before. Nothing here
blocks or alters a transition.

Resolution of the product is ONLY the `RequestItem.inventory_item` FK;
descriptions are never fuzzy-matched. The FK may still be a proposal made by the
requester: each row says so in `link_confirmed`.
"""

from decimal import Decimal

from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce

from apps.core.enums import RQStatusChoices
from apps.rq.models import RequestItem
from apps.rq.services.request_catalog import central_pool_available

_ZERO = Decimal('0')


class LinkStatus:
    """How a request line relates to the warehouse catalog."""

    LINKED = 'LINKED'
    OFF_CATALOG = 'OFF_CATALOG'
    UNLINKED = 'UNLINKED'


class Coverage:
    """Whether the net available stock covers the requested quantity (None if not linked)."""

    FULL = 'FULL'
    PARTIAL = 'PARTIAL'
    NONE = 'NONE'


def committed_to_other_requests(inventory_ids, exclude_request_id) -> dict:
    """
    {inventory_id: Decimal} promised to OTHER requests that are already in
    IN_STOCK (stock confirmed, dispatch pending): what is still owed to them
    (quantity minus what the warehouse already dispatched), never negative.

    Computed on the fly from existing tables; there is no reservation table.
    """
    ids = {i for i in inventory_ids if i}
    if not ids:
        return {}

    dispatched_field = DecimalField(max_digits=14, decimal_places=3)
    rows = (
        RequestItem.objects
        .filter(request__status=RQStatusChoices.IN_STOCK, inventory_item_id__in=ids)
        .exclude(request_id=exclude_request_id)
        .annotate(
            dispatched=Coalesce(
                Sum('dispatch_items__quantity_dispatched'),
                Value(_ZERO, output_field=dispatched_field),
                output_field=dispatched_field,
            )
        )
        .values_list('inventory_item_id', 'quantity', 'dispatched')
    )

    committed: dict = {}
    for inventory_id, quantity, dispatched in rows:
        remaining = max((quantity or _ZERO) - (dispatched or _ZERO), _ZERO)
        committed[inventory_id] = committed.get(inventory_id, _ZERO) + remaining
    return committed


def _classify(requested: Decimal, net_available: Decimal) -> str:
    if requested <= _ZERO or net_available >= requested:
        return Coverage.FULL
    if net_available <= _ZERO:
        return Coverage.NONE
    return Coverage.PARTIAL


def build_stock_availability(request_obj) -> dict:
    """
    Availability report for every line of `request_obj`.

    Returns {'request_id', 'rq_number', 'items': [...], 'summary': {...}}. Quantities
    are Decimal; the serializer renders them. A line that is not linked has
    `coverage=None` and no stock figures: it is reported as OFF_CATALOG (marked on
    purpose) or UNLINKED (still to be confirmed by logistics), never as "no stock".
    """
    items = list(
        request_obj.items.select_related('inventory_item').order_by('line_number')
    )
    inventory_ids = {item.inventory_item_id for item in items if item.inventory_item_id}
    pool = central_pool_available(inventory_ids)
    committed = committed_to_other_requests(inventory_ids, exclude_request_id=request_obj.pk)

    rows = []
    summary = {
        'items_total': len(items),
        'full': 0,
        'partial': 0,
        'none': 0,
        'off_catalog': 0,
        'unlinked': 0,
    }

    for item in items:
        requested = item.quantity or _ZERO
        row = {
            'item_id': item.pk,
            'line_number': item.line_number,
            'description': item.description,
            'unit': item.unit,
            'requested': requested,
            'inventory_item': None,
            'link_status': LinkStatus.UNLINKED,
            'link_confirmed': item.link_confirmed,
            'available_central': None,
            'committed_other_requests': None,
            'available_net': None,
            'shortfall': None,
            'coverage': None,
        }

        if item.inventory_item_id:
            inventory = item.inventory_item
            available_central = pool.get(inventory.pk, _ZERO)
            committed_others = committed.get(inventory.pk, _ZERO)
            available_net = max(available_central - committed_others, _ZERO)
            coverage = _classify(requested, available_net)
            row.update({
                'inventory_item': {
                    'id': inventory.pk,
                    'product_code': inventory.product_code,
                    'description': inventory.description,
                    'unit': inventory.unit,
                },
                'link_status': LinkStatus.LINKED,
                'available_central': available_central,
                'committed_other_requests': committed_others,
                'available_net': available_net,
                'shortfall': max(requested - available_net, _ZERO),
                'coverage': coverage,
            })
            summary[coverage.lower()] += 1
        elif item.is_off_catalog:
            row['link_status'] = LinkStatus.OFF_CATALOG
            summary['off_catalog'] += 1
        else:
            summary['unlinked'] += 1

        rows.append(row)

    return {
        'request_id': request_obj.pk,
        'rq_number': request_obj.rq_number,
        'items': rows,
        'summary': summary,
    }
