"""
Lista de picking de un RQ (SYSPCC-029) · Fase 04 del almacén, pasos 1 y 2 (Recepción del
requerimiento e Identificación de ubicaciones).

Solo lectura. Por cada ítem del RQ: el producto de catálogo (únicamente si Logística lo
confirmó), su ubicación oficial ({Pabellón}{Sección}-{Nivel}) o "PISO n" mientras no esté
ubicado, lo disponible en el pool CENTRAL, lo ya entregado (entregas − reversas), lo pendiente
y el estado. Más el historial de entregas, con lo que hace falta para anular una.

Nunca se inventa un pabellón: la ubicación sale de `Inventory.location_display`.
"""
from decimal import Decimal

from apps.core.enums import RQStatusChoices
from apps.warehouse.services.dispatch_totals import net_dispatched_by_item
from apps.warehouse.services.rq_fulfillment import (
    DELIVERABLE_STATUSES,
    deliver_roles,
    user_can_deliver,
    user_can_reverse,
)

_ZERO = Decimal('0')

# Estado del ítem en la lista de picking.
ITEM_PENDING = 'PENDING'
ITEM_PARTIAL = 'PARTIAL'
ITEM_COMPLETE = 'COMPLETE'

# Vínculo del ítem con el catálogo.
LINK_CONFIRMED = 'CONFIRMED'
LINK_PROPOSED = 'PROPOSED'      # tiene producto, pero Logística aún no lo confirma
LINK_OFF_CATALOG = 'OFF_CATALOG'
LINK_UNLINKED = 'UNLINKED'

# Por qué un ítem no se puede entregar desde el almacén (None si se puede).
BLOCK_COMPLETE = 'COMPLETE'
BLOCK_NO_STOCK = 'NO_STOCK'


def picking_statuses() -> tuple:
    """Estados en los que el RQ tiene lista de picking: la etapa de almacén (Pendientes)."""
    return (
        RQStatusChoices.IN_STOCK,
        RQStatusChoices.QUALITY_APPROVED,
        RQStatusChoices.DISPATCHED_TO_SITE,
        RQStatusChoices.DELIVERED,
    )


def _link_status(item) -> str:
    if item.is_off_catalog:
        return LINK_OFF_CATALOG
    if item.inventory_item_id is None:
        return LINK_UNLINKED
    return LINK_CONFIRMED if item.inventory_item_confirmed_at is not None else LINK_PROPOSED


def _item_status(quantity, delivered) -> str:
    if delivered <= _ZERO:
        return ITEM_PENDING
    return ITEM_COMPLETE if delivered >= quantity else ITEM_PARTIAL


def _product(item):
    inventory = item.inventory_item
    return {
        'id': inventory.pk,
        'product_code': inventory.product_code,
        'description': inventory.description,
        'unit': inventory.unit,
        'category': inventory.category,
        'location': inventory.location_display,       # "B3-2", "PISO 1" o ""
        'location_status': inventory.location_status,  # EXACT | FLOOR_ONLY | NONE
    }


def _deliveries(request_obj, *, can_reverse_role: bool, reversible_state: bool) -> list:
    from apps.warehouse.models import WarehouseDispatch

    dispatches = list(
        WarehouseDispatch.objects
        .filter(request=request_obj)
        .select_related('dispatched_by', 'movement_group')
        .prefetch_related('items__request_item')
        .order_by('pk')
    )
    reversed_by = {d.reverses_id: d.pk for d in dispatches if d.reverses_id}
    rows = []
    for dispatch in dispatches:
        is_reversal = dispatch.reverses_id is not None
        reversal_id = reversed_by.get(dispatch.pk)
        group = dispatch.movement_group
        rows.append({
            'id': dispatch.pk,
            'dispatch_number': dispatch.dispatch_number,
            'dispatch_guide_number': dispatch.dispatch_guide_number,
            'movement_date': group.movement_date if group else None,
            'dispatched_at': dispatch.dispatched_at,
            'dispatched_by': dispatch.dispatched_by.get_full_name() or dispatch.dispatched_by.username,
            'is_reversal': is_reversal,
            'reverses': dispatch.reverses_id,
            'reversed_by': reversal_id,
            'notes': dispatch.notes,
            'can_reverse': (
                can_reverse_role and reversible_state and not is_reversal
                and reversal_id is None and group is not None
            ),
            'lines': [
                {
                    'request_item_id': line.request_item_id,
                    'line_number': line.request_item.line_number,
                    'description': line.request_item.description,
                    'quantity': line.quantity_dispatched,
                }
                for line in sorted(dispatch.items.all(), key=lambda ln: ln.request_item.line_number)
            ],
        })
    return rows


def build_picking(request_obj, user) -> dict:
    """Payload completo de la lista de picking de `request_obj` para `user`."""
    from apps.rq.services.request_catalog import central_pool_available

    items = list(request_obj.items.select_related('inventory_item').order_by('line_number'))
    delivered = net_dispatched_by_item(request=request_obj)
    pool = central_pool_available({
        item.inventory_item_id for item in items if item.inventory_item_id
    })

    rows = []
    summary = {'items_total': len(items), 'complete': 0, 'partial': 0, 'pending': 0, 'blocked': 0}
    for item in items:
        net = delivered.get(item.pk) or _ZERO
        remaining = max(item.quantity - net, _ZERO)
        link = _link_status(item)
        status = _item_status(item.quantity, net)
        confirmed = link == LINK_CONFIRMED
        available = pool.get(item.inventory_item_id, _ZERO) if confirmed else None

        if status == ITEM_COMPLETE:
            blocked = BLOCK_COMPLETE
        elif not confirmed:
            blocked = link
        elif available <= _ZERO:
            blocked = BLOCK_NO_STOCK
        else:
            blocked = None

        rows.append({
            'id': item.pk,
            'line_number': item.line_number,
            'description': item.description,
            'unit': item.unit,
            'quantity': item.quantity,
            'link_status': link,
            'product': _product(item) if confirmed else None,
            'available_central': available,
            'delivered': net,
            'remaining': remaining,
            'max_deliverable': min(remaining, available) if confirmed else None,
            'status': status,
            'can_deliver': blocked is None,
            'blocked_reason': blocked,
        })
        summary[status.lower()] += 1
        if blocked in (LINK_PROPOSED, LINK_OFF_CATALOG, LINK_UNLINKED, BLOCK_NO_STOCK):
            summary['blocked'] += 1

    can_deliver_now = user_can_deliver(request_obj, user)
    can_reverse_role = user_can_reverse(user)
    # Reversal only where the delivery can be redone (same states as a delivery).
    reversible_state = request_obj.status in DELIVERABLE_STATUSES
    return {
        'request': {
            'id': request_obj.pk,
            'rq_number': request_obj.rq_number,
            'flow': request_obj.flow,
            'status': request_obj.status,
            'project': request_obj.project.name if request_obj.project_id else None,
            'project_code': request_obj.project.code if request_obj.project_id else None,
            'department': request_obj.department.name if request_obj.department_id else None,
            'requested_by': request_obj.requested_by.get_full_name(),
            'fecha_necesidad': request_obj.fecha_necesidad,
            'deliverable_state': request_obj.status in DELIVERABLE_STATUSES,
            'deliver_roles': sorted(deliver_roles(request_obj)),
            'can_deliver': can_deliver_now,
            'can_reverse': can_reverse_role and reversible_state,
        },
        'items': rows,
        'summary': summary,
        'deliveries': _deliveries(
            request_obj, can_reverse_role=can_reverse_role, reversible_state=reversible_state,
        ),
    }
