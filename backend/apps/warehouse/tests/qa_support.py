"""
Shared helpers of the QA tests of SYSPCC-025 (round 1).

Everything is INVENTED: worker names, destinations and codes never come from a real workbook.
"""
import io
import re
import uuid
import zipfile
from decimal import Decimal

import pytest
from django.core.cache.backends.locmem import LocMemCache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock
from apps.warehouse.services.imports import parser
from apps.warehouse.throttling import WarehouseImportThrottle

from .conftest import client_for

IMPORTS = '/api/v1/warehouse/imports/'
INVENTORY = '/api/v1/warehouse/inventory/'
MOVEMENTS = '/api/v1/warehouse/movements/'
XLSX = parser.XLSX_CONTENT_TYPE


def tolerant_client(user) -> APIClient:
    """Client that answers a 500 instead of re-raising it, so a crash is an assertion, not a traceback."""
    client = client_for(user)
    client.raise_request_exception = False
    return client


@pytest.fixture
def import_throttle_isolated(monkeypatch):
    """Upload throttle counters live in redis in this stack: give every test its own."""
    monkeypatch.setattr(WarehouseImportThrottle, 'cache', LocMemCache(f'qa-imports-{uuid.uuid4()}', {}))


def upload(client, data: bytes, name='libro.xlsx', **extra):
    file = SimpleUploadedFile(name, data, content_type=XLSX)
    return client.post(IMPORTS, {'file': file, **extra}, format='multipart')


def confirm(client, preview: dict, **overrides):
    body = {
        'expected_plan_digest': preview['plan_digest'], 'project_map': {'ON PLANT': None},
        'accept_warnings': True, 'accept_skipped_rows': True,
    }
    body.update(overrides)
    return client.post(f"{IMPORTS}{preview['id']}/confirm/", body, format='json')


def put_number_in_sheets(data: bytes, marker: int, replacement: str) -> bytes:
    """
    Rewrite the raw XML of a workbook so the numeric cell holding ``marker`` stores
    ``replacement`` instead (e.g. ``1E999``, which openpyxl reads as infinity).
    """
    source = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    pattern = re.compile(rf'<v>{marker}</v>')
    replaced = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in source.infolist():
            content = source.read(info.filename)
            if info.filename.startswith('xl/worksheets/sheet'):
                text, count = pattern.subn(f'<v>{replacement}</v>', content.decode())
                replaced += count
                content = text.encode()
            dst.writestr(info.filename, content)
    assert replaced, f'marker {marker} not found in any worksheet'
    return out.getvalue()


def stock_of(code: str, warehouse='CENTRAL') -> Decimal:
    row = InventoryStock.objects.filter(
        inventory__product_code=code, warehouse_type=warehouse, project__isnull=True, department__isnull=True,
    ).first()
    return row.quantity if row else Decimal('0')


def total_stock(item: Inventory) -> Decimal:
    return sum((s.quantity for s in item.stocks.all()), Decimal('0'))


def snapshot_database() -> dict:
    """Counters that must not move when a request is rejected."""
    return {
        'items': Inventory.objects.count(),
        'movements': InventoryMovement.objects.count(),
        'stock': sorted(
            (s.inventory_id, s.warehouse_type, str(s.quantity)) for s in InventoryStock.objects.all()
        ),
    }
