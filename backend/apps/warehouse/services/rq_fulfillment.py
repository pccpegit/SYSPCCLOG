"""
SYSPCC-028 · Despacho de stock real de un RQ (único servicio de salida ligado a un RQ).

Lo invoca `WorkflowEngine._on_dispatched` tras la acción DISPATCHED; el motor no decide nada
de esto: la transición y sus roles no cambian. Este módulo solo toca el almacén.

Reglas
------
* **Pool central.** Se descuenta de la fila CENTRAL con ``project=NULL`` y
  ``department=NULL`` (semántica de SYSPCC-025), la misma donde `_on_material_received`
  ingresa lo comprado. El proyecto o departamento del RQ queda solo como *destino* del
  vale y del `WarehouseDispatch` (corrige el bug R1: antes se buscaba la fila del proyecto
  y en RQs OPS con proyecto la salida fallaba en silencio).
* **Remanente por ítem.** Se despacha ``cantidad del ítem − lo ya despachado`` (suma de
  `WarehouseDispatchItem`). Un segundo DISPATCHED tras el ciclo de reclamo
  (QUALITY_APPROVED → DISPATCHED se recorre de nuevo) encuentra remanente 0 y no vuelve a
  descontar nada.
* **Solo vínculo confirmado.** Únicamente las líneas con ``inventory_item`` Y
  ``inventory_item_confirmed_at`` (decisión de Logística) mueven stock. Sin vínculo, con
  vínculo propuesto sin confirmar o marcadas fuera de catálogo no se toca nada; no hay
  coincidencia por texto.
* **Lo que el pool cubre.** Por cada línea se despacha ``min(remanente, disponible)``. Lo que
  no se cubre queda como faltante VISIBLE: log estructurado (`warning`), una entrada
  `STOCK_DISCREPANCY` en el `ActivityLog` del RQ y, si hubo despacho, una línea en sus
  notas. Nunca se lanza una excepción hacia la transición: el RQ avanza igual que antes.
* **El vínculo se confirma ANTES de RECEIVED.** Logística confirma el producto de catálogo en
  la verificación de stock, antes de que el RQ llegue a RECEIVED/DISPATCHED. Una línea sin
  vínculo confirmado no ingresa en RECEIVED ni sale en DISPATCHED; no se bloquea la transición,
  pero queda una entrada `STOCK_UNLINKED` en el `ActivityLog` del RQ con esas líneas
  (`record_unlinked_lines`), además del log estructurado.
* **Atribución del movimiento (decisión consciente).** Como se descuenta del pool
  (`project_id=None`), el `MovementGroup` y los `InventoryMovement` de salida quedan con
  `project` NULL y NO aparecen al filtrar movimientos por proyecto. El destino sí queda en
  `destination_type`/`destination_detail` del vale, en `WarehouseDispatch.destination_project`
  / `destination_department` y en la nota (`Despacho automático RQ <número>`). Se prefiere
  esto a tocar `movements.py` o a partir el stock por proyecto (que es lo que causaba R1).
* **Atomicidad.** Los bloqueos se toman en orden de producto (sin deadlocks). El movimiento
  y los documentos (`WarehouseDispatch` + líneas) se escriben juntos en un savepoint: si algo
  falla, se revierten ambos y el error se registra FUERA del savepoint revertido (en
  PostgreSQL un error dentro del `atomic()` de `execute()` lo dejaría inutilizable).
"""
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.enums import WarehouseOriginChoices
from apps.warehouse.services.movements import format_quantity, register_exit_batch

logger = logging.getLogger(__name__)

# Nota del vale de salida. `apps.rq.services.stock_diagnostics` la usa para detectar salidas
# automáticas: la constante vive aquí, en un único lugar.
AUTO_DISPATCH_NOTES_PREFIX = 'Despacho automático RQ '
# Acción del ActivityLog para un faltante de stock (la columna `action` es de texto libre).
STOCK_DISCREPANCY_ACTION = 'STOCK_DISCREPANCY'
# Acción del ActivityLog para líneas omitidas por falta de vínculo de catálogo confirmado.
STOCK_UNLINKED_ACTION = 'STOCK_UNLINKED'

REASON_INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK'
REASON_ERROR = 'ERROR'

_ZERO = Decimal('0')


@dataclass(frozen=True)
class Shortage:
    """Parte de una línea que el pool central no pudo cubrir."""

    request_item_id: int
    line_number: int
    product_code: str
    requested: Decimal      # remanente que se intentó despachar
    dispatched: Decimal     # lo que sí salió
    available: Decimal      # stock del pool al momento de despachar
    reason: str = REASON_INSUFFICIENT_STOCK

    @property
    def missing(self) -> Decimal:
        return self.requested - self.dispatched

    def describe(self) -> str:
        text = (
            f'línea {self.line_number} ({self.product_code}): remanente {format_quantity(self.requested)}, '
            f'despachado {format_quantity(self.dispatched)}, falta {format_quantity(self.missing)}'
        )
        if self.reason == REASON_ERROR:
            return f'{text} (error al registrar el despacho)'
        return f'{text} (disponible en el almacén central: {format_quantity(self.available)})'


@dataclass
class DispatchResult:
    """Resumen de `dispatch_request_items` (el motor lo ignora; los tests y Fase 4 lo leen)."""

    dispatch: object = None                       # WarehouseDispatch o None si nada salió
    group: object = None                          # MovementGroup o None
    dispatched: list = field(default_factory=list)   # [(RequestItem, Decimal)]
    shortages: list = field(default_factory=list)    # [Shortage]
    skipped_unconfirmed: list = field(default_factory=list)  # RequestItem sin vínculo confirmado
    already_dispatched: list = field(default_factory=list)   # RequestItem con remanente 0


def _is_confirmed_catalog_line(item) -> bool:
    """Línea con producto de catálogo confirmado por Logística y no marcada fuera de catálogo."""
    return (
        not item.is_off_catalog
        and item.inventory_item_id is not None
        and item.inventory_item_confirmed_at is not None
    )


def _destination(request):
    if request.project_id:
        return 'PROJECT', request.project.name
    if request.department_id:
        return 'DEPARTMENT', request.department.name
    return 'OTHER', ''


def _plan_lines(request):
    """
    Calcula qué sale de cada línea. Toma los bloqueos del stock (orden de producto) pero NO
    escribe nada. Debe llamarse dentro de una transacción.
    """
    from apps.warehouse.models import InventoryStock, WarehouseDispatchItem

    result = DispatchResult()
    items = list(request.items.select_related('inventory_item').order_by('line_number'))

    already = dict(
        WarehouseDispatchItem.objects
        .filter(request_item__request=request)
        .values('request_item_id')
        .annotate(total=Sum('quantity_dispatched'))
        .values_list('request_item_id', 'total')
    )

    candidates = []
    for item in items:
        if item.is_off_catalog:
            continue  # decisión explícita: nunca mueve stock (ni se avisa)
        remaining = item.quantity - (already.get(item.pk) or _ZERO)
        if remaining <= _ZERO:
            result.already_dispatched.append(item)
            continue
        if not _is_confirmed_catalog_line(item):
            result.skipped_unconfirmed.append(item)
            continue
        candidates.append((item, remaining))

    if not candidates:
        return result

    inventory_ids = sorted({item.inventory_item_id for item, _ in candidates})
    available = {
        row.inventory_id: row.quantity
        for row in (
            InventoryStock.objects.select_for_update()
            .filter(
                warehouse_type=WarehouseOriginChoices.CENTRAL,
                project__isnull=True, department__isnull=True,
                inventory_id__in=inventory_ids,
            )
            .order_by('inventory_id')
        )
    }

    for item, remaining in candidates:
        pool = available.get(item.inventory_item_id, _ZERO)
        take = min(remaining, pool) if pool > _ZERO else _ZERO
        if take > _ZERO:
            result.dispatched.append((item, take))
            available[item.inventory_item_id] = pool - take
        if take < remaining:
            result.shortages.append(Shortage(
                request_item_id=item.pk, line_number=item.line_number,
                product_code=item.inventory_item.product_code,
                requested=remaining, dispatched=take, available=pool,
            ))
    return result


def _write_documents(request, user, result, guide_number):
    """Vale de salida + WarehouseDispatch + líneas, en un solo savepoint."""
    from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

    destination_type, destination_detail = _destination(request)
    items_data = [
        {
            'inventory_id': item.inventory_item_id,
            'quantity': qty,
            'line': number,
            'notes': f'RQ {request.rq_number} · línea {item.line_number}',
        }
        for number, (item, qty) in enumerate(result.dispatched, start=1)
    ]
    # project_id=None: se descuenta del pool central. El destino queda en destination_*.
    group = register_exit_batch(
        items_data=items_data,
        warehouse=WarehouseOriginChoices.CENTRAL,
        project_id=None,
        destination_type=destination_type,
        destination_detail=destination_detail,
        requested_by_id=request.requested_by_id,
        authorized_by_id=None,
        notes=f'{AUTO_DISPATCH_NOTES_PREFIX}{request.rq_number}',
        registered_by=user,
        guide_number=guide_number,
    )

    last_receipt = request.warehouse_receipts.order_by('-received_at').first()
    notes = f'Despacho automático desde workflow RQ {request.rq_number}'
    if result.shortages:
        notes += '. Faltantes: ' + '; '.join(s.describe() for s in result.shortages)
    dispatch = WarehouseDispatch.objects.create(
        request=request,
        receipt=last_receipt,
        dispatched_by=user,
        dispatch_number=group.group_number,
        origin=WarehouseOriginChoices.CENTRAL,
        destination_project=request.project,
        destination_department=request.department,
        dispatch_guide_number=guide_number or '',
        movement_group=group,
        notes=notes,
    )
    for item, qty in result.dispatched:
        WarehouseDispatchItem.objects.create(
            dispatch=dispatch, request_item=item, quantity_dispatched=qty,
        )
    return group, dispatch


def record_unlinked_lines(request, user, items, *, event: str) -> None:
    """
    Deja visible (log estructurado + ActivityLog `STOCK_UNLINKED`) qué líneas se omitieron por
    no tener vínculo de catálogo confirmado. `event` es 'ingresar' (RECEIVED) o 'despachar'
    (DISPATCHED). Nunca lanza: no puede bloquear la transición.
    """
    if not items:
        return
    from apps.rq.models import ActivityLog

    for item in items:
        logger.warning(
            'rq_fulfillment.item_skipped.unconfirmed_link',
            extra={
                'rq_number': request.rq_number, 'request_id': request.pk,
                'request_item_id': item.pk, 'line_number': item.line_number,
                'has_proposed_fk': item.inventory_item_id is not None, 'event': event,
            },
        )
    lines = '; '.join(f'línea {i.line_number} ({i.description[:60]})' for i in items)
    verb = 'ingresaron al almacén' if event == 'ingresar' else 'salieron del almacén'
    try:
        with transaction.atomic():
            ActivityLog.objects.create(
                request=request,
                user=user,
                action=STOCK_UNLINKED_ACTION,
                detail=(
                    f'Líneas sin vínculo de catálogo confirmado: no {verb}. {lines}. '
                    'Logística debe confirmar el vínculo en la verificación de stock antes de '
                    'la recepción.'
                ),
            )
    except Exception:
        logger.exception(
            'rq_fulfillment.unlinked_log_failed',
            extra={'rq_number': request.rq_number, 'request_id': request.pk},
        )


def _record_shortages(request, user, shortages):
    """Faltantes visibles: log estructurado + ActivityLog (fuera de cualquier savepoint revertido)."""
    from apps.rq.models import ActivityLog

    for shortage in shortages:
        logger.warning(
            'rq_fulfillment.stock_shortage',
            extra={
                'rq_number': request.rq_number, 'request_id': request.pk,
                'request_item_id': shortage.request_item_id, 'line_number': shortage.line_number,
                'product_code': shortage.product_code, 'requested': str(shortage.requested),
                'dispatched': str(shortage.dispatched), 'available': str(shortage.available),
                'reason': shortage.reason, 'user_id': getattr(user, 'pk', None),
            },
        )
    # Savepoint propio + captura: si el registro falla, no envenena la transacción del motor
    # ni bloquea la transición (el log estructurado de arriba ya dejó el rastro).
    try:
        with transaction.atomic():
            ActivityLog.objects.create(
                request=request,
                user=user,
                action=STOCK_DISCREPANCY_ACTION,
                detail=(
                    f'Despacho automático {request.rq_number}: el almacén central no cubrió todo '
                    'lo solicitado. ' + '; '.join(s.describe() for s in shortages)
                ),
            )
    except Exception:
        logger.exception(
            'rq_fulfillment.discrepancy_log_failed',
            extra={'rq_number': request.rq_number, 'request_id': request.pk},
        )


def dispatch_request_items(request, user, *, guide_number: str = '') -> DispatchResult:
    """
    Despacha el REMANENTE de cada línea del RQ desde el pool del almacén central.

    No lanza por falta de stock ni por vínculos sin confirmar: devuelve el detalle en
    `DispatchResult` y deja los faltantes registrados. ``guide_number`` es opcional y solo se
    guarda si quien llama lo conoce (el motor no lo recibe: no se inventa).
    """
    with transaction.atomic():
        result = _plan_lines(request)
        if result.dispatched:
            try:
                with transaction.atomic():  # savepoint: movimiento y documentos juntos
                    result.group, result.dispatch = _write_documents(
                        request, user, result, guide_number or '',
                    )
            except Exception:
                logger.exception(
                    'rq_fulfillment.write_failed',
                    extra={'rq_number': request.rq_number, 'request_id': request.pk},
                )
                # Nada salió (el savepoint revirtió movimiento y documentos): cada línea que se
                # iba a despachar pasa a faltante por error, con su remanente completo.
                partial_missing = {s.request_item_id: s.missing for s in result.shortages}
                failed = [
                    Shortage(
                        request_item_id=item.pk, line_number=item.line_number,
                        product_code=item.inventory_item.product_code,
                        requested=qty + partial_missing.get(item.pk, _ZERO),
                        dispatched=_ZERO, available=_ZERO, reason=REASON_ERROR,
                    )
                    for item, qty in result.dispatched
                ]
                planned_ids = {s.request_item_id for s in failed}
                result.shortages = failed + [
                    s for s in result.shortages if s.request_item_id not in planned_ids
                ]
                result.dispatched = []
        if result.shortages:
            _record_shortages(request, user, result.shortages)
        record_unlinked_lines(request, user, result.skipped_unconfirmed, event='despachar')

    if result.dispatch is not None:
        logger.info(
            'rq_fulfillment.dispatched',
            extra={
                'rq_number': request.rq_number, 'request_id': request.pk,
                'group_number': result.group.group_number, 'lines': len(result.dispatched),
                'shortages': len(result.shortages),
            },
        )
    return result


def mark_request_delivered(request, user) -> int:
    """
    Registra la entrega (el RQ llegó a DELIVERED): completa, solo donde estén vacíos,
    `WarehouseDispatch.delivered_at` y `accepted_by` de los despachos del RQ y
    `Request.fecha_real_entrega`. Devuelve cuántos despachos se completaron.

    ``accepted_by`` es el usuario de almacén que registra la entrega en el flujo (no la
    conformidad del solicitante, que es un paso posterior). No fabrica cantidades entregadas.
    """
    from apps.warehouse.models import WarehouseDispatch

    with transaction.atomic():
        now = timezone.now()
        completed = (
            WarehouseDispatch.objects
            .filter(request=request, delivered_at__isnull=True)
            .update(delivered_at=now)
        )
        WarehouseDispatch.objects.filter(request=request, accepted_by__isnull=True).update(accepted_by=user)
        if request.fecha_real_entrega is None:
            request.fecha_real_entrega = timezone.localdate()
            request.save(update_fields=['fecha_real_entrega'])
    return completed
