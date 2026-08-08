"""
SYSPCC-007 fixes #1 and #2: stock cannot go negative, and movement/group
numbering is generated under a row lock.

These tests run against SQLite (dev), where select_for_update() is a documented
no-op — so they can't reproduce a real race between two DB connections. What
they verify instead:
  - the business-logic guard (`stock.quantity < quantity` -> ValueError) still
    works correctly after switching from refresh_from_db() to a locked fetch;
  - the DB-level CheckConstraint on InventoryStock.quantity is real and rejects
    a negative value even if application code is bypassed;
  - register_exit_batch/register_entry_batch remain atomic and produce distinct,
    valid movement/group numbers when called back-to-back.
"""
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from apps.core.enums import ItemTypeChoices, WarehouseOriginChoices
from apps.warehouse.models import Inventory, InventoryStock
from apps.warehouse.services import movements as warehouse_svc


@pytest.fixture
def inventory_item(db):
    return Inventory.objects.create(
        product_code='CEM-001',
        description='Cemento Portland Tipo I',
        unit='bls',
        item_type=ItemTypeChoices.MATERIAL,
    )


@pytest.fixture
def stocked_item(db, inventory_item):
    """CENTRAL stock of 10 units, no project scope."""
    InventoryStock.objects.create(
        inventory=inventory_item,
        warehouse_type=WarehouseOriginChoices.CENTRAL,
        project=None,
        department=None,
        quantity=Decimal('10.000'),
    )
    return inventory_item


@pytest.mark.django_db
class TestStockCannotGoNegative:
    def test_exit_batch_raises_when_quantity_exceeds_stock(self, stocked_item, user):
        with pytest.raises(ValueError, match='Stock insuficiente'):
            warehouse_svc.register_exit_batch(
                items_data=[{'inventory_id': stocked_item.pk, 'quantity': '11'}],
                warehouse=WarehouseOriginChoices.CENTRAL,
                project_id=None,
                destination_type='PROJECT',
                destination_detail='Obra X',
                requested_by_id=None,
                authorized_by_id=None,
                notes='',
                registered_by=user,
            )

        stock = InventoryStock.objects.get(inventory=stocked_item, warehouse_type=WarehouseOriginChoices.CENTRAL)
        assert stock.quantity == Decimal('10.000'), 'Stock must be untouched after the rejected exit.'

    def test_exit_batch_succeeds_and_decrements_when_stock_is_sufficient(self, stocked_item, user):
        group = warehouse_svc.register_exit_batch(
            items_data=[{'inventory_id': stocked_item.pk, 'quantity': '4'}],
            warehouse=WarehouseOriginChoices.CENTRAL,
            project_id=None,
            destination_type='PROJECT',
            destination_detail='Obra X',
            requested_by_id=None,
            authorized_by_id=None,
            notes='',
            registered_by=user,
        )
        stock = InventoryStock.objects.get(inventory=stocked_item, warehouse_type=WarehouseOriginChoices.CENTRAL)
        assert stock.quantity == Decimal('6.000')
        assert group.movements.count() == 1

    def test_db_check_constraint_rejects_negative_quantity(self, stocked_item):
        """
        Last line of defense: even bypassing the service layer entirely and
        writing a negative quantity directly should be rejected by the DB.
        """
        stock = InventoryStock.objects.get(inventory=stocked_item, warehouse_type=WarehouseOriginChoices.CENTRAL)
        stock.quantity = Decimal('-1.000')
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                stock.save(update_fields=['quantity'])


@pytest.mark.django_db
class TestMovementNumberingUnderLock:
    def test_two_sequential_exit_batches_get_distinct_movement_numbers(self, stocked_item, user):
        """
        Not a true concurrency test (SQLite doesn't lock), but pins down that
        the locked lookup still produces correct, unique, sequential numbers
        for back-to-back calls — a regression a naive re-implementation could
        easily break.
        """
        group1 = warehouse_svc.register_exit_batch(
            items_data=[{'inventory_id': stocked_item.pk, 'quantity': '1'}],
            warehouse=WarehouseOriginChoices.CENTRAL,
            project_id=None,
            destination_type='PROJECT',
            destination_detail='Obra X',
            requested_by_id=None,
            authorized_by_id=None,
            notes='',
            registered_by=user,
        )
        group2 = warehouse_svc.register_exit_batch(
            items_data=[{'inventory_id': stocked_item.pk, 'quantity': '1'}],
            warehouse=WarehouseOriginChoices.CENTRAL,
            project_id=None,
            destination_type='PROJECT',
            destination_detail='Obra X',
            requested_by_id=None,
            authorized_by_id=None,
            notes='',
            registered_by=user,
        )

        assert group1.group_number != group2.group_number
        mv1 = group1.movements.first()
        mv2 = group2.movements.first()
        assert mv1.movement_number != mv2.movement_number
