"""SYSPCC-025 — modelo InventoryImport (soporte de la importación) y migración de backfill."""
import hashlib
import uuid
from datetime import date, datetime, timezone as dt_timezone
from importlib import import_module

import pytest
from django.apps import apps
from django.db import IntegrityError, transaction

from apps.warehouse.models import InventoryImport, InventoryImportStatus, InventoryMovement, MovementGroup
from apps.warehouse.services import movements as svc


def _make_import(user, sha='a' * 64, status=InventoryImportStatus.PREVIEWED, warehouse='CENTRAL'):
    return InventoryImport.objects.create(
        uploaded_by=user, file_name='libro.xlsx', file_sha256=sha, status=status,
        warehouse=warehouse, file_bytes=b'PK-fake',
    )


@pytest.mark.django_db
class TestInventoryImportModel:
    def test_defaults(self, central_warehouse):
        imp = _make_import(central_warehouse)
        assert isinstance(imp.pk, uuid.UUID)
        assert imp.status == 'PREVIEWED' and imp.options == {} and imp.result == {}

    def test_same_file_cannot_be_confirmed_twice_for_a_warehouse(self, central_warehouse):
        _make_import(central_warehouse, status=InventoryImportStatus.CONFIRMED)
        with pytest.raises(IntegrityError), transaction.atomic():
            _make_import(central_warehouse, status=InventoryImportStatus.CONFIRMED)

    def test_constraint_only_applies_to_confirmed(self, central_warehouse):
        _make_import(central_warehouse, status=InventoryImportStatus.CONFIRMED)
        _make_import(central_warehouse, status=InventoryImportStatus.PREVIEWED)
        _make_import(central_warehouse, status=InventoryImportStatus.CANCELLED)
        _make_import(central_warehouse, status=InventoryImportStatus.CONFIRMED, warehouse='SITE')
        assert InventoryImport.objects.count() == 4

    def test_clear_file_empties_the_stored_workbook(self, central_warehouse):
        imp = _make_import(central_warehouse)
        imp.clear_file()
        imp.save(update_fields=['file_bytes'])
        imp.refresh_from_db()
        assert bytes(imp.file_bytes) == b''

    def test_movements_can_reference_their_import_batch(self, central_warehouse, epp_item):
        imp = _make_import(central_warehouse)
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': epp_item.pk, 'quantity': 1, 'source_key': hashlib.sha256(b'x').hexdigest()}],
            warehouse='CENTRAL', project_id=None, source_type='INITIAL_LOAD', supplier_name='',
            invoice_number='', notes='', registered_by=central_warehouse, import_batch_id=imp.pk,
            undated=True,
        )
        assert group.movements.get().import_batch_id == imp.pk
        assert imp.movements.count() == 1
        imp.delete()                       # SET_NULL: no se pierde el movimiento
        assert InventoryMovement.objects.count() == 1


@pytest.mark.django_db
class TestBackfillMigration:
    def test_backfill_uses_the_lima_date_of_created_at_and_is_idempotent(self, epp_item, central_warehouse):
        migration = import_module('apps.warehouse.migrations.0010_backfill_movement_date')
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': epp_item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='', invoice_number='', notes='',
            registered_by=central_warehouse, undated=True,
        )
        # 2026-10-06 03:30 UTC == 2026-10-05 22:30 in Lima (UTC-5): the date must be the 5th
        moment = datetime(2026, 10, 6, 3, 30, tzinfo=dt_timezone.utc)
        MovementGroup.objects.filter(pk=group.pk).update(created_at=moment)
        InventoryMovement.objects.filter(group=group).update(created_at=moment)
        untouched = svc.register_entry_batch(
            items_data=[{'inventory_id': epp_item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='', invoice_number='', notes='',
            registered_by=central_warehouse, movement_date=date(2026, 1, 2),
        )

        migration.backfill_movement_date(apps, None)
        migration.backfill_movement_date(apps, None)    # idempotente

        group.refresh_from_db()
        assert group.movement_date == date(2026, 10, 5)
        assert group.movements.get().movement_date == date(2026, 10, 5)
        untouched.refresh_from_db()
        assert untouched.movement_date == date(2026, 1, 2)   # nunca pisa una fecha existente
