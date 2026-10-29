"""
SYSPCC-026 (Fase 1): capture of the catalog link, area and source when creating an RQ.

Covers POST /api/v1/requests/ and the read serializers:
  * `requesting_area` (OP/QC/HSE/ADM) is mandatory on creation;
  * `item_source` (9 allowed values) is optional at the API (old clients, integrations);
    when sent it must be one of them. The new screen is what requires it;
  * `inventory_item` is exposed and validated (must exist), code/description/unit
    come back flat on reads; `is_off_catalog` and the link are mutually exclusive;
  * `supply_source` is read-only on creation (logistics decides it later);
  * a key the serializer does not know (`stock_almacen_principal`) is still
    dropped, but now leaves a warning in the log;
  * the whole creation is atomic.
"""
import logging

import pytest
from django.db import IntegrityError, transaction
from rest_framework import status

from apps.core.enums import ItemSourceChoices, RequestingAreaChoices
from apps.rq.models import Request, RequestItem
from apps.rq.tests.catalog_fixtures import (
    capture_logs,
    client_for,
    make_inventory,
    make_item,
    make_request,
)

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


def _ops_payload(project, **overrides):
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


def _adm_payload(department, **overrides):
    payload = {
        'flow': 'ADMINISTRATIVE',
        'department': department.pk,
        'requesting_area': 'ADM',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Útiles de oficina',
        'items': [_item(description='Papel bond A4', item_source='UTILES', unit='MLL')],
    }
    payload.update(overrides)
    return payload


def _errors(response):
    """Field errors live under `detail` (custom exception handler envelope)."""
    return response.data['detail']


@pytest.mark.django_db
class TestRequestingArea:
    def test_missing_area_is_rejected(self, requester, project):
        payload = _ops_payload(project)
        del payload['requesting_area']

        response = client_for(requester).post(URL, payload, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'requesting_area' in _errors(response)
        assert Request.objects.count() == 0

    @pytest.mark.parametrize('value', ['', None, 'XX', 'op', 'OPERATIONS', ['OP'], 12, {'a': 1}])
    def test_blank_null_or_unknown_area_is_rejected(self, requester, project, value):
        response = client_for(requester).post(
            URL, _ops_payload(project, requesting_area=value), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'requesting_area' in _errors(response)
        assert Request.objects.count() == 0

    @pytest.mark.parametrize('area', [c.value for c in RequestingAreaChoices])
    def test_every_valid_area_is_accepted_on_operations_flow(self, requester, project, area):
        response = client_for(requester).post(
            URL, _ops_payload(project, requesting_area=area), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data['requesting_area'] == area
        assert Request.objects.get(rq_number=response.data['rq_number']).requesting_area == area

    @pytest.mark.parametrize('area', [c.value for c in RequestingAreaChoices])
    def test_every_valid_area_is_accepted_on_administrative_flow(
        self, department_requester, department, area,
    ):
        response = client_for(department_requester).post(
            URL, _adm_payload(department, requesting_area=area), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Request.objects.get(rq_number=response.data['rq_number']).requesting_area == area


@pytest.mark.django_db
class TestItemSource:
    def test_missing_item_source_is_accepted_and_stored_empty(self, requester, project):
        """Orchestrator decisions 2 and 3: the API stays compatible, the UI is what demands it."""
        item = _item()
        del item['item_source']

        response = client_for(requester).post(URL, _ops_payload(project, items=[item]), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        saved = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert saved.item_source == ''
        assert response.data['items'][0]['item_source'] == ''
        assert response.data['items'][0]['item_source_display'] == ''

    def test_blank_item_source_is_accepted_and_stored_empty(self, requester, project):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(item_source='')]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert RequestItem.objects.get(request__rq_number=response.data['rq_number']).item_source == ''

    def test_a_line_without_source_does_not_affect_the_ones_that_have_it(self, requester, project):
        second = _item(line_number=2, description='Guantes')
        del second['item_source']

        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(), second]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        saved = RequestItem.objects.filter(request__rq_number=response.data['rq_number']).order_by('line_number')
        assert [line.item_source for line in saved] == ['EPP', '']

    @pytest.mark.parametrize('value', [None, 'epp', 'LAPTOPS', 'DROP TABLE', 5, ['EPP'], 'X' * 200])
    def test_null_or_unknown_source_is_rejected(self, requester, project, value):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(item_source=value)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'item_source' in _errors(response)['items'][0]
        assert Request.objects.count() == 0

    def test_error_points_at_the_offending_line_only(self, requester, project):
        second = _item(line_number=2, description='Guantes', item_source='LAPTOPS')

        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(), second]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        item_errors = _errors(response)['items']
        assert item_errors[0] == {}
        assert 'item_source' in item_errors[1]

    @pytest.mark.parametrize('source', [c.value for c in ItemSourceChoices])
    def test_all_nine_sources_are_accepted_and_persisted(self, requester, project, source):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(item_source=source)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        item = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert item.item_source == source
        assert response.data['items'][0]['item_source'] == source

    def test_there_are_exactly_nine_sources(self):
        assert {c.value for c in ItemSourceChoices} == {
            'EPP', 'HERRAMIENTAS', 'MATERIALES', 'EQUIPOS', 'FORMATERIA',
            'CONSUMIBLES', 'UNIDADES', 'UTILES', 'GASES',
        }


@pytest.mark.django_db
class TestCatalogLinkOnCreate:
    def test_linked_item_is_persisted_and_returned_with_code_description_unit(
        self, requester, project,
    ):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')

        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(inventory_item=helmet.pk)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        row = response.data['items'][0]
        assert row['inventory_item'] == helmet.pk
        assert row['inventory_item_code'] == 'EPP-0001'
        assert row['inventory_item_description'] == 'Casco de seguridad blanco'
        assert row['inventory_item_unit'] == 'UND'
        assert row['is_off_catalog'] is False
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert stored.inventory_item_id == helmet.pk

    def test_nonexistent_product_is_rejected(self, requester, project):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(inventory_item=999999)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'inventory_item' in _errors(response)['items'][0]
        assert Request.objects.count() == 0

    @pytest.mark.parametrize('value', ['abc', [1], {'id': 1}, -1, 0, 1.5, 'null'])
    def test_malformed_product_reference_is_rejected_not_a_500(self, requester, project, value):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(inventory_item=value)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.count() == 0

    def test_float_product_reference_does_not_silently_link_another_product(self, requester, project):
        """Django would coerce get(pk=1.9) to pk=1: a float must be refused, not truncated."""
        helmet = make_inventory()

        response = client_for(requester).post(
            URL,
            _ops_payload(project, items=[_item(inventory_item=helmet.pk + 0.9)]),
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'inventory_item' in _errors(response)['items'][0]
        assert Request.objects.count() == 0

    def test_linked_and_off_catalog_together_is_rejected(self, requester, project):
        helmet = make_inventory()

        response = client_for(requester).post(
            URL,
            _ops_payload(project, items=[_item(inventory_item=helmet.pk, is_off_catalog=True)]),
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'is_off_catalog' in _errors(response)['items'][0]
        assert Request.objects.count() == 0

    def test_explicit_off_catalog_without_product_is_accepted(self, requester, project):
        response = client_for(requester).post(
            URL,
            _ops_payload(project, items=[_item(description='Servicio de flete', is_off_catalog=True)]),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert stored.is_off_catalog is True
        assert stored.inventory_item_id is None

    def test_null_product_with_off_catalog_is_accepted(self, requester, project):
        response = client_for(requester).post(
            URL,
            _ops_payload(project, items=[_item(inventory_item=None, is_off_catalog=True)]),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_neither_link_nor_off_catalog_is_accepted_for_compatibility(self, requester, project):
        """Integrations/historical data may send neither; only the UI requires one."""
        response = client_for(requester).post(URL, _ops_payload(project), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert stored.inventory_item_id is None
        assert stored.is_off_catalog is False

    @pytest.mark.parametrize('value', ['maybe', [True], {'a': 1}, 'si'])
    def test_non_boolean_off_catalog_is_rejected(self, requester, project, value):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(is_off_catalog=value)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'is_off_catalog' in _errors(response)['items'][0]

    def test_invalid_second_line_rolls_back_the_whole_request(self, requester, project):
        helmet = make_inventory()
        items = [_item(inventory_item=helmet.pk), _item(line_number=2, inventory_item=999999)]

        response = client_for(requester).post(URL, _ops_payload(project, items=items), format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.count() == 0
        assert RequestItem.objects.count() == 0

    def test_linked_line_works_on_administrative_flow(self, department_requester, department):
        paper = make_inventory('UTL-0001', 'Papel bond A4', 'MLL', category='Otros')

        response = client_for(department_requester).post(
            URL,
            _adm_payload(department, items=[_item(inventory_item=paper.pk, item_source='UTILES')]),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data['items'][0]['inventory_item_code'] == 'UTL-0001'


@pytest.mark.django_db
class TestSupplySourceIsReadOnlyOnCreate:
    @pytest.mark.parametrize('value', ['STOCK', 'PURCHASE', 'whatever'])
    def test_requester_cannot_set_supply_source(self, requester, project, value):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(supply_source=value)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert stored.supply_source == ''
        assert response.data['items'][0]['supply_source'] == ''


@pytest.mark.django_db
class TestDroppedKeysAreVisible:
    def test_declared_central_stock_is_persisted(self, requester, project):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(stock_almacen_central='7.500')]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert str(stored.stock_almacen_central) == '7.500'

    def test_legacy_principal_key_is_dropped_but_logged(self, requester, project, caplog):
        """
        The frontend used to send `stock_almacen_principal` (not a field): DRF drops
        it silently and the declared stock stayed 0. Still tolerated for old clients,
        but no longer invisible.
        """
        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = client_for(requester).post(
                URL,
                _ops_payload(project, items=[_item(stock_almacen_principal='7.500')]),
                format='json',
            )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get(request__rq_number=response.data['rq_number'])
        assert stored.stock_almacen_central == 0
        records = [r for r in caplog.records if r.getMessage() == 'rq.create.item_unknown_fields']
        assert records, 'the dropped key should leave a warning'
        assert records[0].levelno == logging.WARNING
        assert records[0].unknown_fields == ['stock_almacen_principal']
        assert records[0].user_id == requester.pk

    def test_known_payload_does_not_log_unknown_fields(self, requester, project, caplog):
        with capture_logs(caplog, 'apps.rq.serializers.request'):
            client_for(requester).post(URL, _ops_payload(project), format='json')

        assert not [r for r in caplog.records if r.getMessage() == 'rq.create.item_unknown_fields']


@pytest.mark.django_db
class TestHostilePayloads:
    def test_anonymous_cannot_create(self, api_client, project):
        response = api_client.post(URL, _ops_payload(project), format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.parametrize('items', ['not-a-list', 'x', 5, {'a': 1}, [None], ['text'], [[1, 2]]])
    def test_items_of_the_wrong_shape_are_rejected_not_a_500(self, requester, project, items):
        response = client_for(requester).post(URL, _ops_payload(project, items=items), format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.count() == 0

    def test_oversized_description_is_rejected(self, requester, project):
        response = client_for(requester).post(
            URL, _ops_payload(project, items=[_item(description='A' * 301)]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_client_cannot_inject_status_or_requester(self, requester, other_requester, project):
        response = client_for(requester).post(
            URL,
            _ops_payload(project, status='CLOSED', requested_by=other_requester.pk),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        created = Request.objects.get(rq_number=response.data['rq_number'])
        assert created.status == 'SUBMITTED'
        assert created.requested_by_id == requester.pk


@pytest.mark.django_db
class TestReadSerializers:
    def test_detail_exposes_area_and_linked_and_unlinked_lines(self, requester, project):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
        rq = make_request(number='RQ-2026-0601', requester=requester, project=project)
        rq.requesting_area = 'HSE'
        rq.save(update_fields=['requesting_area'])
        make_item(rq, 1, inventory_item=helmet, item_source='EPP')
        make_item(rq, 2, description='Flete', is_off_catalog=True, item_source='MATERIALES')
        make_item(rq, 3, description='Sin vincular')

        response = client_for(requester).get(f'{URL}{rq.pk}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['requesting_area'] == 'HSE'
        assert response.data['requesting_area_display'] == 'Seguridad y Salud (HSE)'
        linked, off_catalog, unlinked = response.data['items']
        assert linked['inventory_item'] == helmet.pk
        assert linked['inventory_item_code'] == 'EPP-0001'
        assert linked['inventory_item_unit'] == 'UND'
        assert linked['item_source_display'] == 'EPP'
        assert off_catalog['is_off_catalog'] is True
        assert off_catalog['inventory_item'] is None
        assert off_catalog['inventory_item_code'] is None
        assert unlinked['item_source'] == ''
        assert unlinked['item_source_display'] == ''

    def test_historical_request_without_area_still_serializes(self, requester, project):
        rq = make_request(number='RQ-2026-0602', requester=requester, project=project)

        detail = client_for(requester).get(f'{URL}{rq.pk}/')
        listing = client_for(requester).get(URL)

        assert detail.status_code == status.HTTP_200_OK
        assert detail.data['requesting_area'] == ''
        assert listing.status_code == status.HTTP_200_OK
        assert listing.data['results'][0]['requesting_area'] == ''
        assert listing.data['results'][0]['requesting_area_display'] == ''

    def test_list_exposes_requesting_area(self, requester, project):
        client_for(requester).post(URL, _ops_payload(project, requesting_area='QC'), format='json')

        listing = client_for(requester).get(URL)

        assert listing.data['results'][0]['requesting_area'] == 'QC'
        assert listing.data['results'][0]['requesting_area_display'] == 'Control de Calidad (QC)'

    def test_detail_does_not_run_a_query_per_line(self, requester, project, django_assert_max_num_queries):
        rq = make_request(number='RQ-2026-0603', requester=requester, project=project)
        for n in range(1, 9):
            helmet = make_inventory(f'EPP-{n:04d}', f'Producto {n}')
            make_item(rq, n, inventory_item=helmet, item_source='EPP')

        with django_assert_max_num_queries(12):
            response = client_for(requester).get(f'{URL}{rq.pk}/')

        assert len(response.data['items']) == 8


@pytest.mark.django_db
class TestDatabaseConstraint:
    def test_db_rejects_a_line_linked_and_off_catalog(self, ops_request_for_constraint):
        helmet = make_inventory()

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                make_item(ops_request_for_constraint, 1, inventory_item=helmet, is_off_catalog=True)

    def test_model_validation_gives_a_friendly_error_before_the_database_does(
        self, ops_request_for_constraint,
    ):
        """What the admin form shows instead of a 500."""
        from django.core.exceptions import ValidationError

        helmet = make_inventory()
        item = RequestItem(
            request=ops_request_for_constraint, line_number=1, description='x', quantity=1, unit='UND',
            inventory_item=helmet, is_off_catalog=True,
        )

        with pytest.raises(ValidationError) as excinfo:
            item.full_clean()

        assert 'is_off_catalog' in excinfo.value.message_dict

    def test_db_allows_either_state_alone(self, ops_request_for_constraint):
        helmet = make_inventory()

        make_item(ops_request_for_constraint, 1, inventory_item=helmet)
        make_item(ops_request_for_constraint, 2, is_off_catalog=True)

        assert RequestItem.objects.count() == 2

    def test_deleting_the_product_leaves_a_consistent_line(self, ops_request_for_constraint):
        """SET_NULL on the FK must not trip the constraint."""
        helmet = make_inventory()
        item = make_item(ops_request_for_constraint, 1, inventory_item=helmet)

        helmet.delete()

        item.refresh_from_db()
        assert item.inventory_item_id is None
        assert item.is_off_catalog is False


@pytest.fixture
def ops_request_for_constraint(db, requester, project):
    return make_request(number='RQ-2026-0610', requester=requester, project=project)
