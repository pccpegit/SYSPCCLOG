"""
N° de guía interno de las salidas del almacén (SYSPCC-041).

Formato ``GR-AAAA-NNNNNN`` (p. ej. ``GR-2026-000001``): correlativo único en toda la empresa que
reinicia cada año calendario de America/Lima. Es un documento INTERNO de almacén; no reemplaza la
guía de remisión electrónica.

Garantías
---------
* **Sin duplicados.** La fila del año (``GuideSequence``) se bloquea con ``select_for_update``: los
  concurrentes esperan a que el primero confirme.
* **Sin saltos.** El incremento vive en la MISMA transacción que descuenta el stock: si esa
  transacción revierte (stock insuficiente, error), el contador revierte con ella. Por eso no se
  usa una SEQUENCE de PostgreSQL (no es transaccional).
* **Reinicio por año** = una fila nueva; no hay job ni migración de datos.

Orden global de bloqueos (todos los caminos de salida lo respetan; el contador va SIEMPRE al final,
así no hay deadlocks)::

    Request -> RequestItem -> InventoryStock (por inventory_id) -> GuideSequence -> MovementGroup (último SAL)

El contador se toma ANTES de calcular el N° de vale interno (`SAL-AAAA-G####`): las salidas
concurrentes hacen cola en el contador y cada una lee como «último» el vale de la anterior ya
confirmada. Eso cierra además la carrera de `_generate_group_number` entre salidas.
"""
import logging

from django.db import OperationalError, connection
from django.db.models import F
from django.utils import timezone

from apps.warehouse.models import GuideSequence

logger = logging.getLogger(__name__)

GUIDE_PREFIX = 'GR'
GUIDE_DIGITS = 6

# PostgreSQL only. Every exit holds the counter row until its transaction commits, so a stuck or
# very long transaction would queue the exits of the whole company (and exhaust the web workers).
# Waiting longer than this for the row fails fast with ``GuideNumberBusyError`` (retryable).
LOCK_TIMEOUT = '5s'
_LOCK_NOT_AVAILABLE = '55P03'

BUSY_MESSAGE = (
    'El sistema está registrando otras salidas en este momento. '
    'Espere unos segundos e intente nuevamente.'
)


class GuideNumberBusyError(Exception):
    """The counter row could not be locked in time (another exit holds it). Retryable."""

    code = 'GUIDE_BUSY'
    message = BUSY_MESSAGE


def format_guide_number(year: int, sequence: int) -> str:
    """``GR-2026-000001``. Pasado 999 999 al año el número crece (sin truncar)."""
    return f'{GUIDE_PREFIX}-{year}-{sequence:0{GUIDE_DIGITS}d}'


def next_guide_number(on_date=None) -> str:
    """
    Reserva y devuelve el siguiente N° de guía del año de ``on_date`` (hoy en Lima por defecto).

    Debe llamarse dentro de ``transaction.atomic()``: el número solo existe si la transacción
    que lo usa confirma.
    """
    if not connection.in_atomic_block:
        raise RuntimeError('next_guide_number debe llamarse dentro de transaction.atomic().')

    year = (on_date or timezone.localdate()).year
    previous_timeout = _set_lock_timeout()
    try:
        # INSERT ... ON CONFLICT DO NOTHING (OR IGNORE en SQLite): crear la fila del año no lanza ni
        # necesita savepoint, y un concurrente espera a que el primero inserte.
        GuideSequence.objects.bulk_create([GuideSequence(year=year)], ignore_conflicts=True)
        sequence = GuideSequence.objects.select_for_update().get(year=year)
    except OperationalError as exc:
        if getattr(exc.__cause__, 'pgcode', None) == _LOCK_NOT_AVAILABLE:
            logger.warning('warehouse.guide.counter_busy', extra={'year': year, 'timeout': LOCK_TIMEOUT})
            raise GuideNumberBusyError(BUSY_MESSAGE) from exc
        raise
    _restore_lock_timeout(previous_timeout)
    sequence.last_value = F('last_value') + 1
    sequence.save(update_fields=['last_value'])
    sequence.refresh_from_db(fields=['last_value'])
    return format_guide_number(year, sequence.last_value)


def _set_lock_timeout():
    """
    ``SET LOCAL lock_timeout`` (PostgreSQL only) for the counter lock; returns the previous value so
    the rest of the transaction (stock rows of the caller, the engine's own locks) keeps its own.
    """
    if connection.vendor != 'postgresql':
        return None
    with connection.cursor() as cursor:
        cursor.execute('SHOW lock_timeout')
        previous = cursor.fetchone()[0]
        cursor.execute("SELECT set_config('lock_timeout', %s, true)", [LOCK_TIMEOUT])
    return previous


def _restore_lock_timeout(previous):
    if previous is None:
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('lock_timeout', %s, true)", [previous])
