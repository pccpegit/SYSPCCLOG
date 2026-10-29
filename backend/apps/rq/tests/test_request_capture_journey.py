"""
SYSPCC-026 (Fase 1, QA ronda 2): the whole capture journey over HTTP, in both flows.

The other test modules build their RQs through the ORM and exercise one endpoint at a
time. These walk the real path a user takes, with every step going through the API and
the real WorkflowEngine:

    requester POST /requests/  ->  approvals (flow-specific)  ->  logistics reads
    stock-availability  ->  logistics PATCH update-items (confirms the proposed link)
    ->  logistics STOCK_CHECKED  ->  update-items window  ->  dispatch closes it

What they prove together (none of it blocks a transition; the stock check stays advisory):

  * what the requester proposes at creation is stored as a PROPOSAL (`link_confirmed`
    False, `supply_source` empty) and leaves an audit trail for logistics;
  * only logistics confirms it, and the flag turns True in the detail of the RQ and in
    stock-availability;
  * the same decisions work in OPERATIONS (coordinator) and ADMINISTRATIVE (supervisor);
  * the activity trail reads in order: proposed, then updated;
  * once the dispatch action ran, the lines are frozen (409), however the RQ got there.

The workflow itself is frozen by test_workflow_snapshot.py; this module only walks it.
"""
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import BudgetClassificationChoices, RoleChoices
from apps.rq.models import ActivityLog, Approval, Request, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    client_for,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
)

CREATE_URL = '/api/v1/requests/'


def _line(**overrides):
    line = {'description': 'Casco de seguridad', 'quantity': '10.000', 'unit': 'UND', 'item_source': 'EPP'}
    line.update(overrides)
    return line


def _create(user, payload):
    response = client_for(user).post(CREATE_URL, payload, format='json')
    assert response.status_code == status.HTTP_201_CREATED, response.data
    # The 201 body identifies the RQ by its server-generated number (it carries no `id`).
    return Request.objects.get(rq_number=response.data['rq_number']), response


def _ops_payload(project, items):
    return {
        'flow': 'OPERATIONS',
        'project': project.pk,
        'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales para el frente 3',
        'items': [{'line_number': n, **item} for n, item in enumerate(items, start=1)],
    }


def _adm_payload(department, items):
    return {
        'flow': 'ADMINISTRATIVE',
        'department': department.pk,
        'requesting_area': 'ADM',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Útiles de oficina',
        'items': [{'line_number': n, **item} for n, item in enumerate(items, start=1)],
    }


def _act(user, rq, action, acting_role, **extra_data):
    body = {'action': action, 'acting_role': acting_role, 'comments': 'Recorrido de captura.'}
    if extra_data:
        body['extra_data'] = extra_data
    response = client_for(user).post(f'/api/v1/requests/{rq.pk}/action/', body, format='json')
    assert response.status_code == status.HTTP_200_OK, (action, response.data)
    return response


def _status(rq):
    rq.refresh_from_db()
    return rq.status


def _availability(user, rq):
    response = client_for(user).get(f'/api/v1/requests/{rq.pk}/stock-availability/')
    assert response.status_code == status.HTTP_200_OK, response.data
    return {row['line_number']: row for row in response.data['items']}, response.data['summary']


def _detail_lines(user, rq):
    response = client_for(user).get(f'/api/v1/requests/{rq.pk}/')
    assert response.status_code == status.HTTP_200_OK, response.data
    return {line['line_number']: line for line in response.data['items']}, response.data


def _update_items(user, rq, items):
    return client_for(user).patch(f'/api/v1/requests/{rq.pk}/update-items/', {'items': items}, format='json')


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND', 'EPP')


@pytest.fixture
def gloves(db):
    return make_inventory('EPP-0002', 'Guantes de cuero', 'PAR', 'EPP')


@pytest.fixture
def paper(db):
    return make_inventory('UT-0001', 'Papel bond A4', 'MLL', 'Otros')


@pytest.fixture
def adm_budget_manager(db, department):
    """ADMIN_MANAGER of the RQ's department (the conftest `admin_manager` has no department)."""
    return make_user('adm_budget_manager', RoleChoices.ADMIN_MANAGER, department=department)


def _validate_operations(project_resident, project_control, rq):
    _act(project_resident, rq, 'TECHNICAL_APPROVED', RoleChoices.PROJECT_RESIDENT)
    _act(project_control, rq, 'BUDGET_CLASSIFIED', RoleChoices.PROJECT_CONTROL,
         classification=BudgetClassificationChoices.BC_WITHIN_PROPOSAL)
    assert _status(rq) == 'VALIDATED'


def _validate_administrative(direct_supervisor, adm_budget_manager, rq):
    _act(direct_supervisor, rq, 'SUPERVISOR_APPROVED', RoleChoices.DIRECT_SUPERVISOR)
    _act(adm_budget_manager, rq, 'ADMIN_BUDGET_REVIEWED', RoleChoices.ADMIN_MANAGER, within_plan=True)
    assert _status(rq) == 'VALIDATED'


# ──────────────────────────── OPERATIONS ────────────────────────────

@pytest.mark.django_db
class TestOperationsJourney:
    @pytest.fixture
    def created(self, requester, project, helmet):
        """A new RQ with a proposed product, an off-catalog line and a line with neither."""
        make_stock(helmet, 6)  # the pool covers 6 of the 10 requested
        rq, _ = _create(requester, _ops_payload(project, [
            _line(inventory_item=helmet.pk),
            _line(description='Servicio de flete', unit='GLB', quantity='1', item_source='MATERIALES',
                  is_off_catalog=True),
            _line(description='Cinta señalizadora', quantity='5', item_source='CONSUMIBLES'),
        ]))
        return rq

    def test_creation_stores_proposals_not_decisions(self, requester, created, helmet):
        lines, detail = _detail_lines(requester, created)

        assert detail['requesting_area'] == 'OP'
        assert detail['status'] == 'SUBMITTED'
        assert lines[1]['inventory_item'] == helmet.pk
        assert lines[1]['link_confirmed'] is False
        assert lines[2]['is_off_catalog'] is True and lines[2]['link_confirmed'] is False
        assert lines[3]['inventory_item'] is None and lines[3]['is_off_catalog'] is False
        assert lines[3]['link_confirmed'] is False
        # The requester never decides where the line is served from.
        assert {line['supply_source'] for line in lines.values()} == {''}

    def test_the_requester_cannot_decide_the_supply_source_at_creation(self, requester, project, helmet):
        rq, _ = _create(requester, _ops_payload(project, [
            _line(inventory_item=helmet.pk, supply_source='STOCK'),
        ]))

        assert RequestItem.objects.get(request=rq).supply_source == ''

    def test_full_journey_to_the_purchase_branch(
        self, requester, project_resident, project_control, logistics_coordinator, created, helmet, gloves,
    ):
        _validate_operations(project_resident, project_control, created)

        # 1. Logistics reads the availability: the proposal is visible and NOT confirmed.
        rows, summary = _availability(logistics_coordinator, created)
        assert (rows[1]['link_status'], rows[1]['link_confirmed'], rows[1]['coverage']) == ('LINKED', False, 'PARTIAL')
        assert Decimal(rows[1]['available_net']) == Decimal('6')
        assert Decimal(rows[1]['shortfall']) == Decimal('4')
        assert (rows[2]['link_status'], rows[2]['link_confirmed'], rows[2]['coverage']) == ('OFF_CATALOG', False, None)
        assert (rows[3]['link_status'], rows[3]['link_confirmed'], rows[3]['coverage']) == ('UNLINKED', False, None)
        assert summary == {
            'items_total': 3, 'full': 0, 'partial': 1, 'none': 0, 'not_comparable': 0,
            'off_catalog': 1, 'unlinked': 1,
        }

        # 2. Logistics confirms line 1 and 2 and links line 3 to a product.
        lines = {line.line_number: line for line in RequestItem.objects.filter(request=created)}
        response = _update_items(logistics_coordinator, created, [
            {'item_id': lines[1].pk, 'inventory_item': helmet.pk, 'supply_source': 'PURCHASE'},
            {'item_id': lines[2].pk, 'is_off_catalog': True, 'supply_source': 'PURCHASE'},
            {'item_id': lines[3].pk, 'inventory_item': gloves.pk, 'supply_source': 'PURCHASE'},
        ])
        assert response.status_code == status.HTTP_200_OK, response.data
        assert sorted(response.data['updated_item_ids']) == sorted(line.pk for line in lines.values())
        assert response.data['ignored_item_ids'] == []
        assert {item['link_confirmed'] for item in response.data['items']} == {True}

        rows, summary = _availability(logistics_coordinator, created)
        assert {row['link_confirmed'] for row in rows.values()} == {True}
        assert rows[3]['link_status'] == 'LINKED'
        assert summary['unlinked'] == 0

        # 3. The stock check is the manager-defined action and answers as always.
        _act(logistics_coordinator, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=False)
        assert _status(created) == 'REQUIRES_PURCHASE'

        # 4. REQUIRES_PURCHASE is still inside the editing window: re-sending the same
        #    decisions is a no-op, not an error.
        again = _update_items(logistics_coordinator, created, [
            {'item_id': lines[1].pk, 'inventory_item': helmet.pk, 'supply_source': 'PURCHASE'},
        ])
        assert again.status_code == status.HTTP_200_OK
        assert again.data['updated_item_ids'] == [] and again.data['unchanged_item_ids'] == [lines[1].pk]

        # 5. The trail reads: proposed by the requester, then updated by logistics (the
        #    engine writes its own entries in between; only ours are compared).
        actions = list(
            ActivityLog.objects.filter(request=created, action__in=['CATALOG_LINKS_PROPOSED', 'ITEMS_UPDATED'])
            .order_by('created_at', 'pk')
            .values_list('action', flat=True)
        )
        assert actions == ['CATALOG_LINKS_PROPOSED', 'ITEMS_UPDATED']

    def test_a_proposal_can_be_corrected_by_logistics_before_confirming(
        self, project_resident, project_control, logistics_coordinator, created, helmet, gloves,
    ):
        _validate_operations(project_resident, project_control, created)
        line = RequestItem.objects.get(request=created, line_number=1)

        response = _update_items(logistics_coordinator, created, [
            {'item_id': line.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert line.inventory_item_id == gloves.pk
        assert line.link_confirmed is True
        assert line.inventory_item_confirmed_by == logistics_coordinator

    def test_the_stock_check_goes_through_with_nothing_confirmed(
        self, project_resident, project_control, logistics_coordinator, created,
    ):
        """No new rule blocks the manager-defined transition: unconfirmed proposals still pass."""
        _validate_operations(project_resident, project_control, created)

        _act(logistics_coordinator, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)

        assert _status(created) == 'IN_STOCK'
        assert RequestItem.objects.filter(request=created, inventory_item_confirmed_at__isnull=False).count() == 0

    def test_a_rejected_rq_freezes_its_lines_but_stays_readable(
        self, requester, project_resident, logistics_coordinator, created,
    ):
        _act(project_resident, created, 'TECHNICAL_REJECTED', RoleChoices.PROJECT_RESIDENT)
        line = RequestItem.objects.get(request=created, line_number=1)

        response = _update_items(logistics_coordinator, created, [{'item_id': line.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'
        assert _availability(logistics_coordinator, created)[1]['items_total'] == 3
        line.refresh_from_db()
        assert line.supply_source == ''

    def test_before_validation_the_lines_are_not_editable(self, logistics_coordinator, created):
        """SUBMITTED: the lines are still being approved by the project side."""
        line = RequestItem.objects.get(request=created, line_number=1)

        response = _update_items(logistics_coordinator, created, [{'item_id': line.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_STATE_NOT_EDITABLE'

    def test_after_the_dispatch_action_the_lines_are_frozen(
        self, project_resident, project_control, logistics_coordinator, central_warehouse, created, helmet,
    ):
        _validate_operations(project_resident, project_control, created)
        make_stock(helmet, 50)
        _act(logistics_coordinator, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)
        line = RequestItem.objects.get(request=created, line_number=1)
        # Allowed while it waits in IN_STOCK.
        assert _update_items(logistics_coordinator, created, [
            {'item_id': line.pk, 'inventory_item': helmet.pk},
        ]).status_code == status.HTTP_200_OK

        _act(central_warehouse, created, 'DISPATCHED', RoleChoices.CENTRAL_WAREHOUSE)

        assert _status(created) == 'DISPATCHED_TO_SITE'
        assert Approval.objects.filter(request=created, action='DISPATCHED').exists()
        response = _update_items(logistics_coordinator, created, [{'item_id': line.pk, 'supply_source': 'PURCHASE'}])
        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_STATE_NOT_EDITABLE'
        line.refresh_from_db()
        assert line.supply_source != 'PURCHASE'

    def test_an_rq_in_stock_reserves_for_the_next_one_only_what_is_still_owed(
        self, requester, project, project_resident, project_control, logistics_coordinator, created, helmet,
    ):
        """Journey + availability: the second RQ sees the first one's promise (net of the pool)."""
        make_stock(helmet, 4)  # pool: 6 + 4 = 10
        _validate_operations(project_resident, project_control, created)
        _act(logistics_coordinator, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)
        second, _ = _create(requester, _ops_payload(project, [_line(inventory_item=helmet.pk, quantity='4')]))

        rows, _ = _availability(logistics_coordinator, second)

        # 10 in the pool, 10 promised to the first RQ (which is IN_STOCK): nothing left.
        assert Decimal(rows[1]['available_central']) == Decimal('10')
        assert Decimal(rows[1]['committed_other_requests']) == Decimal('10')
        assert Decimal(rows[1]['available_net']) == Decimal('0')
        assert rows[1]['coverage'] == 'NONE'
        # ... and the second one can still go to purchase or to stock: advisory only.
        _validate_operations(project_resident, project_control, second)
        _act(logistics_coordinator, second, 'STOCK_CHECKED', RoleChoices.LOGISTICS_COORDINATOR, has_stock=True)
        assert _status(second) == 'IN_STOCK'


# ──────────────────────────── ADMINISTRATIVE ────────────────────────────

@pytest.mark.django_db
class TestAdministrativeJourney:
    @pytest.fixture
    def created(self, department_requester, department, paper):
        make_stock(paper, 30)
        rq, _ = _create(department_requester, _adm_payload(department, [
            _line(description='Papel bond A4', quantity='20', unit='MLL', item_source='UTILES',
                  inventory_item=paper.pk),
            _line(description='Servicio de courier', quantity='1', unit='GLB', item_source='MATERIALES',
                  is_off_catalog=True),
        ]))
        return rq

    def test_full_journey_to_the_stock_branch(
        self, department_requester, direct_supervisor, adm_budget_manager, logistics_supervisor, created, paper,
    ):
        _validate_administrative(direct_supervisor, adm_budget_manager, created)

        rows, summary = _availability(logistics_supervisor, created)
        assert (rows[1]['link_confirmed'], rows[1]['coverage']) == (False, 'FULL')
        assert (rows[2]['link_status'], rows[2]['link_confirmed']) == ('OFF_CATALOG', False)
        assert summary['full'] == 1 and summary['off_catalog'] == 1

        lines = {line.line_number: line for line in RequestItem.objects.filter(request=created)}
        response = _update_items(logistics_supervisor, created, [
            {'item_id': lines[1].pk, 'inventory_item': paper.pk, 'supply_source': 'STOCK'},
            {'item_id': lines[2].pk, 'is_off_catalog': True, 'supply_source': 'PURCHASE'},
        ])
        assert response.status_code == status.HTTP_200_OK, response.data
        assert {item['link_confirmed'] for item in response.data['items']} == {True}

        _act(logistics_supervisor, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_SUPERVISOR, has_stock=True)
        assert _status(created) == 'IN_STOCK'

        # The requester sees the confirmation on the RQ, not only logistics.
        detail_lines, _ = _detail_lines(department_requester, created)
        assert detail_lines[1]['link_confirmed'] is True and detail_lines[1]['supply_source'] == 'STOCK'

    def test_the_operations_coordinator_role_is_not_the_one_the_administrative_flow_asks_for(
        self, direct_supervisor, adm_budget_manager, logistics_coordinator, created,
    ):
        """The flow-specific role rule is untouched by the new fields."""
        _validate_administrative(direct_supervisor, adm_budget_manager, created)

        response = client_for(logistics_coordinator).post(
            f'/api/v1/requests/{created.pk}/action/',
            {'action': 'STOCK_CHECKED', 'acting_role': RoleChoices.LOGISTICS_COORDINATOR,
             'extra_data': {'has_stock': True}},
            format='json',
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'LOGISTICS_SUPERVISOR' in response.data['detail']
        assert _status(created) == 'VALIDATED'

    def test_a_direct_dispatch_from_stock_freezes_the_lines(
        self, direct_supervisor, adm_budget_manager, logistics_supervisor, central_warehouse, created, paper,
    ):
        """ADM goes IN_STOCK -> DELIVERED directly; the lines are frozen from then on."""
        _validate_administrative(direct_supervisor, adm_budget_manager, created)
        line = RequestItem.objects.get(request=created, line_number=1)
        _update_items(logistics_supervisor, created, [{'item_id': line.pk, 'inventory_item': paper.pk}])
        _act(logistics_supervisor, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_SUPERVISOR, has_stock=True)

        _act(central_warehouse, created, 'DISPATCHED', RoleChoices.CENTRAL_WAREHOUSE)

        assert _status(created) == 'DELIVERED'
        response = _update_items(logistics_supervisor, created, [{'item_id': line.pk, 'supply_source': 'PURCHASE'}])
        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_STATE_NOT_EDITABLE'

    def test_the_two_flows_share_one_pool_for_the_availability(
        self, requester, project, direct_supervisor, adm_budget_manager, logistics_supervisor,
        logistics_coordinator, created, paper,
    ):
        """An ADM RQ in IN_STOCK promises pool stock to an OPERATIONS RQ read afterwards."""
        _validate_administrative(direct_supervisor, adm_budget_manager, created)
        _act(logistics_supervisor, created, 'STOCK_CHECKED', RoleChoices.LOGISTICS_SUPERVISOR, has_stock=True)
        ops, _ = _create(requester, _ops_payload(project, [
            _line(description='Papel bond A4', quantity='15', unit='MLL', item_source='UTILES',
                  inventory_item=paper.pk),
        ]))

        rows, _ = _availability(logistics_coordinator, ops)

        assert Decimal(rows[1]['available_central']) == Decimal('30')
        assert Decimal(rows[1]['committed_other_requests']) == Decimal('20')
        assert Decimal(rows[1]['available_net']) == Decimal('10')
        assert rows[1]['coverage'] == 'PARTIAL'
        assert Decimal(rows[1]['shortfall']) == Decimal('5')
