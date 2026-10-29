"""
SYSPCC-030 · el Master no hace N+1: el número de consultas NO crece con la cantidad de ítems,
RQs ni entregas, ni en el listado (ruta de base de datos y ruta derivada), ni en el resumen, ni
en el Excel.
"""
import datetime

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.rq.tests.master_fixtures import (  # noqa: F401  (fixtures)
    client_for, make_approval, make_delivery, make_inventory, make_item, make_request, make_stock,
    make_user, lima, world,
)
from apps.core.enums import RoleChoices

URL = '/api/v1/request-master/'


def queries(user, path, **params):
    client = client_for(user)
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(path, params)
    assert response.status_code == 200, response.content
    return len(ctx), response


def grow(project, requester, n_requests, items_each, *, product):
    """`n_requests` RQs con `items_each` ítems vinculados y dos entregas cada uno."""
    clerk = make_user(f'perf_clerk_{n_requests}_{items_each}', RoleChoices.CENTRAL_WAREHOUSE)
    for r in range(n_requests):
        rq = make_request(number=f'RQ-2027-{n_requests:02d}{r:03d}', requester=requester,
                          project=project, status='DELIVERED')
        make_approval(rq, 'VALIDATED', at=lima(2026, 10, 1))
        make_approval(rq, 'GM_APPROVED', at=lima(2026, 10, 2))
        for line in range(1, items_each + 1):
            item = make_item(rq, line, quantity=10, inventory_item=product, confirmed=True)
            make_delivery(rq, item, 4, by=clerk, on=datetime.date(2026, 10, 5))
            make_delivery(rq, item, 6, guide='GR-PERF', by=clerk, on=datetime.date(2026, 10, 6))


@pytest.fixture
def product(db):
    p = make_inventory('PERF-0001', 'Producto de prueba', 'UND')
    make_stock(p, 1000)
    return p


@pytest.mark.parametrize('path, params', [
    (URL, {}),                                     # paginación en base de datos
    (URL, {'page_size': 100}),
    (URL, {'item_status': 'ATENDIDO'}),            # ruta derivada
    (URL, {'ordering': '-attended_date', 'with_alerts': 'true'}),
    (URL, {'search': 'GR-PERF'}),
    (URL + 'summary/', {}),
    (URL + 'export/', {}),
])
def test_query_count_does_not_grow_with_the_data(db, project, requester, logistics_coordinator,
                                                 product, path, params):
    grow(project, requester, 2, 2, product=product)
    small, _ = queries(logistics_coordinator, path, **params)
    grow(project, requester, 8, 6, product=product)           # 10 RQs · 52 ítems · 104 entregas
    large, response = queries(logistics_coordinator, path, **params)
    assert large == small, (path, params, small, large)
    assert large < 30, (path, params, large)
    if path == URL and 'page_size' not in params and not params:
        assert response.json()['count'] == 4 + 48


def test_a_full_page_of_a_hundred_rows_stays_in_a_handful_of_queries(
        db, project, requester, logistics_coordinator, product):
    grow(project, requester, 10, 10, product=product)         # 100 ítems, 200 entregas
    count, response = queries(logistics_coordinator, URL, page_size=100)
    assert len(response.json()['results']) == 100
    assert count <= 12, count


def test_requester_scope_also_stays_constant(db, project, requester, product):
    grow(project, requester, 2, 2, product=product)
    small, _ = queries(requester, URL)
    grow(project, requester, 6, 5, product=product)
    large, _ = queries(requester, URL)
    assert small == large


def test_the_export_classifies_each_item_at_most_twice(world, logistics_coordinator):
    """Una pasada para filtrar y otra por RQ completo; build_rows y el resumen reutilizan esos resultados."""
    from unittest import mock

    from apps.rq.services import request_master

    with mock.patch.object(request_master, 'classify_item', wraps=request_master.classify_item) as spy:
        response = client_for(logistics_coordinator).get(URL + 'export/')
    assert response.status_code == 200
    total_items = 6
    assert spy.call_count == 2 * total_items, spy.call_count
