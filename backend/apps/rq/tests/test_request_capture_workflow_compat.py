"""
SYSPCC-026 (Fase 1, QA ronda 1): the new capture fields must never get in the way of
the management-defined workflow, nor of the RQs that were created before them.

Two guarantees, proven through the REAL engine over HTTP (POST /requests/{id}/action/):

  1. Historical compatibility. An RQ with no `requesting_area`, lines with no
     `item_source` and no catalog link (everything created before SYSPCC-026, plus the
     seeds) still serializes and still walks the workflow of BOTH flows.
  2. Nothing new blocks a transition. The stock check is advisory: whatever the
     availability says (full, partial, none, unlinked, off-catalog) logistics can
     still send STOCK_CHECKED with either decision, and the engine answers exactly as
     before. The availability endpoint and update-items never move a status.

The workflow itself is frozen by test_workflow_snapshot.py; these tests only
exercise it through the new data.
"""
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import BudgetClassificationChoices, RoleChoices
from apps.rq.models import Approval, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    client_for,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
    ops_rq,
)
from apps.warehouse.models import InventoryStock


def _act(user, rq, action, acting_role, **extra_data):
    body = {'action': action, 'acting_role': acting_role, 'comments': 'Prueba de compatibilidad.'}
    if extra_data:
        body['extra_data'] = extra_data
    return client_for(user).post(f'/api/v1/requests/{rq.pk}/action/', body, format='json')


def _status(rq):
    rq.refresh_from_db()
    return rq.status


def _availability(user, rq):
    response = client_for(user).get(f'/api/v1/requests/{rq.pk}/stock-availability/')
    assert response.status_code == status.HTTP_200_OK
    return response.data


def _figures(row):
    """(committed, net, shortfall, coverage) of an availability row; the API sends decimals as strings."""
    return (
        Decimal(row['committed_other_requests']), Decimal(row['available_net']),
        Decimal(row['shortfall']), row['coverage'],
    )


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')


@pytest.fixture
def adm_budget_manager(db, department):
    """ADMIN_MANAGER of the RQ's department (the conftest `admin_manager` has no department, so it sees no RQ)."""
    return make_user('adm_budget_manager', RoleChoices.ADMIN_MANAGER, department=department)


def _historical_lines(rq):
    """The shape of every line created before SYSPCC-026: no source, no link, not off-catalog."""
    return [
        make_item(rq, 1, description='Cemento Portland', quantity=10, unit='BLS'),
        make_item(rq, 2, description='Servicio de flete', quantity=1, unit='GLB'),
    ]


# ──────────────────── 1. historical RQs: reading ────────────────────

@pytest.mark.django_db
class TestHistoricalRequestsAreStillReadable:
    def test_operations_detail_has_blank_area_and_unlinked_lines(self, requester, ops_rq):
        _historical_lines(ops_rq)

        response = client_for(requester).get(f'/api/v1/requests/{ops_rq.pk}/')

        assert response.status_code == status.HTTP_200_OK
        assert (response.data['requesting_area'], response.data['requesting_area_display']) == ('', '')
        assert len(response.data['items']) == 2
        for line in response.data['items']:
            assert line['inventory_item'] is None
            assert line['inventory_item_code'] is None
            assert line['inventory_item_description'] is None
            assert line['inventory_item_unit'] is None
            assert line['is_off_catalog'] is False
            assert (line['item_source'], line['item_source_display']) == ('', '')
            assert line['supply_source'] == ''

    def test_administrative_detail_has_blank_area_and_unlinked_lines(self, department_requester, adm_rq):
        _historical_lines(adm_rq)

        response = client_for(department_requester).get(f'/api/v1/requests/{adm_rq.pk}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['requesting_area'] == ''
        assert {line['item_source'] for line in response.data['items']} == {''}

    def test_the_list_mixes_historical_and_new_requests(self, requester, project, ops_rq):
        _historical_lines(ops_rq)
        recent = make_request(number='RQ-2026-0510', requester=requester, project=project)
        recent.requesting_area = 'HSE'
        recent.save(update_fields=['requesting_area'])

        response = client_for(requester).get('/api/v1/requests/')

        assert response.status_code == status.HTTP_200_OK
        areas = {row['rq_number']: (row['requesting_area'], row['requesting_area_display'])
                 for row in response.data['results']}
        assert areas == {
            'RQ-2026-0501': ('', ''),
            'RQ-2026-0510': ('HSE', 'Seguridad y Salud (HSE)'),
        }

    def test_the_list_does_not_filter_out_requests_without_area(self, requester, ops_rq):
        """`requesting_area` is not a hidden condition of visibility: the blank ones are listed."""
        response = client_for(requester).get('/api/v1/requests/')

        assert [row['rq_number'] for row in response.data['results']] == ['RQ-2026-0501']

    def test_availability_of_a_historical_request_reports_every_line_as_unlinked(self, logistics_coordinator, ops_rq):
        _historical_lines(ops_rq)

        data = _availability(logistics_coordinator, ops_rq)

        assert data['summary'] == {
            'items_total': 2, 'full': 0, 'partial': 0, 'none': 0, 'not_comparable': 0,
            'off_catalog': 0, 'unlinked': 2,
        }
        for row in data['items']:
            assert row['link_status'] == 'UNLINKED'
            assert row['coverage'] is None
            assert row['available_net'] is None
            assert row['shortfall'] is None

    def test_the_legacy_supply_source_only_payload_still_works_on_a_historical_line(
        self, logistics_coordinator, ops_rq,
    ):
        """An old client (cached bundle) sends just {item_id, supply_source}: it must keep working."""
        line, _ = _historical_lines(ops_rq)
        ops_rq.status = 'VALIDATED'  # the stock check window, where update-items is allowed
        ops_rq.save(update_fields=['status'])

        response = client_for(logistics_coordinator).patch(
            f'/api/v1/requests/{ops_rq.pk}/update-items/',
            {'items': [{'item_id': line.pk, 'supply_source': 'PURCHASE'}]}, format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['updated_item_ids'] == [line.pk]
        saved = response.data['items'][0]
        assert saved['supply_source'] == 'PURCHASE'
        assert (saved['item_source'], saved['inventory_item'], saved['is_off_catalog']) == ('', None, False)

    def test_a_historical_line_can_be_completed_later_by_logistics(self, logistics_coordinator, ops_rq, helmet):
        line, _ = _historical_lines(ops_rq)
        ops_rq.status = 'VALIDATED'  # the stock check window, where update-items is allowed
        ops_rq.save(update_fields=['status'])

        response = client_for(logistics_coordinator).patch(
            f'/api/v1/requests/{ops_rq.pk}/update-items/',
            {'items': [{'item_id': line.pk, 'inventory_item': helmet.pk, 'item_source': 'EPP'}]}, format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        line.refresh_from_db()
        assert (line.inventory_item_id, line.item_source) == (helmet.pk, 'EPP')


# ──────────────────── 1b. historical RQs: the workflow ────────────────────

@pytest.mark.django_db
class TestHistoricalRequestsWalkTheWorkflow:
    def test_operations_flow_runs_to_the_purchase_branch(
        self, project_resident, project_control, logistics_coordinator, ops_rq,
    ):
        _historical_lines(ops_rq)
        assert ops_rq.requesting_area == ''

        step = _act(project_resident, ops_rq, 'TECHNICAL_APPROVED', RoleChoices.PROJECT_RESIDENT)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(ops_rq) == 'TECHNICAL_APPROVED'

        step = _act(project_control, ops_rq, 'BUDGET_CLASSIFIED', RoleChoices.PROJECT_CONTROL,
                    classification=BudgetClassificationChoices.BC_WITHIN_PROPOSAL)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(ops_rq) == 'VALIDATED'          # WITHIN_PROPOSAL -> VALIDATED (system chain)

        step = _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR,
                    has_stock=False)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(ops_rq) == 'REQUIRES_PURCHASE'

        # The new fields were never required nor touched along the way.
        ops_rq.refresh_from_db()
        assert ops_rq.requesting_area == ''
        assert set(RequestItem.objects.filter(request=ops_rq).values_list('item_source', 'is_off_catalog')) == {
            ('', False),
        }

    def test_administrative_flow_runs_to_the_stock_branch(
        self, direct_supervisor, adm_budget_manager, logistics_supervisor, adm_rq,
    ):
        _historical_lines(adm_rq)

        step = _act(direct_supervisor, adm_rq, 'SUPERVISOR_APPROVED', RoleChoices.DIRECT_SUPERVISOR)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(adm_rq) == 'SUPERVISOR_APPROVED'

        step = _act(adm_budget_manager, adm_rq, 'ADMIN_BUDGET_REVIEWED', RoleChoices.ADMIN_MANAGER, within_plan=True)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(adm_rq) == 'VALIDATED'

        step = _act(logistics_supervisor, adm_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_SUPERVISOR,
                    has_stock=True)
        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(adm_rq) == 'IN_STOCK'

    def test_a_rejection_still_works_without_area_or_sources(self, project_resident, ops_rq):
        _historical_lines(ops_rq)

        step = _act(project_resident, ops_rq, 'TECHNICAL_REJECTED', RoleChoices.PROJECT_RESIDENT)

        assert step.status_code == status.HTTP_200_OK, step.data
        assert _status(ops_rq) == 'TECHNICAL_REJECTED'


# ──────────────────── 2. nothing new blocks a transition ────────────────────

def _build_scenario(rq, scenario, helmet):
    """One line (`qty` 10) in each coverage situation. Returns (expected_link_status, expected_coverage)."""
    if scenario == 'unlinked':
        make_item(rq, 1, quantity=10)
        return 'UNLINKED', None
    if scenario == 'off_catalog':
        make_item(rq, 1, quantity=10, is_off_catalog=True)
        return 'OFF_CATALOG', None
    make_item(rq, 1, quantity=10, inventory_item=helmet, item_source='EPP')
    pool = {'full': 50, 'partial': 3, 'none': 0}[scenario]
    if pool:
        make_stock(helmet, pool)
    return 'LINKED', scenario.upper()


SCENARIOS = ['full', 'partial', 'none', 'unlinked', 'off_catalog']


@pytest.mark.django_db
class TestStockCheckIsNeverBlockedByTheAvailability:
    @pytest.mark.parametrize('scenario', SCENARIOS)
    @pytest.mark.parametrize('has_stock, expected_status', [(True, 'IN_STOCK'), (False, 'REQUIRES_PURCHASE')])
    def test_operations_flow(self, logistics_coordinator, ops_rq, helmet, scenario, has_stock, expected_status):
        link, coverage = _build_scenario(ops_rq, scenario, helmet)
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])
        row = _availability(logistics_coordinator, ops_rq)['items'][0]
        assert (row['link_status'], row['coverage']) == (link, coverage)     # the advice says what it says...

        response = _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR,
                        has_stock=has_stock)

        assert response.status_code == status.HTTP_200_OK, response.data     # ...and the engine does not care
        assert _status(ops_rq) == expected_status

    @pytest.mark.parametrize('scenario', SCENARIOS)
    @pytest.mark.parametrize('has_stock, expected_status', [(True, 'IN_STOCK'), (False, 'REQUIRES_PURCHASE')])
    def test_administrative_flow(
        self, logistics_supervisor, adm_rq, helmet, scenario, has_stock, expected_status,
    ):
        link, coverage = _build_scenario(adm_rq, scenario, helmet)
        adm_rq.status = 'VALIDATED'
        adm_rq.save(update_fields=['status'])
        row = _availability(logistics_supervisor, adm_rq)['items'][0]
        assert (row['link_status'], row['coverage']) == (link, coverage)

        response = _act(logistics_supervisor, adm_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_SUPERVISOR,
                        has_stock=has_stock)

        assert response.status_code == status.HTTP_200_OK, response.data
        assert _status(adm_rq) == expected_status

    def test_a_mixed_request_can_go_all_to_stock_even_if_most_lines_are_not_covered(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        make_stock(helmet, 4)
        make_item(ops_rq, 1, quantity=10, inventory_item=helmet)       # partial
        make_item(ops_rq, 2, quantity=10)                              # unlinked
        make_item(ops_rq, 3, quantity=1, is_off_catalog=True)          # off-catalog
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])
        summary = _availability(logistics_coordinator, ops_rq)['summary']
        assert (summary['partial'], summary['unlinked'], summary['off_catalog']) == (1, 1, 1)

        response = _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR,
                        has_stock=True)

        assert response.status_code == status.HTTP_200_OK, response.data
        assert _status(ops_rq) == 'IN_STOCK'

    def test_the_decision_does_not_touch_the_lines_nor_the_stock(self, logistics_coordinator, ops_rq, helmet):
        pool = make_stock(helmet, 3)
        line = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, item_source='EPP')
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])
        _availability(logistics_coordinator, ops_rq)

        _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)

        line.refresh_from_db()
        pool.refresh_from_db()
        assert (line.quantity, line.inventory_item_id, line.item_source) == (Decimal('10.000'), helmet.pk, 'EPP')
        assert pool.quantity == Decimal('3.000')            # IN_STOCK reserves nothing physically

    def test_reading_availability_and_updating_items_never_move_the_status(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        line = make_item(ops_rq, 1, quantity=10)
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])
        approvals = Approval.objects.filter(request=ops_rq).count()

        _availability(logistics_coordinator, ops_rq)
        client_for(logistics_coordinator).patch(
            f'/api/v1/requests/{ops_rq.pk}/update-items/',
            {'items': [{'item_id': line.pk, 'inventory_item': helmet.pk, 'supply_source': 'STOCK'}]},
            format='json',
        )

        assert _status(ops_rq) == 'VALIDATED'
        assert Approval.objects.filter(request=ops_rq).count() == approvals

    def test_only_the_workflow_role_may_send_the_stock_check(
        self, requester, logistics_coordinator, ops_rq, helmet,
    ):
        """The new endpoints did not widen who can decide: a requester still cannot send STOCK_CHECKED."""
        make_item(ops_rq, 1, quantity=10, inventory_item=helmet)
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])

        response = _act(requester, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _status(ops_rq) == 'VALIDATED'

    def test_a_missing_decision_is_still_the_engines_error_not_the_availabilitys(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        make_stock(helmet, 50)
        make_item(ops_rq, 1, quantity=10, inventory_item=helmet)
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])

        response = _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'has_stock' in response.data['detail']
        assert _status(ops_rq) == 'VALIDATED'


# ──────────────────── 2b. the availability follows real transitions ────────────────────

@pytest.mark.django_db
class TestAvailabilityFollowsTheRealWorkflow:
    def test_an_rq_that_goes_to_stock_reserves_it_for_the_others_across_both_flows(
        self, logistics_coordinator, logistics_supervisor, ops_rq, adm_rq, helmet,
    ):
        """OPS and ADM draw from the same CENTRAL pool: confirming stock in one lowers what the other sees."""
        make_stock(helmet, 10)
        make_item(ops_rq, 1, quantity=8, inventory_item=helmet)
        make_item(adm_rq, 1, quantity=5, inventory_item=helmet)
        for rq in (ops_rq, adm_rq):
            rq.status = 'VALIDATED'
            rq.save(update_fields=['status'])

        before = _availability(logistics_supervisor, adm_rq)['items'][0]
        assert _figures(before) == (Decimal('0'), Decimal('10'), Decimal('0'), 'FULL')

        response = _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR,
                        has_stock=True)
        assert response.status_code == status.HTTP_200_OK, response.data

        after = _availability(logistics_supervisor, adm_rq)['items'][0]
        assert _figures(after) == (Decimal('8'), Decimal('2'), Decimal('3'), 'PARTIAL')
        # The RQ that holds the stock still sees the whole pool (it never competes with itself).
        own = _availability(logistics_coordinator, ops_rq)['items'][0]
        assert _figures(own) == (Decimal('0'), Decimal('10'), Decimal('0'), 'FULL')
        # And the physical pool did not move.
        assert InventoryStock.objects.get(inventory=helmet).quantity == Decimal('10.000')

    def test_an_rq_sent_to_purchase_reserves_nothing(
        self, logistics_coordinator, logistics_supervisor, ops_rq, adm_rq, helmet,
    ):
        make_stock(helmet, 10)
        make_item(ops_rq, 1, quantity=8, inventory_item=helmet)
        make_item(adm_rq, 1, quantity=5, inventory_item=helmet)
        for rq in (ops_rq, adm_rq):
            rq.status = 'VALIDATED'
            rq.save(update_fields=['status'])

        _act(logistics_coordinator, ops_rq, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=False)

        row = _availability(logistics_supervisor, adm_rq)['items'][0]
        assert _figures(row) == (Decimal('0'), Decimal('10'), Decimal('0'), 'FULL')
