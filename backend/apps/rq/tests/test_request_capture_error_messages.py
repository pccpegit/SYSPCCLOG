"""
SYSPCC-026 (Fase 1, revisión): the messages of the fields this ticket added.

DRF's defaults for them were English ("Must be a valid boolean.") or jargon
('Clave primaria "99999999" inválida - objeto no existe.'), and the screen shows them
as-is ("Línea 2 (Producto): Clave primaria ..."). The person has to know what to do
next, in Spanish (es-PE), both when creating a request and in update-items.

The most reachable case is the product deleted between the search and the submit.
"""
import pytest
from rest_framework import status

from apps.core.enums import ItemSourceChoices
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    client_for,
    logistics_supervisor,
    make_inventory,
    ops_rq,
    rq_in_editable_state,
)

CREATE_URL = '/api/v1/requests/'

PRODUCT_GONE = 'El producto del catálogo ya no existe. Búsquelo de nuevo.'
PRODUCT_INVALID = 'Indique un producto válido del catálogo.'
BOOLEAN_INVALID = 'Indique verdadero o falso.'
# Words DRF's defaults are made of: none of them may reach the person.
ENGLISH_OR_JARGON = ('Must be', 'valid boolean', 'Clave primaria', 'objeto no existe', 'no es una elección')


def _create_payload(project, **item_overrides):
    item = {
        'line_number': 1,
        'description': 'Casco de seguridad',
        'quantity': '10.000',
        'unit': 'UND',
        'item_source': 'EPP',
    }
    item.update(item_overrides)
    return {
        'flow': 'OPERATIONS',
        'project': project.pk,
        'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': [item],
    }


def _create_errors(requester, project, **item_overrides):
    response = client_for(requester).post(
        CREATE_URL, _create_payload(project, **item_overrides), format='json',
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    return response.data['detail']['items'][0]


def _update_errors(user, rq, **entry):
    url = f'/api/v1/requests/{rq.pk}/update-items/'
    response = client_for(user).patch(url, {'items': [{'item_id': 1, **entry}]}, format='json')
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    return response.data['detail']['items'][0]


def _assert_plain_spanish(messages):
    for message in messages:
        assert not any(bad in str(message) for bad in ENGLISH_OR_JARGON), message


@pytest.mark.django_db
class TestCreateMessages:
    def test_a_product_deleted_after_the_search_says_so(self, requester, project):
        errors = _create_errors(requester, project, inventory_item=99999999)

        assert [str(m) for m in errors['inventory_item']] == [PRODUCT_GONE]

    @pytest.mark.parametrize('value', ['abc', 1.5, [1], {'id': 1}, True])
    def test_a_value_that_is_not_an_id_asks_for_a_catalog_product(self, requester, project, value):
        errors = _create_errors(requester, project, inventory_item=value)

        assert [str(m) for m in errors['inventory_item']] == [PRODUCT_INVALID]

    @pytest.mark.parametrize('value', ['maybe', 'si', 5, [True], {'a': 1}])
    def test_off_catalog_that_is_not_a_boolean_is_explained_in_spanish(self, requester, project, value):
        errors = _create_errors(requester, project, is_off_catalog=value)

        assert [str(m) for m in errors['is_off_catalog']] == [BOOLEAN_INVALID]

    @pytest.mark.parametrize('overrides', [
        {'item_source': None},
        {'item_source': 'ZZ'},
        {'item_source': 'epp'},
    ])
    def test_a_wrong_source_asks_the_person_to_pick_one(self, requester, project, overrides):
        errors = _create_errors(requester, project, **overrides)

        (message,) = [str(m) for m in errors['item_source']]
        assert message.startswith('Seleccione la fuente del ítem')

    def test_a_source_missing_from_the_payload_is_not_an_error(self, requester, project):
        """The API accepts it (old clients); only the new screen requires the family."""
        payload = _create_payload(project)
        del payload['items'][0]['item_source']

        response = client_for(requester).post(CREATE_URL, payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_the_source_message_names_every_family(self, requester, project):
        """Built from the enum: a family added tomorrow shows up without touching the text."""
        errors = _create_errors(requester, project, item_source='ZZ')

        (message,) = [str(m) for m in errors['item_source']]
        for label in ItemSourceChoices.labels:
            assert str(label) in message

    def test_no_message_keeps_drf_english_or_jargon(self, requester, project):
        errors = _create_errors(
            requester, project,
            inventory_item=99999999, is_off_catalog='maybe', item_source='ZZ',
        )

        _assert_plain_spanish(m for field in errors.values() for m in field)


@pytest.mark.django_db
class TestUpdateItemsMessages:
    @pytest.fixture(autouse=True)
    def _editable(self, ops_rq, rq_in_editable_state):
        self.rq = ops_rq

    def test_a_product_deleted_after_the_search_says_so(self, logistics_supervisor):
        errors = _update_errors(logistics_supervisor, self.rq, inventory_item=99999999)

        assert [str(m) for m in errors['inventory_item']] == [PRODUCT_GONE]

    @pytest.mark.parametrize('value', ['abc', 1.5, [1], {'id': 1}])
    def test_a_value_that_is_not_an_id_asks_for_a_catalog_product(self, logistics_supervisor, value):
        errors = _update_errors(logistics_supervisor, self.rq, inventory_item=value)

        assert [str(m) for m in errors['inventory_item']] == [PRODUCT_INVALID]

    @pytest.mark.parametrize('value', ['maybe', 'si', 5, [True]])
    def test_off_catalog_that_is_not_a_boolean_is_explained_in_spanish(self, logistics_supervisor, value):
        errors = _update_errors(logistics_supervisor, self.rq, is_off_catalog=value)

        assert [str(m) for m in errors['is_off_catalog']] == [BOOLEAN_INVALID]

    def test_a_wrong_source_asks_the_person_to_pick_one(self, logistics_supervisor):
        errors = _update_errors(logistics_supervisor, self.rq, item_source='ZZ')

        (message,) = [str(m) for m in errors['item_source']]
        assert message.startswith('Seleccione la fuente del ítem')

    def test_a_wrong_supply_source_names_the_two_options(self, logistics_supervisor):
        errors = _update_errors(logistics_supervisor, self.rq, supply_source='MAYBE')

        (message,) = [str(m) for m in errors['supply_source']]
        assert message.startswith('Indique el origen de atención')
        assert 'STOCK' in message and 'PURCHASE' in message

    def test_no_message_keeps_drf_english_or_jargon(self, logistics_supervisor):
        errors = _update_errors(
            logistics_supervisor, self.rq,
            inventory_item=99999999, is_off_catalog='maybe', item_source='ZZ', supply_source='X',
        )

        _assert_plain_spanish(m for field in errors.values() for m in field)

    def test_a_product_that_does_exist_is_still_accepted(self, logistics_supervisor):
        """The new messages must not have changed what is valid."""
        product = make_inventory('EPP-0001', 'Casco de seguridad blanco')
        item = self.rq.items.create(
            line_number=1, description='Casco', quantity=1, unit='UND',
        )
        url = f'/api/v1/requests/{self.rq.pk}/update-items/'

        response = client_for(logistics_supervisor).patch(
            url, {'items': [{'item_id': item.pk, 'inventory_item': product.pk}]}, format='json',
        )

        assert response.status_code == status.HTTP_200_OK
