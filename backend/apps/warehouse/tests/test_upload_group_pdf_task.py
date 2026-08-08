"""
SYSPCC-012 FIX 3/4:
  - `upload_group_pdf_task` must be idempotent — if `document_url` is already
    set on the group (a previous run already succeeded), skip re-uploading
    rather than hitting OneDrive again.
  - it must be configured with retry_backoff/retry_jitter (bounded, backed
    off retries on transient upload failures).
  - `batch_entry`/`batch_exit` must enqueue this task via `.delay()` instead
    of blocking the request thread on a synchronous upload.
"""
from decimal import Decimal
from unittest import mock

import pytest
from rest_framework.test import APIClient

from apps.core.enums import ItemTypeChoices, RoleChoices, WarehouseOriginChoices
from apps.warehouse.models import Inventory, InventoryStock, MovementGroup
from apps.warehouse.services import movements as warehouse_svc
from apps.warehouse.tasks import upload_group_pdf_task


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def warehouse_user(db):
    from django.contrib.auth import get_user_model
    from apps.core.models import UserRole

    User = get_user_model()
    u = User.objects.create_user(
        username='central_warehouse',
        email='central_warehouse@test.com',
        password='TestPass2026!',
        first_name='Central',
        last_name='Warehouse',
    )
    UserRole.objects.create(user=u, role=RoleChoices.CENTRAL_WAREHOUSE, is_primary=True)
    return u


@pytest.fixture
def inventory_item(db):
    return Inventory.objects.create(
        product_code='CEM-012',
        description='Cemento Portland Tipo I',
        unit='bls',
        item_type=ItemTypeChoices.MATERIAL,
    )


@pytest.fixture
def entry_group(db, inventory_item, warehouse_user):
    return warehouse_svc.register_entry_batch(
        items_data=[{'inventory_id': inventory_item.pk, 'quantity': '5'}],
        warehouse=WarehouseOriginChoices.CENTRAL,
        project_id=None,
        source_type='PURCHASE',
        supplier_name='Proveedor Test',
        invoice_number='F001-123',
        notes='',
        registered_by=warehouse_user,
    )


class TestUploadGroupPdfTaskRetryConfig:
    def test_task_has_bounded_backoff_and_jitter_retries(self):
        assert upload_group_pdf_task.max_retries == 3
        assert upload_group_pdf_task.retry_backoff is True
        assert upload_group_pdf_task.retry_jitter is True


@pytest.mark.django_db
class TestUploadGroupPdfTaskIdempotency:
    def test_skips_upload_when_document_url_already_set(self, entry_group):
        MovementGroup.objects.filter(pk=entry_group.pk).update(
            document_url='https://onedrive.example.com/already-uploaded.pdf'
        )

        with mock.patch('apps.warehouse.services.onedrive.OneDriveService.is_connected') as mock_connected, \
             mock.patch('apps.warehouse.services.onedrive.OneDriveService.upload_file') as mock_upload:
            upload_group_pdf_task(entry_group.pk)

        mock_connected.assert_not_called()
        mock_upload.assert_not_called()

    def test_uploads_when_document_url_is_empty(self, entry_group):
        assert entry_group.document_url == ''

        with mock.patch(
            'apps.warehouse.services.onedrive.OneDriveService.is_connected', return_value=True
        ), mock.patch(
            'apps.warehouse.services.onedrive.OneDriveService.upload_file',
            return_value='https://onedrive.example.com/new-upload.pdf',
        ) as mock_upload:
            upload_group_pdf_task(entry_group.pk)

        mock_upload.assert_called_once()
        entry_group.refresh_from_db()
        assert entry_group.document_url == 'https://onedrive.example.com/new-upload.pdf'


@pytest.mark.django_db
class TestBatchEndpointsEnqueueInsteadOfBlocking:
    def test_batch_entry_enqueues_task_and_does_not_block(self, warehouse_user, inventory_item):
        client = _client_for(warehouse_user)

        with mock.patch('apps.warehouse.tasks.upload_group_pdf_task.delay') as mock_delay:
            response = client.post(
                '/api/v1/warehouse/movements/batch-entry/',
                {
                    'items': [{'inventory': inventory_item.pk, 'quantity': '3'}],
                    'warehouse': WarehouseOriginChoices.CENTRAL,
                    'source_type': 'PURCHASE',
                    'supplier_name': 'Proveedor Test',
                    'invoice_number': 'F001-999',
                    'notes': '',
                },
                format='json',
            )

        assert response.status_code == 201, response.data
        mock_delay.assert_called_once()
        group_id = MovementGroup.objects.get(group_number=response.data['group_number']).pk
        assert mock_delay.call_args[0][0] == group_id

    def test_batch_exit_enqueues_task_and_does_not_block(self, warehouse_user, inventory_item):
        InventoryStock.objects.create(
            inventory=inventory_item,
            warehouse_type=WarehouseOriginChoices.CENTRAL,
            project=None,
            department=None,
            quantity=Decimal('10.000'),
        )
        client = _client_for(warehouse_user)

        with mock.patch('apps.warehouse.tasks.upload_group_pdf_task.delay') as mock_delay:
            response = client.post(
                '/api/v1/warehouse/movements/batch-exit/',
                {
                    'items': [{'inventory': inventory_item.pk, 'quantity': '2'}],
                    'warehouse': WarehouseOriginChoices.CENTRAL,
                    'destination_type': 'PROJECT',
                    'destination_detail': 'Obra X',
                    'notes': '',
                },
                format='json',
            )

        assert response.status_code == 201, response.data
        mock_delay.assert_called_once()
