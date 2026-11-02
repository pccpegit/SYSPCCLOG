"""
SYSPCC-029: concurrencia REAL de las entregas parciales y las reversas (hilos, dos conexiones).

Mismo patrón que `apps/rq/tests/test_dispatch_concurrency.py`: en SQLite `select_for_update()` es
un no-op, así que la carrera solo es real en PostgreSQL y estos tests se omiten fuera de él.

  * dos entregas del MISMO ítem a la vez: el remanente nunca se sobrepasa y el stock no se duplica;
  * doble clic (mismas líneas, mismo usuario): una entra y la otra es DUPLICATE_DELIVERY;
  * una entrega parcial y el DISPATCHED del motor a la vez: lo entregado neto nunca supera lo pedido;
  * dos reversas de la misma entrega: una gana y el stock vuelve una sola vez.
"""
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections

from apps.core.enums import RoleChoices
from apps.rq.models import Request
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    logistics_chief,
    make_inventory,
    make_item,
    make_request,
    make_stock,
)
from apps.warehouse.models import InventoryStock, WarehouseDispatch
from apps.warehouse.services.dispatch_totals import net_dispatched_by_item
from apps.warehouse.services.rq_fulfillment import DeliveryError, deliver_request_items, reverse_delivery

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(
        connection.vendor != 'postgresql',
        reason='select_for_update() es un no-op en SQLite: la carrera solo es real en PostgreSQL.',
    ),
]


def _run_in_threads(callables):
    """Run each callable in its own thread (own DB connection); return their results/exceptions."""
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


@pytest.fixture
def scenario(central_warehouse, project, requester):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 100)
    rq = make_request(number='RQ-CONC-29', requester=requester, project=project, status='IN_STOCK')
    item = make_item(rq, 1, quantity=10, inventory_item=product, confirmed=True)
    return rq, item, product


def _pool(product):
    return InventoryStock.objects.get(inventory=product, project=None, department=None).quantity


def _deliver(rq, item, user, qty):
    return lambda: deliver_request_items(
        rq.pk, user, [{'request_item_id': item.pk, 'quantity': Decimal(qty)}])


def test_two_simultaneous_deliveries_never_exceed_the_remainder(scenario, central_warehouse):
    rq, item, product = scenario

    results = _run_in_threads([
        _deliver(rq, item, central_warehouse, '6'),
        _deliver(rq, item, central_warehouse, '5'),
    ])

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], DeliveryError), results
    assert errors[0].code == 'DELIVERY_LINES_INVALID'
    assert errors[0].extra['lines'][0]['code'] == 'EXCEEDS_REMAINING'
    # (different quantities on purpose: identical lines would be the double-click rule, tested below)
    net = net_dispatched_by_item([item.pk])[item.pk]
    assert net in (Decimal('6.000'), Decimal('5.000'))
    assert _pool(product) == Decimal('100.000') - net
    assert WarehouseDispatch.objects.filter(request=rq).count() == 1


def test_double_click_with_the_same_lines_delivers_once(scenario, central_warehouse):
    rq, item, product = scenario

    results = _run_in_threads([_deliver(rq, item, central_warehouse, '4')] * 2)

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], DeliveryError), results
    assert errors[0].code == 'DUPLICATE_DELIVERY'
    assert _pool(product) == Decimal('96.000')
    assert WarehouseDispatch.objects.filter(request=rq).count() == 1


def test_a_partial_delivery_and_the_engine_dispatch_never_deliver_more_than_requested(
    scenario, central_warehouse,
):
    rq, item, product = scenario

    def dispatch():
        return WorkflowEngine(Request.objects.get(pk=rq.pk), central_warehouse,
                              RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')

    results = _run_in_threads([_deliver(rq, item, central_warehouse, '4'), dispatch])

    # Whichever lock won, the net delivered is exactly the requested quantity, taken once.
    assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}
    assert _pool(product) == Decimal('90.000')
    delivery_outcome = results[0]
    if isinstance(delivery_outcome, Exception):      # the dispatch won: the request already left IN_STOCK
        assert isinstance(delivery_outcome, DeliveryError) and delivery_outcome.code == 'INVALID_STATE'
    assert not isinstance(results[1], Exception), results


def test_two_simultaneous_reversals_of_the_same_delivery_return_the_stock_once(
    scenario, central_warehouse, logistics_chief,
):
    rq, item, product = scenario
    result = deliver_request_items(
        rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('4')}])
    dispatch_id = result.dispatch.pk

    results = _run_in_threads([
        lambda: reverse_delivery(rq.pk, dispatch_id, central_warehouse, reason='Motivo uno'),
        lambda: reverse_delivery(rq.pk, dispatch_id, logistics_chief, reason='Motivo dos'),
    ])

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], DeliveryError), results
    assert errors[0].code == 'ALREADY_REVERSED'
    assert _pool(product) == Decimal('100.000')
    assert WarehouseDispatch.objects.filter(reverses_id=dispatch_id).count() == 1
    assert net_dispatched_by_item([item.pk]).get(item.pk) == Decimal('0.000')


def test_a_reversal_and_a_new_delivery_at_the_same_time_stay_consistent(scenario, central_warehouse):
    rq, item, product = scenario
    first = deliver_request_items(
        rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('10')}])

    results = _run_in_threads([
        lambda: reverse_delivery(rq.pk, first.dispatch.pk, central_warehouse, reason='Motivo valido'),
        _deliver(rq, item, central_warehouse, '10'),
    ])

    net = net_dispatched_by_item([item.pk])[item.pk]
    assert net <= Decimal('10.000')
    assert _pool(product) == Decimal('100.000') - net            # the ledger always balances
    assert not [r for r in results if isinstance(r, Exception) and not isinstance(r, DeliveryError)], results
