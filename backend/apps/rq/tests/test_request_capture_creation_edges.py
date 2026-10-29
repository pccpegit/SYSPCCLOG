"""
SYSPCC-026 (Fase 1, QA ronda 1): hostile and borderline values for POST /api/v1/requests/
that test_request_capture_creation.py does not cover.

  * `requesting_area` / `item_source` are exact, case-sensitive codes of the enums;
  * quantities: negative, non-numeric, NaN/Infinity, too many decimals, too many digits;
  * the server owns the line numbering and the RQ number;
  * what the creation answers (201 body) for the new fields.

Every rejection must be an HTTP 400 that leaves NOTHING behind (no request, no lines).
"""
import pytest
from rest_framework import status

from apps.rq.models import Request, RequestItem
from apps.rq.tests.catalog_fixtures import client_for, make_inventory

URL = '/api/v1/requests/'


def _item(**overrides):
    item = {
        'line_number': 1,
        'description': 'Casco de seguridad',
        'quantity': '10.000',
        'unit': 'UND',
        'item_source': 'EPP',
    }
    item.update(overrides)
    return item


def _payload(project, **overrides):
    payload = {
        'flow': 'OPERATIONS',
        'project': project.pk,
        'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': [_item()],
    }
    payload.update(overrides)
    return payload


def _nothing_was_created():
    return not Request.objects.exists() and not RequestItem.objects.exists()


@pytest.mark.django_db
class TestCodesAreExact:
    @pytest.mark.parametrize('value', [
        'op', 'Op', ' OP', 'OP ', 'OPERACIONES', 'ADMIN', 'XX', 'O', 'OPOP', '1', 1, True, [], {}, ['OP'],
    ])
    def test_requesting_area_must_be_one_of_the_four_codes_exactly(self, requester, project, value):
        response = client_for(requester).post(URL, _payload(project, requesting_area=value), format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'requesting_area' in response.data['detail']
        assert _nothing_was_created()

    @pytest.mark.parametrize('value', ['epp', 'Epp', ' EPP', 'EPP ', 'Materiales', 'MATERIAL', 'OTROS', 1, True, ['EPP'], {}])
    def test_item_source_must_be_one_of_the_nine_codes_exactly(self, requester, project, value):
        response = client_for(requester).post(
            URL, _payload(project, items=[_item(item_source=value)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'item_source' in response.data['detail']['items'][0]
        assert _nothing_was_created()


@pytest.mark.django_db
class TestQuantities:
    @pytest.mark.parametrize('value', [
        '-1', -1, '-0.001', 'abc', '', 'NaN', 'Infinity', '-Infinity', '1.0001', '1234567890123', None, [], {},
    ])
    def test_invalid_quantities_are_rejected_and_nothing_is_created(self, requester, project, value):
        response = client_for(requester).post(
            URL, _payload(project, items=[_item(quantity=value)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'quantity' in response.data['detail']['items'][0]
        assert _nothing_was_created()

    @pytest.mark.parametrize('value, stored', [
        ('0.001', '0.001'), ('1', '1.000'), (2.5, '2.500'), ('999999999.999', '999999999.999'), ('1e2', '100.000'),
    ])
    def test_valid_quantities_are_stored_exactly(self, requester, project, value, stored):
        response = client_for(requester).post(
            URL, _payload(project, items=[_item(quantity=value)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert str(RequestItem.objects.get().quantity) == stored

    def test_a_line_of_zero_units_is_rejected(self, requester, project):
        response = client_for(requester).post(
            URL, _payload(project, items=[_item(quantity='0')]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert _nothing_was_created()


@pytest.mark.django_db
class TestTextFields:
    @pytest.mark.parametrize('field', ['description', 'unit'])
    @pytest.mark.parametrize('value', ['', '   ', '\t\n', None])
    def test_blank_line_texts_are_rejected(self, requester, project, field, value):
        response = client_for(requester).post(
            URL, _payload(project, items=[_item(**{field: value})]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert field in response.data['detail']['items'][0]
        assert _nothing_was_created()

    def test_an_item_with_no_items_at_all_key_is_rejected(self, requester, project):
        body = _payload(project)
        del body['items']

        response = client_for(requester).post(URL, body, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'items' in response.data['detail']
        assert _nothing_was_created()


@pytest.mark.django_db
class TestServerOwnsNumbering:
    def test_line_numbers_are_assigned_by_the_server_in_the_order_received(self, requester, project):
        response = client_for(requester).post(URL, _payload(project, items=[
            _item(line_number=7, description='Primero'),
            _item(line_number=7, description='Segundo'),          # duplicated by the client: harmless
            _item(line_number=1, description='Tercero'),
        ]), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = list(RequestItem.objects.order_by('line_number').values_list('line_number', 'description'))
        assert stored == [(1, 'Primero'), (2, 'Segundo'), (3, 'Tercero')]

    def test_the_client_cannot_choose_the_rq_number(self, requester, project):
        response = client_for(requester).post(
            URL, _payload(project, rq_number='RQ-1999-9999'), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Request.objects.get().rq_number != 'RQ-1999-9999'


@pytest.mark.django_db
class TestCreationResponse:
    def test_the_created_request_echoes_its_area(self, requester, project):
        response = client_for(requester).post(URL, _payload(project, requesting_area='QC'), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data['requesting_area'] == 'QC'
        assert Request.objects.get().requesting_area == 'QC'

    def test_a_catalog_link_and_an_off_catalog_line_can_travel_together(self, requester, project):
        product = make_inventory('EPP-0001', 'Casco de seguridad blanco')

        response = client_for(requester).post(URL, _payload(project, items=[
            _item(description='Casco', inventory_item=product.pk),
            _item(description='Servicio de topografía', is_off_catalog=True, item_source='EQUIPOS', unit='GLB'),
        ]), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        linked, off_catalog = RequestItem.objects.order_by('line_number')
        assert (linked.inventory_item_id, linked.is_off_catalog) == (product.pk, False)
        assert (off_catalog.inventory_item_id, off_catalog.is_off_catalog) == (None, True)

    def test_the_declared_central_stock_and_the_catalog_link_coexist(self, requester, project):
        """The field the form used to lose (`stock_almacen_principal`) now arrives under its real name."""
        product = make_inventory('EPP-0001', 'Casco de seguridad blanco')

        response = client_for(requester).post(URL, _payload(project, items=[
            _item(inventory_item=product.pk, stock_almacen_central='7', stock_almacen_obra='2', x_atender='1'),
        ]), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        line = RequestItem.objects.get()
        assert (str(line.stock_almacen_central), str(line.stock_almacen_obra), str(line.x_atender)) == (
            '7.000', '2.000', '1.000',
        )
