"""
Seguimiento por ítem de un RQ (SYSPCC-030 · Master de RQ).

UNA sola función pura (`classify_item`) calcula, a partir de hechos ya leídos, el estado de un
ítem, lo atendido, el faltante, la fecha atendida y las alertas. La usan el listado del Master,
su resumen por RQ, el Excel y los tests; así no hay lógica duplicada. Este módulo no consulta la
base de datos ni escribe nada: quien lo llama arma `ItemFacts` (ver `request_master.py`).

El Master es DERIVADO. Lo único que una persona decide es `attention_override` (STAND_BY /
DESESTIMADO, con motivo); todo lo demás sale de lo que registró el almacén (entregas menos
reversas, `services/dispatch_totals.py`) y del estado del RQ. Nada de esto cambia el flujo de
trabajo: el estado del RQ solo se LEE.

Estado del ítem, por prioridad
------------------------------
1. override DESESTIMADO                      -> DESESTIMADO
2. RQ terminal distinto de CLOSED            -> ANULADO (`Request.is_terminal`, no por sufijo)
3. override STAND_BY y atendido < solicitado -> STAND BY
4. seguimiento VINCULADO                     -> ATENDIDO / PARCIAL / PENDIENTE por entregado neto
5. seguimiento FUERA DE CATÁLOGO             -> ATENDIDO si el RQ ya pasó por DELIVERED, si no PENDIENTE
6. seguimiento SIN VINCULAR                  -> SIN VINCULAR (marcador de trabajo; no cuenta en el %)

Seguimiento (columna propia)
----------------------------
* VINCULADO: producto de catálogo CONFIRMADO por Logística, o ya tiene movimientos de almacén
  (cubre registros históricos). Un producto solo propuesto por el solicitante NO cuenta: el
  stock no se mueve hasta que Logística lo confirma.
* FUERA DE CATÁLOGO: marcado a propósito (`is_off_catalog`); nunca mueve stock.
* SIN VINCULAR: ninguno de los dos. No se adivina por texto.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from typing import Iterable, Optional

from apps.core.enums import AttentionOverrideChoices, RQStatusChoices as S

_ZERO = Decimal('0')
_ONE = Decimal('1')
_HUNDRED = Decimal('100')


# ─────────────────────────────── vocabulario ───────────────────────────────

class ItemStatus:
    ATTENDED = 'ATENDIDO'
    PARTIAL = 'PARCIAL'
    PENDING = 'PENDIENTE'
    STAND_BY = 'STAND_BY'
    DISCARDED = 'DESESTIMADO'
    VOIDED = 'ANULADO'
    UNLINKED = 'SIN_VINCULAR'


class Tracking:
    LINKED = 'VINCULADO'
    OFF_CATALOG = 'FUERA_CATALOGO'
    UNLINKED = 'SIN_VINCULAR'


class Alert:
    UNLINKED = 'SIN_VINCULAR'
    DELIVERED_WITHOUT_DISCOUNT = 'ENTREGADO_SIN_DESCUENTO'
    WITH_MOVEMENTS = 'CON_MOVIMIENTOS'
    DISCREPANCY = 'DISCREPANCIA'


class GMApproval:
    APPROVED = 'APROBADO'
    REJECTED = 'RECHAZADO'
    PENDING = 'PENDIENTE'
    NOT_APPLICABLE = 'NO_APLICA'


ITEM_STATUS_LABELS = {
    ItemStatus.ATTENDED: 'Atendido',
    ItemStatus.PARTIAL: 'Parcial',
    ItemStatus.PENDING: 'Pendiente',
    ItemStatus.STAND_BY: 'Stand by',
    ItemStatus.DISCARDED: 'Desestimado',
    ItemStatus.VOIDED: 'Anulado',
    ItemStatus.UNLINKED: 'Sin vincular',
}
TRACKING_LABELS = {
    Tracking.LINKED: 'Vinculado',
    Tracking.OFF_CATALOG: 'Fuera de catálogo',
    Tracking.UNLINKED: 'Sin vincular',
}
ALERT_LABELS = {
    Alert.UNLINKED: 'Ítem sin vincular al catálogo del almacén',
    Alert.DELIVERED_WITHOUT_DISCOUNT: 'El RQ ya fue despachado pero el almacén no registró toda la salida',
    Alert.WITH_MOVEMENTS: 'Ítem anulado con movimientos de almacén',
    Alert.DISCREPANCY: 'Faltante de stock registrado al despachar',
}
GM_APPROVAL_LABELS = {
    GMApproval.APPROVED: 'Aprobado',
    GMApproval.REJECTED: 'Rechazado',
    GMApproval.PENDING: 'Pendiente',
    GMApproval.NOT_APPLICABLE: 'No aplica',
}
GM_KIND_LABELS = {
    'GM_REVIEW': 'Adicional / fuera de plan',
    'COST_OVERRUN': 'Sobrecosto',
    '': '',
}
OVERRIDE_LABELS = {value: str(label) for value, label in AttentionOverrideChoices.choices}

ITEM_STATUS_CHOICES = tuple(ITEM_STATUS_LABELS)
TRACKING_CHOICES = tuple(TRACKING_LABELS)
ALERT_CHOICES = tuple(ALERT_LABELS)


# ───────────────────────── etapa del RQ (estado → etapa) ─────────────────────────

@dataclass(frozen=True)
class Stage:
    code: str
    label: str


_STAGE_TABLE = (
    ('BORRADOR', 'Borrador', (S.DRAFT,)),
    ('EN_VALIDACION', 'En validación', (
        S.SUBMITTED, S.TECHNICAL_REVIEW, S.TECHNICAL_APPROVED, S.BUDGET_REVIEW, S.WITHIN_PROPOSAL,
        S.ADDITIONAL_REQ, S.SUPERVISOR_REVIEW, S.SUPERVISOR_APPROVED, S.ADMIN_BUDGET_REVIEW,
        S.WITHIN_ANNUAL_PLAN, S.OUT_OF_ANNUAL_PLAN,
    )),
    ('REVISION_GERENCIA', 'En revisión de gerencia', (S.GM_REVIEW, S.GM_APPROVED)),
    ('RECHAZADO', 'Rechazado', (
        S.TECHNICAL_REJECTED, S.SUPERVISOR_REJECTED, S.GM_REJECTED, S.COST_OVERRUN_REJECTED,
    )),
    ('VERIFICACION_STOCK', 'Verificación de stock', (S.VALIDATED, S.STOCK_CHECK)),
    ('COTIZACION', 'Cotización y costo', (
        S.REQUIRES_PURCHASE, S.QUOTING, S.QUOTE_COMPARISON, S.QUOTE_SELECTED, S.COST_OVERRUN_REVIEW,
    )),
    ('ORDEN_COMPRA', 'Orden de compra', (
        S.QUOTE_COST_APPROVED, S.COST_OVERRUN_APPROVED, S.PO_GENERATED,
    )),
    ('POR_ENTREGAR', 'Por entregar (almacén)', (S.IN_STOCK, S.QUALITY_APPROVED)),
    ('RECEPCION_CALIDAD', 'Recepción y calidad', (
        S.RECEIVING, S.QUALITY_CHECK, S.RECEPTION_CONFORMITY,
    )),
    ('RECLAMO_PROVEEDOR', 'Reclamo al proveedor', (
        S.QUALITY_REJECTED, S.SUPPLIER_CLAIM_SENT, S.SUPPLIER_CLAIM_PENDING,
        S.SUPPLIER_REPLACEMENT_RECEIVED, S.RECEPTION_CLAIM,
    )),
    ('DESPACHADO', 'Despachado a obra', (S.DISPATCHED_TO_SITE,)),
    ('ENTREGADO', 'Entregado', (S.DELIVERED, S.WAREHOUSE_UPDATED)),
    ('CONFORMIDAD', 'Conformidad del usuario', (S.USER_CONFORMITY,)),
    ('RECLAMO_USUARIO', 'Reclamo del usuario', (S.USER_CLAIM, S.CLAIM_IN_REVIEW, S.CLAIM_RESOLVED)),
    ('CERRADO', 'Cerrado', (S.CLOSED,)),
    ('CANCELADO', 'Cancelado', (S.CANCELLED,)),
)

STAGES: tuple = tuple(Stage(code, label) for code, label, _ in _STAGE_TABLE)
STAGE_BY_CODE: dict = {stage.code: stage for stage in STAGES}
STATUS_STAGE: dict = {
    status: STAGE_BY_CODE[code] for code, _label, statuses in _STAGE_TABLE for status in statuses
}


def statuses_of_stage(stage_code: str) -> tuple:
    """RQ statuses that belong to `stage_code` (empty tuple if the code is unknown)."""
    for code, _label, statuses in _STAGE_TABLE:
        if code == stage_code:
            return tuple(statuses)
    return ()


# Fase (1 a 5) del flujo de gerencia en la que se encuentra cada estado. CANCELLED no tiene fase.
_PHASE_STATUSES = {
    1: (S.DRAFT, S.SUBMITTED),
    2: (
        S.TECHNICAL_REVIEW, S.TECHNICAL_APPROVED, S.TECHNICAL_REJECTED, S.BUDGET_REVIEW,
        S.WITHIN_PROPOSAL, S.ADDITIONAL_REQ, S.SUPERVISOR_REVIEW, S.SUPERVISOR_APPROVED,
        S.SUPERVISOR_REJECTED, S.ADMIN_BUDGET_REVIEW, S.WITHIN_ANNUAL_PLAN, S.OUT_OF_ANNUAL_PLAN,
        S.GM_REVIEW, S.GM_APPROVED, S.GM_REJECTED,
    ),
    3: (
        S.VALIDATED, S.STOCK_CHECK, S.IN_STOCK, S.REQUIRES_PURCHASE, S.QUOTING, S.QUOTE_COMPARISON,
        S.QUOTE_SELECTED, S.QUOTE_COST_APPROVED, S.COST_OVERRUN_REVIEW, S.COST_OVERRUN_APPROVED,
        S.COST_OVERRUN_REJECTED, S.PO_GENERATED,
    ),
    4: (
        S.RECEIVING, S.QUALITY_CHECK, S.QUALITY_APPROVED, S.QUALITY_REJECTED, S.SUPPLIER_CLAIM_SENT,
        S.SUPPLIER_CLAIM_PENDING, S.SUPPLIER_REPLACEMENT_RECEIVED, S.RECEPTION_CONFORMITY,
        S.RECEPTION_CLAIM, S.DISPATCHED_TO_SITE, S.DELIVERED,
    ),
    5: (
        S.WAREHOUSE_UPDATED, S.USER_CONFORMITY, S.USER_CLAIM, S.CLAIM_IN_REVIEW, S.CLAIM_RESOLVED,
        S.CLOSED,
    ),
}
STATUS_PHASE: dict = {status: phase for phase, statuses in _PHASE_STATUSES.items() for status in statuses}

# RQ ya despachado a obra o más allá (también tras un reclamo posterior a la entrega).
DISPATCHED_OR_LATER = frozenset({
    S.DISPATCHED_TO_SITE, S.DELIVERED, S.WAREHOUSE_UPDATED, S.USER_CONFORMITY, S.USER_CLAIM,
    S.CLAIM_IN_REVIEW, S.CLAIM_RESOLVED, S.CLOSED,
})
# RQ que ya pasó por DELIVERED (entrega al destino).
DELIVERED_OR_LATER = DISPATCHED_OR_LATER - {S.DISPATCHED_TO_SITE}


def stage_of(request_status: str) -> Stage:
    """Etapa legible del RQ. Un estado desconocido nunca rompe el Master: cae en una etapa neutra."""
    return STATUS_STAGE.get(request_status) or Stage('DESCONOCIDA', str(request_status or ''))


def phase_of(request_status: str) -> Optional[int]:
    """Fase (1 a 5) del estado, o None (CANCELLED, estado desconocido)."""
    return STATUS_PHASE.get(request_status)


@lru_cache(maxsize=None)
def is_voided_status(request_status: str) -> bool:
    """
    True si el RQ está en un estado terminal que NO es CLOSED (cancelado o rechazado).
    Usa `Request.is_terminal` como única fuente, nunca el sufijo del nombre del estado.
    """
    from apps.rq.models import Request

    request = Request(status=request_status)
    return request.is_terminal and request_status != S.CLOSED


# ─────────────────────────── aprobación de gerencia ───────────────────────────

def gm_approval_from_status(latest_status: Optional[str]) -> tuple:
    """
    (código, tipo) de la decisión de gerencia a partir del `new_status` del ÚLTIMO Approval
    entre GM_REVIEW / GM_APPROVED / GM_REJECTED / COST_OVERRUN_*. Sin ninguno: NO_APLICA.
    El tipo distingue la revisión por adicional/fuera de plan de la de sobrecosto.
    """
    table = {
        S.GM_REVIEW: (GMApproval.PENDING, 'GM_REVIEW'),
        S.GM_APPROVED: (GMApproval.APPROVED, 'GM_REVIEW'),
        S.GM_REJECTED: (GMApproval.REJECTED, 'GM_REVIEW'),
        S.COST_OVERRUN_REVIEW: (GMApproval.PENDING, 'COST_OVERRUN'),
        S.COST_OVERRUN_APPROVED: (GMApproval.APPROVED, 'COST_OVERRUN'),
        S.COST_OVERRUN_REJECTED: (GMApproval.REJECTED, 'COST_OVERRUN'),
    }
    return table.get(latest_status, (GMApproval.NOT_APPLICABLE, ''))


GM_DECISION_STATUSES = (
    S.GM_REVIEW, S.GM_APPROVED, S.GM_REJECTED,
    S.COST_OVERRUN_REVIEW, S.COST_OVERRUN_APPROVED, S.COST_OVERRUN_REJECTED,
)


# ───────────────────────────────── cálculo ─────────────────────────────────

@dataclass(frozen=True)
class ItemFacts:
    """Hechos de un ítem ya leídos (sin acceso a base de datos). Fechas en hora de Lima."""

    quantity: Decimal
    net_dispatched: Decimal                    # entregas − reversas
    dispatch_rows: int                         # filas de WarehouseDispatchItem (incluye reversas)
    has_confirmed_link: bool                   # producto de catálogo CONFIRMADO por Logística
    is_off_catalog: bool
    override: str                              # '' | STAND_BY | DESESTIMADO
    request_status: str
    delivered_on: Optional[datetime.date] = None       # primer Approval con new_status=DELIVERED
    last_delivery_on: Optional[datetime.date] = None   # fecha operativa de la última entrega
    has_discrepancy: bool = False              # ActivityLog STOCK_DISCREPANCY en el RQ


@dataclass(frozen=True)
class ItemTracking:
    tracking: str
    status: str
    attended: Decimal
    missing: Optional[Decimal]                 # None: SIN VINCULAR (no se puede calcular)
    attended_on: Optional[datetime.date]
    alerts: tuple
    progress: Optional[Decimal]                # 0..1; None si no cuenta para el % del RQ
    attended_by_flow: bool = False             # ATENDIDO por el estado del RQ (fuera de catálogo)

    @property
    def counts_for_progress(self) -> bool:
        return self.progress is not None


def _tracking_of(facts: ItemFacts) -> str:
    if facts.has_confirmed_link or facts.dispatch_rows > 0:
        return Tracking.LINKED
    if facts.is_off_catalog:
        return Tracking.OFF_CATALOG
    return Tracking.UNLINKED


def classify_item(facts: ItemFacts) -> ItemTracking:
    """Estado, cantidades, fecha atendida y alertas de UN ítem (función pura)."""
    quantity = facts.quantity if facts.quantity and facts.quantity > _ZERO else _ZERO
    tracking = _tracking_of(facts)
    voided = is_voided_status(facts.request_status)
    delivered_flow = facts.request_status in DELIVERED_OR_LATER or facts.delivered_on is not None

    net = max(facts.net_dispatched or _ZERO, _ZERO)
    attended_by_flow = False
    if tracking == Tracking.OFF_CATALOG:
        # Nunca mueve stock: se considera atendido por el flujo cuando el RQ ya fue entregado.
        attended_by_flow = delivered_flow
        attended = quantity if delivered_flow else _ZERO
    else:
        attended = net

    # ── estado ──
    if facts.override == AttentionOverrideChoices.DESESTIMADO:
        status = ItemStatus.DISCARDED
    elif voided:
        status = ItemStatus.VOIDED
    elif facts.override == AttentionOverrideChoices.STAND_BY and attended < quantity:
        status = ItemStatus.STAND_BY
    elif tracking == Tracking.LINKED:
        if quantity > _ZERO and attended >= quantity:
            status = ItemStatus.ATTENDED
        elif attended > _ZERO and quantity > _ZERO:
            status = ItemStatus.PARTIAL
        else:
            status = ItemStatus.PENDING
    elif tracking == Tracking.OFF_CATALOG:
        status = ItemStatus.ATTENDED if delivered_flow else ItemStatus.PENDING
    else:
        status = ItemStatus.UNLINKED

    # ── faltante ──
    if status in (ItemStatus.VOIDED, ItemStatus.DISCARDED):
        missing: Optional[Decimal] = _ZERO
    elif status == ItemStatus.UNLINKED:
        missing = None
    else:
        missing = max(quantity - attended, _ZERO)

    # ── fecha atendida ──
    attended_on = None
    if status == ItemStatus.ATTENDED:
        attended_on = facts.delivered_on if tracking == Tracking.OFF_CATALOG else facts.last_delivery_on

    # ── avance (para el % del RQ) ──
    if status in (ItemStatus.DISCARDED, ItemStatus.VOIDED, ItemStatus.UNLINKED):
        progress = None
    elif quantity > _ZERO:
        progress = min(attended / quantity, _ONE)
    else:
        progress = _ZERO

    # ── alertas ──
    alerts = []
    phase = phase_of(facts.request_status)
    if status == ItemStatus.UNLINKED and phase is not None and phase >= 3:
        alerts.append(Alert.UNLINKED)
    dispatched_flow = facts.request_status in DISPATCHED_OR_LATER or facts.delivered_on is not None
    if (
        tracking == Tracking.LINKED and dispatched_flow and not voided
        and attended < quantity and not facts.override
    ):
        alerts.append(Alert.DELIVERED_WITHOUT_DISCOUNT)
    if status == ItemStatus.VOIDED and net > _ZERO:
        alerts.append(Alert.WITH_MOVEMENTS)
    if facts.has_discrepancy:
        alerts.append(Alert.DISCREPANCY)

    return ItemTracking(
        tracking=tracking,
        status=status,
        attended=attended,
        missing=missing,
        attended_on=attended_on,
        alerts=tuple(alerts),
        progress=progress,
        attended_by_flow=attended_by_flow,
    )


@dataclass(frozen=True)
class RQProgress:
    """
    % de atención de un RQ y los conteos para reconciliarlo con el Excel.

    `percent` es el promedio simple del avance de los ítems que cuentan (no DESESTIMADO, no
    ANULADO, no SIN VINCULAR), de 0 a 100 con un decimal; None si ninguno cuenta. No se
    pondera por cantidades: las unidades (kg, UND, GLB) no se pueden sumar.
    """

    percent: Optional[float]
    items_total: int
    items_counted: int
    items_attended: int
    items_partial: int
    items_pending: int
    items_stand_by: int
    items_unlinked: int
    items_discarded: int
    items_voided: int


_COUNT_FIELD = {
    ItemStatus.ATTENDED: 'items_attended',
    ItemStatus.PARTIAL: 'items_partial',
    ItemStatus.PENDING: 'items_pending',
    ItemStatus.STAND_BY: 'items_stand_by',
    ItemStatus.UNLINKED: 'items_unlinked',
    ItemStatus.DISCARDED: 'items_discarded',
    ItemStatus.VOIDED: 'items_voided',
}


def summarize_progress(trackings: Iterable[ItemTracking]) -> RQProgress:
    """% de atención y conteos de un conjunto de ítems (normalmente, todos los de un RQ)."""
    counts = {name: 0 for name in _COUNT_FIELD.values()}
    total = 0
    counted = 0
    acc = _ZERO
    for tracking in trackings:
        total += 1
        counts[_COUNT_FIELD[tracking.status]] += 1
        if tracking.progress is not None:
            counted += 1
            acc += tracking.progress
    percent = None
    if counted:
        percent = float(
            (acc / counted * _HUNDRED).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        )
    return RQProgress(percent=percent, items_total=total, items_counted=counted, **counts)
