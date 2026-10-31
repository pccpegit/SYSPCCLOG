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

SYSPCC-029 (entregas parciales y reversas)
------------------------------------------
* `deliver_request_items`: el almacén entrega por tandas (cantidad real, guía y fecha operativa)
  contra el MISMO pool y el MISMO remanente. No cambia el estado del RQ: el rol que puede hacerlo
  se LEE de `TRANSITIONS` para la acción DISPATCHED en el (flujo, estado) del RQ y solo en
  IN_STOCK / QUALITY_APPROVED. Bloqueos en orden fijo: Request → ítems → stock.
* `reverse_delivery`: anula una entrega con un contra-movimiento (ingreso `RETURN`) y un
  `WarehouseDispatch` de reversa enlazado (`reverses`). No se borra nada.
* Lo entregado de un ítem = entregas − reversas (`dispatch_totals`); por eso un DISPATCHED
  posterior solo despacha lo que falte y una reversa vuelve a dejar remanente.
"""
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.core.enums import RoleChoices, RQStatusChoices, WarehouseOriginChoices
from apps.rq.services.transition_roles import roles_for_action
from apps.warehouse.permissions import CanReverseDelivery
from apps.warehouse.services.dispatch_totals import net_dispatched_by_item
from apps.warehouse.services.movements import (
    format_quantity,
    register_entry_batch,
    register_exit_batch,
)

logger = logging.getLogger(__name__)

# Nota del vale de salida. `apps.rq.services.stock_diagnostics` la usa para detectar salidas
# automáticas: la constante vive aquí, en un único lugar.
AUTO_DISPATCH_NOTES_PREFIX = 'Despacho automático RQ '
# Acción del ActivityLog para un faltante de stock (la columna `action` es de texto libre).
STOCK_DISCREPANCY_ACTION = 'STOCK_DISCREPANCY'
# Acción del ActivityLog para líneas omitidas por falta de vínculo de catálogo confirmado.
STOCK_UNLINKED_ACTION = 'STOCK_UNLINKED'

# SYSPCC-029: acciones del ActivityLog.
DELIVERY_REGISTERED_ACTION = 'DELIVERY_REGISTERED'
DELIVERY_REVERSED_ACTION = 'DELIVERY_REVERSED'
# Estados en los que el almacén puede registrar entregas parciales (el RQ no cambia de estado).
DELIVERABLE_STATUSES = (RQStatusChoices.IN_STOCK, RQStatusChoices.QUALITY_APPROVED)
DELIVERY_ACTION = 'DISPATCHED'

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


def _lock_items(request):
    """
    Bloquea las líneas del RQ (orden de pk) y las devuelve ordenadas por `line_number`.

    `of=('self',)`: `inventory_item` es una FK nula y PostgreSQL no permite FOR UPDATE sobre el
    lado nulable de un outer join. Debe llamarse dentro de una transacción.
    """
    items = list(
        request.items.select_for_update(of=('self',)).select_related('inventory_item').order_by('pk')
    )
    items.sort(key=lambda item: item.line_number)
    return items


def _lock_pool(inventory_ids) -> dict:
    """
    {inventory_id: Decimal} del pool CENTRAL (project y department NULL), con las filas de stock
    bloqueadas en orden de producto (sin deadlocks). Los productos sin fila no aparecen (0).
    """
    from apps.warehouse.models import InventoryStock

    if not inventory_ids:
        return {}
    return {
        row.inventory_id: row.quantity
        for row in (
            InventoryStock.objects.select_for_update()
            .filter(
                warehouse_type=WarehouseOriginChoices.CENTRAL,
                project__isnull=True, department__isnull=True,
                inventory_id__in=sorted(inventory_ids),
            )
            .order_by('inventory_id')
        )
    }


def _plan_lines(request):
    """
    Calcula qué sale de cada línea. Toma los bloqueos (líneas y stock) pero NO escribe nada.
    Debe llamarse dentro de una transacción. Lo ya entregado es neto de reversas.
    """
    result = DispatchResult()
    items = _lock_items(request)
    already = net_dispatched_by_item(request=request)

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

    available = _lock_pool({item.inventory_item_id for item, _ in candidates})

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


def _write_documents(request, user, dispatched, *, guide_number, group_notes, dispatch_notes,
                     movement_date=None):
    """
    Vale de salida + WarehouseDispatch + líneas. `dispatched` es [(RequestItem, Decimal)].
    Debe correr dentro de una transacción (el llamador decide el savepoint).
    """
    from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

    destination_type, destination_detail = _destination(request)
    items_data = [
        {
            'inventory_id': item.inventory_item_id,
            'quantity': qty,
            'line': number,
            'notes': f'RQ {request.rq_number} · línea {item.line_number}',
        }
        for number, (item, qty) in enumerate(dispatched, start=1)
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
        notes=group_notes,
        registered_by=user,
        guide_number=guide_number,
        movement_date=movement_date,
    )

    last_receipt = request.warehouse_receipts.order_by('-received_at').first()
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
        notes=dispatch_notes,
    )
    for item, qty in dispatched:
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
        # Request primero (orden fijo Request → ítems → stock). Dentro de `execute()` la fila ya
        # está bloqueada por esta misma transacción y esto no cuesta nada; llamado solo, evita
        # que una entrega parcial concurrente calcule el remanente sobre datos viejos.
        _lock_request(request.pk)
        result = _plan_lines(request)
        if result.dispatched:
            try:
                with transaction.atomic():  # savepoint: movimiento y documentos juntos
                    notes = f'Despacho automático desde workflow RQ {request.rq_number}'
                    if result.shortages:
                        notes += '. Faltantes: ' + '; '.join(s.describe() for s in result.shortages)
                    result.group, result.dispatch = _write_documents(
                        request, user, result.dispatched,
                        guide_number=guide_number or '',
                        group_notes=f'{AUTO_DISPATCH_NOTES_PREFIX}{request.rq_number}',
                        dispatch_notes=notes,
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
            .filter(request=request, delivered_at__isnull=True, reverses__isnull=True)
            .update(delivered_at=now)
        )
        WarehouseDispatch.objects.filter(
            request=request, accepted_by__isnull=True, reverses__isnull=True,
        ).update(accepted_by=user)
        if request.fecha_real_entrega is None:
            request.fecha_real_entrega = timezone.localdate()
            request.save(update_fields=['fecha_real_entrega'])
    return completed


# ──────────────────────────────────────────────────────────────────────────────
# SYSPCC-029 · Entregas parciales y reversas
# ──────────────────────────────────────────────────────────────────────────────

class DeliveryError(Exception):
    """
    Error de negocio de `deliver_request_items` / `reverse_delivery`.

    `code` es estable (el frontend lo usa), `message` va en español para el usuario y `status`
    es el HTTP sugerido. `extra` se vuelca tal cual en la respuesta (p. ej. `lines`).
    """

    def __init__(self, code: str, message: str, *, status: int = 409, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra or {}


# Códigos por línea dentro de `DELIVERY_LINES_INVALID`.
LINE_UNLINKED = 'ITEM_NOT_LINKED'          # sin vínculo de catálogo o sin confirmar
LINE_OFF_CATALOG = 'ITEM_OFF_CATALOG'      # marcado fuera de catálogo: nunca mueve stock
LINE_EXCEEDS_REMAINING = 'EXCEEDS_REMAINING'
LINE_INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK'


def _fixed(value: Decimal) -> str:
    """Cantidad con 3 decimales fijos (mismo formato que las cantidades del resto de la API)."""
    return str(value.quantize(Decimal('0.001')))


def _lock_request(request_id):
    """Fila del RQ bloqueada (`select_for_update`) y refrescada; debe correr en una transacción."""
    from apps.rq.models import Request

    return (
        Request.objects.select_for_update(of=('self',))
        .select_related('project', 'department')
        .get(pk=request_id)
    )


def status_label(status: str) -> str:
    try:
        return str(RQStatusChoices(status).label)
    except ValueError:
        return status


def _role_label(role: str) -> str:
    try:
        return str(RoleChoices(role).label)
    except ValueError:
        return role


def deliver_roles(request) -> frozenset:
    """Roles que la tabla de gerencia exige para DISPATCHED en el (flujo, estado) del RQ."""
    return roles_for_action(request.flow, request.status, DELIVERY_ACTION)


def user_can_deliver(request, user) -> bool:
    """
    Sin bypass por is_superuser/is_staff: solo `UserRole`. Falso fuera de los estados de entrega
    o si la tabla no define un rol para (flujo, estado).
    """
    if request.status not in DELIVERABLE_STATUSES:
        return False
    roles = deliver_roles(request)
    return bool(roles) and user.user_roles.filter(role__in=roles).exists()


def operational_date(dispatch):
    """Fecha operativa de una entrega: la del vale de salida; si falta, el día de registro (Lima)."""
    group = dispatch.movement_group
    if group is not None and group.movement_date is not None:
        return group.movement_date
    return timezone.localtime(dispatch.dispatched_at).date()


def user_can_reverse(user) -> bool:
    return user.user_roles.filter(role__in=CanReverseDelivery.ALLOWED_ROLES).exists()


def assert_can_deliver(request, user) -> None:
    """Estado (409) y luego rol (403). El estado primero: fuera de él no hay rol que derivar."""
    if request.status not in DELIVERABLE_STATUSES:
        allowed = ' o '.join(f'«{status_label(s)}»' for s in DELIVERABLE_STATUSES)
        raise DeliveryError(
            'INVALID_STATE',
            f'Solo se pueden registrar entregas con el requerimiento en {allowed} '
            f'(estado actual: «{status_label(request.status)}»).',
            extra={'status': request.status, 'allowed_statuses': list(DELIVERABLE_STATUSES)},
        )
    roles = deliver_roles(request)
    if not roles or not user.user_roles.filter(role__in=roles).exists():
        needed = ', '.join(_role_label(r) for r in sorted(roles)) or 'ninguno'
        raise DeliveryError(
            'ROLE_NOT_ALLOWED',
            f'Su rol no puede registrar entregas en este estado. Rol requerido: {needed}.',
            status=403,
            extra={'required_roles': sorted(roles)},
        )


@dataclass
class DeliveryResult:
    """Lo que escribió `deliver_request_items`."""

    dispatch: object
    group: object
    lines: list          # [(RequestItem, Decimal)]


def _duplicate_guide_exists(request, guide_number: str) -> bool:
    """
    ¿Ya hay una entrega VIGENTE de este RQ con la misma guía? Es la defensa contra el doble clic
    (la segunda petición espera el bloqueo del RQ y aquí ve la entrega de la primera). Una entrega
    anulada o una reversa no cuenta: se puede volver a registrar con la guía corregida.
    """
    from apps.warehouse.models import WarehouseDispatch

    return (
        WarehouseDispatch.objects
        .filter(request=request, reverses__isnull=True, dispatch_guide_number__iexact=guide_number)
        .exclude(reversals__isnull=False)
        .exists()
    )


def deliver_request_items(request_id, user, lines, *, guide_number: str, movement_date=None,
                          notes: str = '') -> DeliveryResult:
    """
    Registra UNA tanda de entrega (paso 5 de la Fase 04 del almacén) contra el RQ `request_id`.

    `lines`: [{'request_item_id': int, 'quantity': Decimal}] con cantidades > 0 y sin repetir
    ítem. Todo o nada: si una línea no es válida no se escribe nada y se informan TODAS las
    líneas con problema (`DELIVERY_LINES_INVALID`). No cambia el estado del RQ.

    Orden de bloqueos: Request → ítems → filas de stock. El remanente (cantidad − entregado
    neto) se calcula DENTRO de la transacción, con el RQ bloqueado.
    """
    from apps.rq.models import ActivityLog

    guide_number = (guide_number or '').strip()
    with transaction.atomic():
        request = _lock_request(request_id)
        assert_can_deliver(request, user)

        created_on = timezone.localtime(request.created_at).date()
        if movement_date is not None and movement_date < created_on:
            raise DeliveryError(
                'INVALID_DATE',
                'La fecha de la entrega no puede ser anterior a la creación del requerimiento '
                f'({created_on:%d/%m/%Y}).',
                status=400, extra={'min_date': created_on.isoformat()},
            )

        if _duplicate_guide_exists(request, guide_number):
            raise DeliveryError(
                'DUPLICATE_GUIDE',
                f'Ya hay una entrega vigente de este requerimiento con la guía «{guide_number}». '
                'Si fue un error, anúlela antes de registrarla de nuevo.',
                extra={'dispatch_guide_number': guide_number},
            )

        items = {item.pk: item for item in _lock_items(request)}
        wanted_ids = [line['request_item_id'] for line in lines]
        if len(set(wanted_ids)) != len(wanted_ids):
            raise DeliveryError(
                'INVALID_ITEM', 'Un ítem no puede repetirse en la misma entrega.', status=400,
            )
        unknown = [pk for pk in wanted_ids if pk not in items]
        if unknown:
            raise DeliveryError(
                'INVALID_ITEM', 'Hay ítems que no pertenecen a este requerimiento.',
                status=400, extra={'item_ids': sorted(unknown)},
            )

        delivered = net_dispatched_by_item(wanted_ids)
        problems = []
        plan = []   # [(item, quantity)] en orden de línea
        for line in sorted(lines, key=lambda ln: items[ln['request_item_id']].line_number):
            item = items[line['request_item_id']]
            quantity = line['quantity']
            remaining = max(item.quantity - (delivered.get(item.pk) or _ZERO), _ZERO)
            base = {'request_item_id': item.pk, 'line_number': item.line_number}
            if item.is_off_catalog:
                problems.append(base | {
                    'code': LINE_OFF_CATALOG,
                    'message': 'El ítem está marcado fuera de catálogo: no mueve stock del almacén.',
                })
            elif not _is_confirmed_catalog_line(item):
                problems.append(base | {
                    'code': LINE_UNLINKED,
                    'message': 'El ítem no tiene un producto de catálogo confirmado por Logística.',
                })
            elif quantity > remaining:
                problems.append(base | {
                    'code': LINE_EXCEEDS_REMAINING,
                    'message': f'La cantidad supera lo pendiente de entregar ({format_quantity(remaining)}).',
                    'remaining': _fixed(remaining),
                })
            else:
                plan.append((item, quantity))

        pool = _lock_pool({item.inventory_item_id for item, _ in plan})
        shipped = []
        for item, quantity in plan:
            held = pool.get(item.inventory_item_id, _ZERO)
            if quantity > held:
                problems.append({
                    'request_item_id': item.pk, 'line_number': item.line_number,
                    'code': LINE_INSUFFICIENT_STOCK,
                    'message': (
                        f'El almacén central solo tiene {format_quantity(held)} de '
                        f'{item.inventory_item.product_code}.'
                    ),
                    'available': _fixed(held),
                })
                continue
            pool[item.inventory_item_id] = held - quantity
            shipped.append((item, quantity))

        if problems:
            problems.sort(key=lambda p: p['line_number'])
            raise DeliveryError(
                'DELIVERY_LINES_INVALID',
                'Hay líneas que no se pueden entregar. No se registró nada.',
                extra={'lines': problems},
            )

        user_notes = (notes or '').strip()
        suffix = f' — {user_notes}' if user_notes else ''
        group, dispatch = _write_documents(
            request, user, shipped,
            guide_number=guide_number,
            group_notes=f'Entrega RQ {request.rq_number}{suffix}',
            dispatch_notes=f'Entrega por tandas RQ {request.rq_number}{suffix}',
            movement_date=movement_date,
        )
        detail = '; '.join(
            f'línea {item.line_number} × {format_quantity(qty)}' for item, qty in shipped
        )
        ActivityLog.objects.create(
            request=request, user=user, action=DELIVERY_REGISTERED_ACTION,
            detail=f'Entrega {dispatch.dispatch_number} (guía {guide_number}): {detail}.',
        )

    logger.info(
        'rq_fulfillment.delivery_registered',
        extra={
            'rq_number': request.rq_number, 'request_id': request.pk,
            'dispatch_id': dispatch.pk, 'group_number': group.group_number,
            'lines': len(shipped), 'user_id': getattr(user, 'pk', None),
        },
    )
    return DeliveryResult(dispatch=dispatch, group=group, lines=shipped)


def reverse_delivery(request_id, dispatch_id, user, *, reason: str, movement_date=None):
    """
    Anula la entrega `dispatch_id` del RQ con un contra-movimiento: un ingreso `RETURN` por lo
    mismo que salió (a la misma fila de stock de la que salió) y un `WarehouseDispatch` de
    reversa enlazado al original por `reverses`. No se borra nada; el remanente de los ítems
    vuelve a aparecer porque lo entregado es neto de reversas.

    Solo roles CENTRAL_WAREHOUSE o LOGISTICS_CHIEF, y solo en los estados donde la entrega se
    puede rehacer (IN_STOCK y QUALITY_APPROVED, `DELIVERABLE_STATUSES`): después el RQ ya siguió su
    camino y lo que corresponde es el ciclo de reclamo. Una entrega se anula una sola vez y una
    reversa no se anula. La fecha de la reversa no puede ser anterior a la de la entrega.
    """
    from apps.rq.models import ActivityLog
    from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

    reason = (reason or '').strip()
    with transaction.atomic():
        request = _lock_request(request_id)
        if not user_can_reverse(user):
            raise DeliveryError(
                'ROLE_NOT_ALLOWED',
                'Solo Almacén Central y Jefe Logístico pueden anular entregas.',
                status=403, extra={'required_roles': sorted(CanReverseDelivery.ALLOWED_ROLES)},
            )
        if request.status not in DELIVERABLE_STATUSES:
            raise DeliveryError(
                'RQ_NOT_REVERSIBLE_STATE',
                'La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.',
                extra={'status': request.status, 'allowed_statuses': list(DELIVERABLE_STATUSES)},
            )

        original = (
            WarehouseDispatch.objects.select_for_update(of=('self',))
            .select_related('movement_group')
            .filter(pk=dispatch_id, request=request)
            .first()
        )
        if original is None:
            raise DeliveryError(
                'DELIVERY_NOT_FOUND', 'La entrega no existe en este requerimiento.', status=404,
            )
        if original.reverses_id is not None:
            raise DeliveryError(
                'NOT_REVERSIBLE', 'Una reversa no se puede anular.',
            )
        if WarehouseDispatch.objects.filter(reverses=original).exists():
            raise DeliveryError(
                'ALREADY_REVERSED', 'Esta entrega ya fue anulada.',
            )
        out_group = original.movement_group
        movements = list(out_group.movements.select_related('inventory').order_by('pk')) if out_group else []
        if not movements or any(m.movement_type != 'EXIT' for m in movements):
            raise DeliveryError(
                'NOT_REVERSIBLE',
                'Esta entrega no tiene un vale de salida que se pueda revertir.',
            )

        # Lock the items like a delivery does (Request → ítems → stock) so that a concurrent
        # delivery computes its remainder after this reversal commits.
        _lock_items(request)

        original_date = operational_date(original)
        if movement_date is not None and movement_date < original_date:
            raise DeliveryError(
                'INVALID_DATE',
                'La fecha de la reversa no puede ser anterior a la de la entrega que anula '
                f'({original_date:%d/%m/%Y}).',
                status=400, extra={'min_date': original_date.isoformat()},
            )

        label = original.dispatch_number or f'#{original.pk}'
        guide = original.dispatch_guide_number
        try:
            entry = register_entry_batch(
                items_data=[
                    {
                        'inventory_id': m.inventory_id,
                        'quantity': m.quantity,
                        'line': number,
                        'notes': f'Reversa de {m.movement_number}',
                    }
                    for number, m in enumerate(movements, start=1)
                ],
                warehouse=out_group.warehouse,
                project_id=out_group.project_id,
                source_type='RETURN',
                supplier_name='',
                invoice_number='',
                notes=f'Reversa de la entrega {label} del RQ {request.rq_number}. Motivo: {reason}',
                registered_by=user,
                movement_date=movement_date,
                guide_number=guide,
            )
        except ValueError as exc:   # entry above the maximum stock the column can hold
            raise DeliveryError('REVERSE_FAILED', str(exc)) from exc

        reversal = WarehouseDispatch.objects.create(
            request=request,
            receipt=original.receipt,
            dispatched_by=user,
            dispatch_number=entry.group_number,
            origin=original.origin,
            destination_project=original.destination_project,
            destination_department=original.destination_department,
            dispatch_guide_number=guide,
            movement_group=entry,
            reverses=original,
            notes=f'Reversa de la entrega {label}. Motivo: {reason}',
        )
        for line in original.items.all():
            WarehouseDispatchItem.objects.create(
                dispatch=reversal, request_item=line.request_item,
                quantity_dispatched=line.quantity_dispatched,
            )
        ActivityLog.objects.create(
            request=request, user=user, action=DELIVERY_REVERSED_ACTION,
            detail=(
                f'Entrega {label} (guía {guide or "s/n"}) anulada con la reversa '
                f'{entry.group_number}. Motivo: {reason}'
            ),
        )

    logger.info(
        'rq_fulfillment.delivery_reversed',
        extra={
            'rq_number': request.rq_number, 'request_id': request.pk,
            'dispatch_id': original.pk, 'reversal_id': reversal.pk,
            'group_number': entry.group_number, 'user_id': getattr(user, 'pk', None),
        },
    )
    return reversal
