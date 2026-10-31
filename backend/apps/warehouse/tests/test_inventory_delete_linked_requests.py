"""
SYSPCC-026: a catalog product that request lines point at cannot be deleted.

`RequestItem.inventory_item` is `on_delete=SET_NULL`, so the database would not object:
deleting the product silently emptied the link of every RQ line that used it (and the stock
check / dispatch could no longer find it). `DELETE /api/v1/warehouse/inventory/{id}/` now
answers 409 `item_linked_to_requests` instead. The FK itself is unchanged.

Movement history keeps its own protection (409 `item_has_movements`, PROTECT), covered in
test_review_round1_hardening.py.
"""
import datetime
from decimal import Decimal
from unittest import mock

import pytest

from apps.core.enums import AcquisitionTypeChoices, RoleChoices, RQFlowChoices
from apps.rq.models import Request, RequestItem
from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock

from .conftest import client_for, make_user
from .qa_support import INVENTORY, MOVEMENTS, tolerant_client

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


@pytest.fixture
def product(make_item):
    return make_item('EPP000001', 'CASCO DE SEGURIDAD', 'UND', stock=5)


def _rq_line(product, *, number='RQ-2026-0900', status='SUBMITTED', **extra):
    requester = make_user(f'req_{number[-4:]}', RoleChoices.REQUESTER)
    rq = Request.objects.create(
        rq_number=number, flow=RQFlowChoices.ADMINISTRATIVE, requested_by=requester, status=status,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )
    return RequestItem.objects.create(
        request=rq, line_number=1, description='Casco', quantity=Decimal('2'), unit='UND',
        inventory_item=product, **extra,
    )


def _delete(client, product):
    return client.delete(f'{INVENTORY}{product.pk}/')


class TestLinkedProductIsKept:
    def test_a_product_with_request_lines_answers_409_with_the_envelope(self, client, product):
        _rq_line(product)

        response = _delete(client, product)
        body = response.json()

        assert response.status_code == 409
        assert body['error'] is True and body['status_code'] == 409
        assert body['code'] == 'item_linked_to_requests'
        assert 'requerimientos' in body['detail'] and 'no se puede eliminar' in body['detail']

    def test_nothing_is_deleted_and_the_line_keeps_its_link(self, client, product):
        line = _rq_line(product)

        _delete(client, product)

        assert Inventory.objects.filter(pk=product.pk).exists()
        assert InventoryStock.objects.filter(inventory=product).exists()      # no half-deleted product
        line.refresh_from_db()
        assert line.inventory_item_id == product.pk

    def test_a_second_attempt_answers_the_same(self, client, product):
        _rq_line(product)

        assert _delete(client, product).status_code == 409
        assert _delete(client, product).status_code == 409

    def test_one_line_is_enough_among_many_products(self, client, make_item, product):
        other = make_item('EPP000002', 'GUANTE', 'EA', stock=3)
        _rq_line(product)

        assert _delete(client, other).status_code == 204
        assert _delete(client, product).status_code == 409

    @pytest.mark.parametrize('state', ['DRAFT', 'IN_STOCK', 'DELIVERED', 'CLOSED', 'CANCELLED'])
    def test_the_state_of_the_request_does_not_matter(self, client, product, state):
        """A closed or cancelled RQ still shows the product on its history: the link is protected too."""
        _rq_line(product, status=state)

        assert _delete(client, product).status_code == 409
        assert Inventory.objects.filter(pk=product.pk).exists()

    def test_it_is_checked_before_the_movement_history(self, client, product):
        """With both a request line and a movement the answer is still a 409 and nothing is lost."""
        _rq_line(product)
        exit_payload = {'inventory': product.pk, 'quantity': 1, 'warehouse': 'CENTRAL',
                        'destination_type': 'PROJECT', 'destination_detail': 'Obra Prueba'}
        assert client.post(MOVEMENTS + 'exit/', exit_payload, format='json').status_code == 201

        response = _delete(client, product)

        assert response.status_code == 409
        assert response.json()['code'] in ('item_linked_to_requests', 'item_has_movements')
        assert Inventory.objects.filter(pk=product.pk).exists()
        assert InventoryMovement.objects.filter(inventory=product).exists()


class TestUnlinkedProductIsStillDeleted:
    def test_a_product_no_line_points_at_is_deleted_with_its_stock_rows(self, client, product):
        assert _delete(client, product).status_code == 204
        assert not Inventory.objects.filter(pk=product.pk).exists()
        assert not InventoryStock.objects.filter(inventory_id=product.pk).exists()

    def test_lines_of_other_products_do_not_block(self, client, make_item, product):
        other = make_item('EPP000002', 'GUANTE', 'EA', stock=3)
        _rq_line(other)

        assert _delete(client, product).status_code == 204

    def test_once_the_line_is_unlinked_the_product_can_go(self, client, product):
        line = _rq_line(product)
        assert _delete(client, product).status_code == 409

        line.inventory_item = None
        line.save(update_fields=['inventory_item'])

        assert _delete(client, product).status_code == 204
        line.refresh_from_db()
        assert line.inventory_item_id is None

    def test_a_request_that_was_deleted_no_longer_blocks_the_product(self, client, product):
        line = _rq_line(product)
        line.request.delete()                       # a DRAFT removed by its owner takes its lines along

        assert _delete(client, product).status_code == 204


class TestAccessIsUnchanged:
    def test_a_user_without_a_warehouse_role_still_gets_403_not_the_conflict(self, product):
        _rq_line(product)
        requester = make_user('plain_requester', RoleChoices.REQUESTER)

        response = client_for(requester).delete(f'{INVENTORY}{product.pk}/')

        assert response.status_code == 403
        assert Inventory.objects.filter(pk=product.pk).exists()

    def test_anonymous_gets_401(self, api_client, product):
        assert api_client.delete(f'{INVENTORY}{product.pk}/').status_code == 401

    def test_a_missing_product_is_a_404(self, client):
        assert client.delete(f'{INVENTORY}999999/').status_code == 404
