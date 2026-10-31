"""
Master de RQ (SYSPCC-030): consultas del seguimiento por ítem.

Una fila por ÍTEM de RQ, de todos los proyectos y departamentos que el usuario puede ver
(`get_accessible_requests_queryset`, la misma fuente de visibilidad que `RequestViewSet`). Es
una vista DERIVADA: el estado, lo atendido y las fechas salen de `item_tracking.classify_item`
a partir de lo que registró el almacén; aquí solo se leen los hechos y se dan forma a las filas.
No expone precios ni costos ni nombres de trabajadores (solo el usuario del sistema que registró
cada salida).

Rendimiento
-----------
* Todos los agregados se anotan en la consulta (Subquery/Exists), sin N+1: entregado neto,
  fecha de la última entrega, fecha de aprobación, decisión de gerencia y discrepancias.
* Los filtros de base de datos acotan el conjunto primero. Los que dependen del estado derivado
  (estado del ítem, seguimiento, alertas, faltante, fecha atendida) y el orden por columnas
  derivadas se resuelven en Python sobre filas ligeras (`values()`) y solo entonces se pagina;
  sin esos filtros, la paginación va directo a la base de datos.
* El detalle (nombres, guías, responsables) se carga solo para la página con `select_related` y
  un `prefetch`; el % de atención de los RQs de la página y el stock vivo, con una consulta cada
  uno.

El % de atención de un RQ es SIEMPRE el del RQ completo, aunque un filtro de ítem (fuente,
estado, etc.) deje ver solo algunas de sus líneas.
"""
from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import asdict, dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional

from django.db.models import (
    Case, Count, Exists, F, IntegerField, Max, OuterRef, Prefetch, Q, Subquery, Value, When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.core.enums import (
    ItemSourceChoices,
    PriorityChoices,
    RequestingAreaChoices,
    RQFlowChoices,
    RQStatusChoices,
)
from apps.rq.models import ActivityLog, Approval, Request, RequestItem
from apps.rq.permissions import get_accessible_requests_queryset, never_sent_q
from apps.rq.services import item_tracking as tracking_rules
from apps.rq.services.item_tracking import ItemFacts, ItemStatus, classify_item, summarize_progress
from apps.warehouse.models import WarehouseDispatchItem
from apps.warehouse.services.dispatch_totals import net_dispatched_expression

_ZERO = Decimal('0')

NO_VALUE = 'NONE'          # filtro "sin área" / "sin fuente"
CHUNK_SIZE = 500           # tamaño de los `pk__in` (límite de variables de SQLite)

# Columnas por las que se puede ordenar. `?ordering=-campo` invierte.
DB_ORDERING = {
    'rq_number': 'request__rq_number',
    'line_number': 'line_number',
    'need_date': 'request__fecha_necesidad',
    'approval_date': 'rq_validated_at',
    'project': 'origin_name',
    'requested_by': 'requester_name',
    'quantity': 'quantity',
    'source': 'item_source',
    'priority': 'priority_rank',
}
DERIVED_ORDERING = ('status', 'attended', 'missing', 'attended_date')
ITEM_ORDERING_FIELDS = tuple(DB_ORDERING) + DERIVED_ORDERING
SUMMARY_ORDERING_FIELDS = (
    'rq_number', 'percent', 'approval_date', 'need_date', 'items_total', 'project', 'stage',
)
DEFAULT_ITEM_ORDERING = ('-request__rq_number', 'line_number', 'pk')


# ──────────────────────────────── parámetros ────────────────────────────────

@dataclass
class MasterParams:
    """Filtros ya validados (los arma `MasterQuerySerializer`)."""

    project: Optional[int] = None
    department: Optional[int] = None
    flow: str = ''
    area: str = ''
    source: str = ''
    item_status: str = ''
    tracking: str = ''
    alert: str = ''
    stage: str = ''
    status: str = ''
    requested_by: Optional[int] = None
    request: Optional[int] = None
    approved_from: Optional[datetime.date] = None
    approved_to: Optional[datetime.date] = None
    attended_from: Optional[datetime.date] = None
    attended_to: Optional[datetime.date] = None
    with_shortage: bool = False
    with_alerts: bool = False
    search: str = ''
    ordering: str = ''

    @classmethod
    def from_validated(cls, data: dict) -> 'MasterParams':
        known = {name for name in cls.__dataclass_fields__}
        return cls(**{key: value for key, value in data.items() if key in known and value is not None})

    @property
    def ordering_field(self) -> str:
        return self.ordering.lstrip('-')

    @property
    def descending(self) -> bool:
        return self.ordering.startswith('-')

    @property
    def has_derived_filters(self) -> bool:
        return bool(
            self.item_status or self.tracking or self.alert or self.with_shortage
            or self.with_alerts or self.attended_from or self.attended_to
        )

    @property
    def needs_python_pass(self) -> bool:
        return self.has_derived_filters or self.ordering_field in DERIVED_ORDERING


# ───────────────────────────── consulta anotada ─────────────────────────────

def _lima_date(value):
    if value is None:
        return None
    return timezone.localtime(value).date() if timezone.is_aware(value) else value.date()


def _approval_annotations(outer: str) -> dict:
    """Anotaciones de Approval/ActivityLog para `RequestItem` (outer='request_id') o `Request` ('pk')."""
    from apps.warehouse.services.rq_fulfillment import STOCK_DISCREPANCY_ACTION

    approvals = Approval.objects.filter(request=OuterRef(outer))
    return {
        'rq_validated_at': Subquery(
            approvals.filter(new_status=RQStatusChoices.VALIDATED)
            .order_by('performed_at', 'pk').values('performed_at')[:1]
        ),
        'rq_delivered_at': Subquery(
            approvals.filter(new_status=RQStatusChoices.DELIVERED)
            .order_by('performed_at', 'pk').values('performed_at')[:1]
        ),
        'rq_gm_status': Subquery(
            approvals.filter(new_status__in=tracking_rules.GM_DECISION_STATUSES)
            .order_by('-performed_at', '-pk').values('new_status')[:1]
        ),
        'rq_has_discrepancy': Exists(
            ActivityLog.objects.filter(request=OuterRef(outer), action=STOCK_DISCREPANCY_ACTION)
        ),
    }


def annotate_items(queryset):
    """
    Anota a cada RequestItem lo que sale de Approval/ActivityLog y las columnas de orden.

    Lo que sale del almacén (entregado neto, filas, última entrega) NO se anota aquí: una
    subconsulta correlacionada por ítem sobre las entregas es cuadrática en PostgreSQL. Se
    calcula en UNA consulta agrupada (`dispatch_aggregates`) y se une en Python.
    """
    return queryset.annotate(
        **_approval_annotations('request_id'),
        origin_name=Coalesce('request__project__name', 'request__department__name', Value('')),
        requester_name=Coalesce('request__requested_by__last_name', Value('')),
        priority_rank=Case(
            When(request__priority=PriorityChoices.URGENT, then=Value(0)),
            When(request__priority=PriorityChoices.HIGH, then=Value(1)),
            When(request__priority=PriorityChoices.NORMAL, then=Value(2)),
            default=Value(3), output_field=IntegerField(),
        ),
    )


@dataclass(frozen=True)
class DispatchAggregate:
    """Lo que el almacén registró contra un ítem."""

    net: Decimal                                  # entregas − reversas
    rows: int                                     # filas de entrega (incluye reversas)
    last_on: Optional[datetime.date]              # fecha de la última entrega VIGENTE


_NO_DISPATCH = DispatchAggregate(net=_ZERO, rows=0, last_on=None)


def dispatch_aggregates(item_ids) -> dict:
    """
    {request_item_id: DispatchAggregate} en UNA consulta agrupada. `item_ids` es una lista de
    ids o una consulta `values('pk')` de RequestItem. Los ítems sin entregas no aparecen.

    La última entrega vigente es la de mayor fecha operativa (MovementGroup.movement_date; si
    falta, la fecha de registro) entre las que no son reversa ni fueron anuladas por una reversa.
    """
    active = Q(dispatch__reverses__isnull=True, dispatch__reversals__isnull=True)
    grouped = (
        WarehouseDispatchItem.objects.filter(request_item_id__in=item_ids)
        .values('request_item_id')
        .annotate(
            net=net_dispatched_expression(''),
            line_count=Count('pk', distinct=True),
            last_movement=Max('dispatch__movement_group__movement_date', filter=active),
            last_registered=Max('dispatch__dispatched_at', filter=active),
        )
        .order_by()
    )
    return {
        row['request_item_id']: DispatchAggregate(
            net=row['net'] or _ZERO,
            rows=row['line_count'],
            last_on=row['last_movement'] or _lima_date(row['last_registered']),
        )
        for row in grouped
    }


# Campos que se leen con `values()` para el cálculo ligero (todo lo que necesita `facts_from_row`).
_FACT_VALUES = (
    'pk', 'request_id', 'quantity', 'inventory_item_id', 'inventory_item_confirmed_at',
    'is_off_catalog', 'attention_override', 'request__status', 'rq_validated_at',
    'rq_delivered_at', 'rq_has_discrepancy',
)


def facts_from_row(row: dict, dispatch: DispatchAggregate = _NO_DISPATCH) -> ItemFacts:
    return ItemFacts(
        quantity=row['quantity'] or _ZERO,
        net_dispatched=dispatch.net,
        dispatch_rows=dispatch.rows,
        has_confirmed_link=(
            row['inventory_item_id'] is not None and row['inventory_item_confirmed_at'] is not None
        ),
        is_off_catalog=bool(row['is_off_catalog']),
        override=row['attention_override'] or '',
        request_status=row['request__status'],
        delivered_on=_lima_date(row['rq_delivered_at']),
        last_delivery_on=dispatch.last_on,
        has_discrepancy=bool(row['rq_has_discrepancy']),
    )


def facts_from_item(item: RequestItem, dispatch: DispatchAggregate = _NO_DISPATCH) -> ItemFacts:
    """Mismos hechos desde una instancia anotada con `annotate_items`."""
    return facts_from_row({
        'quantity': item.quantity,
        'inventory_item_id': item.inventory_item_id,
        'inventory_item_confirmed_at': item.inventory_item_confirmed_at,
        'is_off_catalog': item.is_off_catalog,
        'attention_override': item.attention_override,
        'request__status': item.request.status,
        'rq_validated_at': item.rq_validated_at,
        'rq_delivered_at': item.rq_delivered_at,
        'rq_has_discrepancy': item.rq_has_discrepancy,
    }, dispatch)


def _tracked_requests(user):
    """
    RQs the Master tracks for `user`: the accessible ones minus the never-sent ones
    (drafts, and drafts cancelled before being sent: SYSPCC-031). They are not a
    requirement: their lines have nothing to be attended. Excluded even for their owner.
    """
    return get_accessible_requests_queryset(user).exclude(never_sent_q()).values('pk')


def master_queryset(user, params: MasterParams):
    """RequestItem anotados, con el alcance del usuario y los filtros de base de datos."""
    scope = _tracked_requests(user)
    qs = annotate_items(RequestItem.objects.filter(request_id__in=scope))

    if params.project:
        qs = qs.filter(request__project_id=params.project)
    if params.department:
        qs = qs.filter(request__department_id=params.department)
    if params.flow:
        qs = qs.filter(request__flow=params.flow)
    if params.area:
        qs = qs.filter(request__requesting_area='' if params.area == NO_VALUE else params.area)
    if params.source:
        qs = qs.filter(item_source='' if params.source == NO_VALUE else params.source)
    if params.stage:
        qs = qs.filter(request__status__in=tracking_rules.statuses_of_stage(params.stage))
    if params.status:
        qs = qs.filter(request__status=params.status)
    if params.requested_by:
        qs = qs.filter(request__requested_by_id=params.requested_by)
    if params.request:
        qs = qs.filter(request_id=params.request)
    if params.approved_from:
        qs = qs.filter(rq_validated_at__date__gte=params.approved_from)
    if params.approved_to:
        qs = qs.filter(rq_validated_at__date__lte=params.approved_to)
    if params.search:
        term = params.search
        guide_match = WarehouseDispatchItem.objects.filter(request_item=OuterRef('pk')).filter(
            Q(dispatch__dispatch_guide_number__icontains=term)
            | Q(dispatch__movement_group__guide_number__icontains=term)
        )
        qs = qs.filter(
            Q(request__rq_number__icontains=term)
            | Q(description__icontains=term)
            | Q(inventory_item__product_code__icontains=term)
            | Exists(guide_match)
        )
    return qs.order_by(*_db_ordering(params))


def _db_ordering(params: MasterParams) -> tuple:
    column = DB_ORDERING.get(params.ordering_field)
    if column is None:
        return DEFAULT_ITEM_ORDERING
    expression = F(column).desc(nulls_last=True) if params.descending else F(column).asc(nulls_last=True)
    tail = ('request__rq_number', 'line_number', 'pk')
    return (expression, *tail)


# ───────────────────────────── cálculo ligero ─────────────────────────────

@dataclass
class Light:
    """Un ítem ya clasificado, sin cargar la instancia."""

    pk: int
    request_id: int
    result: tracking_rules.ItemTracking


def _chunks(values: list, size: int = CHUNK_SIZE):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def iter_light(queryset) -> Iterable[Light]:
    # Un solo agrupado de entregas para todo el conjunto (subconsulta de ids), no uno por ítem.
    dispatch = dispatch_aggregates(queryset.order_by().values('pk'))
    # Sin `.iterator()`: en PostgreSQL abre un cursor del lado del servidor, que no funciona
    # detrás de un pooler en modo transacción (el pool de DigitalOcean); son filas ligeras (`values()`).
    for row in queryset.values(*_FACT_VALUES):
        result = classify_item(facts_from_row(row, dispatch.get(row['pk'], _NO_DISPATCH)))
        yield Light(pk=row['pk'], request_id=row['request_id'], result=result)


def _matches(result, params: MasterParams) -> bool:
    if params.item_status and result.status != params.item_status:
        return False
    if params.tracking and result.tracking != params.tracking:
        return False
    if params.alert and params.alert not in result.alerts:
        return False
    if params.with_alerts and not result.alerts:
        return False
    if params.with_shortage and not (result.missing is not None and result.missing > _ZERO):
        return False
    if params.attended_from or params.attended_to:
        if result.attended_on is None:
            return False
        if params.attended_from and result.attended_on < params.attended_from:
            return False
        if params.attended_to and result.attended_on > params.attended_to:
            return False
    return True


_STATUS_ORDER = {code: position for position, code in enumerate(tracking_rules.ITEM_STATUS_LABELS)}


def _derived_value(field_name: str, light: Light):
    result = light.result
    if field_name == 'status':
        return _STATUS_ORDER[result.status]
    if field_name == 'attended':
        return result.attended
    if field_name == 'missing':
        return result.missing           # None: SIN VINCULAR, no se puede calcular
    return result.attended_on           # None: aún sin fecha


def select_matching(user, params: MasterParams) -> list:
    """
    Ítems (como `Light`, en el orden pedido) que cumplen TODOS los filtros, incluidos los que
    dependen del estado derivado. Es la base del listado con filtros derivados, del resumen y
    del Excel.
    """
    lights = [light for light in iter_light(master_queryset(user, params)) if _matches(light.result, params)]
    if params.ordering_field in DERIVED_ORDERING:
        # Estable: el empate conserva el orden de base de datos (RQ y línea). Lo que no tiene
        # valor (sin fecha, faltante incalculable) va siempre al final, en ambos sentidos.
        name = params.ordering_field
        present = [light for light in lights if _derived_value(name, light) is not None]
        absent = [light for light in lights if _derived_value(name, light) is None]
        present.sort(key=lambda light: _derived_value(name, light), reverse=params.descending)
        lights = present + absent
    return lights


def rq_progress_map(request_ids: Iterable[int]) -> dict:
    """{request_id: RQProgress} sobre TODOS los ítems de cada RQ (no solo los filtrados)."""
    return progress_from_results(_results_by_request(request_ids))


def progress_from_results(results: dict) -> dict:
    return {rid: summarize_progress(items) for rid, items in results.items()}


def lights_by_request(request_ids: Iterable[int]) -> dict:
    """{request_id: [Light]} de TODOS los ítems de cada RQ, clasificados una sola vez."""
    grouped: dict = defaultdict(list)
    for chunk in _chunks(sorted(set(request_ids))):
        qs = annotate_items(RequestItem.objects.filter(request_id__in=chunk)).order_by('request_id', 'line_number')
        for light in iter_light(qs):
            grouped[light.request_id].append(light)
    return grouped


def results_of(lights: dict) -> dict:
    return {rid: [light.result for light in items] for rid, items in lights.items()}


def _results_by_request(request_ids: Iterable[int]) -> dict:
    return results_of(lights_by_request(request_ids))


# ───────────────────────── filas del Master (con detalle) ─────────────────────────

def detail_queryset():
    """RequestItem anotados con lo necesario para armar la fila completa de una página."""
    deliveries = WarehouseDispatchItem.objects.select_related(
        'dispatch__movement_group', 'dispatch__dispatched_by',
    ).order_by('dispatch__dispatched_at', 'pk')
    return annotate_items(
        RequestItem.objects.select_related(
            'request__project', 'request__department', 'request__requested_by', 'inventory_item',
        ).prefetch_related(Prefetch('dispatch_items', queryset=deliveries))
    )


@dataclass(frozen=True)
class Delivery:
    """Una entrega (o reversa) registrada por el almacén contra un ítem."""

    on: Optional[datetime.date]
    at: Optional[datetime.datetime]
    dispatch_id: int
    dispatch_number: str
    guide: str
    quantity: Decimal           # negativo en una reversa
    is_reversal: bool
    by: str                     # usuario del sistema que registró (nunca el trabajador que recibió)
    reverses: Optional[int] = None   # id de la entrega que esta reversa anula


def _person(user) -> str:
    if user is None:
        return ''
    return user.get_full_name() or user.get_username()


def deliveries_of(item: RequestItem) -> list:
    """Entregas y reversas del ítem, en orden cronológico (usa el prefetch de `detail_queryset`)."""
    events = []
    for line in item.dispatch_items.all():
        dispatch = line.dispatch
        group = dispatch.movement_group
        is_reversal = dispatch.reverses_id is not None
        events.append(Delivery(
            on=(group.movement_date if group and group.movement_date else _lima_date(dispatch.dispatched_at)),
            at=dispatch.dispatched_at,
            dispatch_id=dispatch.pk,
            dispatch_number=dispatch.dispatch_number,
            guide=dispatch.dispatch_guide_number or (group.guide_number if group else '') or '',
            quantity=-line.quantity_dispatched if is_reversal else line.quantity_dispatched,
            is_reversal=is_reversal,
            by=_person(dispatch.dispatched_by),
            reverses=dispatch.reverses_id,
        ))
    events.sort(key=lambda e: (e.on or datetime.date.min, e.at or datetime.datetime.min, e.dispatch_id))
    return events


def active_deliveries(events: list) -> list:
    """Entregas vigentes: ni reversas ni entregas ya anuladas por una reversa."""
    annulled = {event.reverses for event in events if event.is_reversal}
    return [e for e in events if not e.is_reversal and e.dispatch_id not in annulled]


def _guides(events: list) -> list:
    seen: list = []
    for event in active_deliveries(events):
        if event.guide and event.guide not in seen:
            seen.append(event.guide)
    return seen


def _guide_text(guides: list) -> str:
    if len(guides) <= 3:
        return ', '.join(guides)
    return f'{guides[-1]} +{len(guides) - 1}'


def _label(choices, value) -> str:
    return str(dict(choices.choices).get(value, value or ''))


def build_rows(items: list, *, can_override_role: bool = False, progress: Optional[dict] = None,
               classified: Optional[dict] = None) -> list:
    """
    Filas del Master (dicts) para `items`: instancias de `detail_queryset()` ya cargadas.
    Hace UNA consulta extra para el stock vivo y UNA para el % de atención de sus RQs.

    `progress` ({request_id: RQProgress}) y `classified` ({item_id: ItemTracking}) permiten
    reutilizar lo ya calculado (el Excel clasifica cada ítem una sola vez); sin ellos se
    calculan aquí.
    """
    from apps.rq.services.request_catalog import central_pool_available

    if progress is None:
        progress = rq_progress_map({item.request_id for item in items})
    unclassified = [i.pk for i in items if classified is None or i.pk not in classified]
    dispatch = dispatch_aggregates(unclassified) if unclassified else {}
    live_ids = {i.inventory_item_id for i in items if i.inventory_item_id and i.inventory_item_confirmed_at}
    pool = central_pool_available(live_ids)

    rows = []
    for item in items:
        rq = item.request
        if classified is not None and item.pk in classified:
            result = classified[item.pk]
        else:
            result = classify_item(facts_from_item(item, dispatch.get(item.pk, _NO_DISPATCH)))
        events = deliveries_of(item)
        guides = _guides(events)
        real = active_deliveries(events)
        stage = tracking_rules.stage_of(rq.status)
        gm_code, gm_kind = tracking_rules.gm_approval_from_status(item.rq_gm_status)
        is_live = item.inventory_item_id is not None and item.inventory_item_confirmed_at is not None
        rq_progress = progress.get(item.request_id)
        origin = rq.project.name if rq.project_id else (rq.department.name if rq.department_id else '')
        rows.append({
            'id': item.pk,
            'request_id': item.request_id,
            'rq_number': rq.rq_number,
            'line_number': item.line_number,
            'flow': rq.flow,
            'flow_label': _label(RQFlowChoices, rq.flow),
            'project_id': rq.project_id,
            'project_code': rq.project.code if rq.project_id else '',
            'project_name': rq.project.name if rq.project_id else '',
            'department_id': rq.department_id,
            'department_name': rq.department.name if rq.department_id else '',
            'origin': origin,
            'requesting_area': rq.requesting_area,
            'requesting_area_label': _label(RequestingAreaChoices, rq.requesting_area) or 'Sin área',
            'description': item.description,
            'unit': item.unit,
            'product_code': item.inventory_item.product_code if item.inventory_item_id else '',
            'quantity': item.quantity,
            'quantity_attended': result.attended,
            'quantity_missing': result.missing,
            'central_stock': pool.get(item.inventory_item_id, _ZERO) if is_live else item.stock_almacen_central,
            'central_stock_is_live': is_live,
            'item_source': item.item_source,
            'item_source_label': _label(ItemSourceChoices, item.item_source),
            'priority': rq.priority,
            'priority_label': _label(PriorityChoices, rq.priority),
            'requested_by_id': rq.requested_by_id,
            'requested_by_name': _person(rq.requested_by),
            'approval_date': _lima_date(item.rq_validated_at),
            'need_date': rq.fecha_necesidad,
            'attended_date': result.attended_on,
            'last_delivery_date': real[-1].on if real else None,
            'status': result.status,
            'status_label': tracking_rules.ITEM_STATUS_LABELS[result.status],
            'tracking': result.tracking,
            'tracking_label': tracking_rules.TRACKING_LABELS[result.tracking],
            'link_proposed': (
                item.inventory_item_id is not None and item.inventory_item_confirmed_at is None
            ),
            'attended_by_flow': result.attended_by_flow,
            'guides': guides,
            'guide_text': _guide_text(guides),
            'attention_responsible': real[-1].by if real else '',
            'comments': item.comentarios,
            'attention_override': item.attention_override,
            'attention_override_label': tracking_rules.OVERRIDE_LABELS.get(item.attention_override, ''),
            'attention_note': item.attention_note,
            'can_set_override': can_override_role and not rq.is_terminal,
            'budget_type': item.presupuestado_adicional,
            'budget_classification': rq.budget_classification or '',
            'budget_classification_label': (
                rq.get_budget_classification_display() if rq.budget_classification else ''
            ),
            'gm_approval': gm_code,
            'gm_approval_label': tracking_rules.GM_APPROVAL_LABELS[gm_code],
            'gm_approval_kind': gm_kind,
            'gm_approval_kind_label': tracking_rules.GM_KIND_LABELS[gm_kind],
            'stage': stage.code,
            'stage_label': stage.label,
            'phase': tracking_rules.phase_of(rq.status),
            'rq_status': rq.status,
            'rq_status_label': rq.get_status_display(),
            'alerts': [
                {'code': code, 'label': tracking_rules.ALERT_LABELS[code]} for code in result.alerts
            ],
            'rq_progress': asdict(rq_progress) if rq_progress else None,
            # Las entregas (con su guía y responsable) para la fila expandible / la hoja ENTREGAS.
            'deliveries': [
                {
                    'dispatch_id': e.dispatch_id,
                    'dispatch_number': e.dispatch_number,
                    'date': e.on,
                    'guide': e.guide,
                    'quantity': e.quantity,
                    'is_reversal': e.is_reversal,
                    'responsible': e.by,
                }
                for e in events
            ],
        })
    return rows


def user_is_logistics(user) -> bool:
    from apps.core.permissions import IsLogisticsStaff

    return user.user_roles.filter(role__in=IsLogisticsStaff.LOGISTICS_ROLES).exists()


def get_master_row(user, item_id: int) -> Optional[dict]:
    """Fila del Master de UN ítem visible para `user` (None si no existe o no lo puede ver)."""
    scope = _tracked_requests(user)
    item = detail_queryset().filter(pk=item_id, request_id__in=scope).first()
    if item is None:
        return None
    return build_rows([item], can_override_role=user_is_logistics(user))[0]


def page_rows(user, params: MasterParams, paginator, request, view) -> tuple:
    """
    (filas de la página, página) para el listado. Con filtros/orden derivados la selección se
    hace en Python sobre filas ligeras; si no, la paginación va directo a la base de datos.
    Devuelve `None` como página cuando el paginador no pagina.
    """
    if params.needs_python_pass:
        selected = select_matching(user, params)
        page = paginator.paginate_queryset(selected, request, view=view)
        page_ids = [light.pk for light in (page if page is not None else selected)]
        by_pk = {item.pk: item for item in detail_queryset().filter(pk__in=page_ids)}
        items = [by_pk[pk] for pk in page_ids if pk in by_pk]
    else:
        # Solo los ids se paginan en base de datos; el detalle se carga después para esa página.
        page = paginator.paginate_queryset(
            master_queryset(user, params).values_list('pk', flat=True), request, view=view,
        )
        page_ids = list(page) if page is not None else []
        by_pk = {item.pk: item for item in detail_queryset().filter(pk__in=page_ids)}
        items = [by_pk[pk] for pk in page_ids if pk in by_pk]
    return build_rows(items, can_override_role=user_is_logistics(user)), page


# ───────────────────────────── resumen por RQ ─────────────────────────────

def _rq_queryset():
    return Request.objects.select_related('project', 'department', 'requested_by').annotate(
        **_approval_annotations('pk')
    )


def summary_rows(user, params: MasterParams, matching: Optional[list] = None,
                 results: Optional[dict] = None) -> tuple:
    """
    (filas, kpis): una fila por RQ que tiene al menos un ítem que cumple los filtros, con el %
    de atención y los conteos del RQ COMPLETO, más los KPIs globales de ese conjunto de RQs.
    """
    if matching is None:
        matching = select_matching(user, params)
    request_ids = list(dict.fromkeys(light.request_id for light in matching))
    if results is None:
        results = _results_by_request(request_ids)

    requests = {}
    for chunk in _chunks(request_ids):
        # Los ids ya salen del alcance del usuario (`master_queryset`); nada que re-filtrar.
        for rq in _rq_queryset().filter(pk__in=chunk):
            requests[rq.pk] = rq

    rows = []
    for rid in request_ids:
        rq = requests.get(rid)
        if rq is None:
            continue
        progress = summarize_progress(results.get(rid, []))
        stage = tracking_rules.stage_of(rq.status)
        gm_code, gm_kind = tracking_rules.gm_approval_from_status(rq.rq_gm_status)
        rows.append({
            'request_id': rq.pk,
            'rq_number': rq.rq_number,
            'flow': rq.flow,
            'flow_label': _label(RQFlowChoices, rq.flow),
            'project_id': rq.project_id,
            'project_code': rq.project.code if rq.project_id else '',
            'project_name': rq.project.name if rq.project_id else '',
            'department_id': rq.department_id,
            'department_name': rq.department.name if rq.department_id else '',
            'origin': rq.project.name if rq.project_id else (rq.department.name if rq.department_id else ''),
            'requesting_area': rq.requesting_area,
            'requesting_area_label': _label(RequestingAreaChoices, rq.requesting_area) or 'Sin área',
            'priority': rq.priority,
            'priority_label': _label(PriorityChoices, rq.priority),
            'requested_by_id': rq.requested_by_id,
            'requested_by_name': _person(rq.requested_by),
            'approval_date': _lima_date(rq.rq_validated_at),
            'need_date': rq.fecha_necesidad,
            'rq_status': rq.status,
            'rq_status_label': rq.get_status_display(),
            'stage': stage.code,
            'stage_label': stage.label,
            'phase': tracking_rules.phase_of(rq.status),
            'is_open': not rq.is_terminal,
            'gm_approval': gm_code,
            'gm_approval_label': tracking_rules.GM_APPROVAL_LABELS[gm_code],
            'gm_approval_kind': gm_kind,
            'gm_approval_kind_label': tracking_rules.GM_KIND_LABELS[gm_kind],
            'percent': progress.percent,
            'items_total': progress.items_total,
            'items_counted': progress.items_counted,
            'items_attended': progress.items_attended,
            'items_partial': progress.items_partial,
            'items_pending': progress.items_pending,
            'items_stand_by': progress.items_stand_by,
            'items_unlinked': progress.items_unlinked,
            'items_discarded': progress.items_discarded,
            'items_voided': progress.items_voided,
        })

    _sort_summary(rows, params)
    return rows, _kpis(rows, results)


def _sort_summary(rows: list, params: MasterParams) -> None:
    field_name = params.ordering_field
    if field_name not in SUMMARY_ORDERING_FIELDS:
        rows.sort(key=lambda r: r['rq_number'], reverse=True)
        return
    column = {
        'rq_number': 'rq_number', 'percent': 'percent', 'approval_date': 'approval_date',
        'need_date': 'need_date', 'items_total': 'items_total', 'project': 'origin', 'stage': 'stage_label',
    }[field_name]
    rows.sort(key=lambda r: r['rq_number'])
    present = [r for r in rows if r[column] is not None]
    missing = [r for r in rows if r[column] is None]
    present.sort(key=lambda r: r[column], reverse=params.descending)
    rows[:] = present + missing


def _mean(values: list) -> Optional[float]:
    if not values:
        return None
    total = sum((Decimal(str(v)) for v in values), _ZERO)
    return float((total / len(values)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))


def _kpis(rows: list, results: dict) -> dict:
    by_status = {code: 0 for code in tracking_rules.ITEM_STATUS_LABELS}
    linked = 0
    linkable = 0
    items_total = 0
    for rq_row in rows:
        for result in results.get(rq_row['request_id'], []):
            items_total += 1
            by_status[result.status] += 1
            if result.status not in (ItemStatus.VOIDED, ItemStatus.DISCARDED):
                linkable += 1
                if result.tracking != tracking_rules.Tracking.UNLINKED:
                    linked += 1

    origins: dict = {}
    for rq_row in rows:
        kind, ident, name = (
            ('PROJECT', rq_row['project_id'], rq_row['project_name']) if rq_row['project_id']
            else ('DEPARTMENT', rq_row['department_id'], rq_row['department_name'])
        )
        entry = origins.setdefault((kind, ident), {'kind': kind, 'id': ident, 'name': name, 'rqs': 0, '_pcts': []})
        entry['rqs'] += 1
        if rq_row['percent'] is not None:
            entry['_pcts'].append(rq_row['percent'])
    by_origin = sorted(
        ({**{k: v for k, v in e.items() if k != '_pcts'}, 'percent_avg': _mean(e['_pcts'])} for e in origins.values()),
        key=lambda e: e['name'],
    )
    return {
        'rqs_total': len(rows),
        'rqs_open': sum(1 for r in rows if r['is_open']),
        'items_total': items_total,
        'items_by_status': by_status,
        'items_pending': by_status[ItemStatus.PENDING],
        'items_partial': by_status[ItemStatus.PARTIAL],
        'items_attended': by_status[ItemStatus.ATTENDED],
        'percent_avg': _mean([r['percent'] for r in rows if r['percent'] is not None]),
        'linked_pct': (
            float((Decimal(linked) * 100 / linkable).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
            if linkable else None
        ),
        'by_origin': by_origin,
    }
