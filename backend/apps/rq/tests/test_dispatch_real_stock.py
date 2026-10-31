"""
SYSPCC-028 (Paso A / "Fase 3"): el DISPATCHED del motor descuenta stock de verdad.

Todo se ejecuta a través del motor real (`WorkflowEngine.execute`) con las acciones y roles
de la tabla de gerencia; el flujo no cambia (lo congela test_workflow_snapshot.py).

Cubre:
  * R1: RQ OPS con proyecto descuenta del POOL central (project=NULL); el proyecto queda
    solo como destino. ADM (sin proyecto) igual.
  * Remanente: el segundo DISPATCHED tras el ciclo de reclamo no vuelve a descontar.
  * Un ítem sin stock no aborta a los demás y el faltante queda visible (log +
    ActivityLog STOCK_DISCREPANCY + nota del despacho); el RQ avanza igual.
  * Vínculo sin confirmar o sin FK: no mueve stock.
  * Recepción: enlaza la línea de OC (`po_items`) y no ingresa líneas sin vínculo confirmado.
  * Hook de fechas por (estado previo, estado nuevo), set-if-null, en OPS y ADM.
  * Un fallo al escribir el despacho no envenena la transición.
"""
import datetime
from decimal import Decimal
from unittest import mock

import pytest

from apps.core.enums import RoleChoices
from apps.core.exceptions import WorkflowError
from apps.rq.models import ActivityLog, Approval, PurchaseOrder, PurchaseOrderItem, Quotation, Supplier
from apps.rq.services.stock_availability import committed_to_other_requests
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    capture_logs,
    central_warehouse,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_stock,
    ops_rq,
)
from apps.warehouse.models import (
    InventoryMovement,
    InventoryStock,
    MovementGroup,
    WarehouseDispatch,
    WarehouseDispatchItem,
    WarehouseReceipt,
    WarehouseReceiptItem,
)

pytestmark = pytest.mark.django_db

FULFILLMENT_LOGGER = 'apps.warehouse.services.rq_fulfillment'


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
    make_stock(product, 10)
    return product


@pytest.fixture
def gloves(db):
    product = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')
    make_stock(product, 20)
    return product


def _pool(product):
    return InventoryStock.objects.get(inventory=product, project=None, department=None).quantity


def _dispatch(rq, user, *, from_status='IN_STOCK', role=RoleChoices.CENTRAL_WAREHOUSE):
    rq.status = from_status
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, role).execute('DISPATCHED', comments='Despacho de prueba.')


def _discrepancies(rq):
    return list(ActivityLog.objects.filter(request=rq, action='STOCK_DISCREPANCY'))


# ──────────────────── R1: descuenta del pool ────────────────────

class TestDiscountsFromThePool:
    def test_ops_rq_with_project_discounts_the_central_pool(
        self, ops_rq, central_warehouse, helmet, project,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert _pool(helmet) == Decimal('7.000')
        dispatch = WarehouseDispatch.objects.get(request=ops_rq)
        assert dispatch.destination_project == project
        assert dispatch.origin == 'CENTRAL'
        assert dispatch.dispatch_number == dispatch.movement_group.group_number
        assert dispatch.items.get().quantity_dispatched == Decimal('3.000')

    def test_the_project_is_only_the_destination_of_the_voucher(
        self, ops_rq, central_warehouse, helmet, project,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        group = MovementGroup.objects.get(movement_type='EXIT')
        assert group.project_id is None
        assert (group.destination_type, group.destination_detail) == ('PROJECT', project.name)
        assert group.notes == f'Despacho automático RQ {ops_rq.rq_number}'
        assert InventoryMovement.objects.get().project_id is None

    def test_a_stock_row_scoped_to_the_project_is_not_touched(
        self, ops_rq, central_warehouse, helmet, project,
    ):
        scoped = make_stock(helmet, 50, project=project)
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        scoped.refresh_from_db()
        assert scoped.quantity == Decimal('50.000')
        assert _pool(helmet) == Decimal('7.000')

    def test_no_zero_row_is_created_when_the_pool_has_no_row(
        self, ops_rq, central_warehouse, project,
    ):
        product = make_inventory('EPP-0099', 'Sin stock', 'UND')
        make_item(ops_rq, 1, quantity=3, inventory_item=product, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        assert not InventoryStock.objects.filter(inventory=product).exists()

    def test_administrative_rq_discounts_the_pool_and_goes_straight_to_delivered(
        self, adm_rq, central_warehouse, helmet, department,
    ):
        make_item(adm_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)

        _dispatch(adm_rq, central_warehouse)

        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DELIVERED'
        assert _pool(helmet) == Decimal('6.000')
        dispatch = WarehouseDispatch.objects.get(request=adm_rq)
        assert dispatch.destination_department == department
        assert dispatch.destination_project is None

    def test_two_lines_of_the_same_product_share_the_pool(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=6, inventory_item=helmet, confirmed=True)
        make_item(ops_rq, 2, quantity=6, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        assert _pool(helmet) == Decimal('0.000')
        assert [d.quantity_dispatched for d in WarehouseDispatchItem.objects.order_by('request_item__line_number')] \
            == [Decimal('6.000'), Decimal('4.000')]
        shortage = _discrepancies(ops_rq)
        assert len(shortage) == 1 and 'línea 2' in shortage[0].detail

    def test_no_guide_number_is_invented(self, ops_rq, central_warehouse, helmet):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        assert WarehouseDispatch.objects.get().dispatch_guide_number == ''


# ──────────────────── remanente e idempotencia ────────────────────

class TestRemainder:
    def test_second_dispatched_after_the_claim_cycle_does_not_discount_again(
        self, ops_rq, central_warehouse, logistics_coordinator, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        _dispatch(ops_rq, central_warehouse)
        assert _pool(helmet) == Decimal('7.000')

        # CLAIM_IN_REVIEW -> ... -> QUALITY_APPROVED -> DISPATCHED se recorre otra vez.
        _dispatch(ops_rq, logistics_coordinator, from_status='QUALITY_APPROVED',
                  role=RoleChoices.LOGISTICS_COORDINATOR)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert _pool(helmet) == Decimal('7.000')
        assert WarehouseDispatch.objects.filter(request=ops_rq).count() == 1
        assert MovementGroup.objects.filter(movement_type='EXIT').count() == 1
        assert _discrepancies(ops_rq) == []

    def test_double_click_is_refused_by_the_state_machine_and_discounts_once(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        _dispatch(ops_rq, central_warehouse)

        with pytest.raises(WorkflowError):
            WorkflowEngine(ops_rq, central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')

        assert _pool(helmet) == Decimal('7.000')

    def test_a_partially_dispatched_line_gets_only_its_remainder_later(
        self, ops_rq, central_warehouse, logistics_coordinator, helmet,
    ):
        helmet_stock = InventoryStock.objects.get(inventory=helmet)
        helmet_stock.quantity = Decimal('2')
        helmet_stock.save()
        item = make_item(ops_rq, 1, quantity=5, inventory_item=helmet, confirmed=True)
        _dispatch(ops_rq, central_warehouse)
        assert _pool(helmet) == Decimal('0.000')
        assert WarehouseDispatchItem.objects.get().quantity_dispatched == Decimal('2.000')

        helmet_stock.refresh_from_db()
        helmet_stock.quantity = Decimal('10')            # llegó reposición al pool
        helmet_stock.save()
        _dispatch(ops_rq, logistics_coordinator, from_status='QUALITY_APPROVED',
                  role=RoleChoices.LOGISTICS_COORDINATOR)

        assert _pool(helmet) == Decimal('7.000')         # salieron 3 (5 − 2), no 5
        assert sum(d.quantity_dispatched for d in WarehouseDispatchItem.objects.filter(request_item=item)) \
            == Decimal('5.000')


# ──────────────────── faltantes visibles ────────────────────

class TestShortages:
    def test_an_item_without_stock_does_not_abort_the_others_and_stays_visible(
        self, ops_rq, central_warehouse, helmet, caplog,
    ):
        empty = make_inventory('EPP-0003', 'Arnés', 'UND')
        make_stock(empty, 0)
        no_stock = make_item(ops_rq, 1, quantity=2, inventory_item=empty, confirmed=True)
        ok = make_item(ops_rq, 2, quantity=3, inventory_item=helmet, confirmed=True)

        with capture_logs(caplog, FULFILLMENT_LOGGER):
            _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'                    # el RQ avanza igual
        assert _pool(helmet) == Decimal('7.000')
        assert list(WarehouseDispatchItem.objects.values_list('request_item_id', flat=True)) == [ok.pk]
        # visible: log estructurado, ActivityLog y nota del despacho
        record = next(r for r in caplog.records if r.getMessage() == 'rq_fulfillment.stock_shortage')
        assert record.request_item_id == no_stock.pk and record.product_code == 'EPP-0003'
        [entry] = _discrepancies(ops_rq)
        assert 'línea 1 (EPP-0003)' in entry.detail and 'falta 2' in entry.detail
        assert 'Faltantes' in WarehouseDispatch.objects.get().notes

    def test_a_partially_covered_line_dispatches_what_the_pool_has_and_records_the_rest(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=15, inventory_item=helmet, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        assert _pool(helmet) == Decimal('0.000')
        assert WarehouseDispatchItem.objects.get().quantity_dispatched == Decimal('10.000')
        [entry] = _discrepancies(ops_rq)
        assert 'falta 5' in entry.detail and 'disponible en el almacén central: 10' in entry.detail

    def test_when_nothing_is_covered_there_is_no_document_but_the_rq_advances(
        self, ops_rq, central_warehouse,
    ):
        product = make_inventory('EPP-0004', 'Sin existencias', 'UND')
        make_item(ops_rq, 1, quantity=2, inventory_item=product, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert not WarehouseDispatch.objects.exists()
        assert not MovementGroup.objects.exists()
        assert len(_discrepancies(ops_rq)) == 1
        assert Approval.objects.filter(request=ops_rq, action='DISPATCHED').exists()

    def test_a_failure_writing_the_documents_rolls_back_and_does_not_block_the_transition(
        self, ops_rq, central_warehouse, helmet, caplog,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        with mock.patch(
            'apps.warehouse.services.rq_fulfillment.register_exit_batch',
            side_effect=RuntimeError('boom'),
        ), capture_logs(caplog, FULFILLMENT_LOGGER):
            _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert Approval.objects.filter(request=ops_rq, action='DISPATCHED').exists()   # transaction still usable
        assert _pool(helmet) == Decimal('10.000')
        assert not WarehouseDispatch.objects.exists()
        assert any(r.getMessage() == 'rq_fulfillment.write_failed' for r in caplog.records)
        [entry] = _discrepancies(ops_rq)
        assert 'error al registrar el despacho' in entry.detail

    def test_the_failed_dispatch_is_retried_in_full_by_the_next_dispatched(
        self, ops_rq, central_warehouse, logistics_coordinator, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        with mock.patch(
            'apps.warehouse.services.rq_fulfillment.register_exit_batch', side_effect=RuntimeError('boom'),
        ):
            _dispatch(ops_rq, central_warehouse)

        _dispatch(ops_rq, logistics_coordinator, from_status='QUALITY_APPROVED',
                  role=RoleChoices.LOGISTICS_COORDINATOR)

        assert _pool(helmet) == Decimal('7.000')


class TestAtomicityAfterTheMovement:
    def test_a_failure_after_the_movement_leaves_no_trace_of_it(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)

        with mock.patch.object(WarehouseDispatch.objects, 'create', side_effect=RuntimeError('boom')):
            _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert _pool(helmet) == Decimal('10.000')                 # the discount was rolled back
        assert MovementGroup.objects.count() == 0
        assert InventoryMovement.objects.count() == 0
        assert WarehouseDispatchItem.objects.count() == 0
        assert len(_discrepancies(ops_rq)) == 1


# ──────────────────── vínculos sin confirmar ────────────────────

class TestUnconfirmedLinks:
    def test_a_proposed_link_without_confirmation_moves_no_stock(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet)             # propuesto, sin confirmar

        _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert _pool(helmet) == Decimal('10.000')
        assert not WarehouseDispatch.objects.exists()

    def test_a_line_without_fk_matching_the_catalog_text_moves_no_stock(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, description='Casco de seguridad blanco', quantity=3)

        _dispatch(ops_rq, central_warehouse)

        assert _pool(helmet) == Decimal('10.000')
        assert not MovementGroup.objects.exists()

    def test_in_a_mixed_rq_only_the_confirmed_line_leaves(
        self, ops_rq, central_warehouse, helmet, gloves,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet)
        make_item(ops_rq, 2, quantity=4, unit='PAR', inventory_item=gloves, confirmed=True)

        _dispatch(ops_rq, central_warehouse)

        assert _pool(helmet) == Decimal('10.000')
        assert _pool(gloves) == Decimal('16.000')


# ──────────────────── recepción ────────────────────

def _purchase_order(rq, user, number='OC-2026-0001'):
    supplier = Supplier.objects.create(ruc='20123456789', business_name='Proveedor Prueba')
    quotation = Quotation.objects.create(request=rq, supplier=supplier, total_amount=Decimal('100'))
    return PurchaseOrder.objects.create(
        po_number=number, request=rq, quotation=quotation, supplier=supplier,
        generated_by=user, total_amount=Decimal('100'),
    )


def _po_line(po, item):
    return PurchaseOrderItem.objects.create(
        purchase_order=po, request_item=item, description=item.description,
        quantity=item.quantity, unit=item.unit, unit_price=Decimal('1'), total_price=item.quantity,
    )


def _receive(rq, user):
    rq.status = 'PO_GENERATED'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.LOGISTICS_COORDINATOR).execute('RECEIVED')


class TestReceipt:
    def test_receipt_item_is_linked_to_its_purchase_order_line(
        self, ops_rq, logistics_coordinator, helmet,
    ):
        item = make_item(ops_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)
        po_line = _po_line(_purchase_order(ops_rq, logistics_coordinator), item)

        _receive(ops_rq, logistics_coordinator)

        receipt_item = WarehouseReceiptItem.objects.get(request_item=item)
        assert receipt_item.purchase_order_item == po_line
        assert WarehouseReceipt.objects.get(request=ops_rq).purchase_order == po_line.purchase_order
        assert _pool(helmet) == Decimal('14.000')

    def test_a_line_without_purchase_order_line_keeps_the_receipt_with_a_null_link(
        self, ops_rq, logistics_coordinator, helmet,
    ):
        item = make_item(ops_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)

        _receive(ops_rq, logistics_coordinator)

        assert WarehouseReceiptItem.objects.get(request_item=item).purchase_order_item is None

    def test_unconfirmed_lines_are_not_ingressed(
        self, ops_rq, logistics_coordinator, helmet, gloves,
    ):
        make_item(ops_rq, 1, quantity=4, inventory_item=helmet)                       # sin confirmar
        make_item(ops_rq, 2, quantity=5, unit='PAR', inventory_item=gloves, confirmed=True)
        make_item(ops_rq, 3, description='Casco de seguridad blanco', quantity=7)     # sin FK

        _receive(ops_rq, logistics_coordinator)

        assert _pool(helmet) == Decimal('10.000')
        assert _pool(gloves) == Decimal('25.000')
        assert set(InventoryMovement.objects.values_list('inventory_id', flat=True)) == {gloves.pk}

    def test_an_rq_with_only_unconfirmed_lines_ingresses_nothing_and_still_advances(
        self, ops_rq, logistics_coordinator, helmet,
    ):
        make_item(ops_rq, 1, quantity=4, inventory_item=helmet)

        _receive(ops_rq, logistics_coordinator)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'RECEIVING'
        assert not MovementGroup.objects.exists() and not WarehouseReceipt.objects.exists()


def _receive_adm(rq, user):
    rq.status = 'PO_GENERATED'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.LOGISTICS_SUPERVISOR).execute('RECEIVED')


class TestMixedReceiptHasNoPhantomCommitment:
    """A receipt row is read as "already in the pool": it must exist only for lines that entered."""

    def test_confirmed_plus_unconfirmed_purchase_lines(
        self, adm_rq, logistics_supervisor, helmet, gloves,
    ):
        helmet_stock = InventoryStock.objects.get(inventory=helmet)
        helmet_stock.quantity = Decimal('5')
        helmet_stock.save()
        confirmed = make_item(adm_rq, 1, quantity=5, unit='PAR', inventory_item=gloves, confirmed=True,
                              supply_source='PURCHASE')
        unconfirmed = make_item(adm_rq, 2, quantity=10, inventory_item=helmet, supply_source='PURCHASE')

        _receive_adm(adm_rq, logistics_supervisor)

        assert _pool(gloves) == Decimal('25.000')
        assert _pool(helmet) == Decimal('5.000')                       # nothing entered for the helmet
        assert set(InventoryMovement.objects.values_list('inventory_id', flat=True)) == {gloves.pk}
        assert list(WarehouseReceiptItem.objects.values_list('request_item_id', flat=True)) == [confirmed.pk]
        committed = committed_to_other_requests({helmet.pk, gloves.pk}, exclude_request_id=0)
        assert committed.get(helmet.pk, Decimal('0')) == Decimal('0')   # no phantom commitment
        assert committed[gloves.pk] == Decimal('5')
        assert not WarehouseReceiptItem.objects.filter(request_item=unconfirmed).exists()

    def test_a_receipt_row_of_an_unconfirmed_line_is_ignored_by_the_commitment(
        self, adm_rq, logistics_supervisor, helmet,
    ):
        """Defense in depth: even if such a row exists (legacy/manual data), it promises nothing."""
        item = make_item(adm_rq, 1, quantity=10, inventory_item=helmet, supply_source='PURCHASE')
        adm_rq.status = 'RECEIVING'
        adm_rq.save(update_fields=['status'])
        receipt = WarehouseReceipt.objects.create(request=adm_rq, received_by=logistics_supervisor)
        WarehouseReceiptItem.objects.create(receipt=receipt, request_item=item, quantity_received=10)

        assert committed_to_other_requests({helmet.pk}, exclude_request_id=0) == {}

        type(item).objects.filter(pk=item.pk).update(inventory_item_confirmed_at='2026-01-01T00:00:00Z')
        assert committed_to_other_requests({helmet.pk}, exclude_request_id=0) == {helmet.pk: Decimal('10')}


class TestUnlinkedLinesAreVisible:
    def test_received_leaves_an_activity_entry_for_the_skipped_lines(
        self, adm_rq, logistics_supervisor, helmet, gloves,
    ):
        make_item(adm_rq, 1, quantity=5, unit='PAR', inventory_item=gloves, confirmed=True,
                  supply_source='PURCHASE')
        make_item(adm_rq, 2, description='Casco blanco', quantity=3, inventory_item=helmet,
                  supply_source='PURCHASE')
        make_item(adm_rq, 3, description='Servicio de flete', quantity=1, is_off_catalog=True,
                  supply_source='PURCHASE')

        _receive_adm(adm_rq, logistics_supervisor)

        [entry] = ActivityLog.objects.filter(request=adm_rq, action='STOCK_UNLINKED')
        assert 'no ingresaron al almacén' in entry.detail
        assert 'línea 2 (Casco blanco)' in entry.detail
        assert 'línea 3' not in entry.detail and 'línea 1' not in entry.detail   # off-catalog is deliberate

    def test_received_with_only_unlinked_lines_still_logs_and_advances(
        self, ops_rq, logistics_coordinator, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet)

        _receive(ops_rq, logistics_coordinator)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'RECEIVING'
        assert ActivityLog.objects.filter(request=ops_rq, action='STOCK_UNLINKED').count() == 1

    def test_dispatched_leaves_an_activity_entry_for_the_skipped_lines(
        self, ops_rq, central_warehouse, helmet, gloves,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        make_item(ops_rq, 2, description='Guantes de cuero', quantity=2, unit='PAR')

        _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        [entry] = ActivityLog.objects.filter(request=ops_rq, action='STOCK_UNLINKED')
        assert 'no salieron del almacén' in entry.detail and 'línea 2 (Guantes de cuero)' in entry.detail

    def test_no_entry_when_every_line_is_confirmed_or_off_catalog(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        make_item(ops_rq, 2, description='Flete', quantity=1, is_off_catalog=True)

        _dispatch(ops_rq, central_warehouse)

        assert not ActivityLog.objects.filter(request=ops_rq, action='STOCK_UNLINKED').exists()

    def test_a_failure_logging_the_entry_does_not_block_the_transition(
        self, ops_rq, central_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=2, unit='PAR', description='Sin vincular')

        real_create = ActivityLog.objects.create

        def fail_for_unlinked(*args, **kwargs):
            if kwargs.get('action') == 'STOCK_UNLINKED':
                raise RuntimeError('boom')
            return real_create(*args, **kwargs)

        with mock.patch.object(ActivityLog.objects, 'create', side_effect=fail_for_unlinked):
            _dispatch(ops_rq, central_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DISPATCHED_TO_SITE'
        assert Approval.objects.filter(request=ops_rq, action='DISPATCHED').exists()


# ──────────────────── fechas de entrega ────────────────────

def _site_deliver(rq, user):
    rq.status = 'DISPATCHED_TO_SITE'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.SITE_WAREHOUSE).execute('WAREHOUSE_RECORDS_UPDATED')


class TestDeliveryDates:
    def test_ops_dispatched_to_site_to_delivered_completes_the_dates(
        self, ops_rq, central_warehouse, site_warehouse, helmet,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        _dispatch(ops_rq, central_warehouse)
        dispatch = WarehouseDispatch.objects.get()
        assert dispatch.delivered_at is None and dispatch.accepted_by is None
        ops_rq.refresh_from_db()
        assert ops_rq.fecha_real_entrega is None                   # el despacho OPS aún no entrega

        _site_deliver(ops_rq, site_warehouse)

        dispatch.refresh_from_db()
        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DELIVERED'
        assert dispatch.delivered_at is not None
        assert dispatch.accepted_by == site_warehouse
        assert ops_rq.fecha_real_entrega is not None

    def test_existing_dates_are_never_overwritten(
        self, ops_rq, central_warehouse, site_warehouse, helmet, django_user_model,
    ):
        make_item(ops_rq, 1, quantity=3, inventory_item=helmet, confirmed=True)
        _dispatch(ops_rq, central_warehouse)
        earlier = datetime.datetime(2026, 1, 5, 10, 0, tzinfo=datetime.timezone.utc)
        WarehouseDispatch.objects.update(delivered_at=earlier, accepted_by=central_warehouse)
        ops_rq.fecha_real_entrega = datetime.date(2026, 1, 5)
        ops_rq.save(update_fields=['fecha_real_entrega'])

        _site_deliver(ops_rq, site_warehouse)

        dispatch = WarehouseDispatch.objects.get()
        ops_rq.refresh_from_db()
        assert dispatch.delivered_at == earlier and dispatch.accepted_by == central_warehouse
        assert ops_rq.fecha_real_entrega == datetime.date(2026, 1, 5)

    def test_ops_delivery_without_any_dispatch_document_still_sets_the_rq_date(
        self, ops_rq, site_warehouse,
    ):
        _site_deliver(ops_rq, site_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DELIVERED'
        assert ops_rq.fecha_real_entrega is not None

    def test_adm_direct_in_stock_to_delivered_completes_the_dates_inside_the_dispatch(
        self, adm_rq, central_warehouse, helmet,
    ):
        make_item(adm_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)

        _dispatch(adm_rq, central_warehouse)

        dispatch = WarehouseDispatch.objects.get()
        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DELIVERED'
        assert dispatch.delivered_at is not None and dispatch.accepted_by == central_warehouse
        assert adm_rq.fecha_real_entrega is not None

    def test_adm_dispatch_through_quality_approved_waits_for_the_site_update(
        self, adm_rq, logistics_supervisor, central_warehouse, helmet,
    ):
        make_item(adm_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)
        _dispatch(adm_rq, logistics_supervisor, from_status='QUALITY_APPROVED',
                  role=RoleChoices.LOGISTICS_SUPERVISOR)
        dispatch = WarehouseDispatch.objects.get()
        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DISPATCHED_TO_SITE'
        assert dispatch.delivered_at is None and adm_rq.fecha_real_entrega is None

        adm_rq.status = 'DISPATCHED_TO_SITE'
        WorkflowEngine(adm_rq, central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute(
            'WAREHOUSE_RECORDS_UPDATED')

        dispatch.refresh_from_db()
        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DELIVERED'
        assert dispatch.delivered_at is not None and adm_rq.fecha_real_entrega is not None

    def test_adm_delivered_to_warehouse_updated_does_not_touch_the_dates(
        self, adm_rq, central_warehouse, helmet,
    ):
        make_item(adm_rq, 1, quantity=4, inventory_item=helmet, confirmed=True)
        _dispatch(adm_rq, central_warehouse)                       # IN_STOCK -> DELIVERED (fechas listas)
        WarehouseDispatch.objects.update(delivered_at=None, accepted_by=None)
        type(adm_rq).objects.filter(pk=adm_rq.pk).update(fecha_real_entrega=None)

        WorkflowEngine(adm_rq, central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute(
            'WAREHOUSE_RECORDS_UPDATED')

        dispatch = WarehouseDispatch.objects.get()
        adm_rq.refresh_from_db()
        assert adm_rq.status == 'WAREHOUSE_UPDATED'
        assert dispatch.delivered_at is None and dispatch.accepted_by is None
        assert adm_rq.fecha_real_entrega is None

    def test_a_failure_in_the_delivery_hook_does_not_block_the_transition(
        self, ops_rq, site_warehouse,
    ):
        with mock.patch(
            'apps.warehouse.services.rq_fulfillment.mark_request_delivered', side_effect=RuntimeError('boom'),
        ):
            _site_deliver(ops_rq, site_warehouse)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'DELIVERED'
