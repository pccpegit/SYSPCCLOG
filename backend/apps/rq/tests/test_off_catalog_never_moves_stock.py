"""
SYSPCC-026: a line marked OFF-CATALOG on purpose (services, items that do not go
through the warehouse) must never move warehouse stock.

History: `WorkflowEngine._resolve_inventory_item` used to fall into a fuzzy fallback
(description `icontains`, or the first word as a product code), so an off-catalog
"Lentes de seguridad" bought by RQ matched the catalog product "LENTES DE SEGURIDAD CLARO"
and the engine moved its stock. SYSPCC-026 short-circuited it with the off-catalog mark;
SYSPCC-028 removed the fuzzy fallback altogether (only a CONFIRMED link moves stock), so the
"control" tests below now assert that the look-alike is left alone EVEN WITHOUT the mark.

Covered through the REAL engine (`execute`), in both directions:
  * ENTRY  (RECEIVED, OPS):            PO_GENERATED -> RECEIVING
  * EXIT   (DISPATCHED, ADMINISTRATIVE): IN_STOCK -> DELIVERED

The workflow itself (transitions, states, roles) is not touched; test_workflow_snapshot.py
freezes it.
"""
from decimal import Decimal
from unittest import mock

import pytest

from apps.core.enums import RoleChoices
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    central_warehouse,
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

SERVICE_TEXT = 'Lentes de seguridad'


@pytest.fixture
def look_alike_by_text(db):
    """EPP product whose description CONTAINS the off-catalog text (the icontains branch)."""
    product = make_inventory('EPP-LEN-01', 'LENTES DE SEGURIDAD CLARO', 'UND')
    make_stock(product, 10)
    return product


@pytest.fixture
def look_alike_by_code(db):
    """EPP product whose CODE is the first word of the text (the product_code__iexact branch)."""
    product = make_inventory('LENTES', 'Protección ocular con filtro UV', 'UND')
    make_stock(product, 10)
    return product


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
    make_stock(product, 10)
    return product


def _pool(product):
    return InventoryStock.objects.get(inventory=product).quantity


def _resolve(rq, user, item):
    return WorkflowEngine(rq, user, 'REQUESTER')._resolve_inventory_item(item)


def _no_stock_was_touched():
    return (
        not InventoryMovement.objects.exists()
        and not MovementGroup.objects.exists()
    )


# ──────────────────── the resolver itself ────────────────────

@pytest.mark.django_db
class TestResolveInventoryItem:
    def test_an_off_catalog_line_resolves_to_nothing_even_with_a_look_alike_by_description(
        self, ops_rq, requester, look_alike_by_text,
    ):
        item = make_item(ops_rq, 1, description=SERVICE_TEXT, is_off_catalog=True)

        assert _resolve(ops_rq, requester, item) is None

    def test_an_off_catalog_line_resolves_to_nothing_even_with_a_look_alike_by_code(
        self, ops_rq, requester, look_alike_by_code,
    ):
        item = make_item(ops_rq, 1, description=SERVICE_TEXT, is_off_catalog=True)

        assert _resolve(ops_rq, requester, item) is None

    def test_it_does_not_log_a_fuzzy_match_for_an_off_catalog_line(
        self, ops_rq, requester, look_alike_by_text, look_alike_by_code,
    ):
        """The fuzzy path must not even run: no 'guessed a product' warning."""
        item = make_item(ops_rq, 1, description=SERVICE_TEXT, is_off_catalog=True)

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as warning:
            WorkflowEngine(ops_rq, requester, 'REQUESTER')._resolve_inventory_item(item)

        warning.assert_not_called()

    def test_a_linked_line_still_resolves_to_its_product(self, ops_rq, requester, helmet):
        item = make_item(ops_rq, 1, description='lo que escribió el solicitante', inventory_item=helmet, confirmed=True)

        assert _resolve(ops_rq, requester, item) == helmet


# ──────────────────── ENTRY: RECEIVED (OPS) ────────────────────

def _receive(rq, user):
    rq.status = 'PO_GENERATED'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.LOGISTICS_COORDINATOR).execute(
        'RECEIVED', comments='Recepción de prueba.',
    )


@pytest.mark.django_db
class TestEntryOnReceived:
    def test_the_off_catalog_line_is_left_out_of_the_entry_batch(
        self, ops_rq, requester, helmet, look_alike_by_text,
    ):
        make_item(ops_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)
        make_item(ops_rq, 2, description='Casco', quantity=3, inventory_item=helmet, confirmed=True)

        data = WorkflowEngine(ops_rq, requester, 'REQUESTER')._build_items_data('ENTRY')

        assert data == [{'inventory_id': helmet.pk, 'quantity': Decimal('3.000'), 'line': 1}]

    def test_receiving_an_off_catalog_only_rq_ingresses_nothing(
        self, ops_rq, logistics_coordinator, look_alike_by_text, look_alike_by_code,
    ):
        make_item(ops_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)

        _receive(ops_rq, logistics_coordinator)

        ops_rq.refresh_from_db()
        assert ops_rq.status == 'RECEIVING'                      # the transition itself is untouched
        assert _pool(look_alike_by_text) == Decimal('10.000')
        assert _pool(look_alike_by_code) == Decimal('10.000')
        assert _no_stock_was_touched()
        assert not WarehouseReceipt.objects.filter(request=ops_rq).exists()

    def test_in_a_mixed_rq_only_the_linked_product_is_ingressed(
        self, ops_rq, logistics_coordinator, helmet, look_alike_by_text,
    ):
        make_item(ops_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)
        make_item(ops_rq, 2, description='Casco', quantity=3, inventory_item=helmet, confirmed=True)

        _receive(ops_rq, logistics_coordinator)

        assert _pool(helmet) == Decimal('13.000')
        assert _pool(look_alike_by_text) == Decimal('10.000')
        moved = set(InventoryMovement.objects.values_list('inventory_id', flat=True))
        assert moved == {helmet.pk}
        receipt_lines = WarehouseReceiptItem.objects.filter(receipt__request=ops_rq)
        assert receipt_lines.count() == 1        # receipt rows only for lines that entered the pool
        assert receipt_lines.get().request_item.line_number == 2

    def test_the_same_line_without_the_mark_and_without_a_link_ingresses_nothing_either(
        self, ops_rq, logistics_coordinator, look_alike_by_text,
    ):
        """SYSPCC-028: there is no text matching any more, with or without the off-catalog mark."""
        make_item(ops_rq, 1, description=SERVICE_TEXT, quantity=4)

        _receive(ops_rq, logistics_coordinator)

        assert _pool(look_alike_by_text) == Decimal('10.000')
        assert _no_stock_was_touched()


# ──────────────────── EXIT: DISPATCHED (ADMINISTRATIVE, project NULL) ────────────────────

def _dispatch(rq, user):
    rq.status = 'IN_STOCK'
    rq.save(update_fields=['status'])
    return WorkflowEngine(rq, user, RoleChoices.CENTRAL_WAREHOUSE).execute(
        'DISPATCHED', comments='Despacho de prueba.',
    )


@pytest.mark.django_db
class TestExitOnDispatched:
    def test_the_off_catalog_line_is_left_out_of_the_exit_batch(
        self, adm_rq, department_requester, helmet, look_alike_by_text,
    ):
        make_item(adm_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)
        make_item(adm_rq, 2, description='Casco', quantity=3, inventory_item=helmet, confirmed=True)

        data = WorkflowEngine(adm_rq, department_requester, 'REQUESTER')._build_items_data('EXIT')

        assert data == [{'inventory_id': helmet.pk, 'quantity': Decimal('3.000'), 'line': 1}]

    def test_dispatching_an_off_catalog_only_rq_takes_nothing_out(
        self, adm_rq, central_warehouse, look_alike_by_text, look_alike_by_code,
    ):
        make_item(adm_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)

        _dispatch(adm_rq, central_warehouse)

        adm_rq.refresh_from_db()
        assert adm_rq.status == 'DELIVERED'                      # the transition itself is untouched
        assert _pool(look_alike_by_text) == Decimal('10.000')
        assert _pool(look_alike_by_code) == Decimal('10.000')
        assert _no_stock_was_touched()
        assert not WarehouseDispatch.objects.filter(request=adm_rq).exists()
        assert not WarehouseDispatchItem.objects.filter(request_item__request=adm_rq).exists()

    def test_in_a_mixed_rq_only_the_linked_product_leaves(
        self, adm_rq, central_warehouse, helmet, look_alike_by_text,
    ):
        off_catalog = make_item(adm_rq, 1, description=SERVICE_TEXT, quantity=4, is_off_catalog=True)
        linked = make_item(adm_rq, 2, description='Casco', quantity=3, inventory_item=helmet, confirmed=True)

        _dispatch(adm_rq, central_warehouse)

        assert _pool(helmet) == Decimal('7.000')
        assert _pool(look_alike_by_text) == Decimal('10.000')
        moved = set(InventoryMovement.objects.values_list('inventory_id', flat=True))
        assert moved == {helmet.pk}
        dispatched = set(
            WarehouseDispatchItem.objects.filter(request_item__request=adm_rq)
            .values_list('request_item_id', flat=True)
        )
        assert dispatched == {linked.pk}
        assert off_catalog.pk not in dispatched

    def test_the_same_line_without_the_mark_and_without_a_link_takes_nothing_out_either(
        self, adm_rq, central_warehouse, look_alike_by_text,
    ):
        """SYSPCC-028 (see the ENTRY twin): no text matching, so the look-alike is untouched."""
        make_item(adm_rq, 1, description=SERVICE_TEXT, quantity=4)

        _dispatch(adm_rq, central_warehouse)

        assert _pool(look_alike_by_text) == Decimal('10.000')
        assert _no_stock_was_touched()
