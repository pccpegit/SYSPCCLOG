"""
Warehouse services — business logic for inventory movements.
All stock mutations go through these functions to ensure atomicity.

Public API
----------
register_entry        — single-item entry (backward compat wrapper)
register_exit         — single-item exit  (backward compat wrapper)
register_adjustment   — inventory adjustment (no group)
register_entry_batch  — multi-item entry, returns MovementGroup
register_exit_batch   — multi-item exit,  returns MovementGroup (stamps the automatic guide
                        GR-AAAA-NNNNNN, SYSPCC-041; see services/guides.py)
"""
import logging
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum
from django.db.models.functions import Length
from django.utils import timezone

from apps.core.models import User
from apps.warehouse.models import Inventory, InventoryStock, InventoryMovement, MovementGroup
from apps.warehouse.models.inventory import MAX_STOCK_QUANTITY
from apps.warehouse.services.guides import next_guide_number

logger = logging.getLogger(__name__)


def format_quantity(value) -> str:
    """
    Quantity as a person reads it: ``5`` instead of ``5.000``, ``2.5`` instead of ``2.500``.

    Stock errors go straight to the screen, where ``5.000`` can be read as five thousand.
    """
    return format(Decimal(str(value)).normalize(), 'f')


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _generate_movement_number(movement_type: str) -> str:
    """
    Generate a sequential movement number.
    Format: ENT-2026-0001, SAL-2026-0001, TRF-2026-0001, AJU-2026-0001.

    The caller must already be inside an atomic transaction. select_for_update()
    locks the most recent matching row so a second concurrent transaction blocks
    until the first commits and then recomputes off the updated max — closing the
    common race window. When no row exists yet for the (prefix, year) pair there is
    nothing to lock, so a residual race remains for the very first number of the
    year/prefix; callers must treat the resulting IntegrityError (duplicate
    movement_number) as a 409/retry case rather than a 500.
    """
    prefixes = {
        'ENTRY': 'ENT',
        'EXIT': 'SAL',
        'TRANSFER': 'TRF',
        'ADJUSTMENT': 'AJU',
    }
    prefix = prefixes.get(movement_type, 'MOV')
    year = datetime.now().year
    # Longest first: the sequence is zero-padded to 4 digits, so past 9999 a plain text sort puts
    # ...-10000 BEFORE ...-9999 and the same number would be handed out again.
    last = (
        InventoryMovement.objects
        .select_for_update()
        .filter(movement_number__startswith=f'{prefix}-{year}-')
        .order_by(Length('movement_number').desc(), '-movement_number')
        .first()
    )
    if last:
        try:
            seq = int(last.movement_number.split('-')[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    else:
        seq = 1
    return f'{prefix}-{year}-{seq:04d}'


def _generate_group_number(movement_type: str) -> str:
    """
    Generate a sequential group number using the same prefix convention.
    Reads from MovementGroup to avoid collisions with individual movements.
    Format: ENT-2026-G0001, SAL-2026-G0001
    """
    from apps.warehouse.models import MovementGroup

    prefixes = {
        'ENTRY': 'ENT',
        'EXIT': 'SAL',
        'TRANSFER': 'TRF',
        'ADJUSTMENT': 'AJU',
    }
    prefix = prefixes.get(movement_type, 'MOV')
    year = datetime.now().year
    pattern = f'{prefix}-{year}-G'
    # Longest first: ``SAL-2026-G9999`` is followed by ``G10000``, which a plain text sort puts
    # BEFORE ``G9999``: the next number would repeat ``G10000`` and every registration would fail
    # on the unique constraint. (~400 vales in 12 days in the real workbook: months, not years.)
    last = (
        MovementGroup.objects
        .select_for_update()
        .filter(group_number__startswith=pattern)
        .order_by(Length('group_number').desc(), '-group_number')
        .first()
    )
    if last:
        try:
            seq = int(last.group_number.split('-G')[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    else:
        seq = 1
    return f'{pattern}{seq:04d}'


def _get_or_create_stock(inventory, warehouse: str, project_id=None) -> InventoryStock:
    """Return (or create) the InventoryStock row for the given scope."""
    from apps.core.models import Project as ProjectModel

    project = None
    if project_id:
        project = ProjectModel.objects.filter(pk=project_id).first()

    stock, _ = InventoryStock.objects.get_or_create(
        inventory=inventory,
        warehouse_type=warehouse,
        project=project,
        department=None,
        defaults={'quantity': Decimal('0')},
    )
    return stock


def _upload_group_pdf_sync(group_id: int) -> None:
    """
    Generate PDF and upload to OneDrive synchronously.
    Best-effort: a failure is logged but never raises.

    SYSPCC-012: no longer called from apps.warehouse.views — batch_entry/
    batch_exit now enqueue `apps.warehouse.tasks.upload_group_pdf_task`
    instead of blocking the request thread on this. Left in place (unused)
    rather than deleted, in case another sync call site is added later;
    remove if it stays dead after a couple of releases.
    """
    try:
        from apps.warehouse.models import MovementGroup
        from apps.warehouse.services.pdf_generator import (
            generate_group_pdf, get_group_filename, get_group_month_folder,
        )
        from apps.warehouse.services.onedrive import OneDriveService

        group = (
            MovementGroup.objects
            .select_related('registered_by', 'project')
            .prefetch_related('movements', 'movements__inventory')
            .get(pk=group_id)
        )

        if not OneDriveService.is_connected():
            logger.info('OneDrive not connected — skipping upload for %s', group.group_number)
            return

        pdf_bytes = generate_group_pdf(group)
        filename = get_group_filename(group)
        folder = get_group_month_folder(group)
        remote_path = f'{folder}/{filename}'

        url = OneDriveService.upload_file(pdf_bytes, remote_path)
        if url:
            MovementGroup.objects.filter(pk=group.pk).update(document_url=url)
            logger.info('Uploaded %s to OneDrive: %s', group.group_number, url)
    except Exception as exc:
        logger.warning('Failed to upload PDF for group %s: %s', group_id, exc)


# ---------------------------------------------------------------------------
# Batch (multi-item) operations
# ---------------------------------------------------------------------------

def resolve_movement_date(movement_date, undated: bool = False):
    """
    Operational date of a movement: the given date, or today (America/Lima) when
    ``movement_date`` is None. ``undated=True`` stores NULL instead (only the
    Excel importer uses it, for rows the workbook leaves without a date).
    """
    if undated:
        return None
    return movement_date or timezone.localdate()


# SYSPCC-041: window of the double-submit defence of the free exits (same one as the RQ deliveries).
DUPLICATE_EXIT_WINDOW = timedelta(seconds=15)
DUPLICATE_EXIT_MESSAGE = (
    'Esta salida ya se registró hace unos segundos con los mismos ítems y destino. Revise el '
    'historial de movimientos. Si es una segunda salida intencional, espere unos segundos y '
    'vuelva a registrarla.'
)


class DuplicateExitError(Exception):
    """The same user just registered an identical free exit (double click / retry). Retryable later."""

    code = 'DUPLICATE_EXIT'
    message = DUPLICATE_EXIT_MESSAGE


def _recent_duplicate_exit_exists(*, registered_by, warehouse, project_id, destination_type,
                                  destination_detail, destination_personal_id, wanted) -> bool:
    """
    ¿El MISMO usuario registró hace menos de 15 s una salida LIBRE (sin RQ) al mismo destino con
    exactamente los mismos ítems y cantidades (las líneas repetidas de un ítem se suman)? Heurística
    del doble clic / reintento tras un timeout: la segunda petición espera el bloqueo del stock y aquí
    ve la salida de la primera. Las entregas de un RQ tienen su propia regla (`DUPLICATE_DELIVERY`).
    """
    recent = (
        MovementGroup.objects
        .filter(
            movement_type='EXIT', registered_by=registered_by, warehouse=warehouse, project_id=project_id,
            destination_type=destination_type, destination_detail=destination_detail or '',
            destination_personal_id=destination_personal_id,
            created_at__gte=timezone.now() - DUPLICATE_EXIT_WINDOW,
            warehouse_dispatch__isnull=True,
        )
        .values_list('pk', flat=True)
    )
    for group_id in recent:
        lines = {
            row['inventory_id']: row['total']
            for row in (
                InventoryMovement.objects.filter(group_id=group_id)
                .values('inventory_id').annotate(total=Sum('quantity'))
            )
        }
        if lines == wanted:
            return True
    return False


def find_duplicate_voucher(warehouse: str, voucher_number: str) -> bool:
    """True when an EXIT vale with this physical number already exists in the warehouse."""
    if not voucher_number:
        return False
    # iexact: the movements list filters by ``voucher_number__iexact``, so 'S-12' and 's-12' are
    # the same physical vale.
    return MovementGroup.objects.filter(
        movement_type='EXIT', warehouse=warehouse, voucher_number__iexact=voucher_number.strip(),
    ).exists()


@transaction.atomic
def register_entry_batch(
    items_data: list,
    warehouse: str,
    project_id,
    source_type: str,
    supplier_name: str,
    invoice_number: str,
    notes: str,
    registered_by: User,
    *,
    movement_date=None,
    undated: bool = False,
    voucher_number: str = '',
    po_number: str = '',
    guide_number: str = '',
    internal_transfer: str = '',
    destination_personal_id=None,
    import_batch_id=None,
):
    """
    Register multiple inventory entries as a single vale (MovementGroup).

    items_data: list of dicts with keys:
        - 'inventory_id': int (PK of Inventory)
        - 'quantity': numeric
        - 'line': int (optional, used to suffix the movement_number)
        - 'tag', 'notes', 'source_key': optional per-line data (SYSPCC-025)

    The keyword-only arguments are optional (SYSPCC-025); callers that do not
    pass them (e.g. the WorkflowEngine) behave exactly as before, with
    ``movement_date`` defaulting to today (America/Lima).

    Returns the created MovementGroup.
    """
    movement_date = resolve_movement_date(movement_date, undated)
    header = {
        'movement_date': movement_date,
        'voucher_number': voucher_number or '',
        'po_number': po_number or '',
        'guide_number': guide_number or '',
        'internal_transfer': internal_transfer or '',
        'destination_personal_id': destination_personal_id,
    }

    group = MovementGroup.objects.create(
        group_number=_generate_group_number('ENTRY'),
        movement_type='ENTRY',
        warehouse=warehouse,
        project_id=project_id,
        source_type=source_type,
        supplier_name=supplier_name or '',
        invoice_number=invoice_number or '',
        notes=notes or '',
        registered_by=registered_by,
        **header,
    )

    # Lock the stock rows up front in a deterministic order (inventory id) so two
    # concurrent batches touching the same items cannot deadlock. The locked quantity also
    # lets us refuse an entry that would overflow the DECIMAL(12, 3) column (repeated lines
    # of one item are added up first, like the exit does).
    incoming: dict = {}
    for d in items_data:
        incoming[d['inventory_id']] = incoming.get(d['inventory_id'], Decimal('0')) + Decimal(str(d['quantity']))
    for inv_id in sorted(incoming):
        inventory = Inventory.objects.get(pk=inv_id)
        pre_stock = _get_or_create_stock(inventory, warehouse, project_id)
        locked = InventoryStock.objects.select_for_update().get(pk=pre_stock.pk)
        if locked.quantity + incoming[inv_id] > MAX_STOCK_QUANTITY:
            raise ValueError(
                f'El ingreso supera el stock máximo permitido ({MAX_STOCK_QUANTITY:,.3f}) '
                f'para {inventory.product_code}. Stock actual: {format_quantity(locked.quantity)}.'
            )

    for idx, item_data in enumerate(items_data, start=1):
        inventory = Inventory.objects.get(pk=item_data['inventory_id'])
        quantity = Decimal(str(item_data['quantity']))
        line = item_data.get('line', idx)

        InventoryMovement.objects.create(
            movement_number=f'{group.group_number}-{line:02d}',
            movement_type='ENTRY',
            inventory=inventory,
            quantity=quantity,
            warehouse=warehouse,
            project_id=project_id,
            source_type=source_type,
            supplier_name=supplier_name or '',
            invoice_number=invoice_number or '',
            notes=item_data.get('notes') or '',
            tag=item_data.get('tag') or '',
            source_key=item_data.get('source_key') or None,
            import_batch_id=import_batch_id,
            registered_by=registered_by,
            group=group,
            **header,
        )

        stock = _get_or_create_stock(inventory, warehouse, project_id)
        stock.quantity = F('quantity') + quantity
        stock.save(update_fields=['quantity', 'last_updated'])

    # Fire async PDF generation + OneDrive upload after the transaction commits.
    # PDF upload is handled by the view layer after the transaction commits

    return group


@transaction.atomic
def register_exit_batch(
    items_data: list,
    warehouse: str,
    project_id,
    destination_type: str,
    destination_detail: str,
    requested_by_id,
    authorized_by_id,
    notes: str,
    registered_by: User,
    *,
    movement_date=None,
    undated: bool = False,
    voucher_number: str = '',
    po_number: str = '',
    guide_number: str = '',
    internal_transfer: str = '',
    destination_personal_id=None,
    import_batch_id=None,
    reject_recent_duplicate: bool = False,
):
    """
    Register multiple inventory exits as a single vale (MovementGroup).

    items_data: list of dicts with keys:
        - 'inventory_id': int (PK of Inventory)
        - 'quantity': numeric
        - 'line': int (optional)
        - 'tag', 'notes', 'source_key': optional per-line data (SYSPCC-025)

    Raises ValueError if any item has insufficient stock (quantities of the same
    item repeated across lines are added up before checking).
    Returns the created MovementGroup.

    SYSPCC-041 · N° de guía automático. Every EXIT vale gets ``GR-AAAA-NNNNNN`` from the
    ``GuideSequence`` counter, inside THIS transaction (a rollback does not burn a number). It is
    stored in ``MovementGroup.internal_guide_number`` (source of truth) and mirrored into
    ``guide_number`` of the vale and its lines. The ``guide_number`` argument is DEPRECATED: it is
    accepted for backward compatibility and IGNORED (nobody types the guide); do not pass it.

    ``reject_recent_duplicate`` (the API views set it): raises ``DuplicateExitError`` BEFORE taking a
    number when the same user registered an identical free exit less than 15 s ago. If the counter
    row stays locked past ``guides.LOCK_TIMEOUT`` (PostgreSQL) ``GuideNumberBusyError`` is raised.
    Global lock order, always the same:
    Request -> RequestItem -> InventoryStock (by inventory id) -> GuideSequence -> MovementGroup
    (last EXIT number). Taking the counter first serializes the exits, which also makes the EXIT vale
    number race-free.
    """
    requested_by = (
        User.objects.filter(pk=requested_by_id).first() if requested_by_id else None
    )
    authorized_by = (
        User.objects.filter(pk=authorized_by_id).first() if authorized_by_id else None
    )
    movement_date = resolve_movement_date(movement_date, undated)
    header = {
        'movement_date': movement_date,
        'voucher_number': voucher_number or '',
        'po_number': po_number or '',
        'guide_number': '',   # mirror of the automatic guide, filled below (the argument is ignored)
        'internal_transfer': internal_transfer or '',
        'destination_personal_id': destination_personal_id,
    }

    # Validate & lock stock for every item before creating anything.
    # select_for_update() blocks any concurrent transaction that would read/decrement
    # the same InventoryStock row until this transaction commits or rolls back, closing
    # the TOCTOU race that could otherwise push stock negative under concurrent exits.
    # Locks are taken in inventory-id order (deterministic -> no deadlocks between
    # two batches) and the requested quantity of a repeated item is accumulated so
    # that "2 lines x 3" is checked as 6 against the available stock.
    requested_by_inventory: dict[int, Decimal] = {}
    for item_data in items_data:
        inv_id = item_data['inventory_id']
        requested_by_inventory[inv_id] = (
            requested_by_inventory.get(inv_id, Decimal('0'))
            + Decimal(str(item_data['quantity']))
        )

    locked_stocks: dict[int, InventoryStock] = {}
    for inv_id in sorted(requested_by_inventory):
        inventory = Inventory.objects.get(pk=inv_id)
        stock = _get_or_create_stock(inventory, warehouse, project_id)
        stock = InventoryStock.objects.select_for_update().get(pk=stock.pk)
        requested = requested_by_inventory[inv_id]
        if stock.quantity < requested:
            raise ValueError(
                f'Stock insuficiente para {inventory.product_code}. '
                f'Disponible: {format_quantity(stock.quantity)}, solicitado: {format_quantity(requested)}'
            )
        locked_stocks[inv_id] = stock

    # Double-submit defence, under the stock locks taken above (a concurrent identical request waits
    # for them and sees this one committed) and BEFORE a number is taken.
    if reject_recent_duplicate and _recent_duplicate_exit_exists(
        registered_by=registered_by, warehouse=warehouse, project_id=project_id,
        destination_type=destination_type, destination_detail=destination_detail,
        destination_personal_id=destination_personal_id,
        wanted={inv_id: qty for inv_id, qty in requested_by_inventory.items()},
    ):
        raise DuplicateExitError(DUPLICATE_EXIT_MESSAGE)

    # The counter row is locked BEFORE the vale number is computed (see the docstring): concurrent
    # exits queue here until the previous one commits, so each of them reads the previous group as
    # the last one. That also closes the race of `_generate_group_number` for EXIT vales (under
    # READ COMMITTED a waiter of `FOR UPDATE ... LIMIT 1` re-reads the SAME row, not the new max).
    internal_guide_number = next_guide_number()
    group_number = _generate_group_number('EXIT')
    header['guide_number'] = internal_guide_number

    group = MovementGroup.objects.create(
        group_number=group_number,
        internal_guide_number=internal_guide_number,
        movement_type='EXIT',
        warehouse=warehouse,
        project_id=project_id,
        destination_type=destination_type,
        destination_detail=destination_detail or '',
        notes=notes or '',
        registered_by=registered_by,
        **header,
    )

    for idx, item_data in enumerate(items_data, start=1):
        inventory = Inventory.objects.get(pk=item_data['inventory_id'])
        quantity = Decimal(str(item_data['quantity']))
        line = item_data.get('line', idx)

        InventoryMovement.objects.create(
            movement_number=f'{group.group_number}-{line:02d}',
            movement_type='EXIT',
            inventory=inventory,
            quantity=quantity,
            warehouse=warehouse,
            project_id=project_id,
            destination_type=destination_type,
            destination_detail=destination_detail or '',
            requested_by=requested_by,
            authorized_by=authorized_by,
            notes=item_data.get('notes') or '',
            tag=item_data.get('tag') or '',
            source_key=item_data.get('source_key') or None,
            import_batch_id=import_batch_id,
            registered_by=registered_by,
            group=group,
            **header,
        )

        # Reuse the locked row; F() keeps the decrement atomic at the DB level.
        stock = locked_stocks[inventory.pk]
        stock.quantity = F('quantity') - quantity
        stock.save(update_fields=['quantity', 'last_updated'])

    # PDF upload is handled by the view layer after the transaction commits

    # Audit trail of the number (ids and the document numbers only: no worker or destination data).
    logger.info(
        'warehouse.exit.guide_assigned',
        extra={
            'guide_number': internal_guide_number, 'group_number': group.group_number,
            'group_id': group.pk, 'lines': len(items_data), 'warehouse': warehouse,
            'user_id': getattr(registered_by, 'pk', None),
        },
    )
    return group


# ---------------------------------------------------------------------------
# Single-item operations (backward-compatible wrappers)
# ---------------------------------------------------------------------------

@transaction.atomic
def register_entry(
    inventory: Inventory,
    quantity,
    warehouse: str,
    project_id,
    source_type: str,
    supplier_name: str,
    invoice_number: str,
    notes: str,
    registered_by: User,
    *,
    tag: str = '',
    **header,
) -> InventoryMovement:
    """
    Register a single inventory entry and increment the matching stock row.
    Creates a one-item MovementGroup for consistent PDF handling.
    ``header`` carries the optional SYSPCC-025 document fields (movement_date,
    voucher_number, po_number, guide_number, internal_transfer, ...).
    """
    group = register_entry_batch(
        items_data=[{'inventory_id': inventory.pk, 'quantity': quantity, 'line': 1, 'tag': tag}],
        warehouse=warehouse,
        project_id=project_id,
        source_type=source_type,
        supplier_name=supplier_name,
        invoice_number=invoice_number,
        notes=notes,
        registered_by=registered_by,
        **header,
    )
    # Return the single InventoryMovement for backward compatibility
    return group.movements.first()


@transaction.atomic
def register_exit(
    inventory: Inventory,
    quantity,
    warehouse: str,
    project_id,
    destination_type: str,
    destination_detail: str,
    requested_by_id,
    authorized_by_id,
    notes: str,
    registered_by: User,
    *,
    tag: str = '',
    **header,
) -> InventoryMovement:
    """
    Register a single inventory exit and decrement the matching stock row.
    Raises ValueError if current stock is insufficient.
    Creates a one-item MovementGroup for consistent PDF handling.
    ``header`` carries the optional SYSPCC-025 document fields.
    """
    group = register_exit_batch(
        items_data=[{'inventory_id': inventory.pk, 'quantity': quantity, 'line': 1, 'tag': tag}],
        warehouse=warehouse,
        project_id=project_id,
        destination_type=destination_type,
        destination_detail=destination_detail,
        requested_by_id=requested_by_id,
        authorized_by_id=authorized_by_id,
        notes=notes,
        registered_by=registered_by,
        **header,
    )
    return group.movements.first()


@transaction.atomic
def register_adjustment(
    inventory: Inventory,
    quantity,  # positive = add, negative = subtract
    warehouse: str,
    project_id,
    notes: str,
    registered_by: User,
    *,
    movement_date=None,
) -> InventoryMovement:
    """
    Register an inventory adjustment.

    `quantity` is the signed delta: positive = stock increase, negative = decrease.
    The movement stores the absolute value; the direction is captured by source/destination type.
    Raises ValueError if the adjustment would produce negative stock.
    No MovementGroup is created for adjustments.
    """
    # Same lock pattern as register_exit_batch: hold a row lock for the duration of
    # the transaction so a concurrent adjustment/exit can't race past this check.
    stock = _get_or_create_stock(inventory, warehouse, project_id)
    stock = InventoryStock.objects.select_for_update().get(pk=stock.pk)

    qty = Decimal(str(quantity))
    new_qty = stock.quantity + qty
    if new_qty < 0:
        raise ValueError(
            f'El ajuste resultaría en stock negativo. '
            f'Stock actual: {format_quantity(stock.quantity)}, ajuste: {format_quantity(qty)}'
        )
    if new_qty > MAX_STOCK_QUANTITY:
        raise ValueError(
            f'El ajuste supera el stock máximo permitido ({MAX_STOCK_QUANTITY:,.3f}). '
            f'Stock actual: {format_quantity(stock.quantity)}, ajuste: {format_quantity(qty)}'
        )

    movement = InventoryMovement.objects.create(
        movement_number=_generate_movement_number('ADJUSTMENT'),
        movement_type='ADJUSTMENT',
        inventory=inventory,
        quantity=abs(qty),
        warehouse=warehouse,
        project_id=project_id,
        source_type='ADJUSTMENT' if qty > 0 else '',
        destination_type='ADJUSTMENT' if qty < 0 else '',
        notes=notes or '',
        movement_date=resolve_movement_date(movement_date),
        registered_by=registered_by,
    )

    stock.quantity = F('quantity') + qty
    stock.save(update_fields=['quantity', 'last_updated'])

    return movement
