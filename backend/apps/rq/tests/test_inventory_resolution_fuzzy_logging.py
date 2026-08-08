"""
SYSPCC-013 FIX 8: WorkflowEngine._resolve_inventory_item must log a warning
when it resolves via the fuzzy fallback (description__icontains /
product_code__iexact), not just when it finds nothing.

Before the fix, only the no-match branch logged (at info level). A "guessed"
match is silently accepted and can move stock against the wrong product —
this is a traceability gap, not a correctness bug, so the resolution logic
itself is intentionally left untouched; only logging is added.
"""
from unittest import mock

import pytest

from apps.rq.models import RequestItem
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.warehouse.models import Inventory


@pytest.mark.django_db
class TestResolveInventoryItemLogging:
    def test_direct_fk_match_does_not_log_warning(self, ops_request, requester):
        inv = Inventory.objects.create(
            product_code='CEM-001', description='Cemento Portland Tipo I', unit='bls',
        )
        item = RequestItem.objects.create(
            request=ops_request, line_number=1, description='Cemento Portland Tipo I',
            quantity=1, unit='bls', inventory_item=inv,
        )
        engine = WorkflowEngine(ops_request, requester, 'REQUESTER')

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as mock_warning:
            resolved = engine._resolve_inventory_item(item)

        assert resolved == inv
        mock_warning.assert_not_called()

    def test_fuzzy_match_logs_warning_with_traceable_context(self, ops_request, requester):
        inv = Inventory.objects.create(
            product_code='CEM-001', description='Cemento Portland Tipo I', unit='bls',
        )
        item = RequestItem.objects.create(
            request=ops_request, line_number=1, description='Cemento Portland Tipo I',
            quantity=1, unit='bls', inventory_item=None,
        )
        engine = WorkflowEngine(ops_request, requester, 'REQUESTER')

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as mock_warning:
            resolved = engine._resolve_inventory_item(item)

        assert resolved == inv
        mock_warning.assert_called_once()
        args, kwargs = mock_warning.call_args
        assert args[0] == 'workflow_engine.inventory_resolution.fuzzy_match'
        extra = kwargs['extra']
        assert extra['rq_number'] == ops_request.rq_number
        assert extra['request_item_id'] == item.pk
        assert extra['matched_inventory_id'] == inv.pk
        assert extra['matched_product_code'] == inv.product_code

    def test_no_match_logs_info_not_warning(self, ops_request, requester):
        item = RequestItem.objects.create(
            request=ops_request, line_number=1, description='Producto totalmente inexistente XYZ',
            quantity=1, unit='und', inventory_item=None,
        )
        engine = WorkflowEngine(ops_request, requester, 'REQUESTER')

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as mock_warning, \
             mock.patch('apps.rq.services.workflow_engine.logger.info') as mock_info:
            resolved = engine._resolve_inventory_item(item)

        assert resolved is None
        mock_warning.assert_not_called()
        mock_info.assert_called_once()
