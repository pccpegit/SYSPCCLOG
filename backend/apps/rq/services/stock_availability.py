"""
Stock availability of a request's lines against the CENTRAL pool (SYSPCC-026).

Read-only helper for the logistics stock-check screen (the endpoint is restricted to
logistics roles: the figures include demand from other projects). It answers, line by line: how much was asked for, which catalog
product the line is linked to, how much of it the CENTRAL pool holds, how much
of that is already promised to OTHER requests, and whether what is left covers
the line fully, partially or not at all.

Three rules keep the figures honest:

* One product, several lines of the SAME request: the lines are served in
  `line_number` order. A line only sees what the earlier lines of that request
  have not already taken, so the second line of a product the pool cannot cover
  twice comes out PARTIAL or NONE instead of repeating the same availability.
* Other requests already hold part of the pool: both the ones in IN_STOCK that
  still wait for their dispatch and the purchases already received into the pool
  whose dispatch is still pending (see `committed_to_other_requests`).
* Quantities are only compared in the same unit: a line whose unit differs from the
  product's (after folding spellings such as UND / EA / PZA) is NOT_COMPARABLE, never
  FULL/PARTIAL/NONE.

It is advisory only: the stock-check decision (`has_stock`) stays with
logistics and the WorkflowEngine processes it exactly as before. Nothing here
blocks or alters a transition.

Resolution of the product is ONLY the `RequestItem.inventory_item` FK;
descriptions are never fuzzy-matched. The FK may still be a proposal made by the
requester: each row says so in `link_confirmed`.
"""

from decimal import Decimal

from django.db.models import DecimalField, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from apps.core.enums import RQStatusChoices
from apps.rq.models import RequestItem
from apps.rq.services.request_catalog import central_pool_available
from apps.rq.services.units import units_equivalent
from apps.warehouse.models import WarehouseDispatchItem, WarehouseReceiptItem

_ZERO = Decimal('0')
_QUANTITY_FIELD = DecimalField(max_digits=14, decimal_places=3)

# Requests whose purchase has already entered the CENTRAL pool (the engine ingresses at
# RECEIVED) and has not been dispatched yet: their material sits in the pool but belongs
# to them. The claim-cycle states (QUALITY_REJECTED, SUPPLIER_CLAIM_*) are left out on
# purpose: the rejected material is physically set apart, so whether it still counts as
# promised stock is a decision for management, not something to guess here.
RECEIVED_PENDING_DISPATCH_STATUSES = (
    RQStatusChoices.RECEIVING,
    RQStatusChoices.QUALITY_APPROVED,
    RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
)


class LinkStatus:
    """How a request line relates to the warehouse catalog."""

    LINKED = 'LINKED'
    OFF_CATALOG = 'OFF_CATALOG'
    UNLINKED = 'UNLINKED'


class Coverage:
    """
    Whether the net available stock covers the requested quantity (None if not linked).

    NOT_COMPARABLE: the line and the product use different units, so no quantity can be
    compared; logistics has to decide by hand.
    """

    FULL = 'FULL'
    PARTIAL = 'PARTIAL'
    NONE = 'NONE'
    NOT_COMPARABLE = 'NOT_COMPARABLE'


def _owed_to_in_stock_requests(ids, exclude_request_id) -> dict:
    """{inventory_id: Decimal} still owed to OTHER requests in IN_STOCK (quantity minus dispatched)."""
    rows = (
        RequestItem.objects
        .filter(request__status=RQStatusChoices.IN_STOCK, inventory_item_id__in=ids)
        .exclude(request_id=exclude_request_id)
        .annotate(
            dispatched=Coalesce(
                Sum('dispatch_items__quantity_dispatched'),
                Value(_ZERO, output_field=_QUANTITY_FIELD),
                output_field=_QUANTITY_FIELD,
            )
        )
        .values_list('inventory_item_id', 'quantity', 'dispatched')
    )

    owed: dict = {}
    for inventory_id, quantity, dispatched in rows:
        remaining = max((quantity or _ZERO) - (dispatched or _ZERO), _ZERO)
        owed[inventory_id] = owed.get(inventory_id, _ZERO) + remaining
    return owed


def _owed_to_received_purchases(ids, exclude_request_id) -> dict:
    """
    {inventory_id: Decimal} of material bought for OTHER requests that already entered
    the pool and is still waiting for its dispatch.

    A line counts when its request is in RECEIVED_PENDING_DISPATCH_STATUSES, it is linked
    to the product and it has a WarehouseReceiptItem (the proof that the entry happened:
    the engine writes it together with the pool movement, and only for lines whose
    `supply_source` is not STOCK). The amount is what the pool really holds for that
    line that has not left yet: the smaller of what was requested and what was received,
    minus what was already dispatched, never negative. Receipts and dispatches are
    aggregated in subqueries, so one never multiplies the other.
    """
    received = (
        WarehouseReceiptItem.objects
        .filter(request_item=OuterRef('pk'))
        .values('request_item')
        .annotate(total=Sum('quantity_received'))
        .values('total')
    )
    dispatched = (
        WarehouseDispatchItem.objects
        .filter(request_item=OuterRef('pk'))
        .values('request_item')
        .annotate(total=Sum('quantity_dispatched'))
        .values('total')
    )
    rows = (
        RequestItem.objects
        .filter(
            request__status__in=RECEIVED_PENDING_DISPATCH_STATUSES,
            inventory_item_id__in=ids,
        )
        .exclude(request_id=exclude_request_id)
        .exclude(supply_source='STOCK')
        # SYSPCC-028: only a confirmed link ever entered the pool (defense in depth, in case a
        # receipt row exists for a line the engine did not ingress).
        .filter(inventory_item_confirmed_at__isnull=False, is_off_catalog=False)
        .annotate(
            received=Subquery(received, output_field=_QUANTITY_FIELD),
            dispatched=Coalesce(
                Subquery(dispatched, output_field=_QUANTITY_FIELD),
                Value(_ZERO, output_field=_QUANTITY_FIELD),
                output_field=_QUANTITY_FIELD,
            ),
        )
        .filter(received__isnull=False)
        .values_list('inventory_item_id', 'quantity', 'received', 'dispatched')
    )

    owed: dict = {}
    for inventory_id, quantity, received_total, dispatched_total in rows:
        in_pool = min(quantity or _ZERO, received_total or _ZERO)
        remaining = max(in_pool - (dispatched_total or _ZERO), _ZERO)
        owed[inventory_id] = owed.get(inventory_id, _ZERO) + remaining
    return owed


def committed_to_other_requests(inventory_ids, exclude_request_id) -> dict:
    """
    {inventory_id: Decimal} of the CENTRAL pool already promised to OTHER requests:

    * requests in IN_STOCK (stock confirmed, dispatch pending): what is still owed to
      them (quantity minus what the warehouse already dispatched), never negative;
    * purchases already received into the pool whose dispatch is still pending
      (RECEIVING, QUALITY_APPROVED, SUPPLIER_REPLACEMENT_RECEIVED): what they hold in the
      pool that has not left yet. See `_owed_to_received_purchases`.

    Computed on the fly from existing tables; there is no reservation table.
    """
    ids = {i for i in inventory_ids if i}
    if not ids:
        return {}

    committed = _owed_to_in_stock_requests(ids, exclude_request_id)
    for inventory_id, amount in _owed_to_received_purchases(ids, exclude_request_id).items():
        committed[inventory_id] = committed.get(inventory_id, _ZERO) + amount
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

    For a LINKED line:

    * `available_central` is the pool, `committed_other_requests` what other requests
      already hold of it and `committed_earlier_lines` what the earlier lines
      (lower `line_number`) of THIS request take of the same product;
    * `available_net` is what is left for this line after both, and `coverage` /
      `shortfall` are computed against it. Each line takes `min(requested, left)`, so
      an earlier PARTIAL line leaves nothing for the next one;
    * when the line's unit is not the product's (see `units_equivalent`), the numbers
      are in the PRODUCT's unit (`product_unit`) and cannot be compared with the
      requested quantity: `unit_mismatch` is true, `coverage` is NOT_COMPARABLE,
      `shortfall` is None, and the line takes nothing from the later lines.
    """
    items = list(
        request_obj.items.select_related('inventory_item').order_by('line_number')
    )
    inventory_ids = {item.inventory_item_id for item in items if item.inventory_item_id}
    pool = central_pool_available(inventory_ids)
    committed = committed_to_other_requests(inventory_ids, exclude_request_id=request_obj.pk)
    # What each product still has free for the NEXT line of this request, after the
    # other requests and the lines already served.
    left_for_next_line = {
        inventory_id: max(pool.get(inventory_id, _ZERO) - committed.get(inventory_id, _ZERO), _ZERO)
        for inventory_id in inventory_ids
    }

    rows = []
    summary = {
        'items_total': len(items),
        'full': 0,
        'partial': 0,
        'none': 0,
        'not_comparable': 0,
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
            'product_unit': None,
            'unit_mismatch': False,
            'link_status': LinkStatus.UNLINKED,
            'link_confirmed': item.link_confirmed,
            'available_central': None,
            'committed_other_requests': None,
            'committed_earlier_lines': None,
            'available_net': None,
            'shortfall': None,
            'coverage': None,
        }

        if item.inventory_item_id:
            inventory = item.inventory_item
            available_central = pool.get(inventory.pk, _ZERO)
            committed_others = committed.get(inventory.pk, _ZERO)
            available_net = left_for_next_line[inventory.pk]
            earlier_lines = max(available_central - committed_others, _ZERO) - available_net
            unit_mismatch = not units_equivalent(item.unit, inventory.unit)

            if unit_mismatch:
                coverage = Coverage.NOT_COMPARABLE
                shortfall = None
            else:
                coverage = _classify(requested, available_net)
                shortfall = max(requested - available_net, _ZERO)
                # This line takes its share; the next line of the product sees the rest.
                left_for_next_line[inventory.pk] = available_net - min(max(requested, _ZERO), available_net)

            row.update({
                'inventory_item': {
                    'id': inventory.pk,
                    'product_code': inventory.product_code,
                    'description': inventory.description,
                    'unit': inventory.unit,
                },
                'product_unit': inventory.unit,
                'unit_mismatch': unit_mismatch,
                'link_status': LinkStatus.LINKED,
                'available_central': available_central,
                'committed_other_requests': committed_others,
                'committed_earlier_lines': earlier_lines,
                'available_net': available_net,
                'shortfall': shortfall,
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
