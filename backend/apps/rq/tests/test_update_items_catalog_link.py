"""
SYSPCC-026 (Fase 1): PATCH /api/v1/requests/{id}/update-items/ extended.

Logistics confirms per line the catalog product (`inventory_item`) or marks it
off-catalog (`is_off_catalog`), the family (`item_source`) and the supply origin
(`supply_source`). It runs atomically under a lock and carries a state guard that
lives ONLY in this auxiliary endpoint: 409 when the RQ is in a final state or a
line already has warehouse dispatches. It never touches a workflow transition.
(The role restriction and the legacy supply_source cases stay covered by
test_update_items_permission.py.)
"""
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status

from apps.core.enums import RQStatusChoices, WarehouseOriginChoices
from apps.rq.models import ActivityLog, Approval, Request, RequestItem
from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    central_warehouse,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    ops_rq,
    rq_in_editable_state,
)

# Every update-items test runs on an RQ in an editable state (the shared fixtures are SUBMITTED).
pytestmark = pytest.mark.usefixtures('rq_in_editable_state')

TERMINAL_STATES = ['CLOSED', 'CANCELLED', 'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED',
                   'GM_REJECTED', 'COST_OVERRUN_REJECTED']
# The window in which logistics may edit the lines, written out LITERALLY (not read
# from the service): widening or narrowing it has to be a deliberate edit of this list.
EDITABLE_STATES = [
    'VALIDATED', 'STOCK_CHECK', 'IN_STOCK', 'REQUIRES_PURCHASE', 'QUOTING', 'QUOTE_COMPARISON',
    'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_APPROVED',
    'PO_GENERATED', 'RECEIVING', 'QUALITY_APPROVED',
]
# Non-terminal states OUTSIDE the window: still being approved, the supplier claim cycle
# (re-enterable after a delivery), dispatched/delivered, claims and the legacy states.
NOT_EDITABLE_STATES = [
    'DRAFT', 'SUBMITTED', 'TECHNICAL_REVIEW', 'TECHNICAL_APPROVED', 'BUDGET_REVIEW',
    'WITHIN_PROPOSAL', 'ADDITIONAL_REQ', 'SUPERVISOR_REVIEW', 'SUPERVISOR_APPROVED',
    'ADMIN_BUDGET_REVIEW', 'WITHIN_ANNUAL_PLAN', 'OUT_OF_ANNUAL_PLAN', 'GM_REVIEW', 'GM_APPROVED',
    'QUALITY_CHECK', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_CLAIM_PENDING',
    'SUPPLIER_REPLACEMENT_RECEIVED', 'RECEPTION_CONFORMITY', 'RECEPTION_CLAIM',
    'DISPATCHED_TO_SITE', 'DELIVERED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'USER_CLAIM',
    'CLAIM_IN_REVIEW', 'CLAIM_RESOLVED',
]


def _url(rq):
    return f'/api/v1/requests/{rq.pk}/update-items/'


def _patch(user, rq, items):
    return client_for(user).patch(_url(rq), {'items': items}, format='json')


def _dispatch(rq, item, quantity, by):
    dispatch = WarehouseDispatch.objects.create(
        request=rq, dispatched_by=by, origin=WarehouseOriginChoices.CENTRAL,
    )
    return WarehouseDispatchItem.objects.create(
        dispatch=dispatch, request_item=item, quantity_dispatched=Decimal(str(quantity)),
    )


def _errors(response):
    return response.data['detail']


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')


@pytest.fixture
def gloves(db):
    return make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')


@pytest.fixture
def item(ops_rq):
    return make_item(ops_rq, 1, description='Casco', quantity=10)


@pytest.mark.django_db
class TestAccess:
    def test_anonymous_gets_401(self, api_client, ops_rq, item):
        response = api_client.patch(_url(ops_rq), {'items': [{'item_id': item.pk, 'item_source': 'EPP'}]},
                                    format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.parametrize('fixture_name', [
        'requester', 'project_resident', 'project_control', 'general_manager',
        'site_warehouse', 'central_warehouse',
    ])
    def test_non_logistics_roles_get_403_and_nothing_changes(self, request, fixture_name, ops_rq, item, helmet):
        user = request.getfixturevalue(fixture_name)

        response = _patch(user, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        item.refresh_from_db()
        assert item.inventory_item_id is None

    @pytest.mark.parametrize('fixture_name', ['logistics_coordinator', 'logistics_supervisor', 'logistics_chief'])
    def test_each_logistics_role_can_link_on_an_operations_request(
        self, request, fixture_name, ops_rq, item, helmet,
    ):
        user = request.getfixturevalue(fixture_name)

        response = _patch(user, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK, response.data
        item.refresh_from_db()
        assert item.inventory_item_id == helmet.pk

    @pytest.mark.parametrize('fixture_name', ['logistics_coordinator', 'logistics_supervisor', 'logistics_chief'])
    def test_each_logistics_role_can_link_on_an_administrative_request(
        self, request, fixture_name, adm_rq, helmet,
    ):
        user = request.getfixturevalue(fixture_name)
        adm_item = make_item(adm_rq, 1, description='Papel')

        response = _patch(user, adm_rq, [{'item_id': adm_item.pk, 'inventory_item': helmet.pk,
                                          'item_source': 'UTILES'}])

        assert response.status_code == status.HTTP_200_OK, response.data
        adm_item.refresh_from_db()
        assert (adm_item.inventory_item_id, adm_item.item_source) == (helmet.pk, 'UTILES')

    def test_nonexistent_request_gets_404(self, logistics_coordinator):
        response = client_for(logistics_coordinator).patch(
            '/api/v1/requests/999999/update-items/', {'items': []}, format='json',
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestLinking:
    def test_link_a_catalog_product(self, logistics_coordinator, ops_rq, item, helmet):
        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk, 'item_source': 'EPP', 'supply_source': 'STOCK'},
        ])

        assert response.status_code == status.HTTP_200_OK, response.data
        item.refresh_from_db()
        assert item.inventory_item_id == helmet.pk
        assert item.is_off_catalog is False
        assert item.item_source == 'EPP'
        assert item.supply_source == 'STOCK'
        assert response.data['updated_item_ids'] == [item.pk]
        assert response.data['unchanged_item_ids'] == []
        assert response.data['ignored_item_ids'] == []
        returned = response.data['items'][0]
        assert returned['inventory_item_code'] == 'EPP-0001'
        assert returned['inventory_item_description'] == 'Casco de seguridad blanco'
        assert returned['inventory_item_unit'] == 'UND'

    def test_relink_to_a_different_product(self, logistics_coordinator, ops_rq, helmet, gloves):
        item = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.inventory_item_id == gloves.pk

    def test_unlink_with_null(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': None}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.inventory_item_id is None
        assert item.is_off_catalog is False

    def test_mark_off_catalog(self, logistics_coordinator, ops_rq, item):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.is_off_catalog is True
        assert item.inventory_item_id is None

    def test_marking_off_catalog_drops_an_existing_link(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.is_off_catalog is True
        assert item.inventory_item_id is None

    def test_linking_a_product_clears_the_off_catalog_mark(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, is_off_catalog=True)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.inventory_item_id == helmet.pk
        assert item.is_off_catalog is False

    def test_unmarking_off_catalog_keeps_the_line_unlinked(self, logistics_coordinator, ops_rq):
        item = make_item(ops_rq, 1, is_off_catalog=True)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'is_off_catalog': False}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.is_off_catalog is False
        assert item.inventory_item_id is None

    def test_setting_the_source_alone_keeps_the_link(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, inventory_item=helmet, item_source='MATERIALES')

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'item_source': 'EPP'}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert (item.inventory_item_id, item.item_source) == (helmet.pk, 'EPP')

    def test_blank_source_clears_it(self, logistics_coordinator, ops_rq):
        item = make_item(ops_rq, 1, item_source='EPP')

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'item_source': ''}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.item_source == ''

    def test_supply_source_alone_still_works_and_keeps_the_rest(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, inventory_item=helmet, item_source='EPP')

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'supply_source': 'PURCHASE'}])

        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert (item.supply_source, item.inventory_item_id, item.item_source) == ('PURCHASE', helmet.pk, 'EPP')

    def test_several_lines_in_one_call(self, logistics_coordinator, ops_rq, helmet, gloves):
        first = make_item(ops_rq, 1)
        second = make_item(ops_rq, 2)
        third = make_item(ops_rq, 3)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': first.pk, 'inventory_item': helmet.pk},
            {'item_id': second.pk, 'inventory_item': gloves.pk, 'supply_source': 'STOCK'},
            {'item_id': third.pk, 'is_off_catalog': True, 'supply_source': 'PURCHASE'},
        ])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['updated_item_ids'] == [first.pk, second.pk, third.pk]
        for line in (first, second, third):
            line.refresh_from_db()
        assert (first.inventory_item_id, second.inventory_item_id) == (helmet.pk, gloves.pk)
        assert (third.is_off_catalog, third.supply_source) == (True, 'PURCHASE')

    def test_unchanged_values_are_reported_and_not_audited(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(
            ops_rq, 1, inventory_item=helmet, item_source='EPP', supply_source='STOCK',
            inventory_item_confirmed_at=timezone.now(),
        )

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk, 'item_source': 'EPP', 'supply_source': 'STOCK'},
        ])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['updated_item_ids'] == []
        assert response.data['unchanged_item_ids'] == [item.pk]
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_empty_items_list_is_accepted_and_changes_nothing(self, logistics_coordinator, ops_rq, item):
        response = _patch(logistics_coordinator, ops_rq, [])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['updated_item_ids'] == []

    def test_total_price_and_quantities_are_not_touched(self, logistics_coordinator, ops_rq, helmet):
        item = make_item(ops_rq, 1, quantity=10, unit_price=Decimal('5.00'))

        _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        item.refresh_from_db()
        assert item.quantity == Decimal('10.000')
        assert item.total_price == Decimal('50.00')
        assert item.unit_price == Decimal('5.00')


@pytest.mark.django_db
class TestPayloadValidation:
    @pytest.mark.parametrize('entry', [
        {'inventory_item': 999999},
        {'inventory_item': 'abc'},
        {'inventory_item': [1]},
        {'inventory_item': {'id': 1}},
        {'inventory_item': True},
        {'inventory_item': -1},
        {'is_off_catalog': 'maybe'},
        {'is_off_catalog': [True]},
        {'item_source': 'LAPTOPS'},
        {'item_source': 'epp'},
        {'item_source': 'X' * 100},
        {'item_source': None},
        {'supply_source': 'DROP TABLE items'},
        {'supply_source': ''},
        {'supply_source': None},
    ])
    def test_bad_values_are_rejected_with_400_and_change_nothing(
        self, logistics_coordinator, ops_rq, item, entry,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, **entry}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        item.refresh_from_db()
        assert (item.inventory_item_id, item.is_off_catalog, item.item_source, item.supply_source) == (
            None, False, '', '',
        )

    def test_float_product_reference_is_refused_not_truncated(self, logistics_coordinator, ops_rq, item, helmet):
        response = _patch(logistics_coordinator, ops_rq,
                          [{'item_id': item.pk, 'inventory_item': helmet.pk + 0.9}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        item.refresh_from_db()
        assert item.inventory_item_id is None

    def test_link_and_off_catalog_together_is_rejected(self, logistics_coordinator, ops_rq, item, helmet):
        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk, 'is_off_catalog': True},
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'is_off_catalog' in _errors(response)['items'][0]
        item.refresh_from_db()
        assert item.inventory_item_id is None and item.is_off_catalog is False

    def test_null_link_with_off_catalog_is_fine(self, logistics_coordinator, ops_rq, item):
        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': None, 'is_off_catalog': True},
        ])

        assert response.status_code == status.HTTP_200_OK

    def test_entry_without_any_field_to_update_is_rejected(self, logistics_coordinator, ops_rq, item):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_duplicate_item_ids_are_rejected(self, logistics_coordinator, ops_rq, item, helmet, gloves):
        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk},
            {'item_id': item.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        item.refresh_from_db()
        assert item.inventory_item_id is None

    @pytest.mark.parametrize('body', [
        {}, {'items': 'x'}, {'items': {'item_id': 1}}, {'items': [None]}, {'items': ['x']}, {'items': [[1]]},
        {'items': [{'inventory_item': 1}]}, {'items': [{'item_id': None, 'item_source': 'EPP'}]},
    ])
    def test_malformed_bodies_are_400_not_500(self, logistics_coordinator, ops_rq, body):
        response = client_for(logistics_coordinator).patch(_url(ops_rq), body, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_too_many_entries_are_rejected(self, logistics_coordinator, ops_rq):
        entries = [{'item_id': n, 'item_source': 'EPP'} for n in range(1, 502)]

        assert _patch(logistics_coordinator, ops_rq, entries).status_code == status.HTTP_400_BAD_REQUEST

    def test_an_invalid_entry_aborts_the_whole_call(self, logistics_coordinator, ops_rq, helmet):
        good = make_item(ops_rq, 1)
        other = make_item(ops_rq, 2)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': good.pk, 'inventory_item': helmet.pk},
            {'item_id': other.pk, 'item_source': 'NOPE'},
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        good.refresh_from_db()
        assert good.inventory_item_id is None


@pytest.mark.django_db
class TestForeignItems:
    def test_item_of_another_request_is_never_touched_and_is_reported(
        self, logistics_coordinator, ops_rq, helmet, foreign_request,
    ):
        mine = make_item(ops_rq, 1)
        foreign = make_item(foreign_request, 1)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': mine.pk, 'inventory_item': helmet.pk},
            {'item_id': foreign.pk, 'inventory_item': helmet.pk},
        ])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['updated_item_ids'] == [mine.pk]
        assert response.data['ignored_item_ids'] == [foreign.pk]
        foreign.refresh_from_db()
        assert foreign.inventory_item_id is None

    def test_nonexistent_item_id_is_reported_as_ignored(self, logistics_coordinator, ops_rq):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': 999999, 'item_source': 'EPP'}])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['ignored_item_ids'] == [999999]


@pytest.mark.django_db
class TestStateGuard:
    @pytest.mark.parametrize('state', TERMINAL_STATES)
    def test_terminal_request_answers_409_and_changes_nothing(
        self, logistics_coordinator, ops_rq, item, helmet, state,
    ):
        ops_rq.status = state
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk, 'supply_source': 'STOCK'},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'
        assert 'estado final' in response.data['detail']
        item.refresh_from_db()
        assert (item.inventory_item_id, item.supply_source) == (None, '')
        ops_rq.refresh_from_db()
        assert ops_rq.status == state

    @pytest.mark.parametrize('state', TERMINAL_STATES)
    def test_terminal_guard_also_applies_to_the_legacy_supply_source_payload(
        self, logistics_coordinator, ops_rq, item, state,
    ):
        ops_rq.status = state
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_409_CONFLICT

    def test_the_three_lists_cover_every_state_exactly_once(self):
        """A new RQ state must be classified here on purpose (default-deny in the service)."""
        everything = EDITABLE_STATES + NOT_EDITABLE_STATES + TERMINAL_STATES
        assert len(everything) == len(set(everything))
        assert set(everything) == set(RQStatusChoices.values)
        assert len(RQStatusChoices.values) == 47

    @pytest.mark.parametrize('state', RQStatusChoices.values)
    def test_only_the_editable_window_accepts_edits_in_every_state(
        self, logistics_coordinator, ops_rq, item, helmet, state,
    ):
        """
        All 47 states: 200 inside the window; outside it 409 and NOTHING is written
        (terminal states keep their own code; the rest answer REQUEST_STATE_NOT_EDITABLE).
        """
        ops_rq.status = state
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': item.pk, 'inventory_item': helmet.pk, 'supply_source': 'STOCK'},
        ])

        item.refresh_from_db()
        ops_rq.refresh_from_db()
        assert ops_rq.status == state  # the guard never moves the workflow
        if state == 'DRAFT':
            # SYSPCC-031: a draft is private to its requester: logistics does not see it (404).
            assert response.status_code == status.HTTP_404_NOT_FOUND
            assert item.inventory_item_id is None
            return
        if state in EDITABLE_STATES:
            assert response.status_code == status.HTTP_200_OK, (state, response.data)
            assert item.inventory_item_id == helmet.pk
        else:
            assert response.status_code == status.HTTP_409_CONFLICT, state
            expected = 'REQUEST_TERMINAL' if state in TERMINAL_STATES else 'REQUEST_STATE_NOT_EDITABLE'
            assert response.data['code'] == expected
            assert (item.inventory_item_id, item.supply_source) == (None, '')
            assert not ActivityLog.objects.filter(request=ops_rq).exists()

    @pytest.mark.parametrize('state', ['SUBMITTED', 'DELIVERED', 'QUALITY_REJECTED'])
    def test_the_not_editable_message_names_the_state_in_spanish(
        self, logistics_coordinator, ops_rq, item, state,
    ):
        ops_rq.status = state
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert set(response.data) == {'detail', 'code', 'item_ids'}
        assert 'desde la validación' in response.data['detail']
        assert Request(status=state).get_status_display() in response.data['detail']

    @pytest.mark.parametrize('state', ['SUBMITTED', 'DISPATCHED_TO_SITE', 'DELIVERED'])
    def test_the_window_also_applies_on_the_administrative_flow(self, logistics_supervisor, adm_rq, state):
        adm_item = make_item(adm_rq, 1)
        adm_rq.status = state
        adm_rq.save(update_fields=['status'])

        response = _patch(logistics_supervisor, adm_rq, [{'item_id': adm_item.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_STATE_NOT_EDITABLE'

    @pytest.mark.parametrize('state', ['VALIDATED', 'IN_STOCK', 'QUALITY_APPROVED'])
    def test_a_legacy_supply_source_only_payload_follows_the_same_window(
        self, logistics_coordinator, ops_rq, item, state,
    ):
        ops_rq.status = state
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'supply_source': 'PURCHASE'}])

        assert response.status_code == status.HTTP_200_OK

    def test_an_rq_that_already_went_through_a_dispatch_is_closed_to_edits_even_if_back_in_the_window(
        self, logistics_coordinator, central_warehouse, ops_rq, item, helmet,
    ):
        """
        Claim cycle: DELIVERED -> CLAIM_IN_REVIEW -> ... -> QUALITY_APPROVED lands in an
        editable state again, but the first DISPATCHED approval is the evidence that the
        product moved (even when no WarehouseDispatchItem was written for it).
        """
        ops_rq.status = 'QUALITY_APPROVED'
        ops_rq.save(update_fields=['status'])
        Approval.objects.create(
            request=ops_rq, action='DISPATCHED', performed_by=central_warehouse, role='CENTRAL_WAREHOUSE',
            previous_status='IN_STOCK', new_status='DISPATCHED_TO_SITE',
        )

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_STATE_NOT_EDITABLE'
        assert 'despacho' in response.data['detail']
        item.refresh_from_db()
        assert item.inventory_item_id is None

    def test_other_approvals_do_not_close_the_window(self, logistics_coordinator, project_resident, ops_rq, item, helmet):
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])
        Approval.objects.create(
            request=ops_rq, action='TECHNICAL_APPROVED', performed_by=project_resident, role='PROJECT_RESIDENT',
            previous_status='SUBMITTED', new_status='TECHNICAL_APPROVED',
        )

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK

    def test_the_terminal_set_matches_the_model(self):
        """Guard against drift: the states above are exactly Request.is_terminal."""
        for state in RQStatusChoices.values:
            assert Request(status=state).is_terminal == (state in TERMINAL_STATES), state

    def test_line_with_dispatches_answers_409_and_changes_nothing(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet, gloves,
    ):
        dispatched = make_item(ops_rq, 1, inventory_item=helmet)
        _dispatch(ops_rq, dispatched, 3, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': dispatched.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_DISPATCHED'
        assert response.data['item_ids'] == [dispatched.pk]
        dispatched.refresh_from_db()
        assert dispatched.inventory_item_id == helmet.pk

    def test_dispatch_guard_covers_every_editable_field(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        dispatched = make_item(ops_rq, 1, inventory_item=helmet, item_source='EPP', supply_source='STOCK')
        _dispatch(ops_rq, dispatched, 3, central_warehouse)

        for entry in ({'supply_source': 'PURCHASE'}, {'item_source': 'GASES'},
                      {'is_off_catalog': True}, {'inventory_item': None}):
            response = _patch(logistics_coordinator, ops_rq, [{'item_id': dispatched.pk, **entry}])
            assert response.status_code == status.HTTP_409_CONFLICT, entry

        dispatched.refresh_from_db()
        assert (dispatched.inventory_item_id, dispatched.item_source, dispatched.supply_source,
                dispatched.is_off_catalog) == (helmet.pk, 'EPP', 'STOCK', False)

    def test_other_lines_without_dispatch_remain_editable(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet, gloves,
    ):
        dispatched = make_item(ops_rq, 1, inventory_item=helmet)
        pending = make_item(ops_rq, 2)
        _dispatch(ops_rq, dispatched, 3, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': pending.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_200_OK
        pending.refresh_from_db()
        assert pending.inventory_item_id == gloves.pk

    def test_one_blocked_line_blocks_the_whole_call(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet, gloves,
    ):
        """All-or-nothing: the editable line must not be written if another one is blocked."""
        pending = make_item(ops_rq, 1)
        dispatched = make_item(ops_rq, 2, inventory_item=helmet)
        _dispatch(ops_rq, dispatched, 3, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': pending.pk, 'inventory_item': gloves.pk, 'supply_source': 'STOCK'},
            {'item_id': dispatched.pk, 'item_source': 'EPP'},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['item_ids'] == [dispatched.pk]
        pending.refresh_from_db()
        assert (pending.inventory_item_id, pending.supply_source) == (None, '')
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_a_dispatch_on_another_request_does_not_block_this_one(
        self, logistics_coordinator, central_warehouse, ops_rq, foreign_request, helmet, gloves,
    ):
        other_item = make_item(foreign_request, 1, inventory_item=helmet)
        _dispatch(foreign_request, other_item, 3, central_warehouse)
        mine = make_item(ops_rq, 1)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': mine.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_200_OK

    def test_guard_does_not_alter_the_request_status(self, logistics_coordinator, ops_rq, item, helmet):
        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])

        _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'VALIDATED'
        assert not ops_rq.approvals.exists()


@pytest.mark.django_db
class TestAtomicity:
    def test_failure_mid_call_rolls_back_every_line(self, logistics_coordinator, ops_rq, helmet, gloves, monkeypatch):
        first = make_item(ops_rq, 1)
        second = make_item(ops_rq, 2)
        original_save = RequestItem.save
        calls = {'n': 0}

        def flaky_save(self, *args, **kwargs):
            calls['n'] += 1
            if calls['n'] == 2:
                raise RuntimeError('boom')
            return original_save(self, *args, **kwargs)

        monkeypatch.setattr(RequestItem, 'save', flaky_save)
        client = client_for(logistics_coordinator)
        client.raise_request_exception = False

        response = client.patch(_url(ops_rq), {'items': [
            {'item_id': first.pk, 'inventory_item': helmet.pk},
            {'item_id': second.pk, 'inventory_item': gloves.pk},
        ]}, format='json')

        monkeypatch.undo()
        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        first.refresh_from_db()
        second.refresh_from_db()
        assert first.inventory_item_id is None
        assert second.inventory_item_id is None
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_unexpected_failure_is_logged_with_context(
        self, logistics_coordinator, ops_rq, item, helmet, monkeypatch, caplog,
    ):
        from apps.rq.tests.catalog_fixtures import capture_logs

        def boom(*args, **kwargs):
            raise RuntimeError('boom')

        monkeypatch.setattr('apps.rq.views.request.update_request_items', boom)
        client = client_for(logistics_coordinator)
        client.raise_request_exception = False

        with capture_logs(caplog, 'apps.rq.views.request'):
            response = client.patch(
                _url(ops_rq), {'items': [{'item_id': item.pk, 'inventory_item': helmet.pk}]}, format='json',
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        record = next(r for r in caplog.records if r.getMessage() == 'rq.update_items.unexpected')
        assert record.rq_id == ops_rq.pk
        assert record.user_id == logistics_coordinator.pk
        assert record.exc_info is not None


@pytest.mark.django_db
class TestAudit:
    def test_a_change_leaves_one_readable_activity_entry(self, logistics_coordinator, ops_rq, helmet):
        first = make_item(ops_rq, 1)
        second = make_item(ops_rq, 2)

        _patch(logistics_coordinator, ops_rq, [
            {'item_id': first.pk, 'inventory_item': helmet.pk, 'item_source': 'EPP'},
            {'item_id': second.pk, 'is_off_catalog': True, 'supply_source': 'PURCHASE'},
        ])

        entries = ActivityLog.objects.filter(request=ops_rq)
        assert entries.count() == 1
        entry = entries.get()
        assert entry.action == 'ITEMS_UPDATED'
        assert entry.user_id == logistics_coordinator.pk
        assert 'Línea 1' in entry.detail and 'EPP-0001' in entry.detail
        assert 'fuente: EPP' in entry.detail
        assert 'Línea 2' in entry.detail and 'fuera de catálogo' in entry.detail
        assert 'origen de atención: Requiere compra' in entry.detail
        assert 'PURCHASE' not in entry.detail      # human labels, not codes

    def test_the_audit_entry_is_visible_in_the_request_activity(self, logistics_coordinator, requester, ops_rq, helmet):
        item = make_item(ops_rq, 1)
        _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        response = client_for(requester).get(f'/api/v1/requests/{ops_rq.pk}/activity/')

        assert response.status_code == status.HTTP_200_OK
        assert [row['action'] for row in response.data] == ['ITEMS_UPDATED']
