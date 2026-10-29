"""
SYSPCC-026: a line marked OFF-CATALOG on purpose (services, items that do not go
through the warehouse) must never move warehouse stock.

The bug this pins: `WorkflowEngine._resolve_inventory_item` only looked at the FK. A line
with no FK fell into a fuzzy fallback (description `icontains`, or the first word as a
product code), so an off-catalog "Lentes de seguridad" bought by RQ matched the catalog
product "LENTES DE SEGURIDAD CLARO" and the engine ingressed it at RECEIVED and took it
out at DISPATCHED. The explicit off-catalog mark now short-circuits the resolution.

Covered through the REAL engine (`execute`), in both directions:
  * ENTRY  (RECEIVED, OPS):            PO_GENERATED -> RECEIVING
  * EXIT   (DISPATCHED, ADMINISTRATIVE): IN_STOCK -> DELIVERED  (project NULL: the exit
    works there today, so a missing movement is never explained by the known OPS stock
    mismatch of the project-scoped exit)

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
        item = make_item(ops_rq, 1, description='lo que escribió el solicitante', inventory_item=helmet)

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
        make_item(ops_rq, 2, description='Casco', quantity=3, inventory_item=helmet)

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
        make_item(ops_rq, 2, description='Casco', quantity=3, inventory_item=helmet)

        _receive(ops_rq, logistics_coordinator)

        assert _pool(helmet) == Decimal('13.000')
        assert _pool(look_alike_by_text) == Decimal('10.000')
        moved = set(InventoryMovement.objects.values_list('inventory_id', flat=True))
        assert moved == {helmet.pk}
        receipt_lines = WarehouseReceiptItem.objects.filter(receipt__request=ops_rq)
        assert receipt_lines.count() == 2        # documents follow the lines, stock follows the product

    def test_the_off_catalog_line_alone_would_have_been_ingressed_before_the_fix(
        self, ops_rq, logistics_coordinator, look_alike_by_text,
    ):
        """
        Control: the very same line WITHOUT the off-catalog mark is still resolved by the
        legacy fallback (removing it is Fase 3), so the test above is not passing for an
        unrelated reason.
        """
        make_item(ops_rq, 1, description=SERVICE_TEXT, quantity=4)

        _receive(ops_rq, logistics_coordinator)

        assert _pool(look_alike_by_text) == Decimal('14.000')


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
        make_item(adm_rq, 2, description='Casco', quantity=3, inventory_item=helmet)

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
        linked = make_item(adm_rq, 2, description='Casco', quantity=3, inventory_item=helmet)

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

    def test_the_same_line_without_the_mark_is_still_resolved_by_the_legacy_fallback(
        self, adm_rq, central_warehouse, look_alike_by_text,
    ):
        """Control (see the ENTRY twin): proves the exit would have taken the look-alike out."""
        make_item(adm_rq, 1, description=SERVICE_TEXT, quantity=4)

        _dispatch(adm_rq, central_warehouse)

        assert _pool(look_alike_by_text) == Decimal('6.000')
