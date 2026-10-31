"""
RQ pendientes por entregar (SYSPCC-041) · lista del selector de la pantalla Salida.

Un RQ aparece cuando el usuario PUEDE entregarlo hoy y todavía tiene algo que entregar:

* **Visibilidad**: `get_accessible_requests_queryset` (la misma fuente que el resto de la app).
* **Estado y rol**: solo los estados que admite `deliver_request_items` (`DELIVERABLE_STATUSES`) y,
  en cada (flujo, estado), solo si el usuario tiene alguno de los roles que `TRANSITIONS` exige para
  DISPATCHED. Es `user_can_deliver` resuelto en bloque, en la base de datos; sin bypass de
  `is_superuser` / `is_staff`.
* **Pendiente**: la regla del Master. Se clasifica cada ítem con `item_tracking.classify_item`
  (vía `request_master.lights_by_request`, una consulta agrupada por lote: sin N+1) y el RQ entra si
  tiene al menos un ítem `PENDIENTE` o `PARCIAL` que además el almacén pueda entregar (vínculo de
  catálogo confirmado y no fuera de catálogo). STAND_BY, DESESTIMADO, ATENDIDO, anulados y sin
  vincular se excluyen por la propia clasificación. Es un subconjunto estricto de «PENDIENTE o
  PARCIAL» del Master: un RQ con solo ítems fuera de catálogo no aparece porque no habría nada que
  entregar.

Solo lectura. No expone precios ni datos de trabajadores.
"""
import logging
from dataclasses import dataclass

from django.db.models import Exists, F, OuterRef, Q

from apps.core.enums import RQFlowChoices
from apps.rq.models import RequestItem
from apps.rq.permissions import get_accessible_requests_queryset
from apps.rq.services.item_tracking import ItemStatus, summarize_progress
from apps.rq.services.request_master import lights_by_request
from apps.rq.services.transition_roles import roles_for_action
from apps.warehouse.services.rq_fulfillment import DELIVERABLE_STATUSES, DELIVERY_ACTION

logger = logging.getLogger(__name__)

# El selector es un typeahead sobre un backlog corto (IN_STOCK / QUALITY_APPROVED). El tope evita
# que una anomalía convierta la lista en una carga sin límite; si se alcanza, queda en el log.
MAX_CANDIDATES = 500
MAX_SEARCH_LENGTH = 100


@dataclass(frozen=True)
class DeliverableList:
    """`rows` plus `truncated`: the candidate cap was reached, so the list may be missing requests."""

    rows: list
    truncated: bool = False


def _deliverable_pairs_q(user):
    """Q que une los (flujo, estado) donde `user` tiene un rol de entrega; None si no hay ninguno."""
    user_roles = set(user.user_roles.values_list('role', flat=True))
    condition = None
    for flow in RQFlowChoices.values:
        for status in DELIVERABLE_STATUSES:
            if user_roles & roles_for_action(flow, status, DELIVERY_ACTION):
                pair = Q(flow=flow, status=status)
                condition = pair if condition is None else condition | pair
    return condition


def _deliverable_items():
    """Ítems que el almacén puede entregar: vínculo confirmado y no fuera de catálogo."""
    return RequestItem.objects.filter(
        inventory_item__isnull=False,
        inventory_item_confirmed_at__isnull=False,
        is_off_catalog=False,
    )


def list_deliverable_requests(user, *, search: str = '', flow: str = '') -> DeliverableList:
    """
    RQ pendientes por entregar visibles para `user`, como dicts listos para serializar, en el orden
    fecha de necesidad (sin fecha al final), más reciente primero. Lista vacía si el usuario no
    tiene rol de entrega en ningún estado. `search` se recorta a `MAX_SEARCH_LENGTH` caracteres.
    `truncated` indica que se alcanzó `MAX_CANDIDATES` y pudieron quedar RQ fuera de la lista (el
    usuario debe afinar la búsqueda).
    """
    pairs = _deliverable_pairs_q(user)
    if pairs is None:
        return DeliverableList([])

    candidates = (
        get_accessible_requests_queryset(user)
        .filter(pairs)
        .filter(Exists(_deliverable_items().filter(request_id=OuterRef('pk'))))
        .select_related('project', 'department', 'requested_by')
    )
    if flow:
        candidates = candidates.filter(flow=flow)
    term = (search or '').strip()[:MAX_SEARCH_LENGTH]
    if term:
        candidates = candidates.filter(
            Q(rq_number__icontains=term)
            | Q(description__icontains=term)
            | Q(project__name__icontains=term)
            | Q(project__code__icontains=term)
            | Q(department__name__icontains=term)
            | Q(requested_by__first_name__icontains=term)
            | Q(requested_by__last_name__icontains=term)
        )
    # One more than the cap, to know whether something was left out.
    requests = list(
        candidates.order_by(F('fecha_necesidad').asc(nulls_last=True), '-created_at', 'pk')[:MAX_CANDIDATES + 1]
    )
    truncated = len(requests) > MAX_CANDIDATES
    if truncated:
        requests = requests[:MAX_CANDIDATES]
        logger.warning(
            'warehouse.rq_deliverable.candidates_capped',
            extra={'user_id': user.pk, 'cap': MAX_CANDIDATES},
        )
    if not requests:
        return DeliverableList([])

    ids = [rq.pk for rq in requests]
    lights = lights_by_request(ids)                     # una consulta agrupada por lote
    deliverable_item_ids = set(
        _deliverable_items().filter(request_id__in=ids).values_list('pk', flat=True)
    )

    rows = []
    for rq in requests:
        items = lights.get(rq.pk, [])
        pending = partial = 0
        for light in items:
            if light.pk not in deliverable_item_ids:
                continue
            if light.result.status == ItemStatus.PENDING:
                pending += 1
            elif light.result.status == ItemStatus.PARTIAL:
                partial += 1
        if not pending and not partial:
            continue
        progress = summarize_progress(light.result for light in items)
        rows.append({
            'id': rq.pk,
            'rq_number': rq.rq_number,
            'flow': rq.flow,
            'status': rq.status,
            'project': rq.project.name if rq.project_id else None,
            'project_code': rq.project.code if rq.project_id else None,
            'department': rq.department.name if rq.department_id else None,
            'requested_by': rq.requested_by.get_full_name(),
            'fecha_necesidad': rq.fecha_necesidad,
            'priority': rq.priority,
            'items_total': progress.items_total,
            'items_pending': pending,
            'items_partial': partial,
            'items_deliverable': pending + partial,
            'percent': progress.percent,
        })
    return DeliverableList(rows, truncated)
