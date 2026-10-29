"""
EPP delivery with a physical vale (SYSPCC-025).

Counter use case of the warehouse: a worker receives EPP items against a signed
vale. It is a thin layer on top of ``register_exit_batch`` (stock lock, atomicity
and vale PDF numbering are reused). It does NOT touch the WorkflowEngine nor any
request (RQ) status.
"""
import logging

from apps.warehouse.services import movements as movements_svc

logger = logging.getLogger(__name__)

# Units that cannot be split (EPP is counted in whole pieces).
INTEGER_UNITS = {'EA', 'UND', 'PAR', 'JGO'}


class DuplicateVoucherError(ValueError):
    """The physical vale number is already used by another EXIT in the warehouse."""


class RecipientError(ValueError):
    """The recipient of the delivery is missing, ambiguous or unknown."""


def requires_integer_quantity(unit: str) -> bool:
    return (unit or '').strip().upper() in INTEGER_UNITS


def register_epp_delivery(
    *,
    items: list,
    warehouse: str,
    voucher_number: str,
    movement_date,
    registered_by,
    personal=None,
    recipient_name: str = '',
    internal_destination: str = '',
    internal_transfer: str = '',
    notes: str = '',
    project_id=None,
    allow_duplicate_voucher: bool = False,
):
    """
    Register an EPP delivery. ``items``: ``[{'inventory_id', 'quantity', 'notes'?}]``.

    Exactly one recipient must be given:
      * ``personal``            -> EMPLOYEE, linked to ``core.Personal``
      * ``recipient_name``      -> EMPLOYEE, free text (worker not in Personal)
      * ``internal_destination``-> TRANSFER_OUT (e.g. 'ALM - PRIMER PISO')

    Raises ``RecipientError``, ``DuplicateVoucherError`` or ``ValueError``
    (insufficient stock). Returns the created ``MovementGroup``.
    """
    given = [bool(personal), bool((recipient_name or '').strip()), bool((internal_destination or '').strip())]
    if sum(given) != 1:
        raise RecipientError('Indique un solo destinatario: trabajador, texto libre o destino interno.')

    voucher_number = (voucher_number or '').strip()
    if not voucher_number:
        raise ValueError('Indique el N° de vale.')
    if not allow_duplicate_voucher and movements_svc.find_duplicate_voucher(warehouse, voucher_number):
        raise DuplicateVoucherError('Ya existe un egreso con ese N° de vale en este almacén.')

    if personal is not None:
        destination_type = 'EMPLOYEE'
        destination_detail = personal.apellidos_nombres
        personal_id = personal.pk
    elif (recipient_name or '').strip():
        destination_type = 'EMPLOYEE'
        destination_detail = recipient_name.strip()
        personal_id = None
    else:
        destination_type = 'TRANSFER_OUT'
        destination_detail = internal_destination.strip()
        personal_id = None

    group = movements_svc.register_exit_batch(
        items_data=[
            {
                'inventory_id': it['inventory_id'],
                'quantity': it['quantity'],
                'line': idx,
                'notes': it.get('notes', ''),
            }
            for idx, it in enumerate(items, start=1)
        ],
        warehouse=warehouse,
        project_id=project_id,
        destination_type=destination_type,
        destination_detail=destination_detail,
        requested_by_id=None,
        authorized_by_id=None,
        notes=notes,
        registered_by=registered_by,
        movement_date=movement_date,
        voucher_number=voucher_number,
        internal_transfer=internal_transfer,
        destination_personal_id=personal_id,
    )
    # Never log the recipient: only counts and ids.
    logger.info(
        'warehouse.epp_delivery.registered',
        extra={
            'group_id': group.pk,
            'user_id': registered_by.pk,
            'lines': len(items),
            'destination_type': destination_type,
            'linked': personal_id is not None,
        },
    )
    return group
