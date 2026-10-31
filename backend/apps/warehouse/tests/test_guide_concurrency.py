"""
SYSPCC-041: concurrencia REAL del correlativo de guías (hilos, una conexión por hilo).

En SQLite `select_for_update()` es un no-op y las escrituras ya se serializan solas, así que la
carrera solo es real en PostgreSQL (la CI corre contra PostgreSQL 16) y estos tests se omiten fuera
de él. Garantías que se prueban:

  * N salidas simultáneas, incluida la PRIMERA del año con la tabla del contador vacía, reciben N
    números distintos y consecutivos, sin huecos y sin `IntegrityError`;
  * un hilo que revierte no deja un hueco: el siguiente número se reutiliza;
  * entregas de RQ y salidas libres a la vez comparten el mismo contador sin deadlock.
"""
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections
from django.utils import timezone

from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    ops_rq,
)
from apps.warehouse.models import GuideSequence, InventoryStock, MovementGroup
from apps.warehouse.services import movements as svc
from apps.warehouse.services.rq_fulfillment import deliver_request_items

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(
        connection.vendor != 'postgresql',
        reason='select_for_update() es un no-op en SQLite: la carrera solo es real en PostgreSQL.',
    ),
]

THREADS = 8
YEAR = timezone.localdate().year


def _run_in_threads(callables):
    """Run each callable in its own thread (own DB connection); return results/exceptions."""
    results = [None] * len(callables)
    barrier = threading.Barrier(len(callables))

    def worker(index, fn):
        try:
            barrier.wait(timeout=10)
            results[index] = fn()
        except Exception as exc:  # noqa: BLE001 - the test inspects the exception
            results[index] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i, fn)) for i, fn in enumerate(callables)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    return results


def _exit(user, product):
    return lambda: svc.register_exit_batch(
        items_data=[{'inventory_id': product.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona de Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user,
    )


def _numbers(results):
    return sorted(group.internal_guide_number for group in results)


def _expected(count):
    return [f'GR-{YEAR}-{n:06d}' for n in range(1, count + 1)]


def test_the_first_exits_of_the_year_get_distinct_consecutive_numbers_with_an_empty_counter_table(
    central_warehouse,
):
    # One product per thread: the stock locks do not serialize them, so the counter row is the only
    # point of contention (and the row does not exist yet when they all start).
    products = []
    for n in range(THREADS):
        product = make_inventory(f'EPP-{n:04d}', f'Producto {n}', 'UND')
        make_stock(product, 10)
        products.append(product)
    assert not GuideSequence.objects.exists()

    results = _run_in_threads([_exit(central_warehouse, product) for product in products])

    errors = [r for r in results if isinstance(r, Exception)]
    assert not errors, errors
    assert _numbers(results) == _expected(THREADS)
    assert GuideSequence.objects.get(year=YEAR).last_value == THREADS
    assert MovementGroup.objects.filter(internal_guide_number__isnull=False).count() == THREADS


def test_exits_of_the_same_product_at_the_same_time_are_consecutive_too(central_warehouse):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 100)

    results = _run_in_threads([_exit(central_warehouse, product)] * THREADS)

    assert not [r for r in results if isinstance(r, Exception)], results
    assert _numbers(results) == _expected(THREADS)


def test_a_rolled_back_exit_leaves_no_gap(central_warehouse):
    stocked = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(stocked, 100)
    empty = make_inventory('EPP-0002', 'Guante', 'PAR')
    make_stock(empty, 0)

    # Half of the threads fail on "Stock insuficiente" (before taking a number); the rest succeed.
    callables = [_exit(central_warehouse, stocked if n % 2 == 0 else empty) for n in range(THREADS)]
    results = _run_in_threads(callables)

    ok = [r for r in results if not isinstance(r, Exception)]
    failed = [r for r in results if isinstance(r, Exception)]
    assert len(ok) == THREADS // 2 and all(isinstance(e, ValueError) for e in failed), results
    assert _numbers(ok) == _expected(len(ok))
    assert GuideSequence.objects.get(year=YEAR).last_value == len(ok)


def test_deliveries_of_a_request_and_free_exits_share_the_counter_without_deadlock(
    central_warehouse, ops_rq,
):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 100)
    free = make_inventory('EPP-0002', 'Guante', 'PAR')
    make_stock(free, 100)
    ops_rq.status = 'IN_STOCK'
    ops_rq.save(update_fields=['status'])
    item = make_item(ops_rq, 1, quantity=40, inventory_item=product, confirmed=True)

    def delivery(qty):
        return lambda: deliver_request_items(
            ops_rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal(qty)}]).group

    results = _run_in_threads([
        delivery('3'), delivery('4'), delivery('5'),
        _exit(central_warehouse, free), _exit(central_warehouse, free), _exit(central_warehouse, free),
    ])

    assert not [r for r in results if isinstance(r, Exception)], results
    assert _numbers(results) == _expected(6)


# ═══════════════════ lock_timeout y anti doble envío (endurecimiento) ═══════════════════

def _hold_the_counter(hold, locked):
    """Thread body: takes the counter row and keeps the transaction open until `hold` is set."""
    from django.db import transaction

    from apps.warehouse.services.guides import next_guide_number

    try:
        with transaction.atomic():
            next_guide_number()
            locked.set()
            hold.wait(timeout=20)
    finally:
        connections.close_all()


def test_a_stuck_counter_fails_fast_with_a_retryable_error_and_restores_the_timeout(monkeypatch):
    from django.db import transaction

    from apps.warehouse.services import guides

    monkeypatch.setattr(guides, 'LOCK_TIMEOUT', '300ms')
    hold, locked = threading.Event(), threading.Event()
    holder = threading.Thread(target=_hold_the_counter, args=(hold, locked))
    holder.start()
    try:
        assert locked.wait(timeout=10)
        started = timezone.now()
        with pytest.raises(guides.GuideNumberBusyError):
            with transaction.atomic():
                guides.next_guide_number()
        assert (timezone.now() - started).total_seconds() < 5          # it did not wait for the holder
    finally:
        hold.set()
        holder.join(timeout=20)

    # Once free again: a number is issued, and the transaction keeps its own lock_timeout afterwards.
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SHOW lock_timeout')
        before = cursor.fetchone()[0]
        number = guides.next_guide_number()
        cursor.execute('SHOW lock_timeout')
        assert cursor.fetchone()[0] == before
    assert number == f'GR-{YEAR}-000002'


def test_the_api_answers_409_guide_busy_while_the_counter_is_stuck(central_warehouse, monkeypatch):
    from apps.rq.tests.catalog_fixtures import client_for
    from apps.warehouse.services import guides

    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 10)
    monkeypatch.setattr(guides, 'LOCK_TIMEOUT', '300ms')
    hold, locked = threading.Event(), threading.Event()
    holder = threading.Thread(target=_hold_the_counter, args=(hold, locked))
    holder.start()
    try:
        assert locked.wait(timeout=10)
        response = client_for(central_warehouse).post(
            '/api/v1/warehouse/movements/batch-exit/',
            {'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'X',
             'items': [{'inventory': product.pk, 'quantity': '1'}]}, format='json')
    finally:
        hold.set()
        holder.join(timeout=20)

    assert response.status_code == 409 and response.json()['code'] == 'GUIDE_BUSY'
    assert MovementGroup.objects.count() == 0                           # nothing was written


def test_two_simultaneous_identical_free_exits_register_once(central_warehouse, real_exit_guards):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 100)

    def attempt():
        return svc.register_exit_batch(
            items_data=[{'inventory_id': product.pk, 'quantity': 4}], warehouse='CENTRAL', project_id=None,
            destination_type='EMPLOYEE', destination_detail='Persona de Prueba', requested_by_id=None,
            authorized_by_id=None, notes='', registered_by=central_warehouse, reject_recent_duplicate=True)

    results = _run_in_threads([attempt, attempt])

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], svc.DuplicateExitError), results
    assert MovementGroup.objects.count() == 1 and GuideSequence.objects.get().last_value == 1
    assert InventoryStock.objects.get(inventory=product).quantity == Decimal('96.000')
