"""
SYSPCC-026 · Fase 0 — Diagnósticos de stock RQ ↔ almacén. SOLO LECTURA.

Este módulo únicamente ejecuta SELECT: no crea, actualiza ni borra nada, no toma
locks (`select_for_update`) y no llama a ningún servicio de escritura de almacén. Lo
consumen los comandos `check_central_project_stock` y `report_rq_stock_gaps`, que dan
la evidencia previa para corregir el bug R1 en la Fase 3:

    R1: `WorkflowEngine._on_dispatched` descuenta con `project_id=request.project_id`
    (busca la fila CENTRAL + proyecto), pero `_on_material_received` ingresa con
    `project_id=None` (pool central). En RQs OPS con proyecto la salida lanza
    "Stock insuficiente", el `except Exception` lo reduce a un warning y el RQ pasa a
    DISPATCHED_TO_SITE sin movimiento, sin WarehouseDispatch y sin descontar stock.

Pool central = InventoryStock con warehouse_type=CENTRAL, project=NULL y department=NULL
(semántica de SYSPCC-025).

Segundo hallazgo que cubre `report_rq_stock_gaps` (revisión de la Fase 1): el solicitante
puede PROPONER un producto del catálogo al crear el RQ (`RequestItem.inventory_item`), pero
solo Logística lo CONFIRMA (`inventory_item_confirmed_at`). El motor
(`_resolve_inventory_item`) todavía usa la FK propuesta aunque no esté confirmada; hasta que
la Fase 3 lo corrija, `unconfirmed_catalog_links()` lista los ítems en esa situación para
revisarlos antes de desplegar.
"""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Exists, OuterRef, Prefetch, Q, Subquery

from apps.core.enums import (
    ApprovalActionChoices,
    MovementTypeChoices,
    RQFlowChoices,
    RQStatusChoices,
    WarehouseOriginChoices,
)
from apps.rq.models import Approval, Request, RequestItem

# Notas que escribe `WorkflowEngine._on_dispatched` en el MovementGroup de salida
# ("Despacho automático RQ <rq_number>"). Debe coincidir con workflow_engine.py; solo se
# usa para detectar salidas que SÍ ocurrieron aunque no tengan WarehouseDispatch.
AUTO_DISPATCH_NOTES_PREFIX = 'Despacho automático RQ '

# Estados que solo se alcanzan después de la acción DISPATCHED en OPERATIONS. Sirven para
# detectar RQs "despachados" que no tienen el Approval DISPATCHED (datos sembrados/importados).
POST_DISPATCH_STATUSES = frozenset({
    RQStatusChoices.DISPATCHED_TO_SITE,
    RQStatusChoices.DELIVERED,
    RQStatusChoices.CLAIM_IN_REVIEW,
    RQStatusChoices.USER_CONFORMITY,
    RQStatusChoices.CLOSED,
})

# Indicios de `report_rq_stock_gaps` (de mayor a menor fuerza como evidencia de R1).
VERDICT_R1_PROBABLE = 'R1_PROBABLE'
VERDICT_POOL_INSUFFICIENT = 'STOCK_INSUFICIENTE_EN_POOL'
VERDICT_OTHER_CAUSE = 'OTRA_CAUSA'
VERDICT_NO_FK_LINK = 'SIN_VINCULO_FK'
VERDICT_NO_DISPATCH_APPROVAL = 'SIN_APROBACION_DISPATCHED'

VERDICT_LABELS = {
    VERDICT_R1_PROBABLE: (
        'Hay stock en el pool central pero el despacho lo buscó en la fila del proyecto (R1).'
    ),
    VERDICT_POOL_INSUFFICIENT: (
        'Con el stock de hoy, el pool central tampoco cubre la cantidad pedida.'
    ),
    VERDICT_OTHER_CAUSE: (
        'Ítems vinculados cuya fila de proyecto sí cubre la cantidad: la causa no es R1 '
        '(revisar el log del despacho).'
    ),
    VERDICT_NO_FK_LINK: (
        'Ningún ítem tiene inventory_item: no se puede determinar si falló por R1 o por '
        'falta de coincidencia del match difuso.'
    ),
    VERDICT_NO_DISPATCH_APPROVAL: (
        'El estado es posterior al despacho pero no hay Approval DISPATCHED: dato sembrado '
        'o importado; el motor nunca ejecutó el despacho automático (no es R1).'
    ),
}

# Estados finales de un RQ, derivados de `Request.is_terminal` (única fuente de verdad):
# si mañana cambia el conjunto, este también.
TERMINAL_STATUSES = frozenset(
    status for status in RQStatusChoices.values if Request(status=status).is_terminal
)

_CHUNK = 500


def _chunks(values, size=_CHUNK):
    values = list(values)
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _scope_of(stock):
    if stock.project_id and stock.department_id:
        return 'PROJECT+DEPARTMENT'
    return 'PROJECT' if stock.project_id else 'DEPARTMENT'


# ──────────────────────────────────────────────────────────────────────────────
# 1. Filas de stock CENTRAL atadas a proyecto o departamento
# ──────────────────────────────────────────────────────────────────────────────

def central_scoped_stock():
    """
    Filas de InventoryStock del almacén CENTRAL con `project` o `department` no nulos.

    Esas filas NO son parte del pool central: tras corregir el despacho automático (que
    pasará a descontar del pool con project_id=None) ninguna salida las va a consumir.

    Returns:
        {'rows': [...], 'summary': {...}}. Las cantidades son Decimal.
    """
    from apps.warehouse.models import InventoryStock

    scoped = (
        InventoryStock.objects
        .filter(warehouse_type=WarehouseOriginChoices.CENTRAL)
        .filter(Q(project__isnull=False) | Q(department__isnull=False))
    )
    pool_by_inventory = dict(
        InventoryStock.objects
        .filter(
            warehouse_type=WarehouseOriginChoices.CENTRAL,
            project__isnull=True,
            department__isnull=True,
            inventory_id__in=scoped.values('inventory_id'),
        )
        .values_list('inventory_id', 'quantity')
    )

    rows = []
    for stock in (
        scoped.select_related('inventory', 'project', 'department')
        .order_by('inventory__product_code', 'project__code', 'department__code', 'pk')
    ):
        rows.append({
            'stock_id': stock.pk,
            'product_code': stock.inventory.product_code,
            'description': stock.inventory.description,
            'unit': stock.inventory.unit,
            'scope': _scope_of(stock),
            'project_code': stock.project.code if stock.project_id else '',
            'project_name': stock.project.name if stock.project_id else '',
            'department_code': stock.department.code if stock.department_id else '',
            'department_name': stock.department.name if stock.department_id else '',
            'quantity': stock.quantity,
            'pool_quantity': pool_by_inventory.get(stock.inventory_id),
            'last_updated': stock.last_updated,
        })

    positive = [r for r in rows if r['quantity'] > 0]
    units = defaultdict(Decimal)
    for r in positive:
        units[r['unit']] += r['quantity']
    summary = {
        'total_rows': len(rows),
        'zero_rows': len(rows) - len(positive),
        'positive_rows': len(positive),
        'distinct_products': len({r['product_code'] for r in rows}),
        'distinct_projects': len({r['project_code'] for r in rows if r['project_code']}),
        'distinct_departments': len({r['department_code'] for r in rows if r['department_code']}),
        # No se suman unidades distintas entre sí: se agrupa por unidad de medida.
        'positive_units_by_unit': dict(sorted(units.items())),
    }
    return {'rows': rows, 'summary': summary}


# ──────────────────────────────────────────────────────────────────────────────
# 2. RQs OPS con proyecto "despachados" sin movimiento de almacén
# ──────────────────────────────────────────────────────────────────────────────

def _stock_lookup(inventory_ids, project_ids):
    """
    {(inventory_id, project_id|None): quantity} para filas CENTRAL sin departamento.
    La clave con project_id=None es el pool central.
    """
    from apps.warehouse.models import InventoryStock

    lookup = {}
    wanted_projects = set(project_ids) | {None}
    for chunk in _chunks(inventory_ids):
        qs = InventoryStock.objects.filter(
            warehouse_type=WarehouseOriginChoices.CENTRAL,
            department__isnull=True,
            inventory_id__in=chunk,
        ).values_list('inventory_id', 'project_id', 'quantity')
        for inv_id, project_id, qty in qs:
            if project_id in wanted_projects:
                lookup[(inv_id, project_id)] = qty
    return lookup


def _evaluate_request(req, has_approval, stock_lookup):
    """Evidencia por ítem + indicio para un RQ candidato."""
    items = list(req.items.all())
    linked = [it for it in items if it.inventory_item_id]
    item_rows = []
    r1_hits = pool_short = project_covers = 0
    for it in linked:
        project_qty = stock_lookup.get((it.inventory_item_id, req.project_id))
        pool_qty = stock_lookup.get((it.inventory_item_id, None))
        project_ok = project_qty is not None and project_qty >= it.quantity
        pool_ok = pool_qty is not None and pool_qty >= it.quantity
        if project_ok:
            project_covers += 1
        elif pool_ok:
            r1_hits += 1
        else:
            pool_short += 1
        item_rows.append({
            'line_number': it.line_number,
            'description': it.description,
            'product_code': it.inventory_item.product_code,
            'requested': it.quantity,
            'project_row_quantity': project_qty,
            'pool_quantity': pool_qty,
        })

    if not has_approval:
        verdict = VERDICT_NO_DISPATCH_APPROVAL
    elif not linked:
        verdict = VERDICT_NO_FK_LINK
    elif r1_hits:
        verdict = VERDICT_R1_PROBABLE
    elif pool_short:
        verdict = VERDICT_POOL_INSUFFICIENT
    else:
        verdict = VERDICT_OTHER_CAUSE
    return len(items), len(linked), item_rows, verdict


def dispatched_requests_without_movement():
    """
    RQs OPERATIONS con proyecto que ya fueron "despachados" y cuyo despacho automático no
    dejó rastro: sin WarehouseDispatch y sin MovementGroup de salida "Despacho automático RQ …".

    "Despachado" = tiene un Approval con acción DISPATCHED o su estado es posterior al
    despacho (`POST_DISPATCH_STATUSES`). Los RQs sin ítems se omiten (nada que mover).

    El indicio usa el stock ACTUAL, no el que había al despachar: es una pista, no una prueba.

    Returns:
        {'rows': [...], 'summary': {...}}
    """
    from apps.warehouse.models import MovementGroup, WarehouseDispatch

    approved = Approval.objects.filter(request=OuterRef('pk'), action=ApprovalActionChoices.DISPATCHED)
    candidates = (
        Request.objects
        .filter(flow=RQFlowChoices.OPERATIONS, project__isnull=False)
        .annotate(
            has_dispatch_approval=Exists(approved),
            dispatch_approved_at=Subquery(approved.order_by('performed_at').values('performed_at')[:1]),
            has_dispatch_doc=Exists(WarehouseDispatch.objects.filter(request=OuterRef('pk'))),
            has_items=Exists(RequestItem.objects.filter(request=OuterRef('pk'))),
        )
        .filter(Q(has_dispatch_approval=True) | Q(status__in=POST_DISPATCH_STATUSES))
        .filter(has_dispatch_doc=False, has_items=True)
        .select_related('project')
        .prefetch_related(Prefetch(
            'items', queryset=RequestItem.objects.select_related('inventory_item').order_by('line_number'),
        ))
        .order_by('rq_number')
    )

    exit_notes = set(
        MovementGroup.objects
        .filter(movement_type=MovementTypeChoices.EXIT, notes__startswith=AUTO_DISPATCH_NOTES_PREFIX)
        .values_list('notes', flat=True)
    )
    pending = [r for r in candidates if f'{AUTO_DISPATCH_NOTES_PREFIX}{r.rq_number}' not in exit_notes]

    inventory_ids, project_ids = set(), set()
    for r in pending:
        project_ids.add(r.project_id)
        inventory_ids.update(it.inventory_item_id for it in r.items.all() if it.inventory_item_id)
    lookup = _stock_lookup(inventory_ids, project_ids) if inventory_ids else {}

    rows = []
    by_verdict = defaultdict(int)
    for r in pending:
        items_total, items_linked, item_rows, verdict = _evaluate_request(
            r, r.has_dispatch_approval, lookup,
        )
        by_verdict[verdict] += 1
        rows.append({
            'request_id': r.pk,
            'rq_number': r.rq_number,
            'status': r.status,
            'project_code': r.project.code,
            'project_name': r.project.name,
            'dispatch_approved_at': r.dispatch_approved_at,
            'has_dispatch_approval': r.has_dispatch_approval,
            'items_total': items_total,
            'items_linked': items_linked,
            'verdict': verdict,
            'items': item_rows,
        })

    summary = {
        'total_requests': len(rows),
        'by_verdict': {v: by_verdict.get(v, 0) for v in VERDICT_LABELS},
        'r1_evidence_requests': by_verdict.get(VERDICT_R1_PROBABLE, 0),
    }
    return {'rows': rows, 'summary': summary}


# ──────────────────────────────────────────────────────────────────────────────
# 3. Vínculos de catálogo propuestos que Logística no confirmó
# ──────────────────────────────────────────────────────────────────────────────

def unconfirmed_catalog_links(*, include_terminal=False):
    """
    Ítems con `inventory_item` y SIN sello de confirmación (`inventory_item_confirmed_at`
    nulo): el producto lo propuso el solicitante, el seed o el admin, pero Logística no lo
    revisó.

    Por defecto solo cuenta RQs que aún pueden mover stock (no terminales); con
    `include_terminal=True` suma los cerrados, cancelados y rechazados.

    Hoy el motor igual usa esa FK al recibir y despachar. Este listado es el insumo para
    decidir, antes de activar la Fase 3 (que solo honrará vínculos confirmados), cuáles
    se confirman en bloque y cuáles revisa Logística.

    Solo SELECT, una consulta (los datos del RQ y del producto vienen con el JOIN).

    Returns:
        {'rows': [...], 'summary': {...}}
    """
    items = (
        RequestItem.objects
        .filter(inventory_item__isnull=False, inventory_item_confirmed_at__isnull=True)
        .select_related('request__project', 'request__department', 'inventory_item')
        .order_by('request__rq_number', 'line_number')
    )
    if not include_terminal:
        items = items.exclude(request__status__in=TERMINAL_STATUSES)

    rows = []
    requests_seen = set()
    by_flow = defaultdict(int)
    by_status = defaultdict(int)
    for item in items:
        req = item.request
        scope = req.project or req.department
        requests_seen.add(req.pk)
        by_flow[req.flow] += 1
        by_status[req.status] += 1
        rows.append({
            'item_id': item.pk,
            'request_id': req.pk,
            'rq_number': req.rq_number,
            'flow': req.flow,
            'status': req.status,
            'scope_code': scope.code if scope else '',
            'line_number': item.line_number,
            'description': item.description,
            'quantity': item.quantity,
            'unit': item.unit,
            'product_code': item.inventory_item.product_code,
            'product_description': item.inventory_item.description,
        })

    summary = {
        'include_terminal': include_terminal,
        'total_items': len(rows),
        'total_requests': len(requests_seen),
        'by_flow': dict(sorted(by_flow.items())),
        'by_status': dict(sorted(by_status.items())),
    }
    return {'rows': rows, 'summary': summary}


# ──────────────────────────────────────────────────────────────────────────────
# Serialización para --json
# ──────────────────────────────────────────────────────────────────────────────

def json_default(value):
    """`default=` de json.dumps para Decimal y fechas (hora de Lima, ISO 8601)."""
    from datetime import date, datetime

    from django.utils import timezone

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return (timezone.localtime(value) if timezone.is_aware(value) else value).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f'No serializable: {type(value).__name__}')
