"""
SYSPCC-026 (QA ronda 4): borrar un producto del catálogo cuando otra petición ya lo borró.

`InventoryViewSet.perform_destroy` bloquea la fila del producto antes de contar las líneas de
RQ que apuntan a él. Si entre `get_object()` y ese bloqueo otra petición borró el producto, la
fila ya no existe: la respuesta debe ser un 404 limpio (no un 500 ni un "borrado" fantasma).
Es la única rama de `perform_destroy` que los tests de `test_inventory_delete_linked_requests.py`
no recorren, porque un id inexistente se rechaza antes, en `get_object()`.
"""
from unittest import mock

import pytest

from apps.warehouse.models import Inventory
from apps.warehouse.views import InventoryViewSet

from .qa_support import INVENTORY, tolerant_client

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def product(make_item):
    return make_item('EPP000077', 'GUANTES DE CUERO', 'PAR', stock=3)


def test_a_product_deleted_by_another_request_before_the_lock_answers_404(central_warehouse, product):
    real_get_object = InventoryViewSet.get_object

    def get_then_lose_the_race(self):
        instance = real_get_object(self)
        Inventory.objects.filter(pk=instance.pk).delete()      # the other request wins here
        return instance

    client = tolerant_client(central_warehouse)
    with mock.patch.object(InventoryViewSet, 'get_object', get_then_lose_the_race):
        response = client.delete(f'{INVENTORY}{product.pk}/')

    assert response.status_code == 404
    assert not Inventory.objects.filter(pk=product.pk).exists()
