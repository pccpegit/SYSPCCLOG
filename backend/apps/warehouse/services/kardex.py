"""
Kardex and movement summary (SYSPCC-025).

Reproduces, in the database, the "RESUMEN DE MOVIMIENTO" sheet of the real
workbook: INV. INICIAL, INGRESOS, EGRESOS and STOCK ACTUAL = INICIAL + INGRESOS - EGRESOS.

Direction of a movement
-----------------------
* ENTRY                                      -> +quantity
* EXIT                                       -> -quantity
* ADJUSTMENT with ``source_type=ADJUSTMENT``      -> +quantity
* ADJUSTMENT with ``destination_type=ADJUSTMENT`` -> -quantity
* TRANSFER (movement type, unused by the system today) is ignored.

An "initial load" is an ENTRY with ``source_type=INITIAL_LOAD``.

Date semantics (``movement_date``, the operational date; NOT ``created_at``)
-------------------------------------------------------------------------
* Without ``date_from``: INV. INICIAL = initial loads; INGRESOS/EGRESOS = everything else
  (up to ``date_to`` when given).
* With ``date_from``: INV. INICIAL = net balance of every dated movement before
  ``date_from`` (initial loads included); INGRESOS/EGRESOS = movements inside
  ``[date_from, date_to]``.
* Movements without date (imported rows the workbook left blank) count only when
  NO date filter is applied; with a filter they are left out and reported through
  ``count_undated_movements`` so the UI can warn.

The initial load therefore changes column depending on ``date_from`` (see
``initial_loads_count_as_entries``): that single rule decides where an exported
workbook writes it, so the INGRESOS sheet and the summary columns never disagree.

Two stocks, one explanation
---------------------------
``closing_stock`` is what the MOVEMENTS add up to; ``current_stock`` is what ``InventoryStock``
holds (what Inventario, the alerts and the dispatch checks read). They agree whenever stock only
changes through the movement services. Stock that was seeded, edited from the admin or loaded
before the movement ledger existed has no movement behind it, so the two differ. That gap is
reported, never hidden or folded into INV. INICIAL: ``untracked_stock`` per row and
``untracked_totals`` for the whole filter, only when NO date filter applies (with a window the
difference also contains the movements outside it, which is expected). The "units in stock" KPI
must use ``totals.current``, the real stock.
"""
from datetime import date
from decimal import Decimal

from django.db.models import (
    Count, DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum, Value,
)
from django.db.models.functions import Coalesce

from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock

_DEC = DecimalField(max_digits=18, decimal_places=3)
_ZERO = Decimal('0')

INITIAL_Q = Q(movement_type='ENTRY', source_type='INITIAL_LOAD')
IN_Q = Q(movement_type='ENTRY') | Q(movement_type='ADJUSTMENT', source_type='ADJUSTMENT')
OUT_Q = Q(movement_type='EXIT') | Q(movement_type='ADJUSTMENT', destination_type='ADJUSTMENT')

# Safe whitelist for the ``ordering`` query parameter.
ORDERING_FIELDS = {
    'product_code', 'description', 'initial_stock', 'entries', 'exits',
    'closing_stock', 'current_stock',
}
MAX_UNPAGINATED_ROWS = 1000


def initial_loads_count_as_entries(date_from: date | None) -> bool:
    """
    True when the summary of that window counts the (dated) initial loads inside it as
    INGRESOS; False when they travel in INV. INICIAL.

    Without ``date_from`` INV. INICIAL *is* the sum of the initial loads. With ``date_from``
    INV. INICIAL is only the balance before the window, so a load dated inside the window
    is an entry of that period. The annotations below and the Excel export both follow this
    function: if it changes, change ``annotate_movement_summary`` with it.
    """
    return date_from is not None


def signed_quantity(movement) -> Decimal:
    """Signed effect of a movement on stock (see module docstring)."""
    q = movement.quantity
    if movement.movement_type == 'ENTRY':
        return q
    if movement.movement_type == 'EXIT':
        return -q
    if movement.movement_type == 'ADJUSTMENT':
        if movement.source_type == 'ADJUSTMENT':
            return q
        if movement.destination_type == 'ADJUSTMENT':
            return -q
    return _ZERO


def _movement_sum(q: Q):
    sub = (
        InventoryMovement.objects
        .filter(q, inventory_id=OuterRef('pk'))
        .order_by()
        .values('inventory_id')
        .annotate(total=Sum('quantity'))
        .values('total')
    )
    return Coalesce(Subquery(sub, output_field=_DEC), Value(_ZERO, output_field=_DEC))


def _warehouse_q(warehouse: str | None) -> Q:
    return Q(warehouse=warehouse) if warehouse else Q()


def annotate_movement_summary(
    qs,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    warehouse: str | None = None,
):
    """
    Annotate an ``Inventory`` queryset with ``initial_stock``, ``entries``,
    ``exits``, ``closing_stock`` and ``current_stock`` (see module docstring).
    Uses correlated sums, so there is no join fan-out and the queryset can still
    be ordered, filtered and paginated by those columns.
    """
    wh = _warehouse_q(warehouse)

    if date_from:
        before = wh & Q(movement_date__lt=date_from)
        period = wh & Q(movement_date__gte=date_from)
        if date_to:
            period &= Q(movement_date__lte=date_to)
        initial = _movement_sum(before & IN_Q) - _movement_sum(before & OUT_Q)
        entries = _movement_sum(period & IN_Q)
        exits = _movement_sum(period & OUT_Q)
    else:
        scope = wh
        if date_to:
            scope &= Q(movement_date__lte=date_to)
        initial = _movement_sum(scope & INITIAL_Q)
        entries = _movement_sum(scope & IN_Q & ~INITIAL_Q)
        exits = _movement_sum(scope & OUT_Q)

    stock_sub = InventoryStock.objects.filter(inventory_id=OuterRef('pk'))
    if warehouse:
        stock_sub = stock_sub.filter(warehouse_type=warehouse)
    stock_sub = stock_sub.order_by().values('inventory_id').annotate(total=Sum('quantity')).values('total')

    return qs.annotate(
        initial_stock=ExpressionWrapper(initial, output_field=_DEC),
        entries=entries,
        exits=exits,
        current_stock=Coalesce(Subquery(stock_sub, output_field=_DEC), Value(_ZERO, output_field=_DEC)),
    ).annotate(
        closing_stock=ExpressionWrapper(
            F('initial_stock') + F('entries') - F('exits'), output_field=_DEC
        ),
    )


def movement_summary_qs(
    base_qs=None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    warehouse: str | None = None,
    only_with_movement: bool = False,
    only_zero_stock: bool = False,
    ordering: str | None = None,
):
    """
    Annotated, filtered and ordered queryset behind the movement summary.
    ``base_qs`` already carries the catalog filters (search, category, ...).
    """
    qs = Inventory.objects.select_related('project') if base_qs is None else base_qs.select_related('project')
    qs = annotate_movement_summary(qs, date_from=date_from, date_to=date_to, warehouse=warehouse)
    if only_with_movement:
        qs = qs.filter(Q(entries__gt=0) | Q(exits__gt=0))
    if only_zero_stock:
        qs = qs.filter(closing_stock=0)

    order = (ordering or 'product_code').strip()
    # At most ONE leading minus: ``lstrip('-')`` let ``--product_code`` through the whitelist
    # and then ``order_by`` failed with FieldError (500).
    field = order[1:] if order.startswith('-') else order
    if field not in ORDERING_FIELDS:
        order = 'product_code'
    return qs.order_by(order, 'pk')


def summary_totals(qs) -> dict:
    """Column totals over the whole filtered queryset (not just one page)."""
    # Aliases must differ from the annotation names ('entries', 'exits'): an
    # aggregate alias equal to an annotation silently resolves to the wrong thing.
    agg = qs.aggregate(
        total_initial=Sum('initial_stock'),
        total_entries=Sum('entries'),
        total_exits=Sum('exits'),
        total_closing=Sum('closing_stock'),
        total_current=Sum('current_stock'),
    )
    return {
        'initial': float(agg['total_initial'] or 0),
        'entries': float(agg['total_entries'] or 0),
        'exits': float(agg['total_exits'] or 0),
        'closing': float(agg['total_closing'] or 0),
        # Real stock (InventoryStock) of the filtered items: what Inventario and the KPI show.
        'current': float(agg['total_current'] or 0),
    }


def untracked_totals(qs, *, date_from: date | None, date_to: date | None) -> dict | None:
    """
    Items whose real stock is not backed by movements: ``{'items': n, 'units': u}`` (``units`` is
    the net difference ``current - closing``). ``None`` when a date filter applies, because then
    the difference is not meaningful (see the module docstring).
    """
    if date_from or date_to:
        return None
    gap = qs.annotate(
        stock_gap=ExpressionWrapper(F('current_stock') - F('closing_stock'), output_field=_DEC)
    ).exclude(stock_gap=0)
    agg = gap.aggregate(items=Count('pk'), units=Sum('stock_gap'))
    return {'items': agg['items'] or 0, 'units': float(agg['units'] or 0)}


def count_undated_movements(inventory_ids_qs, warehouse: str | None = None) -> int:
    """Movements without ``movement_date`` for the given items (left out of date-filtered views)."""
    qs = InventoryMovement.objects.filter(
        movement_date__isnull=True, inventory_id__in=inventory_ids_qs
    )
    if warehouse:
        qs = qs.filter(warehouse=warehouse)
    return qs.count()


def summary_row(item, *, with_untracked: bool = False) -> dict:
    """
    Serializable dict for one annotated inventory row.

    ``untracked_stock`` (real stock minus what the movements add up to) is only filled when the
    caller says it applies (no date filter); otherwise it is ``None``.
    """
    untracked = (
        float(item.current_stock - item.closing_stock) if with_untracked else None
    )
    return {
        'inventory_id': item.pk,
        'product_code': item.product_code,
        'description': item.description,
        'unit': item.unit,
        'category': item.category,
        'size': item.size,
        'initial_stock': float(item.initial_stock),
        'entries': float(item.entries),
        'exits': float(item.exits),
        'closing_stock': float(item.closing_stock),
        'current_stock': float(item.current_stock),
        'untracked_stock': untracked,
        'location': item.location_display,
        'location_status': item.location_status,
        'floor': item.floor,
        'observation': item.observation,
        'project_code': item.project.code if item.project_id else '',
        'project_name': item.project.name if item.project_id else '',
    }


def item_kardex(
    item,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    movement_type: str | None = None,
    warehouse: str | None = None,
) -> dict:
    """
    Kardex of one item: ``opening_stock`` and the movements ordered by
    ``movement_date`` (undated last) and id, each with ``delta`` and the running
    ``balance_after``. The balance is always computed over the full set of
    movements in scope; ``movement_type`` only filters what is shown.
    """
    base = InventoryMovement.objects.filter(inventory=item)
    if warehouse:
        base = base.filter(warehouse=warehouse)

    opening = _ZERO
    if date_from:
        before = base.filter(movement_date__lt=date_from)
        agg = before.aggregate(
            inc=Sum('quantity', filter=IN_Q), out=Sum('quantity', filter=OUT_Q),
        )
        opening = (agg['inc'] or _ZERO) - (agg['out'] or _ZERO)
        base = base.filter(movement_date__gte=date_from)
    if date_to:
        base = base.filter(movement_date__lte=date_to)

    ordered = (
        base.select_related('registered_by', 'requested_by', 'authorized_by', 'project',
                            'destination_personal')
        .order_by(F('movement_date').asc(nulls_last=True), 'pk')
    )

    balance = opening
    rows = []
    for mv in ordered:
        delta = signed_quantity(mv)
        balance += delta
        if movement_type and mv.movement_type != movement_type:
            continue
        rows.append((mv, delta, balance))
    return {'opening_stock': opening, 'rows': rows, 'closing_stock': balance}
