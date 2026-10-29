"""
SYSPCC-026 (QA ronda 4): las cifras de `stock-availability` y el guard de recibos de
`update-items` contra lo que escribe el MOTOR REAL, no contra filas sembradas a mano.

Los tests de `test_stock_availability_endpoint.py` y `test_update_items_received_guard.py`
crean `WarehouseReceipt`/`WarehouseReceiptItem` directamente. Aquí el recibo lo crea
`WorkflowEngine.execute('RECEIVED')` (ingreso al pool + recibo) y el despacho lo hace
`execute('DISPATCHED')`, de modo que si el motor cambia la forma de sus filas (cantidad
recibida, fila por línea, línea de STOCK sin recibo) estos tests fallan y los sembrados no.

Reglas que se fijan:
  * lo comprado por un RQ que ya entró al pool NO se ofrece como disponible a otro RQ;
  * al despacharse, el pool baja y el compromiso desaparece (el neto no se descuenta dos veces);
  * una línea de STOCK de ese mismo RQ no genera recibo ni compromiso;
  * `update-items` sobre un RQ que el motor dejó en RECEIVING: 409 al cambiar el producto de una
    línea recibida, 200 al reenviar el mismo vínculo y 200 sobre una línea de STOCK sin recibo.

Flujo de gerencia intacto: solo se usa `execute` con las acciones y roles de la tabla.
"""
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import RoleChoices
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    central_warehouse,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_stock,
    ops_rq,
)
from apps.warehouse.models import (
    InventoryStock,
    WarehouseDispatchItem,
    WarehouseReceiptItem,
)


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
    make_stock(product, 5)
    return product


@pytest.fixture
def gloves(db):
    product = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')
    make_stock(product, 20)
    return product


def _pool(product):
    return InventoryStock.objects.get(inventory=product).quantity


def _receive(rq, user):
    """ADMINISTRATIVE: PO_GENERATED -> RECEIVING by the engine (ingress + receipt)."""
    rq.status = 'PO_GENERATED'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.LOGISTICS_SUPERVISOR).execute(
        'RECEIVED', comments='Recepción de prueba.',
    )


def _dispatch_after_quality(rq, user):
    """ADMINISTRATIVE: QUALITY_APPROVED -> DISPATCHED_TO_SITE by the engine (exit from the pool)."""
    rq.refresh_from_db()
    rq.status = 'QUALITY_APPROVED'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.LOGISTICS_SUPERVISOR).execute(
        'DISPATCHED', comments='Despacho de prueba.',
    )


def _availability(user, rq):
    response = client_for(user).get(f'/api/v1/requests/{rq.pk}/stock-availability/')
    assert response.status_code == status.HTTP_200_OK, response.data
    return {row['line_number']: row for row in response.data['items']}


@pytest.mark.django_db
class TestPurchaseReceivedByTheEngine:
    def test_what_one_rq_bought_is_not_offered_as_free_to_another_rq(
        self, adm_rq, ops_rq, logistics_supervisor, logistics_coordinator, helmet,
    ):
        """Pool 5 + purchase of 10 received for RQ A = 15 in the pool, 10 of them A's."""
        make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                  supply_source='PURCHASE')
        make_item(ops_rq, 1, description='Casco', quantity=8, inventory_item=helmet)

        _receive(adm_rq, logistics_supervisor)

        adm_rq.refresh_from_db()
        assert adm_rq.status == 'RECEIVING'
        assert _pool(helmet) == Decimal('15.000')            # the ingress really happened
        row = _availability(logistics_coordinator, ops_rq)[1]
        assert Decimal(row['available_central']) == Decimal('15')
        assert Decimal(row['committed_other_requests']) == Decimal('10')
        assert Decimal(row['available_net']) == Decimal('5')
        assert row['coverage'] == 'PARTIAL'
        assert Decimal(row['shortfall']) == Decimal('3')

    def test_the_receipt_the_engine_writes_is_what_the_commitment_reads(
        self, adm_rq, logistics_supervisor, helmet,
    ):
        item = make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                         supply_source='PURCHASE')

        _receive(adm_rq, logistics_supervisor)

        received = WarehouseReceiptItem.objects.get(request_item=item)
        assert received.quantity_received == Decimal('10.000')

    def test_once_the_purchase_is_dispatched_the_pool_drops_and_nothing_stays_committed(
        self, adm_rq, ops_rq, logistics_supervisor, logistics_coordinator, helmet,
    ):
        """The net figure must not subtract the same 10 twice (pool AND commitment)."""
        item = make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                         supply_source='PURCHASE')
        make_item(ops_rq, 1, description='Casco', quantity=3, inventory_item=helmet)
        _receive(adm_rq, logistics_supervisor)

        _dispatch_after_quality(adm_rq, logistics_supervisor)

        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DISPATCHED_TO_SITE'
        assert _pool(helmet) == Decimal('5.000')
        assert WarehouseDispatchItem.objects.get(request_item=item).quantity_dispatched == Decimal('10.000')
        row = _availability(logistics_coordinator, ops_rq)[1]
        assert Decimal(row['available_central']) == Decimal('5')
        assert Decimal(row['committed_other_requests']) == Decimal('0')
        assert Decimal(row['available_net']) == Decimal('5')
        assert row['coverage'] == 'FULL'

    def test_back_in_quality_approved_after_a_claim_the_dispatched_material_is_not_committed_again(
        self, adm_rq, ops_rq, logistics_supervisor, logistics_coordinator, helmet,
    ):
        """
        The claim cycle (DELIVERED -> CLAIM_IN_REVIEW -> ... -> QUALITY_APPROVED) brings the RQ
        back to a state that counts as "received, dispatch pending". Its 10 units already left the
        pool at the first dispatch, so the remainder (received - dispatched) is 0: counting the
        full purchase again would hide 10 units that are no longer there.
        """
        make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                  supply_source='PURCHASE')
        make_item(ops_rq, 1, description='Casco', quantity=3, inventory_item=helmet)
        _receive(adm_rq, logistics_supervisor)
        _dispatch_after_quality(adm_rq, logistics_supervisor)
        adm_rq.refresh_from_db()
        adm_rq.status = 'QUALITY_APPROVED'          # where the claim cycle leads back to
        adm_rq.save(update_fields=['status'])

        row = _availability(logistics_coordinator, ops_rq)[1]

        assert _pool(helmet) == Decimal('5.000')
        assert Decimal(row['committed_other_requests']) == Decimal('0')
        assert Decimal(row['available_net']) == Decimal('5')
        assert row['coverage'] == 'FULL'

    def test_a_stock_line_of_the_same_rq_makes_no_receipt_and_no_commitment(
        self, adm_rq, ops_rq, logistics_supervisor, logistics_coordinator, helmet, gloves,
    ):
        """Line 1 is served from stock (no purchase): only line 2 enters, only line 2 is committed."""
        from_stock = make_item(adm_rq, 1, description='Guantes', quantity=4, inventory_item=gloves,
                               supply_source='STOCK')
        bought = make_item(adm_rq, 2, description='Casco', quantity=10, inventory_item=helmet,
                           supply_source='PURCHASE')
        make_item(ops_rq, 1, description='Guantes', quantity=2, unit='PAR', inventory_item=gloves)
        make_item(ops_rq, 2, description='Casco', quantity=2, inventory_item=helmet)

        _receive(adm_rq, logistics_supervisor)

        assert not WarehouseReceiptItem.objects.filter(request_item=from_stock).exists()
        assert WarehouseReceiptItem.objects.filter(request_item=bought).exists()
        assert _pool(gloves) == Decimal('20.000')            # nothing entered for the stock line
        rows = _availability(logistics_coordinator, ops_rq)
        assert Decimal(rows[1]['committed_other_requests']) == Decimal('0')
        assert Decimal(rows[1]['available_net']) == Decimal('20')
        assert Decimal(rows[2]['committed_other_requests']) == Decimal('10')
        assert Decimal(rows[2]['available_net']) == Decimal('5')

    def test_a_purchase_line_with_no_origin_chosen_is_committed_like_a_purchase(
        self, adm_rq, ops_rq, logistics_supervisor, logistics_coordinator, helmet,
    ):
        """
        The engine ingresses every line that is not STOCK, also the ones whose origin was left
        blank; if the commitment skipped them their material would look free to the next RQ.
        """
        make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet)   # supply_source ''
        make_item(ops_rq, 1, description='Casco', quantity=8, inventory_item=helmet)

        _receive(adm_rq, logistics_supervisor)

        assert _pool(helmet) == Decimal('15.000')
        row = _availability(logistics_coordinator, ops_rq)[1]
        assert Decimal(row['committed_other_requests']) == Decimal('10')
        assert Decimal(row['available_net']) == Decimal('5')

    def test_the_rq_that_bought_it_does_not_see_its_own_purchase_as_committed(
        self, adm_rq, logistics_supervisor, helmet,
    ):
        make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                  supply_source='PURCHASE')
        _receive(adm_rq, logistics_supervisor)

        row = _availability(logistics_supervisor, adm_rq)[1]

        assert Decimal(row['available_central']) == Decimal('15')
        assert Decimal(row['committed_other_requests']) == Decimal('0')
        assert row['coverage'] == 'FULL'


@pytest.mark.django_db
class TestUpdateItemsOnAnRqTheEngineLeftReceiving:
    @pytest.fixture
    def received_rq(self, adm_rq, logistics_supervisor, helmet, gloves):
        """RQ in RECEIVING after the real RECEIVED: line 1 bought, line 2 from stock."""
        bought = make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                           supply_source='PURCHASE')
        from_stock = make_item(adm_rq, 2, description='Guantes', quantity=4, unit='PAR',
                               inventory_item=gloves, supply_source='STOCK')
        _receive(adm_rq, logistics_supervisor)
        adm_rq.refresh_from_db()
        assert adm_rq.status == 'RECEIVING'
        return adm_rq, bought, from_stock

    def _patch(self, user, rq, items):
        return client_for(user).patch(
            f'/api/v1/requests/{rq.pk}/update-items/', {'items': items}, format='json',
        )

    def test_changing_the_product_of_the_received_line_is_refused(
        self, received_rq, logistics_supervisor, gloves,
    ):
        rq, bought, _ = received_rq
        before = bought.inventory_item_id

        response = self._patch(logistics_supervisor, rq, [
            {'item_id': bought.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert response.data['item_ids'] == [bought.pk]
        bought.refresh_from_db()
        assert bought.inventory_item_id == before

    def test_marking_the_received_line_off_catalog_is_refused(
        self, received_rq, logistics_supervisor,
    ):
        rq, bought, _ = received_rq

        response = self._patch(logistics_supervisor, rq, [
            {'item_id': bought.pk, 'inventory_item': None, 'is_off_catalog': True},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'

    def test_a_line_without_product_that_got_a_receipt_row_cannot_be_marked_off_catalog(
        self, adm_rq, logistics_supervisor, helmet,
    ):
        """
        In a mixed RQ the engine writes a receipt row for EVERY line that is not STOCK, also for
        the ones that moved nothing (no product). The guard keys on that row: the product stays
        empty here, so only the off-catalog flag changes, and it must still be refused.
        """
        make_item(adm_rq, 1, description='Casco', quantity=10, inventory_item=helmet,
                  supply_source='PURCHASE')
        service = make_item(adm_rq, 2, description='Flete urgente', quantity=1, unit='GLB',
                            supply_source='PURCHASE')
        _receive(adm_rq, logistics_supervisor)
        assert WarehouseReceiptItem.objects.filter(request_item=service).exists()
        assert _pool(helmet) == Decimal('15.000')

        response = self._patch(logistics_supervisor, adm_rq, [
            {'item_id': service.pk, 'is_off_catalog': True},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'ITEMS_ALREADY_RECEIVED'
        assert response.data['item_ids'] == [service.pk]
        service.refresh_from_db()
        assert service.is_off_catalog is False

    def test_confirming_the_same_product_and_changing_the_origin_is_allowed(
        self, received_rq, logistics_supervisor, helmet,
    ):
        rq, bought, _ = received_rq

        response = self._patch(logistics_supervisor, rq, [
            {'item_id': bought.pk, 'inventory_item': helmet.pk, 'supply_source': 'PURCHASE',
             'item_source': 'EPP'},
        ])

        assert response.status_code == status.HTTP_200_OK, response.data
        bought.refresh_from_db()
        assert bought.inventory_item_id == helmet.pk
        assert bought.item_source == 'EPP'

    def test_a_line_served_from_stock_has_no_receipt_and_can_still_change_product(
        self, received_rq, logistics_supervisor, helmet,
    ):
        rq, _, from_stock = received_rq
        assert not WarehouseReceiptItem.objects.filter(request_item=from_stock).exists()

        response = self._patch(logistics_supervisor, rq, [
            {'item_id': from_stock.pk, 'inventory_item': helmet.pk},
        ])

        assert response.status_code == status.HTTP_200_OK, response.data
        from_stock.refresh_from_db()
        assert from_stock.inventory_item_id == helmet.pk

    def test_one_refused_line_blocks_the_whole_payload(
        self, received_rq, logistics_supervisor, helmet, gloves,
    ):
        """All or nothing: the allowed edit of line 2 is not applied when line 1 is refused."""
        rq, bought, from_stock = received_rq

        response = self._patch(logistics_supervisor, rq, [
            {'item_id': from_stock.pk, 'inventory_item': helmet.pk},
            {'item_id': bought.pk, 'inventory_item': gloves.pk},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        from_stock.refresh_from_db()
        assert from_stock.inventory_item_id == gloves.pk
