"""
SYSPCC-028: `WorkflowEngine._resolve_inventory_item` honra SOLO el vínculo de catálogo
confirmado por Logística. Reemplaza a `test_inventory_resolution_fuzzy_logging.py`
(SYSPCC-013 FIX 8), que fijaba el log del match difuso por texto: ese match ya no existe.

Reglas:
  * FK + sello de confirmación            -> el producto;
  * FK propuesta sin confirmar            -> None + warning estructurado (visible);
  * sin FK, aunque haya un producto con descripción/código parecido -> None, sin adivinar;
  * fuera de catálogo                     -> None.
"""
from unittest import mock

import pytest

from apps.rq.services.workflow_engine import WorkflowEngine
from apps.rq.tests.catalog_fixtures import make_inventory, make_item, ops_rq  # noqa: F401


def _resolve(rq, user, item):
    return WorkflowEngine(rq, user, 'REQUESTER')._resolve_inventory_item(item)


@pytest.fixture
def cement(db):
    return make_inventory('CEM-001', 'Cemento Portland Tipo I', 'bls', category='Otros')


@pytest.mark.django_db
class TestResolveInventoryItem:
    def test_confirmed_link_resolves_to_its_product_without_warnings(self, ops_rq, requester, cement):
        item = make_item(ops_rq, 1, description='Cemento Portland Tipo I', inventory_item=cement,
                         confirmed=True)

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as warning:
            resolved = _resolve(ops_rq, requester, item)

        assert resolved == cement
        warning.assert_not_called()

    def test_proposed_link_without_confirmation_resolves_to_nothing_and_warns(
        self, ops_rq, requester, cement,
    ):
        item = make_item(ops_rq, 1, description='Cemento Portland Tipo I', inventory_item=cement)

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as warning:
            resolved = _resolve(ops_rq, requester, item)

        assert resolved is None
        warning.assert_called_once()
        args, kwargs = warning.call_args
        assert args[0] == 'workflow_engine.inventory_resolution.unconfirmed_link'
        assert kwargs['extra']['rq_number'] == ops_rq.rq_number
        assert kwargs['extra']['request_item_id'] == item.pk
        assert kwargs['extra']['proposed_inventory_id'] == cement.pk

    def test_line_without_link_does_not_match_a_look_alike_by_description(
        self, ops_rq, requester, cement,
    ):
        item = make_item(ops_rq, 1, description='Cemento Portland Tipo I')

        with mock.patch('apps.rq.services.workflow_engine.logger.warning') as warning:
            assert _resolve(ops_rq, requester, item) is None

        warning.assert_not_called()

    def test_line_without_link_does_not_match_by_first_word_as_product_code(
        self, ops_rq, requester,
    ):
        make_inventory('CASCO', 'Protección craneal', 'UND')
        item = make_item(ops_rq, 1, description='CASCO blanco clase E')

        assert _resolve(ops_rq, requester, item) is None

    def test_line_with_empty_description_does_not_match_the_whole_catalog(
        self, ops_rq, requester, cement,
    ):
        item = make_item(ops_rq, 1, description='')

        assert _resolve(ops_rq, requester, item) is None

    def test_off_catalog_line_resolves_to_nothing(self, ops_rq, requester, cement):
        item = make_item(ops_rq, 1, description='Servicio de flete', is_off_catalog=True)

        assert _resolve(ops_rq, requester, item) is None

    def test_confirmation_without_link_resolves_to_nothing(self, ops_rq, requester, cement):
        """Sello huérfano (el vínculo se quitó después): no hay producto que mover."""
        item = make_item(ops_rq, 1, description='Cemento Portland Tipo I', confirmed=True)

        assert _resolve(ops_rq, requester, item) is None
