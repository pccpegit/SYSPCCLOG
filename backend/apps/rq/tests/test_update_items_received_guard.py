"""
SYSPCC-026: update-items refuses to change the catalog link of a line that already has
warehouse RECEIPTS.

A receipt means the purchase entered the CENTRAL pool as the product the line was linked
to. Re-linking the line afterwards (another product, no product, or "off-catalog") would
leave that entry attached to a product the RQ no longer points at, and the later dispatch
would take a different product out. It is the receiving twin of the guard that already
protects lines with dispatches.

Rules pinned here:
  * a CHANGE of `inventory_item` or `is_off_catalog` on a received line -> 409
    `ITEMS_ALREADY_RECEIVED` with the offending `item_ids`, nothing written (all-or-nothing);
  * `supply_source` / `item_source` stay editable on a received line;
  * re-sending the link the line already has (to confirm it) is not a change;
  * lines with dispatches keep answering `ITEMS_ALREADY_DISPATCHED` first.

The guard lives only in this auxiliary endpoint; no workflow transition is involved.
"""
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import WarehouseOriginChoices
from apps.rq.models import ActivityLog
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
from apps.warehouse.models import (
    WarehouseDispatch,
    WarehouseDispatchItem,
    WarehouseReceipt,
    WarehouseReceiptItem,
)

# Every test runs on an RQ in an editable state (the shared fixtures are SUBMITTED).
pytestmark = pytest.mark.usefixtures('rq_in_editable_state')


def _url(rq):
    return f'/api/v1/requests/{rq.pk}/update-items/'


def _patch(user, rq, items):
    return client_for(user).patch(_url(rq), {'items': items}, format='json')


def _receive(rq, item, by, quantity=10):
    receipt = WarehouseReceipt.objects.create(request=rq, received_by=by)
    return WarehouseReceiptItem.objects.create(
        receipt=receipt, request_item=item, quantity_received=Decimal(str(quantity)),
    )


def _dispatch(rq, item, by, quantity=3):
    dispatch = WarehouseDispatch.objects.create(
        request=rq, dispatched_by=by, origin=WarehouseOriginChoices.CENTRAL,
    )
    return WarehouseDispatchItem.objects.create(
        dispatch=dispatch, request_item=item, quantity_dispatched=Decimal(str(quantity)),
    )


def _snapshot(item):
    item.refresh_from_db()
    return (item.inventory_item_id, item.is_off_catalog, item.item_source, item.supply_source)


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')


@pytest.fixture
def gloves(db):
    return make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')


@pytest.fixture
def received(ops_rq, central_warehouse, helmet):
    """A purchased line linked to `helmet` whose material already entered the pool."""
    item = make_item(ops_rq, 1, description='Casco', inventory_item=helmet, supply_source='PURCHASE',
                     item_source='EPP')
    _receive(ops_rq, item, central_warehouse)
    return item


@pytest.mark.django_db
class TestChangingTheLinkOfAReceivedLine:
    def test_another_product_answers_409_and_changes_nothing(
        self, logistics_coordinator, ops_rq, received, helmet, gloves,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert response.data['item_ids'] == [received.pk]
        assert _snapshot(received) == (helmet.pk, False, 'EPP', 'PURCHASE')
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_dropping_the_product_answers_409(self, logistics_coordinator, ops_rq, received, helmet):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': None}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert _snapshot(received)[0] == helmet.pk

    def test_marking_it_off_catalog_answers_409(self, logistics_coordinator, ops_rq, received, helmet):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert _snapshot(received)[:2] == (helmet.pk, False)

    def test_an_unlinked_received_line_cannot_be_linked_after_the_fact(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        unlinked = make_item(ops_rq, 1, description='Casco', supply_source='PURCHASE')
        _receive(ops_rq, unlinked, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': unlinked.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert _snapshot(unlinked)[:2] == (None, False)

    def test_an_off_catalog_received_line_cannot_be_linked_after_the_fact(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        service = make_item(ops_rq, 1, description='Servicio', is_off_catalog=True, supply_source='PURCHASE')
        _receive(ops_rq, service, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': service.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert _snapshot(service)[:2] == (None, True)

    def test_the_message_is_in_spanish_and_the_shape_is_the_usual_409(
        self, logistics_coordinator, ops_rq, received, gloves,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert set(response.data) == {'detail', 'code', 'item_ids'}
        assert 'recibidos' in response.data['detail']
        assert 'catálogo' in response.data['detail']

    def test_the_administrative_flow_has_the_same_guard(
        self, logistics_supervisor, central_warehouse, adm_rq, helmet, gloves,
    ):
        item = make_item(adm_rq, 1, description='Casco', inventory_item=helmet, supply_source='PURCHASE')
        _receive(adm_rq, item, central_warehouse)

        response = _patch(logistics_supervisor, adm_rq, [{'item_id': item.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'

    def test_logistics_chief_is_held_to_the_same_guard(
        self, logistics_chief, ops_rq, received, gloves,
    ):
        response = _patch(logistics_chief, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT


@pytest.mark.django_db
class TestWhatStaysEditableOnAReceivedLine:
    def test_supply_source_and_item_source_can_still_change(
        self, logistics_coordinator, ops_rq, received, helmet,
    ):
        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': received.pk, 'supply_source': 'STOCK', 'item_source': 'HERRAMIENTAS'},
        ])

        assert response.status_code == status.HTTP_200_OK
        assert _snapshot(received) == (helmet.pk, False, 'HERRAMIENTAS', 'STOCK')

    def test_re_sending_the_same_product_is_not_a_change(
        self, logistics_coordinator, ops_rq, received, helmet,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK
        assert _snapshot(received)[:2] == (helmet.pk, False)

    def test_confirming_the_link_it_already_has_is_allowed_and_stamps_the_confirmation(
        self, logistics_coordinator, ops_rq, received, helmet,
    ):
        assert received.link_confirmed is False

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK
        received.refresh_from_db()
        assert received.link_confirmed is True
        assert received.inventory_item_id == helmet.pk

    def test_re_sending_the_same_off_catalog_mark_is_not_a_change(
        self, logistics_coordinator, central_warehouse, ops_rq,
    ):
        service = make_item(ops_rq, 1, description='Servicio', is_off_catalog=True, supply_source='PURCHASE')
        _receive(ops_rq, service, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': service.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK
        assert _snapshot(service)[:2] == (None, True)

    def test_a_line_without_receipts_remains_fully_editable(
        self, logistics_coordinator, ops_rq, received, gloves,
    ):
        pending = make_item(ops_rq, 2, description='Guantes')

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': pending.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_200_OK
        assert _snapshot(pending)[0] == gloves.pk

    def test_a_receipt_on_another_request_does_not_block_this_one(
        self, logistics_coordinator, central_warehouse, ops_rq, foreign_request, helmet, gloves,
    ):
        other = make_item(foreign_request, 1, description='Casco', inventory_item=helmet)
        _receive(foreign_request, other, central_warehouse)
        mine = make_item(ops_rq, 1, description='Casco', inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': mine.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_200_OK
        assert _snapshot(mine)[0] == gloves.pk

    def test_an_item_id_from_another_request_is_ignored_not_blocked(
        self, logistics_coordinator, central_warehouse, ops_rq, foreign_request, helmet, gloves,
    ):
        """A received line of someone else's RQ must neither block nor be touched through this one."""
        other = make_item(foreign_request, 1, description='Casco', inventory_item=helmet)
        _receive(foreign_request, other, central_warehouse)
        mine = make_item(ops_rq, 1, description='Guantes')

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': other.pk, 'inventory_item': gloves.pk},
            {'item_id': mine.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['ignored_item_ids'] == [other.pk]
        assert _snapshot(other)[0] == helmet.pk


@pytest.mark.django_db
class TestAllOrNothingAndPrecedence:
    def test_one_blocked_line_blocks_the_whole_call(
        self, logistics_coordinator, ops_rq, received, gloves,
    ):
        pending = make_item(ops_rq, 2, description='Guantes')

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': pending.pk, 'inventory_item': gloves.pk, 'supply_source': 'STOCK'},
            {'item_id': received.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['item_ids'] == [received.pk]
        assert _snapshot(pending) == (None, False, '', '')
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_every_blocked_line_is_reported_in_order(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet, gloves,
    ):
        first = make_item(ops_rq, 1, inventory_item=helmet, supply_source='PURCHASE')
        second = make_item(ops_rq, 2, inventory_item=helmet, supply_source='PURCHASE')
        _receive(ops_rq, first, central_warehouse)
        _receive(ops_rq, second, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': second.pk, 'inventory_item': gloves.pk},
            {'item_id': first.pk, 'is_off_catalog': True},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['item_ids'] == sorted([first.pk, second.pk])

    def test_several_receipts_on_one_line_are_reported_once(
        self, logistics_coordinator, central_warehouse, ops_rq, received, gloves,
    ):
        _receive(ops_rq, received, central_warehouse, quantity=2)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert response.data['item_ids'] == [received.pk]

    def test_a_line_with_dispatches_keeps_answering_the_dispatch_code_first(
        self, logistics_coordinator, central_warehouse, ops_rq, received, gloves,
    ):
        _dispatch(ops_rq, received, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_DISPATCHED'

    def test_the_existing_state_guard_still_comes_first(
        self, logistics_coordinator, ops_rq, received, gloves,
    ):
        ops_rq.status = 'CANCELLED'
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': received.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'
