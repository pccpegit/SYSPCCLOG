"""
SYSPCC-012 FIX 3: check_low_stock_alerts must log a failed send_mail() with
logger.exception (full stack + context) instead of logger.error (message
only, no traceback) — an SMTP/DNS/credentials failure was previously
invisible in any stack-trace-based alerting.
"""
from decimal import Decimal
from unittest import mock

import pytest
from django.core.mail import BadHeaderError

from apps.core.enums import ItemTypeChoices, WarehouseOriginChoices
from apps.warehouse.models import Inventory, InventoryStock
from apps.warehouse.tasks import check_low_stock_alerts


@pytest.fixture
def low_stock_item(db):
    item = Inventory.objects.create(
        product_code='FIE-001',
        description='Fierro corrugado 1/2"',
        unit='kg',
        item_type=ItemTypeChoices.MATERIAL,
        min_stock=Decimal('50'),
    )
    InventoryStock.objects.create(
        inventory=item,
        warehouse_type=WarehouseOriginChoices.CENTRAL,
        project=None,
        department=None,
        quantity=Decimal('5.000'),
    )
    return item


@pytest.mark.django_db
class TestCheckLowStockAlertsEmailFailureLogging:
    def test_send_mail_failure_logs_exception_with_stack(self, low_stock_item):
        with mock.patch(
            'django.core.mail.send_mail', side_effect=BadHeaderError('bad header')
        ), mock.patch('apps.warehouse.tasks.logger.exception') as mock_exception, \
             mock.patch('apps.warehouse.tasks.logger.error') as mock_error:
            result = check_low_stock_alerts()

        mock_exception.assert_called_once()
        assert mock_exception.call_args[0][0] == 'check_low_stock_alerts.email_failed'
        # The old logger.error(...) call for this failure path must be gone.
        mock_error.assert_not_called()
        # The task itself must not raise — email failure is non-fatal.
        assert isinstance(result, str)

    def test_no_low_stock_items_does_not_attempt_to_send_mail(self):
        with mock.patch('django.core.mail.send_mail') as mock_send:
            check_low_stock_alerts()
        mock_send.assert_not_called()
