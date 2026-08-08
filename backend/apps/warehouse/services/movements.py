"""
Warehouse services — business logic for inventory movements.
All stock mutations go through these functions to ensure atomicity.

Public API
----------
register_entry        — single-item entry (backward compat wrapper)
register_exit         — single-item exit  (backward compat wrapper)
register_adjustment   — inventory adjustment (no group)
register_entry_batch  — multi-item entry, returns MovementGroup
register_exit_batch   — multi-item exit,  returns MovementGroup
"""
import logging
from datetime import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import F

from apps.core.models import User
from apps.warehouse.models import Inventory, InventoryStock, InventoryMovement

logger = logging.getLogger(__name__)


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
    last = (
        InventoryMovement.objects
        .select_for_update()
        .filter(movement_number__startswith=f'{prefix}-{year}-')
        .order_by('-movement_number')
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
    last = (
        MovementGroup.objects
        .select_for_update()
        .filter(group_number__startswith=pattern)
        .order_by('-group_number')
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
):
    """
    Register multiple inventory entries as a single vale (MovementGroup).

    items_data: list of dicts with keys:
        - 'inventory_id': int (PK of Inventory)
        - 'quantity': numeric
        - 'line': int (optional, used to suffix the movement_number)

    Returns the created MovementGroup.
    """
    from apps.warehouse.models import MovementGroup

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
            notes='',
            registered_by=registered_by,
            group=group,
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
):
    """
    Register multiple inventory exits as a single vale (MovementGroup).

    items_data: list of dicts with keys:
        - 'inventory_id': int (PK of Inventory)
        - 'quantity': numeric
        - 'line': int (optional)

    Raises ValueError if any item has insufficient stock.
    Returns the created MovementGroup.
    """
    from apps.warehouse.models import MovementGroup

    requested_by = (
        User.objects.filter(pk=requested_by_id).first() if requested_by_id else None
    )
    authorized_by = (
        User.objects.filter(pk=authorized_by_id).first() if authorized_by_id else None
    )

    # Validate & lock stock for every item before creating anything.
    # select_for_update() blocks any concurrent transaction that would read/decrement
    # the same InventoryStock row until this transaction commits or rolls back, closing
    # the TOCTOU race that could otherwise push stock negative under concurrent exits.
    # The locked rows are reused below when decrementing, so each row is only queried once.
    locked_stocks = []
    for item_data in items_data:
        inventory = Inventory.objects.get(pk=item_data['inventory_id'])
        quantity = Decimal(str(item_data['quantity']))
        stock = _get_or_create_stock(inventory, warehouse, project_id)
        stock = InventoryStock.objects.select_for_update().get(pk=stock.pk)
        if stock.quantity < quantity:
            raise ValueError(
                f'Stock insuficiente para {inventory.product_code}. '
                f'Disponible: {stock.quantity}, solicitado: {quantity}'
            )
        locked_stocks.append(stock)

    group = MovementGroup.objects.create(
        group_number=_generate_group_number('EXIT'),
        movement_type='EXIT',
        warehouse=warehouse,
        project_id=project_id,
        destination_type=destination_type,
        destination_detail=destination_detail or '',
        notes=notes or '',
        registered_by=registered_by,
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
            notes='',
            registered_by=registered_by,
            group=group,
        )

        stock = locked_stocks[idx - 1]
        stock.quantity = F('quantity') - quantity
        stock.save(update_fields=['quantity', 'last_updated'])

    # PDF upload is handled by the view layer after the transaction commits

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
) -> InventoryMovement:
    """
    Register a single inventory entry and increment the matching stock row.
    Creates a one-item MovementGroup for consistent PDF handling.
    """
    group = register_entry_batch(
        items_data=[{'inventory_id': inventory.pk, 'quantity': quantity, 'line': 1}],
        warehouse=warehouse,
        project_id=project_id,
        source_type=source_type,
        supplier_name=supplier_name,
        invoice_number=invoice_number,
        notes=notes,
        registered_by=registered_by,
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
) -> InventoryMovement:
    """
    Register a single inventory exit and decrement the matching stock row.
    Raises ValueError if current stock is insufficient.
    Creates a one-item MovementGroup for consistent PDF handling.
    """
    group = register_exit_batch(
        items_data=[{'inventory_id': inventory.pk, 'quantity': quantity, 'line': 1}],
        warehouse=warehouse,
        project_id=project_id,
        destination_type=destination_type,
        destination_detail=destination_detail,
        requested_by_id=requested_by_id,
        authorized_by_id=authorized_by_id,
        notes=notes,
        registered_by=registered_by,
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
            f'El ajuste resultaria en stock negativo. '
            f'Stock actual: {stock.quantity}, ajuste: {quantity}'
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
        registered_by=registered_by,
    )

    stock.quantity = F('quantity') + qty
    stock.save(update_fields=['quantity', 'last_updated'])

    return movement
