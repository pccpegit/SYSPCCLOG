"""
SYSPCC-041 · GET /api/v1/warehouse/pending-requests/deliverable/ (selector de la pantalla Salida).

Un RQ aparece solo si el usuario puede entregarlo hoy (rol de TRANSITIONS para DISPATCHED en su
estado y flujo, visibilidad) y si todavía tiene al menos un ítem PENDIENTE o PARCIAL del Master que
el almacén pueda entregar.
"""
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.enums import RoleChoices, RQFlowChoices
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
)
from apps.warehouse.services.rq_fulfillment import deliver_request_items

URL = '/api/v1/warehouse/pending-requests/deliverable/'
DELIVER = '/api/v1/warehouse/pending-requests/{}/deliver/'

ROW_KEYS = {
    'id', 'rq_number', 'flow', 'status', 'status_label', 'project', 'project_code', 'department',
    'requested_by', 'fecha_necesidad', 'priority', 'items_total', 'items_pending', 'items_partial',
    'items_deliverable', 'percent',
}

pytestmark = pytest.mark.django_db


@pytest.fixture
def logistics_coordinator(db, project):
    return make_user('logistics_coordinator', RoleChoices.LOGISTICS_COORDINATOR, project=project)


@pytest.fixture
def site_warehouse(db, project):
    return make_user('site_warehouse', RoleChoices.SITE_WAREHOUSE, project=project)


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
    make_stock(product, 1000)
    return product


@pytest.fixture
def gloves(db):
    product = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')
    make_stock(product, 1000)
    return product


_numbers = iter(range(1, 10_000))


def rq_with_item(requester, product, *, status='IN_STOCK', flow=RQFlowChoices.OPERATIONS, project=None,
                 department=None, quantity=10, number=None, **item_extra):
    rq = make_request(number=number or f'RQ-2026-{next(_numbers):04d}', requester=requester, flow=flow,
                      project=project, department=department, status=status)
    item = make_item(rq, 1, quantity=quantity, inventory_item=product, confirmed=True, **item_extra)
    return rq, item


def get(user, **params):
    return client_for(user).get(URL, params)


def numbers(response):
    assert response.status_code == 200, response.content
    return [row['rq_number'] for row in response.json()['results']]


# ═══════════════════════════ quién ve qué ═══════════════════════════

class TestRolesAndStates:
    def test_the_keeper_sees_in_stock_requests_of_both_flows_and_nothing_else(
        self, central_warehouse, requester, department_requester, project, department, helmet,
    ):
        ops, _ = rq_with_item(requester, helmet, project=project, number='RQ-2026-0001')
        adm, _ = rq_with_item(department_requester, helmet, flow=RQFlowChoices.ADMINISTRATIVE,
                              department=department, number='RQ-2026-0002')
        rq_with_item(requester, helmet, project=project, status='QUALITY_APPROVED', number='RQ-2026-0003')
        for index, status in enumerate(('VALIDATED', 'RECEIVING', 'DISPATCHED_TO_SITE', 'DELIVERED', 'CANCELLED')):
            rq_with_item(requester, helmet, project=project, status=status, number=f'RQ-2026-01{index:02d}')

        assert sorted(numbers(get(central_warehouse))) == ['RQ-2026-0001', 'RQ-2026-0002']

    def test_logistics_coordinator_sees_quality_approved_operations_only(
        self, logistics_coordinator, requester, department_requester, project, department, helmet,
    ):
        rq_with_item(requester, helmet, project=project, number='RQ-2026-0001')                      # IN_STOCK
        rq_with_item(requester, helmet, project=project, status='QUALITY_APPROVED', number='RQ-2026-0002')
        rq_with_item(department_requester, helmet, flow=RQFlowChoices.ADMINISTRATIVE, department=department,
                     status='QUALITY_APPROVED', number='RQ-2026-0003')

        assert numbers(get(logistics_coordinator)) == ['RQ-2026-0002']

    def test_logistics_supervisor_sees_quality_approved_administrative_only(
        self, logistics_supervisor, requester, department_requester, project, department, helmet,
    ):
        rq_with_item(requester, helmet, project=project, status='QUALITY_APPROVED', number='RQ-2026-0002')
        rq_with_item(department_requester, helmet, flow=RQFlowChoices.ADMINISTRATIVE, department=department,
                     status='QUALITY_APPROVED', number='RQ-2026-0003')

        assert numbers(get(logistics_supervisor)) == ['RQ-2026-0003']

    @pytest.mark.parametrize('fixture', ['logistics_chief', 'site_warehouse'])
    def test_roles_that_cannot_deliver_get_an_empty_list(
        self, request, fixture, requester, project, helmet,
    ):
        user = request.getfixturevalue(fixture)
        rq_with_item(requester, helmet, project=project)
        rq_with_item(requester, helmet, project=project, status='QUALITY_APPROVED')

        assert numbers(get(user)) == []

    def test_a_requester_and_an_anonymous_client_are_refused(self, requester, helmet, project):
        rq_with_item(requester, helmet, project=project)
        assert get(requester).status_code == 403
        from rest_framework.test import APIClient

        assert APIClient().get(URL).status_code in (401, 403)

    def test_a_superuser_without_a_warehouse_role_has_no_bypass(self, superuser, requester, helmet, project):
        rq_with_item(requester, helmet, project=project)
        assert get(superuser).status_code == 403

    def test_the_response_is_never_cached_and_is_paginated_in_the_standard_shape(
        self, central_warehouse, requester, helmet, project,
    ):
        rq_with_item(requester, helmet, project=project)
        response = get(central_warehouse)
        assert response['Cache-Control'] == 'no-store'
        body = response.json()
        assert set(body) == {'count', 'next', 'previous', 'results', 'truncated'} and body['count'] == 1
        assert body['truncated'] is False


# ═══════════════════════ qué cuenta como «pendiente» ═══════════════════════

class TestPendingRule:
    def test_the_row_has_the_contract_fields(self, central_warehouse, requester, helmet, project):
        rq, _ = rq_with_item(requester, helmet, project=project, number='RQ-2026-0031')

        row = get(central_warehouse).json()['results'][0]

        assert set(row) == ROW_KEYS
        assert (row['id'], row['rq_number'], row['flow'], row['status']) == (
            rq.pk, 'RQ-2026-0031', 'OPERATIONS', 'IN_STOCK')
        assert row['status_label'] == 'Stock disponible — pendiente despacho'
        assert (row['project'], row['project_code'], row['department']) == (project.name, project.code, None)
        assert row['requested_by'] == requester.get_full_name() and row['priority'] == rq.priority
        assert row['fecha_necesidad'] == rq.fecha_necesidad.isoformat()
        assert (row['items_total'], row['items_pending'], row['items_partial'], row['items_deliverable']) == (
            1, 1, 0, 1)
        assert row['percent'] == 0.0

    def test_a_partially_delivered_request_stays_and_shows_partial(
        self, central_warehouse, requester, helmet, project,
    ):
        rq, item = rq_with_item(requester, helmet, project=project, quantity=10)
        deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('4')}])

        row = get(central_warehouse).json()['results'][0]

        assert (row['items_pending'], row['items_partial'], row['items_deliverable']) == (0, 1, 1)
        assert row['percent'] == 40.0

    def test_a_fully_delivered_request_leaves_the_list(self, central_warehouse, requester, helmet, project):
        rq, item = rq_with_item(requester, helmet, project=project, quantity=10)
        deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('10')}])

        assert numbers(get(central_warehouse)) == []

    def test_a_reversal_brings_the_request_back(self, central_warehouse, requester, helmet, project):
        from apps.warehouse.services.rq_fulfillment import reverse_delivery

        rq, item = rq_with_item(requester, helmet, project=project, quantity=10)
        done = deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('10')}])
        reverse_delivery(rq.pk, done.dispatch.pk, central_warehouse, reason='Entrega mal digitada')

        assert numbers(get(central_warehouse)) == [rq.rq_number]

    @pytest.mark.parametrize('override', ['STAND_BY', 'DESESTIMADO'])
    def test_stand_by_and_discarded_items_do_not_count(self, central_warehouse, requester, helmet, project, override):
        rq_with_item(requester, helmet, project=project, attention_override=override, attention_note='Motivo')
        assert numbers(get(central_warehouse)) == []

    def test_a_request_with_only_off_catalog_or_unlinked_items_is_not_listed(
        self, central_warehouse, requester, helmet, project,
    ):
        off = make_request(number='RQ-2026-0040', requester=requester, project=project, status='IN_STOCK')
        make_item(off, 1, is_off_catalog=True)
        proposed = make_request(number='RQ-2026-0041', requester=requester, project=project, status='IN_STOCK')
        make_item(proposed, 1, inventory_item=helmet)                       # linked but never confirmed
        unlinked = make_request(number='RQ-2026-0042', requester=requester, project=project, status='IN_STOCK')
        make_item(unlinked, 1)

        assert numbers(get(central_warehouse)) == []

    def test_only_the_deliverable_items_are_counted_but_the_percent_is_the_whole_request(
        self, central_warehouse, requester, helmet, gloves, project,
    ):
        rq, item = rq_with_item(requester, helmet, project=project, quantity=10, number='RQ-2026-0050')
        make_item(rq, 2, description='Guantes', quantity=4, inventory_item=gloves, confirmed=True)
        make_item(rq, 3, description='Servicio', is_off_catalog=True)
        deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('10')}])

        row = get(central_warehouse).json()['results'][0]

        assert row['items_total'] == 3
        assert (row['items_pending'], row['items_partial'], row['items_deliverable']) == (1, 0, 1)
        assert row['percent'] == 33.3            # (1.0 + 0 + 0) / 3: the off-catalog line counts for the whole RQ


# ═══════════════════════ búsqueda, filtros y paginación ═══════════════════════

class TestSearchFiltersAndPaging:
    def test_search_by_rq_number_project_and_requester(
        self, central_warehouse, requester, department_requester, helmet, project, department,
    ):
        rq_with_item(requester, helmet, project=project, number='RQ-2026-0111')
        rq_with_item(department_requester, helmet, flow=RQFlowChoices.ADMINISTRATIVE, department=department,
                     number='RQ-2026-0222')

        assert numbers(get(central_warehouse, search='0111')) == ['RQ-2026-0111']
        assert numbers(get(central_warehouse, search=project.name)) == ['RQ-2026-0111']
        assert numbers(get(central_warehouse, search=project.code.lower())) == ['RQ-2026-0111']
        assert numbers(get(central_warehouse, search=department.name)) == ['RQ-2026-0222']
        assert numbers(get(central_warehouse, search=requester.last_name)) == ['RQ-2026-0111']
        assert numbers(get(central_warehouse, search='no-existe')) == []

    def test_flow_filter_and_invalid_flow(self, central_warehouse, requester, department_requester, helmet, project,
                                          department):
        rq_with_item(requester, helmet, project=project, number='RQ-2026-0111')
        rq_with_item(department_requester, helmet, flow=RQFlowChoices.ADMINISTRATIVE, department=department,
                     number='RQ-2026-0222')

        assert numbers(get(central_warehouse, flow='ADMINISTRATIVE')) == ['RQ-2026-0222']
        assert get(central_warehouse, flow='OTRO').status_code == 400

    def test_pagination(self, central_warehouse, requester, helmet, project):
        for n in range(5):
            rq_with_item(requester, helmet, project=project, number=f'RQ-2026-{n + 1:04d}')

        first = get(central_warehouse, page_size=2).json()
        third = get(central_warehouse, page_size=2, page=3).json()

        assert first['count'] == 5 and len(first['results']) == 2 and first['next'] and not first['previous']
        assert len(third['results']) == 1 and third['next'] is None
        assert len({r['id'] for r in first['results']} | {r['id'] for r in third['results']}) == 3

    def test_the_order_is_by_need_date_then_newest(self, central_warehouse, requester, helmet, project):
        import datetime

        late, _ = rq_with_item(requester, helmet, project=project, number='RQ-2026-0001')
        soon, _ = rq_with_item(requester, helmet, project=project, number='RQ-2026-0002')
        undated, _ = rq_with_item(requester, helmet, project=project, number='RQ-2026-0003')
        today = datetime.date.today()
        type(late).objects.filter(pk=late.pk).update(fecha_necesidad=today + datetime.timedelta(days=9))
        type(soon).objects.filter(pk=soon.pk).update(fecha_necesidad=today + datetime.timedelta(days=1))
        type(undated).objects.filter(pk=undated.pk).update(fecha_necesidad=None)

        assert numbers(get(central_warehouse)) == ['RQ-2026-0002', 'RQ-2026-0001', 'RQ-2026-0003']

    def test_a_null_byte_in_a_query_parameter_is_a_400(self, central_warehouse):
        assert get(central_warehouse, search='a\x00b').status_code == 400


# ═══════════════════════ rendimiento ═══════════════════════

class TestQueryCountIsConstant:
    def _count(self, user):
        with CaptureQueriesContext(connection) as queries:
            response = get(user, page_size=100)
        assert response.status_code == 200
        return len(queries), response.json()['count']

    def test_one_request_or_thirty_cost_the_same_number_of_queries(
        self, central_warehouse, requester, helmet, gloves, project,
    ):
        rq_with_item(requester, helmet, project=project)
        one_query_count, one = self._count(central_warehouse)

        for _ in range(29):
            rq, _item = rq_with_item(requester, helmet, project=project)
            make_item(rq, 2, description='Guantes', quantity=3, inventory_item=gloves, confirmed=True)
        many_query_count, many = self._count(central_warehouse)

        assert (one, many) == (1, 30)
        assert many_query_count == one_query_count, (one_query_count, many_query_count)

    def test_the_absolute_budget(self, central_warehouse, requester, helmet, project, django_assert_max_num_queries):
        for _ in range(10):
            rq_with_item(requester, helmet, project=project)
        with django_assert_max_num_queries(15):
            assert get(central_warehouse).status_code == 200


# ═══════════════ un RQ listado se puede entregar de verdad ═══════════════

def test_a_listed_request_can_be_delivered_through_the_deliver_endpoint(
    central_warehouse, requester, helmet, project,
):
    rq, item = rq_with_item(requester, helmet, project=project, quantity=10)
    client = client_for(central_warehouse)
    assert [row['id'] for row in client.get(URL).json()['results']] == [rq.pk]

    response = client.post(DELIVER.format(rq.pk), {'lines': [{'request_item_id': item.pk, 'quantity': '10'}]},
                           format='json')

    assert response.status_code == 201, response.content
    delivery = response.json()['delivery']
    assert delivery['dispatch_guide_number'].startswith('GR-') and delivery['movement_group_id']
    assert delivery['first_movement_id']
    assert client.get(URL).json()['results'] == []
