"""
SYSPCC-029 (Paso B / "Fase 4"): picking, entregas parciales y reversas de un RQ desde el almacén.

Todo va por la API real (`/api/v1/warehouse/pending-requests/...`) y, donde importa, por el motor
real (`WorkflowEngine.execute`) para comprobar que las entregas parciales y el DISPATCHED final
cuadran. Ni el estado del RQ ni `TRANSITIONS` cambian (lo congela `test_workflow_snapshot.py`).

Cubre: RBAC (rol derivado de TRANSITIONS por flujo y estado, OPS y ADM), estados permitidos,
remanente, todo-o-nada, doble clic, parcial + DISPATCHED final, reversa y stock, alcance de
visibilidad, listado de Pendientes con QUALITY_APPROVED y el contrato de errores.
"""
import datetime
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.enums import RoleChoices, RQFlowChoices
from apps.core.models import UserRole
from apps.rq.models import ActivityLog, Approval
from apps.rq.services.stock_availability import committed_to_other_requests
from apps.rq.services.workflow_engine import WorkflowEngine
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
from apps.warehouse.models import (
    InventoryMovement,
    InventoryStock,
    MovementGroup,
    WarehouseDispatch,
    WarehouseDispatchItem,
)
from apps.warehouse.services.dispatch_totals import net_dispatched_by_item

pytestmark = pytest.mark.django_db

BASE = '/api/v1/warehouse/pending-requests'
TODAY = timezone.localdate()


def picking_url(rq):
    return f'{BASE}/{rq.pk}/picking/'


def deliver_url(rq):
    return f'{BASE}/{rq.pk}/deliver/'


def reverse_url(rq, dispatch_id):
    return f'{BASE}/{rq.pk}/deliveries/{dispatch_id}/reverse/'


def payload(*lines, guide='GR-001-0001', **extra):
    return {
        'lines': [{'request_item_id': item.pk, 'quantity': str(qty)} for item, qty in lines],
        'dispatch_guide_number': guide,
        **extra,
    }


def set_status(rq, status):
    rq.status = status
    rq.save(update_fields=['status'])
    return rq


def pool(product):
    return InventoryStock.objects.get(inventory=product, project=None, department=None).quantity


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND', location='B3-2')
    make_stock(product, 10)
    return product


@pytest.fixture
def gloves(db):
    product = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR', floor=1)
    make_stock(product, 20)
    return product


@pytest.fixture
def logistics_coordinator(db, project):
    return make_user('logistics_coordinator', RoleChoices.LOGISTICS_COORDINATOR, project=project)


@pytest.fixture
def ops_in_stock(ops_rq, helmet):
    """OPS request, IN_STOCK, one confirmed line of 10 helmets (pool holds 10)."""
    set_status(ops_rq, 'IN_STOCK')
    item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
    return ops_rq, item


# ════════════════════════════════ picking ════════════════════════════════

class TestPicking:
    def test_lists_every_line_with_product_location_stock_and_progress(
        self, ops_rq, helmet, gloves, central_warehouse,
    ):
        set_status(ops_rq, 'IN_STOCK')
        first = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        second = make_item(ops_rq, 2, description='Guantes', quantity=4, unit='PAR',
                           inventory_item=gloves, confirmed=True)

        response = client_for(central_warehouse).get(picking_url(ops_rq))

        assert response.status_code == 200
        body = response.json()
        assert body['request']['rq_number'] == ops_rq.rq_number
        assert body['request']['can_deliver'] is True
        assert body['summary'] == {
            'items_total': 2, 'complete': 0, 'partial': 0, 'pending': 2, 'blocked': 0,
        }
        row1, row2 = body['items']
        assert row1['id'] == first.pk and row1['link_status'] == 'CONFIRMED'
        assert row1['product']['product_code'] == 'EPP-0001'
        assert row1['product']['location'] == 'B3-2'
        assert row1['product']['location_status'] == 'EXACT'
        assert (row1['quantity'], row1['available_central'], row1['delivered'],
                row1['remaining'], row1['max_deliverable']) == (
            '10.000', '10.000', '0.000', '10.000', '10.000')
        assert (row1['status'], row1['can_deliver'], row1['blocked_reason']) == ('PENDING', True, None)
        # Not located yet: "PISO n", never an invented pavilion.
        assert row2['id'] == second.pk
        assert row2['product']['location'] == 'PISO 1'
        assert row2['product']['location_status'] == 'FLOOR_ONLY'

    def test_unlinked_proposed_and_off_catalog_lines_are_blocked_and_show_no_product(
        self, ops_rq, helmet, central_warehouse,
    ):
        set_status(ops_rq, 'IN_STOCK')
        make_item(ops_rq, 1, quantity=2)                                           # no link
        make_item(ops_rq, 2, quantity=2, inventory_item=helmet)                    # proposed
        make_item(ops_rq, 3, quantity=2, is_off_catalog=True)                      # off catalog

        body = client_for(central_warehouse).get(picking_url(ops_rq)).json()

        reasons = [(row['link_status'], row['blocked_reason'], row['product'], row['available_central'])
                   for row in body['items']]
        assert reasons == [
            ('UNLINKED', 'UNLINKED', None, None),
            ('PROPOSED', 'PROPOSED', None, None),
            ('OFF_CATALOG', 'OFF_CATALOG', None, None),
        ]
        assert body['summary']['blocked'] == 3
        assert all(row['can_deliver'] is False for row in body['items'])

    def test_a_line_without_stock_is_blocked_with_no_stock(self, ops_rq, central_warehouse):
        empty = make_inventory('EPP-0003', 'Sin stock', 'UND')
        set_status(ops_rq, 'IN_STOCK')
        make_item(ops_rq, 1, quantity=3, inventory_item=empty, confirmed=True)

        row = client_for(central_warehouse).get(picking_url(ops_rq)).json()['items'][0]

        assert (row['available_central'], row['max_deliverable'], row['can_deliver'],
                row['blocked_reason']) == ('0.000', '0.000', False, 'NO_STOCK')

    def test_delivered_is_net_of_reversals_and_history_is_listed(
        self, ops_in_stock, central_warehouse,
    ):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        first = client.post(deliver_url(rq), payload((item, 4), guide='G-1'), format='json').json()
        client.post(deliver_url(rq), payload((item, 3), guide='G-2'), format='json')
        client.post(reverse_url(rq, first['delivery']['id']), {'reason': 'Cantidad mal digitada'},
                    format='json')

        body = client.get(picking_url(rq)).json()

        row = body['items'][0]
        assert (row['delivered'], row['remaining'], row['status']) == ('3.000', '7.000', 'PARTIAL')
        history = body['deliveries']
        assert [d['dispatch_guide_number'] for d in history] == ['G-1', 'G-2', 'G-1']
        original, second, reversal = history
        assert original['reversed_by'] == reversal['id'] and original['can_reverse'] is False
        assert reversal['is_reversal'] and reversal['reverses'] == original['id']
        assert second['can_reverse'] is True and second['lines'][0]['quantity'] == '3.000'

    def test_complete_status_when_everything_was_delivered(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client_for(central_warehouse).post(deliver_url(rq), payload((item, 10)), format='json')

        row = client_for(central_warehouse).get(picking_url(rq)).json()['items'][0]

        assert (row['status'], row['blocked_reason'], row['can_deliver']) == ('COMPLETE', 'COMPLETE', False)

    @pytest.mark.parametrize('status', ['IN_STOCK', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'DELIVERED'])
    def test_available_in_the_warehouse_stages(self, ops_rq, central_warehouse, status):
        set_status(ops_rq, status)
        assert client_for(central_warehouse).get(picking_url(ops_rq)).status_code == 200

    @pytest.mark.parametrize('status', ['SUBMITTED', 'VALIDATED', 'RECEIVING', 'CLOSED', 'CANCELLED'])
    def test_other_stages_answer_409(self, ops_rq, central_warehouse, status):
        set_status(ops_rq, status)

        response = client_for(central_warehouse).get(picking_url(ops_rq))

        assert response.status_code == 409
        assert response.json()['code'] == 'INVALID_STATE'

    @pytest.mark.parametrize('role', [
        RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.LOGISTICS_SUPERVISOR,
        RoleChoices.LOGISTICS_CHIEF, RoleChoices.CENTRAL_WAREHOUSE,
    ])
    def test_warehouse_and_logistics_roles_can_read(self, ops_in_stock, role):
        rq, _ = ops_in_stock
        user = make_user(f'u_{role}', role)
        assert client_for(user).get(picking_url(rq)).status_code == 200

    def test_non_warehouse_roles_and_anonymous_are_refused(
        self, ops_in_stock, requester, project_resident, general_manager, api_client,
    ):
        rq, _ = ops_in_stock
        for user in (requester, project_resident, general_manager):
            assert client_for(user).get(picking_url(rq)).status_code == 403
        assert api_client.get(picking_url(rq)).status_code in (401, 403)

    def test_site_warehouse_sees_only_requests_of_its_project(
        self, ops_in_stock, site_warehouse, other_project, other_requester,
    ):
        rq, _ = ops_in_stock
        foreign = set_status(make_request(
            number='RQ-2026-0900', requester=other_requester, project=other_project), 'IN_STOCK')

        client = client_for(site_warehouse)

        assert client.get(picking_url(rq)).status_code == 200
        assert client.get(picking_url(foreign)).status_code == 404

    def test_superuser_without_a_warehouse_role_gets_no_bypass(self, ops_in_stock, superuser):
        rq, _ = ops_in_stock
        assert client_for(superuser).get(picking_url(rq)).status_code == 403

    def test_unknown_request_is_404(self, central_warehouse):
        assert client_for(central_warehouse).get(f'{BASE}/999999/picking/').status_code == 404

    def test_nul_byte_in_the_query_is_a_400_not_a_500(self, ops_in_stock, central_warehouse):
        rq, _ = ops_in_stock
        assert client_for(central_warehouse).get(picking_url(rq) + '?x=%00').status_code == 400

    def test_read_only_does_not_write_anything(self, ops_in_stock, central_warehouse):
        rq, _ = ops_in_stock
        client_for(central_warehouse).get(picking_url(rq))
        assert WarehouseDispatch.objects.count() == 0
        assert MovementGroup.objects.count() == 0

    def test_can_deliver_follows_the_transition_table_per_role_and_state(
        self, ops_in_stock, central_warehouse, logistics_coordinator,
    ):
        rq, _ = ops_in_stock
        assert client_for(central_warehouse).get(picking_url(rq)).json()['request']['can_deliver'] is True
        assert client_for(logistics_coordinator).get(picking_url(rq)).json()['request']['can_deliver'] is False

        set_status(rq, 'QUALITY_APPROVED')
        as_keeper = client_for(central_warehouse).get(picking_url(rq)).json()['request']
        as_logistics = client_for(logistics_coordinator).get(picking_url(rq)).json()['request']
        assert as_keeper['can_deliver'] is False and as_keeper['deliver_roles'] == ['LOGISTICS_COORDINATOR']
        assert as_logistics['can_deliver'] is True


# ════════════════════════════════ deliver ════════════════════════════════

class TestDeliverHappyPath:
    def test_registers_a_partial_tanda_with_guide_date_and_discounts_the_pool(
        self, ops_in_stock, central_warehouse, project,
    ):
        rq, item = ops_in_stock

        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 4), guide='GR-777', movement_date=TODAY.isoformat(),
                                     notes='Primera tanda'),
            format='json')

        assert response.status_code == 201
        body = response.json()
        assert pool(item.inventory_item) == Decimal('6.000')
        dispatch = WarehouseDispatch.objects.get(pk=body['delivery']['id'])
        assert dispatch.request == rq and dispatch.reverses is None
        assert dispatch.dispatch_guide_number == 'GR-777'
        assert dispatch.dispatched_by.username == 'central_warehouse'
        assert dispatch.destination_project == project
        assert dispatch.dispatch_number == dispatch.movement_group.group_number
        assert dispatch.items.get().quantity_dispatched == Decimal('4.000')
        group = dispatch.movement_group
        assert group.movement_type == 'EXIT' and group.project_id is None
        assert group.guide_number == 'GR-777' and group.movement_date == TODAY
        assert (group.destination_type, group.destination_detail) == ('PROJECT', project.name)
        assert group.notes == f'Entrega RQ {rq.rq_number} — Primera tanda'
        assert InventoryMovement.objects.get().quantity == Decimal('4.000')
        # Response: the written document plus the refreshed picking list.
        assert body['delivery']['movement_date'] == TODAY.isoformat()
        assert body['picking']['items'][0]['delivered'] == '4.000'
        assert body['picking']['items'][0]['status'] == 'PARTIAL'
        assert response['Cache-Control'] == 'no-store'

    def test_the_request_status_and_approvals_do_not_change(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        approvals = Approval.objects.count()

        client_for(central_warehouse).post(deliver_url(rq), payload((item, 4)), format='json')

        rq.refresh_from_db()
        assert rq.status == 'IN_STOCK'
        assert Approval.objects.count() == approvals

    def test_the_operational_date_defaults_to_today_in_lima(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')
        assert MovementGroup.objects.get().movement_date == timezone.localdate()

    def test_it_leaves_an_audit_trail(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client_for(central_warehouse).post(deliver_url(rq), payload((item, 4), guide='GR-9'), format='json')

        entry = ActivityLog.objects.get(request=rq, action='DELIVERY_REGISTERED')
        assert 'GR-9' in entry.detail and 'línea 1 × 4' in entry.detail
        assert entry.user.username == 'central_warehouse'

    def test_successive_tandas_up_to_the_remainder(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)

        assert client.post(deliver_url(rq), payload((item, 4), guide='G-1'), format='json').status_code == 201
        assert client.post(deliver_url(rq), payload((item, 6), guide='G-2'), format='json').status_code == 201

        assert pool(item.inventory_item) == Decimal('0.000')
        assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}
        assert WarehouseDispatch.objects.filter(request=rq).count() == 2

    def test_several_lines_in_one_tanda_share_one_voucher(self, ops_rq, helmet, gloves, central_warehouse):
        set_status(ops_rq, 'IN_STOCK')
        a = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        b = make_item(ops_rq, 2, quantity=8, unit='PAR', inventory_item=gloves, confirmed=True)

        response = client_for(central_warehouse).post(
            deliver_url(ops_rq), payload((b, 5), (a, 2)), format='json')

        assert response.status_code == 201
        assert MovementGroup.objects.filter(movement_type='EXIT').count() == 1
        assert InventoryMovement.objects.count() == 2
        assert [line['line_number'] for line in response.json()['delivery']['lines']] == [1, 2]
        assert (pool(helmet), pool(gloves)) == (Decimal('8.000'), Decimal('15.000'))

    def test_two_lines_of_the_same_product_are_checked_against_one_pool(
        self, ops_rq, helmet, central_warehouse,
    ):
        set_status(ops_rq, 'IN_STOCK')
        a = make_item(ops_rq, 1, quantity=6, inventory_item=helmet, confirmed=True)
        b = make_item(ops_rq, 2, quantity=6, inventory_item=helmet, confirmed=True)

        response = client_for(central_warehouse).post(
            deliver_url(ops_rq), payload((a, 6), (b, 6)), format='json')   # pool holds 10

        assert response.status_code == 409
        lines = response.json()['lines']
        assert [(ln['line_number'], ln['code']) for ln in lines] == [(2, 'INSUFFICIENT_STOCK')]
        assert pool(helmet) == Decimal('10.000')

    def test_a_quantity_with_three_decimals_is_accepted(self, ops_rq, central_warehouse):
        cable = make_inventory('MAT-1', 'Cable', 'M')
        make_stock(cable, '5.500')
        set_status(ops_rq, 'IN_STOCK')
        item = make_item(ops_rq, 1, quantity='5.500', unit='M', inventory_item=cable, confirmed=True)

        response = client_for(central_warehouse).post(deliver_url(ops_rq), payload((item, '2.250')),
                                                      format='json')

        assert response.status_code == 201
        assert pool(cable) == Decimal('3.250')


class TestDeliverValidation:
    @pytest.mark.parametrize('lines', [[], None, 'x'])
    def test_lines_are_required_and_non_empty(self, ops_in_stock, central_warehouse, lines):
        rq, _ = ops_in_stock
        body = {'dispatch_guide_number': 'G-1'}
        if lines is not None:
            body['lines'] = lines
        assert client_for(central_warehouse).post(deliver_url(rq), body, format='json').status_code == 400

    @pytest.mark.parametrize('quantity', ['0', '-1', '0.0004', '1.2345', 'abc', 'NaN', 'Infinity', None, ''])
    def test_quantity_must_be_a_positive_number_with_at_most_three_decimals(
        self, ops_in_stock, central_warehouse, quantity,
    ):
        rq, item = ops_in_stock
        body = {'lines': [{'request_item_id': item.pk, 'quantity': quantity}], 'dispatch_guide_number': 'G-1'}

        response = client_for(central_warehouse).post(deliver_url(rq), body, format='json')

        assert response.status_code == 400
        assert WarehouseDispatch.objects.count() == 0

    @pytest.mark.parametrize('guide', ['', '   ', 'x' * 51, 'GR\x00001'])
    def test_the_guide_is_required_trimmed_and_bounded(self, ops_in_stock, central_warehouse, guide):
        rq, item = ops_in_stock
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), guide=guide), format='json')
        assert response.status_code == 400
        assert pool(item.inventory_item) == Decimal('10.000')

    def test_the_guide_is_mandatory(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        body = {'lines': [{'request_item_id': item.pk, 'quantity': '1'}]}
        assert client_for(central_warehouse).post(deliver_url(rq), body, format='json').status_code == 400

    def test_a_future_date_is_rejected(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        tomorrow = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), movement_date=tomorrow), format='json')
        assert response.status_code == 400

    def test_a_malformed_date_is_rejected(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), movement_date='20/10/2026'), format='json')
        assert response.status_code == 400

    def test_a_repeated_item_is_rejected(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), (item, 2)), format='json')
        assert response.status_code == 400
        assert WarehouseDispatch.objects.count() == 0

    def test_too_many_lines_are_rejected(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        lines = [{'request_item_id': item.pk + n, 'quantity': '1'} for n in range(201)]
        response = client_for(central_warehouse).post(
            deliver_url(rq), {'lines': lines, 'dispatch_guide_number': 'G'}, format='json')
        assert response.status_code == 400

    def test_an_item_of_another_request_is_a_400_and_writes_nothing(
        self, ops_in_stock, central_warehouse, helmet, requester, project,
    ):
        rq, item = ops_in_stock
        other = set_status(make_request(number='RQ-2026-0777', requester=requester, project=project),
                           'IN_STOCK')
        foreign = make_item(other, 1, quantity=5, inventory_item=helmet, confirmed=True)

        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), (foreign, 1)), format='json')

        assert response.status_code == 400
        assert response.json()['code'] == 'INVALID_ITEM'
        assert response.json()['item_ids'] == [foreign.pk]
        assert pool(helmet) == Decimal('10.000')

    def test_a_hostile_notes_payload_is_rejected_or_stored_inert(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), notes='x' * 301), format='json')
        assert response.status_code == 400

    def test_a_non_json_object_is_rejected(self, ops_in_stock, central_warehouse):
        rq, _ = ops_in_stock
        response = client_for(central_warehouse).post(deliver_url(rq), ['not', 'an', 'object'], format='json')
        assert response.status_code == 400


class TestDeliverBusinessRules:
    def test_more_than_the_remainder_is_refused_and_writes_nothing(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        client.post(deliver_url(rq), payload((item, 7), guide='G-1'), format='json')

        response = client.post(deliver_url(rq), payload((item, 4), guide='G-2'), format='json')

        assert response.status_code == 409
        body = response.json()
        assert body['code'] == 'DELIVERY_LINES_INVALID'
        assert body['lines'] == [{
            'request_item_id': item.pk, 'line_number': 1, 'code': 'EXCEEDS_REMAINING',
            'message': 'La cantidad supera lo pendiente de entregar (3).', 'remaining': '3.000',
        }]
        assert pool(item.inventory_item) == Decimal('3.000')
        assert WarehouseDispatch.objects.filter(request=rq).count() == 1

    def test_all_or_nothing_every_bad_line_is_reported(self, ops_rq, helmet, central_warehouse):
        set_status(ops_rq, 'IN_STOCK')
        good = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        unlinked = make_item(ops_rq, 2, quantity=2)
        proposed = make_item(ops_rq, 3, quantity=2, inventory_item=helmet)
        off = make_item(ops_rq, 4, quantity=2, is_off_catalog=True)
        over = make_item(ops_rq, 5, quantity=1, inventory_item=helmet, confirmed=True)

        response = client_for(central_warehouse).post(
            deliver_url(ops_rq),
            payload((good, 5), (unlinked, 1), (proposed, 1), (off, 1), (over, 2)),
            format='json')

        assert response.status_code == 409
        codes = {ln['line_number']: ln['code'] for ln in response.json()['lines']}
        assert codes == {2: 'ITEM_NOT_LINKED', 3: 'ITEM_NOT_LINKED', 4: 'ITEM_OFF_CATALOG',
                         5: 'EXCEEDS_REMAINING'}
        assert pool(helmet) == Decimal('10.000')                 # the good line did not leave either
        assert WarehouseDispatch.objects.count() == 0 and MovementGroup.objects.count() == 0

    def test_insufficient_pool_stock_is_refused_with_what_is_available(self, ops_rq, central_warehouse):
        scarce = make_inventory('EPP-0005', 'Escaso', 'UND')
        make_stock(scarce, 3)
        set_status(ops_rq, 'IN_STOCK')
        item = make_item(ops_rq, 1, quantity=10, inventory_item=scarce, confirmed=True)

        response = client_for(central_warehouse).post(deliver_url(ops_rq), payload((item, 5)), format='json')

        assert response.status_code == 409
        line = response.json()['lines'][0]
        assert (line['code'], line['available']) == ('INSUFFICIENT_STOCK', '3.000')
        assert pool(scarce) == Decimal('3.000')

    def test_stock_scoped_to_the_project_is_not_available_to_a_delivery(
        self, ops_rq, central_warehouse, project,
    ):
        product = make_inventory('EPP-0006', 'Solo en proyecto', 'UND')
        make_stock(product, 50, project=project)
        set_status(ops_rq, 'IN_STOCK')
        item = make_item(ops_rq, 1, quantity=5, inventory_item=product, confirmed=True)

        response = client_for(central_warehouse).post(deliver_url(ops_rq), payload((item, 1)), format='json')

        assert response.status_code == 409
        assert response.json()['lines'][0]['code'] == 'INSUFFICIENT_STOCK'

    def test_double_click_with_the_same_guide_is_refused(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        first = client.post(deliver_url(rq), payload((item, 4), guide='GR-5'), format='json')

        again = client.post(deliver_url(rq), payload((item, 4), guide=' gr-5 '), format='json')

        assert first.status_code == 201
        assert again.status_code == 409 and again.json()['code'] == 'DUPLICATE_GUIDE'
        assert pool(item.inventory_item) == Decimal('6.000')

    def test_the_same_guide_may_be_used_again_after_the_delivery_was_reversed(
        self, ops_in_stock, central_warehouse,
    ):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        first = client.post(deliver_url(rq), payload((item, 9), guide='GR-5'), format='json').json()
        client.post(reverse_url(rq, first['delivery']['id']), {'reason': 'Cantidad mal digitada'},
                    format='json')

        corrected = client.post(deliver_url(rq), payload((item, 4), guide='GR-5'), format='json')

        assert corrected.status_code == 201
        assert pool(item.inventory_item) == Decimal('6.000')

    def test_the_same_guide_in_another_request_is_fine(self, ops_in_stock, central_warehouse, helmet,
                                                         requester, project):
        rq, item = ops_in_stock
        other = set_status(make_request(number='RQ-2026-0778', requester=requester, project=project),
                           'IN_STOCK')
        other_item = make_item(other, 1, quantity=2, inventory_item=helmet, confirmed=True)
        client = client_for(central_warehouse)
        client.post(deliver_url(rq), payload((item, 1), guide='GR-1'), format='json')

        assert client.post(deliver_url(other), payload((other_item, 1), guide='GR-1'),
                           format='json').status_code == 201

    def test_a_missing_request_is_404(self, central_warehouse):
        response = client_for(central_warehouse).post(
            f'{BASE}/999999/deliver/', {'lines': [], 'dispatch_guide_number': 'G'}, format='json')
        assert response.status_code == 404


class TestDeliverStates:
    @pytest.mark.parametrize('status', [
        'DRAFT', 'SUBMITTED', 'VALIDATED', 'REQUIRES_PURCHASE', 'QUOTING', 'PO_GENERATED', 'RECEIVING',
        'QUALITY_REJECTED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY',
        'CLAIM_IN_REVIEW', 'CLOSED', 'CANCELLED', 'GM_REJECTED',
    ])
    def test_only_in_stock_and_quality_approved_accept_deliveries(
        self, ops_in_stock, central_warehouse, status,
    ):
        rq, item = ops_in_stock
        set_status(rq, status)

        response = client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')

        assert response.status_code == 409
        body = response.json()
        assert body['code'] == 'INVALID_STATE' and body['status'] == status
        assert body['allowed_statuses'] == ['IN_STOCK', 'QUALITY_APPROVED']
        assert pool(item.inventory_item) == Decimal('10.000')

    def test_state_is_checked_before_the_payload_so_a_late_client_gets_409(
        self, ops_in_stock, central_warehouse,
    ):
        rq, _ = ops_in_stock
        set_status(rq, 'DELIVERED')
        response = client_for(central_warehouse).post(deliver_url(rq), {}, format='json')
        assert response.status_code == 409


class TestDeliverRoles:
    """The allowed role is the one TRANSITIONS requires for DISPATCHED at (flow, status)."""

    @pytest.mark.parametrize('status, role, allowed', [
        # OPS
        ('IN_STOCK', RoleChoices.CENTRAL_WAREHOUSE, True),
        ('IN_STOCK', RoleChoices.LOGISTICS_COORDINATOR, False),
        ('IN_STOCK', RoleChoices.LOGISTICS_SUPERVISOR, False),
        ('IN_STOCK', RoleChoices.LOGISTICS_CHIEF, False),
        ('IN_STOCK', RoleChoices.SITE_WAREHOUSE, False),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_COORDINATOR, True),
        ('QUALITY_APPROVED', RoleChoices.CENTRAL_WAREHOUSE, False),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_SUPERVISOR, False),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_CHIEF, False),
    ])
    def test_operations(self, ops_rq, helmet, status, role, allowed):
        set_status(ops_rq, status)
        item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        # Wide visibility (not project-scoped) so the check under test is the ROLE, not the scope.
        user = make_user(f'ops_{status}_{role}'.lower(), role)
        if role == RoleChoices.SITE_WAREHOUSE:
            UserRole.objects.filter(user=user).update(project=ops_rq.project)

        response = client_for(user).post(deliver_url(ops_rq), payload((item, 1)), format='json')

        assert (response.status_code == 201) is allowed, response.content
        if not allowed:
            assert response.status_code == 403
            assert response.json()['code'] == 'ROLE_NOT_ALLOWED'
            assert pool(helmet) == Decimal('10.000')

    @pytest.mark.parametrize('status, role, allowed', [
        # ADM: the same actions, other actors in the compras path
        ('IN_STOCK', RoleChoices.CENTRAL_WAREHOUSE, True),
        ('IN_STOCK', RoleChoices.LOGISTICS_SUPERVISOR, False),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_SUPERVISOR, True),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_COORDINATOR, False),
        ('QUALITY_APPROVED', RoleChoices.CENTRAL_WAREHOUSE, False),
        ('QUALITY_APPROVED', RoleChoices.LOGISTICS_CHIEF, False),
    ])
    def test_administrative(self, adm_rq, helmet, status, role, allowed):
        set_status(adm_rq, status)
        item = make_item(adm_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        user = make_user(f'adm_{status}_{role}'.lower(), role)

        response = client_for(user).post(deliver_url(adm_rq), payload((item, 1)), format='json')

        assert (response.status_code == 201) is allowed, response.content
        if allowed:
            adm_rq.refresh_from_db()
            assert adm_rq.status == status      # an ADM delivery never moves the request either

    def test_the_roles_follow_the_table_and_not_a_copy(self, ops_in_stock, central_warehouse, monkeypatch):
        """If management swaps the role in TRANSITIONS, deliver follows (nothing is hard-coded)."""
        from apps.rq.services import workflow_engine

        rq, item = ops_in_stock
        swapped = [
            dict(t, required_role=RoleChoices.LOGISTICS_CHIEF)
            if (t['flow'] == RQFlowChoices.OPERATIONS and t['from_status'] == 'IN_STOCK'
                and t['action'] == 'DISPATCHED') else t
            for t in workflow_engine.TRANSITIONS
        ]
        monkeypatch.setattr('apps.rq.services.transition_roles.TRANSITIONS', swapped)
        chief = make_user('chief_follow', RoleChoices.LOGISTICS_CHIEF)

        assert client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1)), format='json').status_code == 403
        assert client_for(chief).post(deliver_url(rq), payload((item, 1)), format='json').status_code == 201

    @pytest.mark.parametrize('fixture', ['requester', 'project_resident', 'general_manager', 'project_control'])
    def test_roles_outside_the_warehouse_module_are_refused(self, ops_in_stock, request, fixture):
        rq, item = ops_in_stock
        user = request.getfixturevalue(fixture)
        assert client_for(user).post(deliver_url(rq), payload((item, 1)), format='json').status_code == 403

    def test_anonymous_is_refused(self, ops_in_stock, api_client):
        rq, item = ops_in_stock
        assert api_client.post(deliver_url(rq), payload((item, 1)), format='json').status_code in (401, 403)

    def test_a_superuser_without_the_role_gets_no_bypass(self, ops_in_stock, superuser):
        rq, item = ops_in_stock
        assert client_for(superuser).post(deliver_url(rq), payload((item, 1)), format='json').status_code == 403

    def test_a_site_warehouse_keeper_of_another_project_cannot_even_see_the_request(
        self, ops_in_stock, other_project,
    ):
        rq, item = ops_in_stock
        keeper = make_user('site_other', RoleChoices.SITE_WAREHOUSE, project=other_project)
        assert client_for(keeper).post(deliver_url(rq), payload((item, 1)), format='json').status_code == 404


class TestPartialThenDispatched:
    """The DISPATCHED of the real engine delivers only what is left."""

    def _dispatch(self, rq, user, role=RoleChoices.CENTRAL_WAREHOUSE):
        return WorkflowEngine(rq, user, role).execute('DISPATCHED', comments='Despacho final.')

    def test_dispatched_after_a_partial_delivery_moves_only_the_remainder(
        self, ops_in_stock, central_warehouse,
    ):
        rq, item = ops_in_stock
        client_for(central_warehouse).post(deliver_url(rq), payload((item, 4), guide='G-1'), format='json')

        self._dispatch(Request_of(rq), central_warehouse)

        rq.refresh_from_db()
        assert rq.status == 'DISPATCHED_TO_SITE'
        assert pool(item.inventory_item) == Decimal('0.000')
        quantities = sorted(d.quantity_dispatched for d in WarehouseDispatchItem.objects.all())
        assert quantities == [Decimal('4.000'), Decimal('6.000')]
        assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}

    def test_dispatched_after_a_complete_delivery_moves_nothing_more(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client_for(central_warehouse).post(deliver_url(rq), payload((item, 10)), format='json')
        before = (WarehouseDispatch.objects.count(), MovementGroup.objects.count())

        self._dispatch(Request_of(rq), central_warehouse)

        rq.refresh_from_db()
        assert rq.status == 'DISPATCHED_TO_SITE'
        assert (WarehouseDispatch.objects.count(), MovementGroup.objects.count()) == before
        assert pool(item.inventory_item) == Decimal('0.000')

    def test_a_reversal_gives_the_remainder_back_to_the_final_dispatch(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        tanda = client.post(deliver_url(rq), payload((item, 4), guide='G-1'), format='json').json()
        client.post(reverse_url(rq, tanda['delivery']['id']), {'reason': 'Entrega mal registrada'},
                    format='json')

        self._dispatch(Request_of(rq), central_warehouse)

        assert pool(item.inventory_item) == Decimal('0.000')            # 10 left once, not 14
        assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}

    def test_quality_approved_path_logistics_delivers_in_tandas_then_dispatches(
        self, ops_rq, helmet, logistics_coordinator,
    ):
        set_status(ops_rq, 'QUALITY_APPROVED')
        item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)

        first = client_for(logistics_coordinator).post(deliver_url(ops_rq), payload((item, 3)), format='json')
        self._dispatch(Request_of(ops_rq), logistics_coordinator, RoleChoices.LOGISTICS_COORDINATOR)

        assert first.status_code == 201
        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}
        assert pool(helmet) == Decimal('0.000')

    def test_administrative_in_stock_goes_straight_to_delivered_after_partials(
        self, adm_rq, helmet, central_warehouse,
    ):
        set_status(adm_rq, 'IN_STOCK')
        item = make_item(adm_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        client_for(central_warehouse).post(deliver_url(adm_rq), payload((item, 4)), format='json')

        self._dispatch(Request_of(adm_rq), central_warehouse)

        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DELIVERED'
        assert net_dispatched_by_item([item.pk]) == {item.pk: Decimal('10.000')}
        # The delivery dates are completed on the real deliveries, never on a reversal.
        assert WarehouseDispatch.objects.filter(request=adm_rq, delivered_at__isnull=True).count() == 0

    def test_a_delivery_after_the_final_dispatch_is_refused(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        self._dispatch(Request_of(rq), central_warehouse)

        response = client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')

        assert response.status_code == 409 and response.json()['code'] == 'INVALID_STATE'


def Request_of(rq):  # noqa: N802 - a fresh instance, as the view would load it
    from apps.rq.models import Request

    return Request.objects.get(pk=rq.pk)


# ════════════════════════════════ reverse ════════════════════════════════

def deliver(client, rq, item, qty, guide='G-1'):
    response = client.post(deliver_url(rq), payload((item, qty), guide=guide), format='json')
    assert response.status_code == 201, response.content
    return response.json()['delivery']['id']


class TestReverse:
    def test_gives_the_goods_back_with_a_return_entry_and_a_linked_reversal(
        self, ops_in_stock, central_warehouse,
    ):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 4, guide='GR-3')

        response = client.post(reverse_url(rq, dispatch_id),
                               {'reason': 'La cantidad correcta era otra', 'movement_date': TODAY.isoformat()},
                               format='json')

        assert response.status_code == 201, response.content
        assert pool(item.inventory_item) == Decimal('10.000')
        original = WarehouseDispatch.objects.get(pk=dispatch_id)
        reversal = WarehouseDispatch.objects.get(reverses=original)
        assert response.json()['delivery']['id'] == reversal.pk
        assert reversal.request == rq and reversal.dispatched_by.username == 'central_warehouse'
        assert reversal.dispatch_guide_number == 'GR-3'
        assert 'La cantidad correcta era otra' in reversal.notes
        assert reversal.items.get().quantity_dispatched == Decimal('4.000')
        entry = reversal.movement_group
        assert entry.movement_type == 'ENTRY' and entry.source_type == 'RETURN'
        assert entry.movement_date == TODAY
        movement = entry.movements.get()
        assert (movement.movement_type, movement.source_type, movement.quantity) == (
            'ENTRY', 'RETURN', Decimal('4.000'))
        # Nothing was deleted: the original and its exit voucher are still there.
        original.refresh_from_db()
        assert original.movement_group.movement_type == 'EXIT'
        assert InventoryMovement.objects.count() == 2

    def test_the_item_remainder_is_recalculated(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 10)

        response = client.post(reverse_url(rq, dispatch_id), {'reason': 'Se entregó al proyecto equivocado'},
                               format='json')

        row = response.json()['picking']['items'][0]
        assert (row['delivered'], row['remaining'], row['status'], row['can_deliver']) == (
            '0.000', '10.000', 'PENDING', True)
        assert net_dispatched_by_item([item.pk]).get(item.pk) == Decimal('0.000')

    def test_the_request_status_does_not_change_and_the_trail_is_kept(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 4)

        client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo de prueba'}, format='json')

        rq.refresh_from_db()
        assert rq.status == 'IN_STOCK'
        log = ActivityLog.objects.get(request=rq, action='DELIVERY_REVERSED')
        assert 'Motivo de prueba' in log.detail

    def test_the_stock_row_it_left_is_the_one_it_returns_to(self, ops_rq, central_warehouse, project):
        """A legacy exit taken from a project-scoped row returns to that same row."""
        from apps.core.enums import WarehouseOriginChoices
        from apps.warehouse.services.movements import register_exit_batch

        product = make_inventory('EPP-0008', 'Legado', 'UND')
        scoped = make_stock(product, 10, project=project)
        set_status(ops_rq, 'IN_STOCK')
        item = make_item(ops_rq, 1, quantity=5, inventory_item=product, confirmed=True)
        group = register_exit_batch(
            items_data=[{'inventory_id': product.pk, 'quantity': Decimal('5')}],
            warehouse=WarehouseOriginChoices.CENTRAL, project_id=project.pk,
            destination_type='PROJECT', destination_detail=project.name, requested_by_id=None,
            authorized_by_id=None, notes='legado', registered_by=central_warehouse)
        dispatch = WarehouseDispatch.objects.create(
            request=ops_rq, dispatched_by=central_warehouse, origin='CENTRAL', movement_group=group,
            dispatch_number=group.group_number)
        WarehouseDispatchItem.objects.create(dispatch=dispatch, request_item=item, quantity_dispatched=5)

        response = client_for(central_warehouse).post(
            reverse_url(ops_rq, dispatch.pk), {'reason': 'Corrección de legado'}, format='json')

        assert response.status_code == 201
        scoped.refresh_from_db()
        assert scoped.quantity == Decimal('10.000')
        assert not InventoryStock.objects.filter(inventory=product, project=None).exists()

    @pytest.mark.parametrize('role', [RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.LOGISTICS_CHIEF])
    def test_allowed_roles(self, ops_in_stock, central_warehouse, role):
        rq, item = ops_in_stock
        dispatch_id = deliver(client_for(central_warehouse), rq, item, 2)
        user = make_user(f'rev_{role}'.lower(), role)

        assert client_for(user).post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'},
                                     format='json').status_code == 201

    @pytest.mark.parametrize('role', [
        RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.SITE_WAREHOUSE,
        RoleChoices.REQUESTER, RoleChoices.PROJECT_RESIDENT, RoleChoices.GENERAL_MANAGER,
    ])
    def test_denied_roles(self, ops_in_stock, central_warehouse, role):
        rq, item = ops_in_stock
        dispatch_id = deliver(client_for(central_warehouse), rq, item, 2)
        user = make_user(f'norev_{role}'.lower(), role)
        if role == RoleChoices.SITE_WAREHOUSE:
            UserRole.objects.filter(user=user).update(project=rq.project)

        response = client_for(user).post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'},
                                         format='json')

        assert response.status_code == 403
        assert pool(item.inventory_item) == Decimal('8.000')
        assert not WarehouseDispatch.objects.filter(reverses__isnull=False).exists()

    def test_a_superuser_without_the_role_gets_no_bypass(self, ops_in_stock, central_warehouse, superuser):
        rq, item = ops_in_stock
        dispatch_id = deliver(client_for(central_warehouse), rq, item, 2)
        assert client_for(superuser).post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'},
                                          format='json').status_code == 403

    @pytest.mark.parametrize('body', [{}, {'reason': ''}, {'reason': '   '}, {'reason': 'abc'},
                                      {'reason': 'x' * 301}, {'reason': 'mal\x00motivo'},
                                      {'reason': 'ok motivo', 'movement_date': 'ayer'}])
    def test_the_reason_is_mandatory_and_bounded(self, ops_in_stock, central_warehouse, body):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 2)

        response = client.post(reverse_url(rq, dispatch_id), body, format='json')

        assert response.status_code == 400
        assert pool(item.inventory_item) == Decimal('8.000')

    NOT_REVERSIBLE_STATES = [
        'DISPATCHED_TO_SITE', 'DELIVERED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'CLAIM_IN_REVIEW',
        'RECEIVING', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'CLOSED', 'CANCELLED', 'GM_REJECTED',
        'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED', 'COST_OVERRUN_REJECTED',
    ]

    @pytest.mark.parametrize('status', NOT_REVERSIBLE_STATES)
    def test_only_where_the_delivery_can_be_redone(self, ops_in_stock, central_warehouse, status):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 2)
        set_status(rq, status)

        response = client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 409
        body = response.json()
        assert body['code'] == 'RQ_NOT_REVERSIBLE_STATE'
        assert body['detail'] == ('La entrega ya no se puede anular en este estado; '
                                  'corrígelo con el ciclo de reclamo.')
        assert body['status'] == status and body['allowed_statuses'] == ['IN_STOCK', 'QUALITY_APPROVED']
        assert pool(item.inventory_item) == Decimal('8.000')
        assert not WarehouseDispatch.objects.filter(reverses__isnull=False).exists()

    def test_allowed_in_quality_approved_by_the_role_that_delivers_there(
        self, ops_rq, helmet, logistics_coordinator, logistics_chief,
    ):
        set_status(ops_rq, 'QUALITY_APPROVED')
        item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        dispatch_id = deliver(client_for(logistics_coordinator), ops_rq, item, 3)

        # LOGISTICS_COORDINATOR delivers here but only the chief (or the keeper) may annul.
        denied = client_for(logistics_coordinator).post(
            reverse_url(ops_rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')
        allowed = client_for(logistics_chief).post(
            reverse_url(ops_rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        assert denied.status_code == 403 and allowed.status_code == 201
        assert pool(helmet) == Decimal('10.000')

    def test_the_automatic_dispatch_of_the_engine_is_no_longer_reversible_here(
        self, ops_in_stock, central_warehouse,
    ):
        """After DISPATCHED the request left IN_STOCK: corrections go through the claim cycle."""
        rq, item = ops_in_stock
        WorkflowEngine(Request_of(rq), central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')
        auto = WarehouseDispatch.objects.get(request=rq)

        response = client_for(central_warehouse).post(
            reverse_url(rq, auto.pk), {'reason': 'Despacho automático equivocado'}, format='json')

        assert response.status_code == 409 and response.json()['code'] == 'RQ_NOT_REVERSIBLE_STATE'
        assert pool(item.inventory_item) == Decimal('0.000')

    def test_picking_can_reverse_is_coherent_with_the_state(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        deliver(client, rq, item, 2)

        before = client.get(picking_url(rq)).json()
        set_status(rq, 'DISPATCHED_TO_SITE')
        after = client.get(picking_url(rq)).json()

        assert before['request']['can_reverse'] is True
        assert before['deliveries'][0]['can_reverse'] is True
        assert after['request']['can_reverse'] is False
        assert after['deliveries'][0]['can_reverse'] is False

    def test_the_reversal_date_cannot_precede_the_delivery(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        long_ago = timezone.now() - datetime.timedelta(days=20)
        type(rq).objects.filter(pk=rq.pk).update(created_at=long_ago)
        client = client_for(central_warehouse)
        delivered_on = TODAY - datetime.timedelta(days=3)
        response = client.post(deliver_url(rq), payload((item, 2), movement_date=delivered_on.isoformat()),
                               format='json')
        dispatch_id = response.json()['delivery']['id']

        early = client.post(
            reverse_url(rq, dispatch_id),
            {'reason': 'Motivo valido', 'movement_date': (delivered_on - datetime.timedelta(days=1)).isoformat()},
            format='json')
        same_day = client.post(
            reverse_url(rq, dispatch_id),
            {'reason': 'Motivo valido', 'movement_date': delivered_on.isoformat()}, format='json')

        assert early.status_code == 400
        body = early.json()
        assert (body['code'], body['error'], body['status_code']) == ('INVALID_DATE', True, 400)
        assert body['min_date'] == delivered_on.isoformat()
        assert 'anterior a la de la entrega' in body['detail']
        assert same_day.status_code == 201
        assert pool(item.inventory_item) == Decimal('10.000')

    def test_a_delivery_is_annulled_once(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 4)
        client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        again = client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        assert again.status_code == 409 and again.json()['code'] == 'ALREADY_REVERSED'
        assert pool(item.inventory_item) == Decimal('10.000')                 # returned once, not twice

    def test_a_reversal_cannot_be_annulled(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 4)
        reversal_id = client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'},
                                  format='json').json()['delivery']['id']

        response = client.post(reverse_url(rq, reversal_id), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 409 and response.json()['code'] == 'NOT_REVERSIBLE'

    def test_a_delivery_of_another_request_is_404(self, ops_in_stock, central_warehouse, helmet,
                                                   requester, project):
        rq, _ = ops_in_stock
        other = set_status(make_request(number='RQ-2026-0779', requester=requester, project=project),
                           'IN_STOCK')
        other_item = make_item(other, 1, quantity=2, inventory_item=helmet, confirmed=True)
        foreign_id = deliver(client_for(central_warehouse), other, other_item, 1)

        response = client_for(central_warehouse).post(
            reverse_url(rq, foreign_id), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 404 and response.json()['code'] == 'DELIVERY_NOT_FOUND'
        assert pool(helmet) == Decimal('9.000')

    @pytest.mark.parametrize('dispatch_id', ['999999', '9' * 30])
    def test_an_unknown_or_out_of_range_delivery_id_is_404_not_500(
        self, ops_in_stock, central_warehouse, dispatch_id,
    ):
        rq, _ = ops_in_stock
        response = client_for(central_warehouse).post(
            f'{BASE}/{rq.pk}/deliveries/{dispatch_id}/reverse/', {'reason': 'Motivo valido'}, format='json')
        assert response.status_code == 404

    def test_an_out_of_range_request_id_is_404_not_500(self, central_warehouse):
        big = '9' * 30
        client = client_for(central_warehouse)
        assert client.get(f'{BASE}/{big}/picking/').status_code == 404
        assert client.post(f'{BASE}/{big}/deliver/', {}, format='json').status_code == 404

    def test_a_dispatch_without_an_exit_voucher_cannot_be_reversed(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        seeded = WarehouseDispatch.objects.create(
            request=rq, dispatched_by=central_warehouse, origin='CENTRAL', dispatch_number='SEED-1')
        WarehouseDispatchItem.objects.create(dispatch=seeded, request_item=item, quantity_dispatched=2)

        response = client_for(central_warehouse).post(
            reverse_url(rq, seeded.pk), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 409 and response.json()['code'] == 'NOT_REVERSIBLE'

    def test_the_database_refuses_a_second_reversal_of_the_same_delivery(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        dispatch_id = deliver(client_for(central_warehouse), rq, item, 2)
        original = WarehouseDispatch.objects.get(pk=dispatch_id)
        WarehouseDispatch.objects.create(
            request=rq, dispatched_by=central_warehouse, origin='CENTRAL', reverses=original)

        with pytest.raises(IntegrityError), transaction.atomic():
            WarehouseDispatch.objects.create(
                request=rq, dispatched_by=central_warehouse, origin='CENTRAL', reverses=original)

    def test_reversals_never_get_a_delivery_date(self, ops_in_stock, central_warehouse):
        from apps.warehouse.services.rq_fulfillment import mark_request_delivered

        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 2)
        client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        mark_request_delivered(Request_of(rq), central_warehouse)

        reversal = WarehouseDispatch.objects.get(reverses__isnull=False)
        assert reversal.delivered_at is None and reversal.accepted_by is None

    def test_stock_that_would_overflow_the_column_is_a_clean_409(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 2)
        InventoryStock.objects.filter(inventory=item.inventory_item).update(quantity=Decimal('999999999.000'))

        response = client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 409 and response.json()['code'] == 'REVERSE_FAILED'
        assert not WarehouseDispatch.objects.filter(reverses__isnull=False).exists()


# ════════════════════════════════ the rest of the system sees reversals ════════════════════════════════

class TestOtherReadersNetReversals:
    def test_availability_promised_to_other_requests_counts_reversals(
        self, ops_in_stock, central_warehouse, helmet,
    ):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 4)

        assert committed_to_other_requests([helmet.pk], exclude_request_id=0) == {helmet.pk: Decimal('6.000')}

        client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        assert committed_to_other_requests([helmet.pk], exclude_request_id=0) == {helmet.pk: Decimal('10.000')}


# ════════════════════════════════ Pendientes ════════════════════════════════

LIST_URL = f'{BASE}/list/'


class TestPendingList:
    def test_quality_approved_is_listed_read_only_for_the_keeper_and_actionable_for_logistics(
        self, ops_in_stock, central_warehouse, logistics_coordinator,
    ):
        rq, _ = ops_in_stock
        set_status(rq, 'QUALITY_APPROVED')

        keeper = client_for(central_warehouse).get(LIST_URL).json()['results'][0]
        logistics = client_for(logistics_coordinator).get(LIST_URL).json()['results'][0]

        assert keeper['status'] == 'QUALITY_APPROVED' and logistics['id'] == rq.pk
        assert keeper['pending_action'] == 'DISPATCHED'
        assert keeper['status_label'] == 'Calidad aprobada — pendiente despacho'
        assert (keeper['can_act'], keeper['can_deliver']) == (False, False)
        assert keeper['act_roles'] == ['LOGISTICS_COORDINATOR']
        assert (logistics['can_act'], logistics['can_deliver']) == (True, True)

    def test_in_stock_is_actionable_for_the_keeper(self, ops_in_stock, central_warehouse):
        body = client_for(central_warehouse).get(LIST_URL).json()['results'][0]
        assert (body['can_act'], body['can_deliver'], body['act_roles']) == (True, True, ['CENTRAL_WAREHOUSE'])

    def test_site_warehouse_does_not_see_quality_approved_nor_in_stock(self, ops_in_stock, site_warehouse):
        rq, _ = ops_in_stock
        for status in ('QUALITY_APPROVED', 'IN_STOCK'):
            set_status(rq, status)
            assert client_for(site_warehouse).get(LIST_URL).json()['results'] == []

    def test_dispatched_to_site_keeps_working_for_site_warehouse(self, ops_in_stock, site_warehouse):
        rq, _ = ops_in_stock
        set_status(rq, 'DISPATCHED_TO_SITE')
        row = client_for(site_warehouse).get(LIST_URL).json()['results'][0]
        assert row['pending_action'] == 'WAREHOUSE_RECORDS_UPDATED'
        assert (row['can_act'], row['can_deliver']) == (True, False)

    def test_item_counters_are_correct(self, ops_rq, helmet, central_warehouse):
        set_status(ops_rq, 'IN_STOCK')
        make_item(ops_rq, 1, quantity=1, inventory_item=helmet, confirmed=True, supply_source='STOCK')
        make_item(ops_rq, 2, quantity=1, supply_source='STOCK')
        make_item(ops_rq, 3, quantity=1, supply_source='PURCHASE')

        row = client_for(central_warehouse).get(LIST_URL).json()['results'][0]

        assert (row['items_count'], row['stock_items'], row['purchase_items']) == (3, 2, 1)

    def test_count_includes_quality_approved(self, ops_in_stock, central_warehouse):
        rq, _ = ops_in_stock
        set_status(rq, 'QUALITY_APPROVED')

        body = client_for(central_warehouse).get(f'{BASE}/count/').json()

        assert body['total'] == 1
        assert body['by_status'] == [{
            'status': 'QUALITY_APPROVED', 'label': 'Calidad aprobada — pendiente despacho', 'count': 1,
        }]

    def test_the_list_does_not_query_per_card(self, ops_rq, helmet, central_warehouse, requester,
                                              project, django_assert_max_num_queries):
        for n in range(8):
            rq = set_status(make_request(number=f'RQ-2026-1{n:03d}', requester=requester, project=project),
                            'IN_STOCK')
            make_item(rq, 1, quantity=1, inventory_item=helmet, confirmed=True, supply_source='STOCK')
        client = client_for(central_warehouse)

        with django_assert_max_num_queries(12):
            assert len(client.get(LIST_URL).json()['results']) == 8


class TestThrottle:
    def test_deliver_and_reverse_have_their_own_bucket(self, ops_in_stock, central_warehouse, monkeypatch):
        from apps.warehouse.throttling import WarehouseDeliveryThrottle

        monkeypatch.setattr(WarehouseDeliveryThrottle, 'THROTTLE_RATES',
                            {'user': '1000/min', 'warehouse_delivery': '1/min'})
        rq, item = ops_in_stock
        client = client_for(central_warehouse)

        first = client.post(deliver_url(rq), payload((item, 1), guide='G-1'), format='json')
        second = client.post(deliver_url(rq), payload((item, 1), guide='G-2'), format='json')

        assert first.status_code == 201 and second.status_code == 429
        # The reading endpoint is not in that bucket.
        assert client.get(picking_url(rq)).status_code == 200

    def test_the_scope_is_configured_in_settings(self):
        from django.conf import settings

        assert settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['warehouse_delivery']


class TestUnexpectedErrors:
    def test_an_unexpected_failure_is_a_generic_500_with_nothing_written(
        self, ops_in_stock, central_warehouse, monkeypatch, app_logs,
    ):
        rq, item = ops_in_stock
        monkeypatch.setattr('apps.warehouse.services.rq_fulfillment.register_exit_batch',
                            lambda **kwargs: (_ for _ in ()).throw(RuntimeError('boom con datos internos')))

        response = client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')

        assert response.status_code == 500
        assert response.json() == {'error': True, 'status_code': 500,
                                   'detail': 'No se pudo completar la operación. Intente nuevamente.',
                                   'code': 'INTERNAL_ERROR'}
        assert 'boom' not in response.content.decode()
        assert pool(item.inventory_item) == Decimal('10.000')
        assert 'warehouse.rq_delivery.failed' in app_logs.events()
        assert WarehouseDispatch.objects.count() == 0


# ════════════════════════════════ review adjustments ════════════════════════════════

class TestDeliveryDateLowerBound:
    def test_a_date_before_the_request_was_created_is_a_400(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        created_on = timezone.localtime(rq.created_at).date()
        before = (created_on - datetime.timedelta(days=1)).isoformat()

        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), movement_date=before), format='json')

        assert response.status_code == 400
        body = response.json()
        assert (body['code'], body['error'], body['status_code']) == ('INVALID_DATE', True, 400)
        assert body['min_date'] == created_on.isoformat()
        assert 'anterior a la creación del requerimiento' in body['detail']
        assert pool(item.inventory_item) == Decimal('10.000')

    def test_the_creation_day_itself_is_fine(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        created_on = timezone.localtime(rq.created_at).date().isoformat()
        assert client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 1), movement_date=created_on), format='json').status_code == 201


class TestUniformErrorEnvelope:
    """Every error body of these endpoints carries `error` and `status_code` (+ detail, code, extras)."""

    def _assert_envelope(self, response, http_status, code):
        body = response.json()
        assert response.status_code == http_status
        assert body['error'] is True and body['status_code'] == http_status
        assert body['code'] == code and isinstance(body['detail'], str) and body['detail']
        return body

    def test_domain_errors_of_each_endpoint(self, ops_in_stock, central_warehouse, logistics_coordinator):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)

        self._assert_envelope(
            client_for(logistics_coordinator).post(deliver_url(rq), payload((item, 1)), format='json'),
            403, 'ROLE_NOT_ALLOWED')
        body = self._assert_envelope(
            client.post(deliver_url(rq), payload((item, 99)), format='json'), 409, 'DELIVERY_LINES_INVALID')
        assert body['lines'][0]['code'] == 'EXCEEDS_REMAINING'                      # extras kept
        deliver(client, rq, item, 1, guide='G-X')
        self._assert_envelope(
            client.post(deliver_url(rq), payload((item, 1), guide='G-X'), format='json'), 409, 'DUPLICATE_GUIDE')
        self._assert_envelope(
            client.post(reverse_url(rq, 999999), {'reason': 'Motivo valido'}, format='json'),
            404, 'DELIVERY_NOT_FOUND')
        set_status(rq, 'RECEIVING')
        self._assert_envelope(client.get(picking_url(rq)), 409, 'INVALID_STATE')

    def test_drf_errors_keep_the_standard_envelope(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        response = client_for(central_warehouse).post(
            deliver_url(rq), payload((item, 0)), format='json')
        assert response.status_code == 400
        assert response.json()['error'] is True and response.json()['status_code'] == 400


class TestIntegrityErrors:
    """Only a voucher-number collision is "try again"; anything else gets a generic conflict message."""

    @pytest.fixture
    def fail_with(self, monkeypatch):
        from django.db import IntegrityError

        def _install(message):
            def boom(*args, **kwargs):
                raise IntegrityError(message)
            monkeypatch.setattr('apps.warehouse.views_rq.fulfillment.deliver_request_items', boom)
            monkeypatch.setattr('apps.warehouse.views_rq.fulfillment.reverse_delivery', boom)
        return _install

    @pytest.mark.parametrize('message', [
        'UNIQUE constraint failed: movement_groups.group_number',
        'duplicate key value violates unique constraint "movement_groups_group_number_key"',
        'UNIQUE constraint failed: inventory_movements.movement_number',
    ])
    def test_voucher_number_collision(self, ops_in_stock, central_warehouse, fail_with, message):
        rq, item = ops_in_stock
        fail_with(message)

        response = client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')

        assert response.status_code == 409
        body = response.json()
        assert body['code'] == 'VOUCHER_NUMBER_CONFLICT' and body['error'] is True
        assert 'N° de vale interno' in body['detail']

    def test_any_other_integrity_error_is_a_generic_conflict_and_is_logged(
        self, ops_in_stock, central_warehouse, fail_with, app_logs,
    ):
        rq, item = ops_in_stock
        fail_with('CHECK constraint failed: inventory_stock_quantity_non_negative')

        response = client_for(central_warehouse).post(deliver_url(rq), payload((item, 1)), format='json')

        body = response.json()
        assert response.status_code == 409 and body['code'] == 'INTEGRITY_CONFLICT'
        assert 'vale' not in body['detail'] and 'constraint' not in body['detail']
        assert 'warehouse.rq_delivery.integrity_error' in app_logs.events()

    def test_the_single_reversal_index_maps_to_already_reversed(self, ops_in_stock, central_warehouse, fail_with):
        rq, item = ops_in_stock
        fail_with('UNIQUE constraint failed: warehouse_dispatches.reverses_id')

        response = client_for(central_warehouse).post(
            reverse_url(rq, 1), {'reason': 'Motivo valido'}, format='json')

        assert response.status_code == 409 and response.json()['code'] == 'ALREADY_REVERSED'


class TestOriginalDeliveryIsProtected:
    def test_deleting_an_annulled_delivery_raises_protected_error(self, ops_in_stock, central_warehouse):
        from django.db.models import ProtectedError

        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        dispatch_id = deliver(client, rq, item, 2)
        client.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'}, format='json')

        with pytest.raises(ProtectedError):
            WarehouseDispatch.objects.get(pk=dispatch_id).delete()
        assert WarehouseDispatch.objects.filter(pk=dispatch_id).exists()

    def test_a_delivery_without_reversal_can_still_be_deleted(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        dispatch_id = deliver(client_for(central_warehouse), rq, item, 2)
        WarehouseDispatch.objects.get(pk=dispatch_id).delete()
        assert not WarehouseDispatch.objects.filter(pk=dispatch_id).exists()

    def test_the_admin_does_not_break_and_refuses_to_delete_the_original(
        self, ops_in_stock, central_warehouse, superuser, client,
    ):
        rq, item = ops_in_stock
        api = client_for(central_warehouse)
        dispatch_id = deliver(api, rq, item, 2)
        reversal_id = api.post(reverse_url(rq, dispatch_id), {'reason': 'Motivo valido'},
                               format='json').json()['delivery']['id']
        client.force_login(superuser)

        for pk in (dispatch_id, reversal_id):
            assert client.get(f'/mgmt-panel/warehouse/warehousedispatch/{pk}/change/').status_code == 200
        assert client.get('/mgmt-panel/warehouse/warehousedispatch/').status_code == 200
        confirm = client.get(f'/mgmt-panel/warehouse/warehousedispatch/{dispatch_id}/delete/')
        assert confirm.status_code == 200
        client.post(f'/mgmt-panel/warehouse/warehousedispatch/{dispatch_id}/delete/', {'post': 'yes'})
        assert WarehouseDispatch.objects.filter(pk=dispatch_id).exists()


class TestUpdateItemsUsesTheNetDispatched:
    def _patch(self, user, rq, entries):
        return client_for(user).patch(f'/api/v1/requests/{rq.pk}/update-items/', {'items': entries},
                                      format='json')

    def test_a_fully_annulled_delivery_frees_the_line_for_relinking(
        self, ops_in_stock, central_warehouse, logistics_coordinator, gloves,
    ):
        rq, item = ops_in_stock
        api = client_for(central_warehouse)
        dispatch_id = deliver(api, rq, item, 4)

        blocked = self._patch(logistics_coordinator, rq, [{'item_id': item.pk, 'inventory_item': gloves.pk}])
        api.post(reverse_url(rq, dispatch_id), {'reason': 'Producto equivocado'}, format='json')
        freed = self._patch(logistics_coordinator, rq, [{'item_id': item.pk, 'inventory_item': gloves.pk}])

        assert blocked.status_code == 409 and blocked.json()['code'] == 'ITEMS_ALREADY_DISPATCHED'
        assert freed.status_code == 200, freed.content
        item.refresh_from_db()
        assert item.inventory_item_id == gloves.pk

    def test_a_partially_annulled_line_stays_locked(
        self, ops_in_stock, central_warehouse, logistics_coordinator, gloves,
    ):
        rq, item = ops_in_stock
        api = client_for(central_warehouse)
        first = deliver(api, rq, item, 4, guide='G-1')
        deliver(api, rq, item, 3, guide='G-2')
        api.post(reverse_url(rq, first), {'reason': 'Motivo valido'}, format='json')    # 3 still out

        response = self._patch(logistics_coordinator, rq, [{'item_id': item.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == 409 and response.json()['code'] == 'ITEMS_ALREADY_DISPATCHED'


class TestPendingListIsScopedByVisibility:
    def test_site_warehouse_only_sees_its_own_projects_in_list_and_count(
        self, ops_in_stock, site_warehouse, other_project, other_requester, helmet,
    ):
        rq, _ = ops_in_stock
        set_status(rq, 'DISPATCHED_TO_SITE')                                   # SITE_WAREHOUSE's state
        foreign = set_status(make_request(
            number='RQ-2026-0901', requester=other_requester, project=other_project), 'DISPATCHED_TO_SITE')
        make_item(foreign, 1, quantity=1, inventory_item=helmet, confirmed=True)
        client = client_for(site_warehouse)

        listed = client.get(LIST_URL).json()['results']
        counted = client.get(f'{BASE}/count/').json()

        assert [row['id'] for row in listed] == [rq.pk]
        assert counted['total'] == 1

    def test_central_warehouse_and_logistics_still_see_every_project(
        self, ops_in_stock, central_warehouse, logistics_chief, other_project, other_requester,
    ):
        rq, _ = ops_in_stock
        foreign = set_status(make_request(
            number='RQ-2026-0902', requester=other_requester, project=other_project), 'IN_STOCK')

        for user in (central_warehouse, logistics_chief):
            ids = {row['id'] for row in client_for(user).get(LIST_URL).json()['results']}
            assert ids == {rq.pk, foreign.pk}
