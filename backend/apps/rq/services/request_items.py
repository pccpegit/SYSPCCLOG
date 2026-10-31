"""
Logistics edits on the lines of a request (SYSPCC-026).

During the stock check logistics confirms, line by line, which catalog product
a line is (or marks it off-catalog on purpose), where it comes from
(`supply_source`) and its family (`item_source`). Everything happens in one
transaction under a lock on the request, with a state guard:

* only states in EDITABLE_STATUSES admit edits: from the validation (VALIDATED)
  up to before the dispatch. Before it the lines are still being approved;
  after it the product has already moved (or should have), and the claim cycle
  can be re-entered after a delivery, so it is out as well;
* an RQ that already went through a DISPATCHED action cannot be edited even when
  it is back in an editable state (QUALITY_APPROVED after a claim): the dispatch
  history is the evidence, because a dispatch that failed to write its
  WarehouseDispatchItem rows would otherwise go unnoticed;
* a line that still has goods out (warehouse dispatches minus their reversals > 0) cannot be
  edited (re-linking it would detach the movement history from the product that really
  moved); once a delivery is fully annulled the line can be re-linked (SYSPCC-029);
* a line that already has warehouse receipts (the purchase entered the pool as a
  specific product) cannot change its catalog link: neither the product nor the
  off-catalog mark. Its `supply_source` / `item_source` stay editable, and
  re-sending the link it already has (to confirm it) is not a change.

Provenance: a catalog product (or the off-catalog mark) proposed by the requester
when creating the RQ is NOT confirmed. Only an explicit decision from logistics
through `update_request_items` stamps `inventory_item_confirmed_at/_by`.

The guard lives only in this auxiliary endpoint's service. It does not touch,
block or alter any WorkflowEngine transition.
"""

import logging
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.core.enums import ApprovalActionChoices, ItemSourceChoices, RQStatusChoices
from apps.core.exceptions import RequestItemConflict
from apps.rq.models import ActivityLog, Approval, Request, RequestItem
from apps.warehouse.models import WarehouseReceiptItem
from apps.warehouse.services.dispatch_totals import net_dispatched_by_item

logger = logging.getLogger(__name__)

ACTIVITY_ACTION = 'ITEMS_UPDATED'
PROPOSED_LINKS_ACTIVITY_ACTION = 'CATALOG_LINKS_PROPOSED'
MAX_LOGGED_PROPOSED_LINKS = 50

# Window in which logistics may edit the lines: validated up to before the dispatch.
# Default-deny: every other state (drafts, approvals in progress, the supplier claim
# cycle, dispatched/delivered/closed and the legacy states no transition reaches)
# is out. STOCK_CHECK is a legacy state kept for old data.
EDITABLE_STATUSES = frozenset({
    RQStatusChoices.VALIDATED,
    RQStatusChoices.STOCK_CHECK,
    RQStatusChoices.IN_STOCK,
    RQStatusChoices.REQUIRES_PURCHASE,
    RQStatusChoices.QUOTING,
    RQStatusChoices.QUOTE_COMPARISON,
    RQStatusChoices.QUOTE_SELECTED,
    RQStatusChoices.QUOTE_COST_APPROVED,
    RQStatusChoices.COST_OVERRUN_REVIEW,
    RQStatusChoices.COST_OVERRUN_APPROVED,
    RQStatusChoices.PO_GENERATED,
    RQStatusChoices.RECEIVING,
    RQStatusChoices.QUALITY_APPROVED,
})

_SUPPLY_SOURCE_LABELS = dict(RequestItem._meta.get_field('supply_source').choices)


@dataclass
class UpdateItemsResult:
    """Outcome of an update: `updated` are the persisted RequestItem instances."""

    updated: list = field(default_factory=list)
    unchanged_item_ids: list = field(default_factory=list)
    ignored_item_ids: list = field(default_factory=list)


def _resolve_link_state(item: RequestItem, data: dict):
    """
    Effective (inventory_item, is_off_catalog) after applying `data` to `item`.

    A line is either linked to a catalog product or off-catalog, never both.
    The payload validator already rejects an explicit "both"; when only one side
    is given, the other is reset so the line never ends up inconsistent:
    linking a product clears the off-catalog mark, marking off-catalog drops the link.
    """
    sets_inventory = 'inventory_item' in data
    sets_off_catalog = 'is_off_catalog' in data

    inventory = data['inventory_item'] if sets_inventory else item.inventory_item
    off_catalog = data['is_off_catalog'] if sets_off_catalog else item.is_off_catalog

    if sets_inventory and inventory is not None and not sets_off_catalog:
        off_catalog = False
    if sets_off_catalog and off_catalog and not sets_inventory:
        inventory = None
    return inventory, off_catalog


def _received_link_changes(items: dict, items_data: list) -> list:
    """
    Ids of the lines that already have warehouse receipts and whose catalog link
    (product or off-catalog mark) the payload would change.

    A receipt means the purchased material entered the CENTRAL pool as the product the
    line was linked to; moving the link afterwards would detach that entry from the
    product that really received it. Entries that only touch `supply_source` /
    `item_source`, or re-send the link the line already has, are not link changes.
    """
    received_ids = set(
        WarehouseReceiptItem.objects
        .filter(request_item_id__in=items.keys())
        .values_list('request_item_id', flat=True)
    )
    if not received_ids:
        return []

    offending = []
    for entry in items_data:
        item = items.get(entry['item_id'])
        if item is None or item.pk not in received_ids or item.pk in offending:
            continue
        inventory, off_catalog = _resolve_link_state(item, entry)
        if inventory != item.inventory_item or off_catalog != item.is_off_catalog:
            offending.append(item.pk)
    return offending


def _describe_changes(item: RequestItem, before: dict, after: dict) -> str:
    """Human-readable (es-PE) one-liner of what changed on a line, for the activity log."""
    parts = []
    link_described = False
    if before['inventory_item'] != after['inventory_item']:
        new_inv = after['inventory_item']
        parts.append(
            f'producto de catálogo: {new_inv.product_code} - {new_inv.description}'
            if new_inv else 'vínculo con el catálogo retirado'
        )
        link_described = True
    if before['is_off_catalog'] != after['is_off_catalog']:
        parts.append('marcado fuera de catálogo' if after['is_off_catalog'] else 'ya no está fuera de catálogo')
        link_described = True
    if not before['confirmed'] and after['confirmed']:
        if link_described:
            parts.append('vínculo confirmado')
        else:
            inv = after['inventory_item']
            target = f'{inv.product_code} - {inv.description}' if inv else 'fuera de catálogo'
            parts.append(f'vínculo confirmado ({target})')
    if before['item_source'] != after['item_source']:
        source = after['item_source']
        parts.append(f'fuente: {ItemSourceChoices(source).label if source else "sin fuente"}')
    if before['supply_source'] != after['supply_source']:
        supply = after['supply_source']
        parts.append(f'origen de atención: {_SUPPLY_SOURCE_LABELS.get(supply, supply) or "sin definir"}')
    return f'Línea {item.line_number}: ' + '; '.join(parts)


def log_proposed_catalog_links(request_obj: Request, items, user) -> None:
    """
    Leave an ActivityLog with the catalog products the REQUESTER proposed when
    creating the RQ. They are not confirmed: logistics has to confirm each one in
    the stock check, and this entry is the audit trail of who proposed what.
    Nothing is written when no line carries a product.
    """
    linked = [item for item in items if item.inventory_item_id]
    if not linked:
        return
    shown = [
        f'Línea {item.line_number}: {item.inventory_item.product_code} - {item.inventory_item.description}'
        for item in linked[:MAX_LOGGED_PROPOSED_LINKS]
    ]
    hidden = len(linked) - len(shown)
    detail = (
        'Productos de catálogo propuestos por el solicitante, pendientes de confirmación de Logística. '
        + ' | '.join(shown)
        + (f' | y {hidden} más' if hidden else '')
    )
    ActivityLog.objects.create(
        request=request_obj,
        user=user,
        action=PROPOSED_LINKS_ACTIVITY_ACTION,
        detail=detail,
    )


def _guard_request_state(locked: Request) -> None:
    """Raise RequestItemConflict unless the lines of `locked` may be edited now."""
    if locked.is_terminal:
        raise RequestItemConflict(
            'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.',
            code=RequestItemConflict.REQUEST_TERMINAL,
        )
    if locked.status not in EDITABLE_STATUSES:
        raise RequestItemConflict(
            'Los ítems solo se pueden modificar desde la validación del requerimiento hasta '
            f'antes del despacho. Estado actual: {locked.get_status_display()}.',
            code=RequestItemConflict.REQUEST_STATE_NOT_EDITABLE,
        )
    if Approval.objects.filter(request=locked, action=ApprovalActionChoices.DISPATCHED).exists():
        raise RequestItemConflict(
            'El requerimiento ya tuvo un despacho y sus ítems no se pueden modificar.',
            code=RequestItemConflict.REQUEST_STATE_NOT_EDITABLE,
        )


def _resolve_confirmation(item: RequestItem, entry: dict, inventory, off_catalog):
    """
    (confirmed, stamp) after applying `entry`: `stamp` is True when the confirmation
    must be (re)written now, False when the stored one stays as is.

    Logistics confirms by sending `inventory_item` or `is_off_catalog` (even with the
    value the line already has). Re-sending the same decision on a line that is
    already confirmed keeps the original who/when. Dropping the link leaves nothing
    to confirm. Entries that carry neither key never change the confirmation.
    """
    if 'inventory_item' not in entry and 'is_off_catalog' not in entry:
        return item.link_confirmed, False
    if inventory is None and not off_catalog:
        return False, False
    link_changed = inventory != item.inventory_item or off_catalog != item.is_off_catalog
    if link_changed or not item.link_confirmed:
        return True, True
    return True, False


def update_request_items(request_obj: Request, items_data: list, user) -> UpdateItemsResult:
    """
    Apply `items_data` (validated by UpdateItemsSerializer) to the lines of `request_obj`.

    Each entry has `item_id` plus any of `supply_source`, `inventory_item`
    (Inventory instance or None), `is_off_catalog` and `item_source`; only the keys
    present are applied. All-or-nothing: if any line is blocked by the guard, nothing
    is written.

    Item ids that do not belong to this request are never touched; they come back
    in `ignored_item_ids` so the caller can tell the user.

    Raises RequestItemConflict (HTTP 409) when the RQ is terminal, is outside the
    editable window (see EDITABLE_STATUSES) or already had a dispatch, when a line
    already has warehouse dispatches (ITEMS_ALREADY_DISPATCHED), or when a line that
    already has warehouse receipts would change its product or off-catalog mark
    (ITEMS_ALREADY_RECEIVED).
    """
    ctx = {'rq_id': request_obj.pk, 'user_id': getattr(user, 'id', None)}
    result = UpdateItemsResult()

    with transaction.atomic():
        # Lock order is fixed (request, then its lines) and the status is re-read
        # under the lock: the instance the view loaded may be stale.
        locked = Request.objects.select_for_update().get(pk=request_obj.pk)
        _guard_request_state(locked)

        requested_ids = [entry['item_id'] for entry in items_data]
        # `of=('self',)`: inventory_item is a nullable FK, and PostgreSQL refuses
        # FOR UPDATE on the nullable side of the outer join select_related adds.
        items = {
            item.pk: item
            for item in RequestItem.objects.select_for_update(of=('self',))
            .select_related('inventory_item')
            .filter(request=locked, pk__in=requested_ids)
        }
        result.ignored_item_ids = [item_id for item_id in requested_ids if item_id not in items]

        # SYSPCC-029: only what is still out (entregas − reversas) blocks the edit; a line whose
        # delivery was fully annulled can be re-linked.
        dispatched_ids = sorted(
            item_id
            for item_id, net in net_dispatched_by_item(list(items.keys())).items()
            if net > 0
        )
        if dispatched_ids:
            raise RequestItemConflict(
                'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.',
                code=RequestItemConflict.ITEMS_ALREADY_DISPATCHED,
                item_ids=dispatched_ids,
            )

        received_link_ids = sorted(_received_link_changes(items, items_data))
        if received_link_ids:
            raise RequestItemConflict(
                'Algunos ítems ya fueron recibidos en el almacén y no se puede cambiar su producto '
                'de catálogo ni marcarlos como fuera de catálogo.',
                code=RequestItemConflict.ITEMS_ALREADY_RECEIVED,
                item_ids=received_link_ids,
            )

        descriptions = []
        for entry in items_data:
            item = items.get(entry['item_id'])
            if item is None:
                continue

            before = {
                'inventory_item': item.inventory_item,
                'is_off_catalog': item.is_off_catalog,
                'item_source': item.item_source,
                'supply_source': item.supply_source,
                'confirmed': item.link_confirmed,
            }
            inventory, off_catalog = _resolve_link_state(item, entry)
            confirmed, stamp = _resolve_confirmation(item, entry, inventory, off_catalog)
            after = {
                'inventory_item': inventory,
                'is_off_catalog': off_catalog,
                'item_source': entry.get('item_source', item.item_source),
                'supply_source': entry.get('supply_source', item.supply_source),
                'confirmed': confirmed,
            }

            if after == before:
                result.unchanged_item_ids.append(item.pk)
                continue

            item.inventory_item = after['inventory_item']
            item.is_off_catalog = after['is_off_catalog']
            item.item_source = after['item_source']
            item.supply_source = after['supply_source']
            if stamp:
                item.inventory_item_confirmed_at = timezone.now()
                item.inventory_item_confirmed_by = user
            elif not confirmed and (item.inventory_item_confirmed_at or item.inventory_item_confirmed_by_id):
                item.inventory_item_confirmed_at = None
                item.inventory_item_confirmed_by = None
            item.save(update_fields=[
                'inventory_item', 'is_off_catalog', 'item_source', 'supply_source',
                'inventory_item_confirmed_at', 'inventory_item_confirmed_by',
            ])
            result.updated.append(item)
            descriptions.append(_describe_changes(item, before, after))

        if descriptions:
            ActivityLog.objects.create(
                request=locked,
                user=user,
                action=ACTIVITY_ACTION,
                detail='Ítems actualizados por Logística. ' + ' | '.join(descriptions),
            )

    if result.ignored_item_ids:
        logger.warning(
            'rq.update_items.foreign_item_ids',
            extra=ctx | {'ignored_item_ids': result.ignored_item_ids},
        )
    logger.info(
        'rq.update_items.ok',
        extra=ctx | {
            'updated': len(result.updated),
            'unchanged': len(result.unchanged_item_ids),
            'ignored': len(result.ignored_item_ids),
        },
    )
    return result
