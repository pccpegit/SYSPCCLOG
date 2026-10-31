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
from apps.warehouse.models import (
    WarehouseDispatch,
    WarehouseDispatchItem,
    WarehouseReceipt,
    WarehouseReceiptItem,
)
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
    'product_unit', 'unit_mismatch', 'link_status', 'link_confirmed', 'available_central',
    'committed_other_requests', 'committed_earlier_lines', 'available_net', 'shortfall', 'coverage',
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


def _receive(rq, item, quantity, by):
    """The purchase of `item` entered the pool: the receipt row the engine writes at RECEIVED."""
    receipt = WarehouseReceipt.objects.create(request=rq, received_by=by)
    return WarehouseReceiptItem.objects.create(
        receipt=receipt, request_item=item, quantity_received=Decimal(str(quantity)),
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
            'items_total': 3, 'full': 1, 'partial': 1, 'none': 1, 'not_comparable': 0,
            'off_catalog': 0, 'unlinked': 0,
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
        short = make_inventory('EPP-0001', 'Cable', unit='KG')
        exact = make_inventory('EPP-0002', 'Alambre', unit='KG')
        make_stock(short, '2.500')
        make_stock(exact, '2.500')
        make_item(ops_rq, 1, quantity='2.501', inventory_item=short, unit='KG')
        make_item(ops_rq, 2, quantity='2.500', inventory_item=exact, unit='KG')

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

    def test_when_the_pool_covers_every_line_of_the_same_product_all_are_full(
        self, logistics_coordinator, ops_rq,
    ):
        product = make_inventory()
        make_stock(product, 20)
        make_item(ops_rq, 1, quantity=8, inventory_item=product)
        make_item(ops_rq, 2, quantity=8, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['coverage'] == rows[2]['coverage'] == 'FULL'
        assert rows[1]['available_net'] == '20.000'
        assert rows[2]['available_net'] == '12.000'
        assert rows[2]['committed_earlier_lines'] == '8.000'


@pytest.mark.django_db
class TestLinesOfTheSameProduct:
    """Lines are served in line_number order: a line only sees what the earlier ones left."""

    def test_second_line_of_the_same_product_is_partial_when_the_first_leaves_too_little(
        self, logistics_coordinator, ops_rq,
    ):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=8, inventory_item=product)
        make_item(ops_rq, 2, quantity=8, inventory_item=product)

        response = _get(logistics_coordinator, ops_rq)
        rows = _rows(response)

        assert rows[1]['coverage'] == 'FULL'
        assert rows[1]['committed_earlier_lines'] == '0.000'
        assert rows[2]['coverage'] == 'PARTIAL'
        assert rows[2]['available_central'] == '10.000'
        assert rows[2]['committed_earlier_lines'] == '8.000'
        assert rows[2]['available_net'] == '2.000'
        assert rows[2]['shortfall'] == '6.000'
        assert response.data['summary']['full'] == 1
        assert response.data['summary']['partial'] == 1

    def test_third_line_is_none_once_the_pool_is_used_up(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=8, inventory_item=product)
        make_item(ops_rq, 2, quantity=8, inventory_item=product)
        make_item(ops_rq, 3, quantity=1, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert [rows[n]['coverage'] for n in (1, 2, 3)] == ['FULL', 'PARTIAL', 'NONE']
        assert rows[3]['available_net'] == '0.000'
        assert rows[3]['committed_earlier_lines'] == '10.000'
        assert rows[3]['shortfall'] == '1.000'

    def test_an_earlier_partial_line_takes_everything_that_is_left(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 5)
        make_item(ops_rq, 1, quantity=9, inventory_item=product)
        make_item(ops_rq, 2, quantity=1, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['coverage'] == 'PARTIAL'
        assert rows[1]['available_net'] == '5.000'
        assert rows[2]['coverage'] == 'NONE'
        assert rows[2]['available_net'] == '0.000'

    def test_the_order_is_the_line_number_not_the_insertion_order(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 2, quantity=8, inventory_item=product)     # inserted first
        make_item(ops_rq, 1, quantity=8, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert (rows[1]['coverage'], rows[2]['coverage']) == ('FULL', 'PARTIAL')

    def test_different_products_do_not_share_what_they_take(self, logistics_coordinator, ops_rq):
        helmet = make_inventory('EPP-0001', 'Casco')
        gloves = make_inventory('EPP-0002', 'Guantes')
        make_stock(helmet, 5)
        make_stock(gloves, 5)
        make_item(ops_rq, 1, quantity=5, inventory_item=helmet)
        make_item(ops_rq, 2, quantity=5, inventory_item=gloves)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['coverage'] == rows[2]['coverage'] == 'FULL'
        assert rows[2]['committed_earlier_lines'] == '0.000'

    def test_unlinked_and_off_catalog_lines_take_nothing(self, logistics_coordinator, ops_rq):
        product = make_inventory()
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=9, description='Sin vincular')
        make_item(ops_rq, 2, quantity=9, description='Servicio', is_off_catalog=True)
        make_item(ops_rq, 3, quantity=9, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[3]['coverage'] == 'FULL'
        assert rows[3]['committed_earlier_lines'] == '0.000'

    def test_what_other_requests_hold_is_taken_before_the_lines_of_this_one(
        self, logistics_coordinator, ops_rq, other_requester_same_project, project,
    ):
        product = make_inventory()
        make_stock(product, 12)
        other = make_request(
            number='RQ-2026-0700', requester=other_requester_same_project,
            project=project, status='IN_STOCK',
        )
        make_item(other, 1, quantity=4, inventory_item=product)
        make_item(ops_rq, 1, quantity=5, inventory_item=product)
        make_item(ops_rq, 2, quantity=5, inventory_item=product)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['committed_other_requests'] == '4.000'
        assert rows[1]['available_net'] == '8.000'
        assert rows[1]['coverage'] == 'FULL'
        assert rows[2]['committed_other_requests'] == '4.000'
        assert rows[2]['committed_earlier_lines'] == '5.000'
        assert rows[2]['available_net'] == '3.000'
        assert rows[2]['coverage'] == 'PARTIAL'
        assert rows[2]['shortfall'] == '2.000'


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


@pytest.mark.django_db
class TestReceivedPurchasesAreCommitted:
    """
    Material bought for ANOTHER request that already entered the pool (RECEIVING,
    QUALITY_APPROVED, SUPPLIER_REPLACEMENT_RECEIVED) and has not been dispatched yet is
    promised to that request: it is subtracted from what this request can count on.
    """

    PENDING_STATES = ['RECEIVING', 'QUALITY_APPROVED', 'SUPPLIER_REPLACEMENT_RECEIVED']

    @pytest.fixture
    def product(self):
        product = make_inventory('EPP-0001', 'Casco de seguridad')
        make_stock(product, 20)
        return product

    def _purchase_rq(self, number, requester, project, state, product, quantity=8, *,
                     supply_source='PURCHASE', received=None, by=None):
        rq = make_request(number=number, requester=requester, project=project, status=state)
        item = make_item(rq, 1, quantity=quantity, inventory_item=product, supply_source=supply_source,
                         confirmed=True)
        if received is not None:
            _receive(rq, item, received, by)
        return rq, item

    @pytest.mark.parametrize('state', PENDING_STATES)
    def test_a_received_purchase_not_yet_dispatched_is_subtracted(
        self, state, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, state, product,
            quantity=8, received=8, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=15, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '8.000'
        assert row['available_net'] == '12.000'
        assert row['coverage'] == 'PARTIAL'
        assert row['shortfall'] == '3.000'

    def test_a_purchase_with_no_receipt_has_not_entered_the_pool_and_reserves_nothing(
        self, logistics_coordinator, ops_rq, other_requester_same_project, project, product,
    ):
        self._purchase_rq('RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '0.000'

    def test_only_the_remainder_after_a_dispatch_is_committed(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        rq, item = self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'QUALITY_APPROVED', product,
            quantity=8, received=8, by=central_warehouse,
        )
        _dispatch(rq, item, 3, central_warehouse)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '5.000'

    def test_a_fully_dispatched_purchase_commits_nothing(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        rq, item = self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'QUALITY_APPROVED', product,
            quantity=8, received=8, by=central_warehouse,
        )
        _dispatch(rq, item, 8, central_warehouse)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '0.000'

    def test_only_what_really_entered_the_pool_is_committed(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        """Asked 8, only 5 arrived: the other 3 are not in the pool, so they cannot be subtracted from it."""
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=8, received=5, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '5.000'

    def test_receiving_more_than_asked_commits_only_what_was_asked(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=8, received=12, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '8.000'

    def test_lines_served_from_stock_are_not_counted_as_purchases(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=8, supply_source='STOCK', received=8, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '0.000'

    @pytest.mark.parametrize('state', [
        'PO_GENERATED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'CLOSED', 'CANCELLED', 'IN_STOCK',
    ])
    def test_other_states_do_not_commit_a_received_purchase(
        self, state, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        """
        IN_STOCK has its own rule (owed quantity, receipts irrelevant); the rest either has not
        received yet, has already handed the material over, or is finished.
        """
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, state, product,
            quantity=8, received=8, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        expected = '8.000' if state == 'IN_STOCK' else '0.000'
        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == expected

    def test_the_request_itself_never_counts_against_itself(
        self, logistics_coordinator, central_warehouse, ops_rq, product,
    ):
        ops_rq.status = 'RECEIVING'
        ops_rq.save(update_fields=['status'])
        item = make_item(ops_rq, 1, quantity=8, inventory_item=product, supply_source='PURCHASE')
        _receive(ops_rq, item, 8, central_warehouse)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '0.000'
        assert row['available_net'] == '20.000'

    def test_a_line_with_several_receipts_and_dispatches_is_not_counted_twice(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        """Two receipt rows and two dispatch rows on one line must not multiply each other."""
        rq, item = self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=10, received=6, by=central_warehouse,
        )
        _receive(rq, item, 4, central_warehouse)
        _dispatch(rq, item, 1, central_warehouse)
        _dispatch(rq, item, 2, central_warehouse)
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        assert _rows(_get(logistics_coordinator, ops_rq))[1]['committed_other_requests'] == '7.000'

    def test_in_stock_requests_and_received_purchases_add_up(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        in_stock = make_request(
            number='RQ-2026-0901', requester=other_requester_same_project, project=project,
            status='IN_STOCK',
        )
        make_item(in_stock, 1, quantity=4, inventory_item=product)
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=6, received=6, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=1, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['committed_other_requests'] == '10.000'
        assert row['available_net'] == '10.000'

    def test_the_committed_figure_never_pushes_availability_below_zero(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, product,
    ):
        self._purchase_rq(
            'RQ-2026-0900', other_requester_same_project, project, 'RECEIVING', product,
            quantity=50, received=50, by=central_warehouse,
        )
        make_item(ops_rq, 1, quantity=5, inventory_item=product)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['available_net'] == '0.000'
        assert row['coverage'] == 'NONE'

    def test_it_does_not_cost_a_query_per_line(
        self, logistics_coordinator, central_warehouse, ops_rq, other_requester_same_project,
        project, django_assert_max_num_queries,
    ):
        for n in range(1, 13):
            product = make_inventory(f'EPP-{n:04d}', f'Producto {n}')
            make_stock(product, 50)
            make_item(ops_rq, n, quantity=5, inventory_item=product)
            self._purchase_rq(
                f'RQ-2026-09{n:02d}', other_requester_same_project, project, 'RECEIVING', product,
                quantity=3, received=3, by=central_warehouse,
            )

        with django_assert_max_num_queries(14):
            response = _get(logistics_coordinator, ops_rq)

        assert len(response.data['items']) == 12


@pytest.mark.django_db
class TestUnitMismatch:
    """Quantities are only compared in the same unit; otherwise the line is NOT_COMPARABLE."""

    def test_a_different_unit_is_not_comparable_and_has_no_shortfall(self, logistics_coordinator, ops_rq):
        cable = make_inventory('MAT-0001', 'Cable eléctrico', 'M')
        make_stock(cable, 100)
        make_item(ops_rq, 1, quantity=2, inventory_item=cable, unit='ROLLO')

        response = _get(logistics_coordinator, ops_rq)
        row = _rows(response)[1]

        assert row['unit_mismatch'] is True
        assert row['unit'] == 'ROLLO'
        assert row['product_unit'] == 'M'
        assert row['coverage'] == 'NOT_COMPARABLE'
        assert row['shortfall'] is None
        assert row['available_central'] == '100.000'
        assert response.data['summary']['not_comparable'] == 1
        assert (response.data['summary']['full'], response.data['summary']['partial'],
                response.data['summary']['none']) == (0, 0, 0)

    @pytest.mark.parametrize('line_unit,product_unit', [
        ('UND', 'EA'), ('EA', 'UND'), ('und.', 'UND'), ('Unidad', 'UND'), ('UNID', 'UND'),
        ('U', 'UND'), ('PZA', 'UND'), ('pieza', 'EA'), ('Pza.', 'Unidad'), ('  und ', 'UND'),
        ('KG', 'kg'), ('Kg.', 'KG'), ('M', 'm'),
    ])
    def test_equivalent_spellings_are_comparable(self, logistics_coordinator, ops_rq, line_unit, product_unit):
        product = make_inventory('EPP-0001', 'Casco', product_unit)
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=4, inventory_item=product, unit=line_unit)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['unit_mismatch'] is False
        assert row['coverage'] == 'FULL'

    @pytest.mark.parametrize('line_unit,product_unit', [
        ('KG', 'TN'), ('M', 'CM'), ('UND', 'PAR'), ('M2', 'M3'), ('GLN', 'L'), ('UND', 'CJA'),
    ])
    def test_different_units_are_never_converted(self, logistics_coordinator, ops_rq, line_unit, product_unit):
        product = make_inventory('EPP-0001', 'Producto', product_unit)
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=4, inventory_item=product, unit=line_unit)

        row = _rows(_get(logistics_coordinator, ops_rq))[1]

        assert row['unit_mismatch'] is True
        assert row['coverage'] == 'NOT_COMPARABLE'

    def test_a_mismatched_line_takes_nothing_from_the_next_line_of_the_same_product(
        self, logistics_coordinator, ops_rq,
    ):
        product = make_inventory('EPP-0001', 'Casco', 'UND')
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=9, inventory_item=product, unit='CJA')
        make_item(ops_rq, 2, quantity=9, inventory_item=product, unit='UND')

        rows = _rows(_get(logistics_coordinator, ops_rq))

        assert rows[1]['coverage'] == 'NOT_COMPARABLE'
        assert rows[2]['coverage'] == 'FULL'
        assert rows[2]['committed_earlier_lines'] == '0.000'
        assert rows[2]['available_net'] == '10.000'

    def test_unlinked_and_off_catalog_lines_report_no_unit_data(self, logistics_coordinator, ops_rq):
        make_item(ops_rq, 1, description='Sin vincular', unit='GLB')
        make_item(ops_rq, 2, description='Servicio', unit='GLB', is_off_catalog=True)

        rows = _rows(_get(logistics_coordinator, ops_rq))

        for line in (1, 2):
            assert rows[line]['unit_mismatch'] is False
            assert rows[line]['product_unit'] is None
            assert rows[line]['committed_earlier_lines'] is None

    def test_the_summary_adds_up_with_every_kind_of_line(self, logistics_coordinator, ops_rq):
        full = make_inventory('EPP-0001', 'Casco', 'UND')
        mismatch = make_inventory('MAT-0001', 'Cable', 'M')
        make_stock(full, 10)
        make_stock(mismatch, 10)
        make_item(ops_rq, 1, quantity=1, inventory_item=full)
        make_item(ops_rq, 2, quantity=1, inventory_item=mismatch, unit='ROLLO')
        make_item(ops_rq, 3, quantity=1, is_off_catalog=True)
        make_item(ops_rq, 4, quantity=1)

        summary = _get(logistics_coordinator, ops_rq).data['summary']

        assert summary == {
            'items_total': 4, 'full': 1, 'partial': 0, 'none': 0, 'not_comparable': 1,
            'off_catalog': 1, 'unlinked': 1,
        }
        assert sum(v for k, v in summary.items() if k != 'items_total') == summary['items_total']
