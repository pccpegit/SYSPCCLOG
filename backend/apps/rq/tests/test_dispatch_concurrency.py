"""
SYSPCC-028: concurrencia REAL del despacho automático (hilos, dos conexiones).

Sigue el patrón de `apps/warehouse/tests/test_movements_concurrency.py`, pero aquí sí hace
falta una carrera real: en SQLite `select_for_update()` es un no-op, así que estos tests
solo corren en PostgreSQL (producción) y se omiten en el entorno de desarrollo.

  * dos RQs distintos despachando el MISMO producto a la vez: el stock nunca queda negativo
    y lo despachado más lo faltante suma lo pedido;
  * dos DISPATCHED simultáneos del MISMO RQ: uno gana, el otro recibe WorkflowError y el
    stock se descuenta una sola vez (el lock del Request en `execute()`).
"""
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections

from apps.core.enums import RoleChoices
from apps.core.exceptions import WorkflowError
from apps.rq.models import Request
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    make_inventory,
    make_item,
    make_request,
    make_stock,
)
from apps.warehouse.models import InventoryStock, WarehouseDispatchItem

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


def _dispatch(rq_id, user):
    rq = Request.objects.get(pk=rq_id)
    return WorkflowEngine(rq, user, RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')


def test_two_requests_dispatching_the_same_product_never_oversell(central_warehouse, project, requester):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 10)
    rqs = []
    for n in (1, 2):
        rq = make_request(number=f'RQ-CONC-{n}', requester=requester, project=project, status='IN_STOCK')
        make_item(rq, 1, quantity=7, inventory_item=product, confirmed=True)
        rqs.append(rq)

    results = _run_in_threads([lambda rq=rq: _dispatch(rq.pk, central_warehouse) for rq in rqs])

    assert not [r for r in results if isinstance(r, Exception)], results
    pool = InventoryStock.objects.get(inventory=product, project=None, department=None).quantity
    dispatched = sum(d.quantity_dispatched for d in WarehouseDispatchItem.objects.all())
    assert pool >= 0
    assert dispatched + pool == Decimal('10')            # nothing created out of thin air
    assert dispatched == Decimal('10')                   # the pool was fully used: 7 + 3


def test_two_simultaneous_dispatched_of_the_same_rq_discount_once(central_warehouse, project, requester):
    product = make_inventory('EPP-0001', 'Casco', 'UND')
    make_stock(product, 10)
    rq = make_request(number='RQ-CONC-3', requester=requester, project=project, status='IN_STOCK')
    make_item(rq, 1, quantity=4, inventory_item=product, confirmed=True)

    results = _run_in_threads([lambda: _dispatch(rq.pk, central_warehouse)] * 2)

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], WorkflowError), results
    assert InventoryStock.objects.get(inventory=product, project=None).quantity == Decimal('6')
