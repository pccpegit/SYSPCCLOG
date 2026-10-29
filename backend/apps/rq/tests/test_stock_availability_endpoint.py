"""
SYSPCC-026 (Fase 1): GET /api/v1/requests/{id}/stock-availability/

Per line: requested quantity, linked catalog product, CENTRAL-pool availability
(minus what is still owed to OTHER requests already in IN_STOCK) and whether it
covers the line fully, partially or not at all. Advisory only and restricted to the
logistics roles: the figures carry demand aggregated across projects (what is
promised to other RQs). The permission is checked before the RQ lookup, so nobody
else learns whether an id exists. The product is resolved ONLY through the FK,
never by text; `link_confirmed` says whether logistics already confirmed it.
"""
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import WarehouseOriginChoices
from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    central_warehouse,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
    ops_rq,
)

ROW_KEYS = {
    'item_id', 'line_number', 'description', 'unit', 'requested', 'inventory_item',
    'link_status', 'link_confirmed', 'available_central', 'committed_other_requests',
    'available_net', 'shortfall', 'coverage',
}


def _url(rq):
    return f'/api/v1/requests/{rq.pk}/stock-availability/'


def _get(user, rq):
    return client_for(user).get(_url(rq))


def _rows(response):
    return {row['line_number']: row for row in response.data['items']}


def _dispatch(rq, item, quantity, by):
    dispatch = WarehouseDispatch.objects.create(
        request=rq, dispatched_by=by, origin=WarehouseOriginChoices.CENTRAL,
    )
    return WarehouseDispatchItem.objects.create(
        dispatch=dispatch, request_item=item, quantity_dispatched=Decimal(str(quantity)),
    )


NON_LOGISTICS = [
    'requester', 'project_resident', 'project_control', 'site_warehouse', 'general_manager',
    'central_warehouse', 'direct_supervisor', 'department_requester',
]


@pytest.mark.django_db
class TestStockAvailabilityAccess:
    def test_anonymous_gets_401(self, api_client, ops_rq):
        assert api_client.get(_url(ops_rq)).status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.parametrize('fixture_name', ['logistics_coordinator', 'logistics_supervisor', 'logistics_chief'])
    def test_each_logistics_role_can_read_it_on_both_flows(self, request, fixture_name, ops_rq, adm_rq):
        user = request.getfixturevalue(fixture_name)

        assert _get(user, ops_rq).status_code == status.HTTP_200_OK
        assert _get(user, adm_rq).status_code == status.HTTP_200_OK

    @pytest.mark.parametrize('fixture_name', ['logistics_coordinator', 'logistics_supervisor', 'logistics_chief'])
    def test_logistics_sees_every_project_not_only_its_own(self, request, fixture_name, foreign_request):
        user = request.getfixturevalue(fixture_name)

        assert _get(user, foreign_request).status_code == status.HTTP_200_OK

    @pytest.mark.parametrize('fixture_name', NON_LOGISTICS)
    def test_every_other_role_gets_403_even_on_its_own_request(self, request, fixture_name, ops_rq, adm_rq):
        user = request.getfixturevalue(fixture_name)

        assert _get(user, ops_rq).status_code == status.HTTP_403_FORBIDDEN
        assert _get(user, adm_rq).status_code == status.HTTP_403_FORBIDDEN

    def test_the_owner_requester_is_refused_too(self, requester, ops_rq):
        """The screen that consumes this is the logistics stock check; the owner has no use for it."""
        assert _get(requester, ops_rq).status_code == status.HTTP_403_FORBIDDEN

    def test_user_without_roles_gets_403(self, user, ops_rq):
        assert _get(user, ops_rq).status_code == status.HTTP_403_FORBIDDEN

    def test_permission_is_checked_before_the_lookup_so_there_is_no_existence_oracle(
        self, requester, ops_rq, foreign_request,
    ):
        """Existing-and-mine, existing-and-foreign and non-existent all look the same to a non-logistics user."""
        mine = _get(requester, ops_rq)
        foreign = _get(requester, foreign_request)
        missing = client_for(requester).get('/api/v1/requests/999999/stock-availability/')

        assert mine.status_code == foreign.status_code == missing.status_code == status.HTTP_403_FORBIDDEN
        assert mine.data == foreign.data == missing.data

    def test_nonexistent_request_gets_404_for_logistics(self, logistics_coordinator):
        response = client_for(logistics_coordinator).get('/api/v1/requests/999999/stock-availability/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_a_requester_never_receives_the_demand_of_other_projects(
        self, requester, logistics_coordinator, ops_rq, foreign_request, central_warehouse,
    ):
        """
        The leak that motivated the restriction: a requester proposes a product on their own
        RQ and reads how much OTHER projects have promised of it.
        """
        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco')
        make_stock(helmet, 5000)
        make_item(foreign_request, 1, quantity=3000, inventory_item=helmet)
        foreign_request.status = 'IN_STOCK'
        foreign_request.save(update_fields=['status'])
        make_item(ops_rq, 1, quantity=10, inventory_item=helmet)

        refused = _get(requester, ops_rq)
        allowed = _get(logistics_coordinator, ops_rq)

        assert refused.status_code == status.HTTP_403_FORBIDDEN
        body = refused.content.decode()
        for forbidden in ('committed_other_requests', 'available_net', 'available_central', '3000', '2000'):
            assert forbidden not in body
        assert allowed.status_code == status.HTTP_200_OK
        assert _rows(allowed)[1]['committed_other_requests'] == '3000.000'

    @pytest.mark.parametrize('method', ['post', 'put', 'patch', 'delete'])
    def test_endpoint_is_read_only(self, logistics_coordinator, ops_rq, method):
        response = getattr(client_for(logistics_coordinator), method)(_url(ops_rq), {}, format='json')

        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.django_db
class TestCoverage:
    def test_full_partial_and_none(self, logistics_coordinator, ops_rq):
        plenty = make_inventory('EPP-0001', 'Casco')
        some = make_inventory('EPP-0002', 'Guante')
        empty = make_inventory('EPP-0003', 'Botas')
        make_stock(plenty, 100)
        make_stock(some, 20)
        make_stock(empty, 0)
        make_item(ops_rq, 1, quantity=10, inventory_item=plenty)
        make_item(ops_rq, 2, quantity=30, inventory_item=some)
        make_item(ops_rq, 3, quantity=5, inventory_item=empty)

        response = _get(logistics_coordinator, ops_rq)
        rows = _rows(response)

        assert rows[1]['coverage'] == 'FULL'
        assert rows[1]['available_central'] == '100.000'
        assert rows[1]['shortfall'] == '0.000'
        assert rows[2]['coverage'] == 'PARTIAL'
        assert rows[2]['available_net'] == '20.000'
        assert rows[2]['shortfall'] == '10.000'
        assert rows[3]['coverage'] == 'NONE'
        assert rows[3]['shortfall'] == '5.000'
        assert response.data['summary'] == {
            'items_total': 3, 'full': 1, 'partial': 1, 'none': 1, 'off_catalog': 0, 'unlinked': 0,
        }

    def test_exactly_enough_stock_is_full(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=10, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['coverage'] == 'FULL'

    def test_product_without_any_stock_row_is_none_with_zero_available(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_item(ops_rq, 1, quantity=4, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['coverage'] == 'NONE'
        assert row['available_central'] == '0.000'
        assert row['available_net'] == '0.000'

    def test_decimal_quantities_are_compared_exactly(self, logistics_coordinator, ops_rq):
        product = make_inventory(unit='KG')
        make_stock(product, '2.500')
        make_item(ops_rq, 1, quantity='2.501', inventory_item=product, unit='KG')
        make_item(ops_rq, 2, quantity='2.500', inventory_item=product, unit='KG')

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['coverage'] == 'PARTIAL'
        assert rows[1]['shortfall'] == '0.001'
        assert rows[2]['coverage'] == 'FULL'

    def test_each_line_reports_the_product_it_is_linked_to(self, logistics_coordinator, ops_rq):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
        make_item(ops_rq, 1, description='lo que escribió el solicitante', inventory_item=helmet)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['inventory_item'] == {
            'id': helmet.pk, 'product_code': 'EPP-0001',
            'description': 'Casco de seguridad blanco', 'unit': 'UND',
        }
        assert row['link_status'] == 'LINKED'
        assert row['description'] == 'lo que escribió el solicitante'

    def test_works_for_the_administrative_flow(self, logistics_supervisor, adm_rq):
        paper = make_inventory('UTL-0001', 'Papel bond A4', 'MLL', category='Otros')
        make_stock(paper, 3)
        make_item(adm_rq, 1, quantity=5, inventory_item=paper, unit='MLL')

        row = _rows(_get(logistics_supervisor, adm_rq))[1]

        assert row['coverage'] == 'PARTIAL'
        assert row['available_net'] == '3.000'


@pytest.mark.django_db
class TestLinkStatus:
    def test_unlinked_and_off_catalog_lines_have_no_stock_figures(self, logistics_coordinator, ops_rq):
        make_item(ops_rq, 1, description='Sin vincular')
        make_item(ops_rq, 2, description='Servicio de flete', is_off_catalog=True)

        response = _get(logistics_coordinator, ops_rq)
        rows = _rows(response)

        assert rows[1]['link_status'] == 'UNLINKED'
        assert rows[2]['link_status'] == 'OFF_CATALOG'
        for row in (rows[1], rows[2]):
            assert row['coverage'] is None
            assert row['inventory_item'] is None
            assert row['available_central'] is None
            assert row['available_net'] is None
            assert row['shortfall'] is None
        assert response.data['summary']['unlinked'] == 1
        assert response.data['summary']['off_catalog'] == 1

    def test_a_matching_description_does_not_link_by_text(self, logistics_coordinator, ops_rq):
        """The product is the confirmed FK only: an identical description proves nothing."""
        helmet = make_inventory('EPP-0001', 'Casco de seguridad')
        make_stock(helmet, 500)
        make_item(ops_rq, 1, description='Casco de seguridad', quantity=1)
        make_item(ops_rq, 2, description='EPP-0001', quantity=1)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['link_status'] == 'UNLINKED'
        assert rows[2]['link_status'] == 'UNLINKED'
        assert rows[1]['coverage'] is None

    def test_request_without_lines(self, logistics_coordinator, ops_rq):
        response = _get(logistics_coordinator, ops_rq)

        assert response.data['items'] == []
        assert response.data['summary']['items_total'] == 0


@pytest.mark.django_db
class TestPoolSemantics:
    def test_only_the_central_pool_counts(self, logistics_coordinator, ops_rq, project, department):
        product = make_inventory()
        make_stock(product, 6)                                                  # the pool
        make_stock(product, 100, project=project)                               # earmarked for a project
        make_stock(product, 50, department=department)                         # earmarked for a department
        make_stock(product, 30, warehouse_type=WarehouseOriginChoices.SITE)
        make_stock(product, 20, warehouse_type=WarehouseOriginChoices.OFFICE)
        make_item(ops_rq, 1, quantity=10, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['available_central'] == '6.000'
        assert row['coverage'] == 'PARTIAL'

    def test_same_product_on_two_lines_reports_the_same_availability_on_each(
        self, logistics_coordinator, ops_rq,
    ):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=8, inventory_item=product)
        make_item(ops_rq, 2, quantity=8, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['available_net'] == rows[2]['available_net'] == '10.000'


@pytest.mark.django_db
class TestNetAvailability:
    """available_net = pool minus what is still owed to OTHER requests in IN_STOCK."""

    @pytest.fixture
    def product(self):
        product = make_inventory('EPP-0001', 'Casco de seguridad')
        make_stock(product, 20)
        return product

    @pytest.fixture
    def other_rq(self, other_requester_same_project, project):
        return make_request(
            number='RQ-2026-0700', requester=other_requester_same_project,
            project=project, status='IN_STOCK',
        )

    def test_quantity_owed_to_another_in_stock_request_is_subtracted(
        self, logistics_coordinator, ops_rq, other_rq, product,
    ):
        make_item(other_rq, 1, quantity=8, inventory_item=product)
        make_item(ops_rq, 1, quantity=15, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['available_central'] == '20.000'
        assert row['committed_other_requests'] == '8.000'
        assert row['available_net'] == '12.000'
        assert row['coverage'] == 'PARTIAL'
        assert row['shortfall'] == '3.000'

    def test_only_the_remainder_after_dispatches_is_owed(
        self, logistics_coordinator, central_warehouse, ops_rq, other_rq, product,
    ):
        other_item = make_item(other_rq, 1, quantity=8, inventory_item=product)
        _dispatch(other_rq, other_item, 3, central_warehouse)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '5.000'
        assert row['available_net'] == '15.000'

    def test_a_fully_dispatched_or_over_dispatched_line_owes_nothing(
        self, logistics_coordinator, central_warehouse, ops_rq, other_rq, product,
    ):
        other_item = make_item(other_rq, 1, quantity=8, inventory_item=product)
        _dispatch(other_rq, other_item, 10, central_warehouse)   # more than requested
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '0.000'
        assert row['available_net'] == '20.000'

    def test_requests_in_other_states_do_not_reserve_stock(
        self, logistics_coordinator, ops_rq, other_requester_same_project, project, product,
    ):
        for n, state in enumerate(['VALIDATED', 'REQUIRES_PURCHASE', 'DISPATCHED_TO_SITE', 'CLOSED', 'CANCELLED']):
            rq = make_request(
                number=f'RQ-2026-08{n:02d}', requester=other_requester_same_project,
                project=project, status=state,
            )
            make_item(rq, 1, quantity=9, inventory_item=product)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '0.000'

    def test_the_request_itself_never_counts_against_itself(self, logistics_coordinator, ops_rq, product):
        ops_rq.status = 'IN_STOCK'
        ops_rq.save(update_fields=['status'])
        make_item(ops_rq, 1, quantity=18, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '0.000'
        assert row['available_net'] == '20.000'
        assert row['coverage'] == 'FULL'

    def test_other_products_are_not_subtracted(self, logistics_coordinator, ops_rq, other_rq, product):
        gloves = make_inventory('EPP-0002', 'Guantes')
        make_item(other_rq, 1, quantity=19, inventory_item=gloves)
        make_item(ops_rq, 1, quantity=5, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '0.000'

    def test_unlinked_lines_of_other_requests_reserve_nothing(
        self, logistics_coordinator, ops_rq, other_rq, product,
    ):
        make_item(other_rq, 1, description='Casco de seguridad', quantity=19)
        make_item(ops_rq, 1, quantity=5, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '0.000'

    def test_net_availability_never_goes_negative(
        self, logistics_coordinator, ops_rq, other_rq, product,
    ):
        make_item(other_rq, 1, quantity=50, inventory_item=product)    # owes more than the pool holds
        make_item(ops_rq, 1, quantity=5, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['available_net'] == '0.000'
        assert row['coverage'] == 'NONE'
        assert row['shortfall'] == '5.000'

    def test_several_owing_requests_add_up(
        self, logistics_coordinator, ops_rq, other_rq, other_requester_same_project, project, product,
    ):
        third = make_request(
            number='RQ-2026-0701', requester=other_requester_same_project,
            project=project, status='IN_STOCK',
        )
        make_item(other_rq, 1, quantity=4, inventory_item=product)
        make_item(third, 1, quantity=6, inventory_item=product)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '10.000'


@pytest.mark.django_db
class TestResponseShape:
    def test_row_has_exactly_the_documented_keys_and_no_sensitive_data(self, logistics_coordinator, ops_rq):
        product = make_inventory(
            'EPP-0001', 'Casco', location='B3-2 pasillo secreto', brand='MarcaX', min_stock=9,
        )
        make_stock(product, 5)
        make_item(ops_rq, 1, inventory_item=product, unit_price=Decimal('99.90'))

        response = _get(logistics_coordinator, ops_rq)

        assert set(response.data['items'][0]) == ROW_KEYS
        body = response.content.decode()
        for forbidden in ('pasillo secreto', 'B3-2', 'MarcaX', 'unit_price', '99.90', 'location'):
            assert forbidden not in body, forbidden

    def test_header_identifies_the_request(self, logistics_coordinator, ops_rq):
        response = _get(logistics_coordinator, ops_rq)

        assert response.data['request_id'] == ops_rq.pk
        assert response.data['rq_number'] == ops_rq.rq_number

    def test_does_not_run_a_query_per_line(self, logistics_coordinator, ops_rq, django_assert_max_num_queries):
        for n in range(1, 13):
            product = make_inventory(f'EPP-{n:04d}', f'Producto {n}')
            make_stock(product, n)
            make_item(ops_rq, n, quantity=5, inventory_item=product)

        with django_assert_max_num_queries(14):
            response = _get(logistics_coordinator, ops_rq)

        assert len(response.data['items']) == 12

    def test_reading_it_changes_nothing(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 5)
        item = make_item(ops_rq, 1, inventory_item=product)
        before = (ops_rq.status, ops_rq.updated_at, item.supply_source, item.inventory_item_id)

        _get(logistics_coordinator, ops_rq)

        ops_rq.refresh_from_db()
        item.refresh_from_db()
        assert (ops_rq.status, ops_rq.updated_at, item.supply_source, item.inventory_item_id) == before
