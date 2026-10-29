"""
Applier of the import plan (SYSPCC-025): the ONLY place of the importer that writes.

It runs inside the caller's ``transaction.atomic()`` (the service wraps the whole
confirmation), so any error rolls back the catalog, the movements and the stock
together. The importer never enqueues vale PDFs / OneDrive uploads and never touches
the WorkflowEngine or any request (RQ).

Order: catalog -> initial loads -> ALL entries -> exits (in sheet order) -> checks.

Why bulk inserts instead of one ``register_entry_batch`` / ``register_exit_batch``
call per vale: a real-size workbook (≈250 items, ≈260 entries, ≈480 exits) costs
≈8 000 queries through those services, which against a remote PostgreSQL gets close
to the 120 s gunicorn timeout. Here the same rows are written with a few dozen
queries. The result is IDENTICAL to what the services write (group/movement numbering
format, header fields, stock arithmetic); ``tests/test_import_confirm.py`` compares the
two paths row by row. The stock rows are locked in ``inventory_id`` order, like the
services do, and the final quantity of each item is checked to be >= 0.
"""
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock, MovementGroup
from apps.warehouse.services import movements as movements_svc
from apps.warehouse.services.imports.planner import ACTION_CREATE, ACTION_SKIP, ACTION_UPDATE

GROUP_NOTE = 'Importado desde libro de Excel'
INITIAL_NOTE = 'Carga inicial desde libro de Excel'
CHUNK = 500
ZERO = Decimal('0')


def _chunks(values, size=CHUNK):
    values = list(values)
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _apply_catalog(plan, project_map) -> tuple[dict, int, int]:
    """Create the new items (bulk) and fill/update the existing ones. Returns ``(ids, created, updated)``."""
    ids: dict[str, int] = {}
    created = updated = 0
    new_items = []
    for code, entry in plan.catalog.items():
        if entry.action == ACTION_SKIP:
            continue
        if entry.action == ACTION_CREATE:
            new_items.append(Inventory(
                product_code=code, description=entry.description, unit=entry.unit,
                category=entry.category, item_type=entry.item_type, size=entry.size,
                order_number=entry.order_number, purchase_order_ref=entry.purchase_order_ref,
                packing_list=entry.packing_list, observation=entry.observation,
                floor=entry.floor, location=entry.location,
                project_id=project_map.get(entry.project_key) if entry.project_key else None,
            ))
        elif entry.action == ACTION_UPDATE:
            item = Inventory.objects.select_for_update().get(pk=entry.existing.pk)
            for name, value in entry.changes.items():
                if name == 'project_key':
                    project_id = project_map.get(value)
                    if project_id is not None:
                        item.project_id = project_id
                else:
                    setattr(item, name, value)
            item.save()
            ids[code] = item.pk
            updated += 1
        else:                                   # UNCHANGED / EXTERNAL: already in the database
            ids[code] = entry.existing.pk

    if new_items:
        Inventory.objects.bulk_create(new_items, batch_size=CHUNK)
        codes = [item.product_code for item in new_items]
        for chunk in _chunks(codes):
            ids.update({
                code: pk
                for pk, code in Inventory.objects.filter(product_code__in=chunk).values_list('pk', 'product_code')
            })
        created = len(new_items)
    return ids, created, updated


class _Numbering:
    """Sequential ``ENT-AAAA-G0001`` / ``SAL-AAAA-G0001`` group numbers, allocated in memory."""

    def __init__(self, movement_type: str):
        # One locked read of the latest number (same function the services use), then count up.
        first = movements_svc._generate_group_number(movement_type)
        self._prefix, seq = first.rsplit('-G', 1)
        self._next = int(seq)

    def take(self) -> str:
        number = f'{self._prefix}-G{self._next:04d}'
        self._next += 1
        return number


class _Writer:
    """Collects groups and movements in memory and writes them with bulk inserts."""

    def __init__(self, plan, import_obj, user, ids):
        self.plan, self.import_obj, self.user, self.ids = plan, import_obj, user, ids
        self.groups: list[MovementGroup] = []
        self.movements: list[tuple[str, InventoryMovement]] = []     # (group_number, movement)
        self.delta: dict[int, Decimal] = defaultdict(lambda: ZERO)
        self.entry_numbers = _Numbering('ENTRY')
        self.exit_numbers = _Numbering('EXIT')

    def _header(self, group) -> dict:
        return {
            'movement_date': group.date,
            'voucher_number': getattr(group, 'voucher', '') or '',
            'po_number': getattr(group, 'po', '') or '',
            'guide_number': getattr(group, 'guide', '') or '',
            'internal_transfer': getattr(group, 'transfer', '') or '',
        }

    def _add(self, *, movement_type, number, lines, header, group_kwargs, line_kwargs, sign):
        warehouse = self.plan.warehouse
        self.groups.append(MovementGroup(
            group_number=number, movement_type=movement_type, warehouse=warehouse, project_id=None,
            registered_by=self.user, **header, **group_kwargs,
        ))
        for index, ln in enumerate(lines, start=1):
            inventory_id = self.ids[ln.code]
            self.movements.append((number, InventoryMovement(
                movement_number=f'{number}-{index:02d}', movement_type=movement_type,
                inventory_id=inventory_id, quantity=ln.quantity, warehouse=warehouse, project_id=None,
                notes=ln.notes or '', tag=ln.tag or '', source_key=ln.source_key or None,
                import_batch_id=self.import_obj.pk, registered_by=self.user,
                **header, **line_kwargs,
            )))
            self.delta[inventory_id] += sign * ln.quantity

    def add_initial(self, lines):
        header = {
            'movement_date': self.plan.opening_date, 'voucher_number': '', 'po_number': '',
            'guide_number': '', 'internal_transfer': '',
        }
        self._add(
            movement_type='ENTRY', number=self.entry_numbers.take(), lines=lines, header=header,
            group_kwargs={'source_type': 'INITIAL_LOAD', 'supplier_name': '', 'invoice_number': '', 'notes': INITIAL_NOTE},
            line_kwargs={'source_type': 'INITIAL_LOAD', 'supplier_name': '', 'invoice_number': ''},
            sign=1,
        )

    def add_entry_group(self, group):
        source_type = 'TRANSFER_IN' if group.transfer else 'PURCHASE'
        self._add(
            movement_type='ENTRY', number=self.entry_numbers.take(), lines=group.lines,
            header=self._header(group),
            group_kwargs={'source_type': source_type, 'supplier_name': '', 'invoice_number': '', 'notes': GROUP_NOTE},
            line_kwargs={'source_type': source_type, 'supplier_name': '', 'invoice_number': ''},
            sign=1,
        )

    def add_exit_group(self, group, destination_map):
        destination_type = 'TRANSFER_OUT' if group.internal else 'EMPLOYEE'
        personal_id = None if group.internal else destination_map.get(group.dest_key, group.personal_id)
        header = {**self._header(group), 'destination_personal_id': personal_id}
        detail = {'destination_type': destination_type, 'destination_detail': group.destination}
        self._add(
            movement_type='EXIT', number=self.exit_numbers.take(), lines=group.lines, header=header,
            group_kwargs={**detail, 'notes': GROUP_NOTE}, line_kwargs=detail, sign=-1,
        )

    # -- persistence -------------------------------------------------------------------

    def write(self):
        MovementGroup.objects.bulk_create(self.groups, batch_size=CHUNK)
        numbers = [g.group_number for g in self.groups]
        group_ids: dict[str, int] = {}
        for chunk in _chunks(numbers):
            group_ids.update({
                number: pk for pk, number in
                MovementGroup.objects.filter(group_number__in=chunk).values_list('pk', 'group_number')
            })
        for number, movement in self.movements:
            movement.group_id = group_ids[number]
        InventoryMovement.objects.bulk_create([m for _n, m in self.movements], batch_size=CHUNK)

    def apply_stock(self):
        """Lock the stock rows in ``inventory_id`` order and apply the net change of each item."""
        warehouse = self.plan.warehouse
        touched = sorted(self.delta)
        locked: dict[int, InventoryStock] = {}
        for chunk in _chunks(touched):
            rows = (
                InventoryStock.objects.select_for_update()
                .filter(inventory_id__in=chunk, warehouse_type=warehouse, project__isnull=True, department__isnull=True)
                .order_by('inventory_id')
            )
            locked.update({row.inventory_id: row for row in rows})

        now = timezone.now()
        to_create, to_update = [], []
        for inventory_id in touched:
            change = self.delta[inventory_id]
            row = locked.get(inventory_id)
            current = row.quantity if row is not None else ZERO
            new_quantity = current + change
            if new_quantity < 0:
                raise ValueError('El stock de al menos un ítem quedaría negativo.')
            if row is None:
                to_create.append(InventoryStock(
                    inventory_id=inventory_id, warehouse_type=warehouse, project=None, department=None,
                    quantity=new_quantity,
                ))
            elif change != 0:
                row.quantity = new_quantity
                row.last_updated = now
                to_update.append(row)
        if to_create:
            InventoryStock.objects.bulk_create(to_create, batch_size=CHUNK)
        if to_update:
            InventoryStock.objects.bulk_update(to_update, ['quantity', 'last_updated'], batch_size=CHUNK)


def apply_plan(plan, import_obj, user, *, project_map=None, destination_map=None) -> dict:
    """
    Write the plan. ``project_map``: normalized project label -> project id (or None).
    ``destination_map``: destination key -> ``core.Personal`` id. Returns the result dict.
    Raises ``ValueError`` (stock would go negative) or ``IntegrityError`` (concurrent import).
    """
    project_map = project_map or {}
    destination_map = destination_map or {}

    with transaction.atomic():
        ids, created, updated = _apply_catalog(plan, project_map)

        writer = _Writer(plan, import_obj, user, ids)
        initial = [ln for ln in plan.initial_lines if not ln.already]
        if initial:
            writer.add_initial(initial)
        for group in plan.entry_groups:                 # every entry before any exit
            writer.add_entry_group(group)
        for group in plan.exit_groups:
            writer.add_exit_group(group, destination_map)
        if writer.groups:
            writer.write()
            writer.apply_stock()

        stock_total, reconciled = _verify_stock(plan, ids)

    return {
        'catalog': {'created': created, 'updated': updated},
        'groups': {
            'initial': 1 if initial else 0,
            'entries': len(plan.entry_groups),
            'exits': len(plan.exit_groups),
        },
        'movements': {
            'initial': len(initial),
            'entries': sum(len(g.lines) for g in plan.entry_groups),
            'exits': sum(len(g.lines) for g in plan.exit_groups),
        },
        'skipped': {
            'rows_with_errors': plan.skipped_rows,
            'already_imported': (
                sum(1 for ln in plan.initial_lines if ln.already)
                + plan.stats.get('already_ENTRY', 0) + plan.stats.get('already_EXIT', 0)
            ),
        },
        'stock_total': float(stock_total),
        'reconciled': reconciled,
    }


def _verify_stock(plan, ids) -> tuple[Decimal, bool | None]:
    """Final check: no negative stock; compare with the workbook's STOCK ACTUAL."""
    by_item: dict[int, Decimal] = {}
    for chunk in _chunks(sorted(ids.values())):
        by_item.update(dict(
            InventoryStock.objects.filter(
                inventory_id__in=chunk, warehouse_type=plan.warehouse,
                project__isnull=True, department__isnull=True,
            ).values_list('inventory_id', 'quantity')
        ))
    if any(qty < 0 for qty in by_item.values()):
        raise ValueError('El stock de al menos un ítem quedaría negativo.')

    total = sum(by_item.values(), ZERO)
    compared = [
        (entry, by_item.get(ids[code], ZERO))
        for code, entry in plan.catalog.items()
        if code in ids and entry.sheet_stock is not None
    ]
    if not compared:
        return total, None
    return total, all(entry.sheet_stock == stock for entry, stock in compared)
