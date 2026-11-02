"""
SYSPCC-041 · el N° de guía automático sale impreso en el PDF de la salida y no rompe el historial.

* `generate_group_pdf` y `generate_movement_pdf` imprimen «N° de guía GR-…» en las salidas nuevas;
  los ingresos y las salidas históricas (sin guía) conservan el diseño anterior.
* El vale físico, si existe (historial, importación), se sigue imprimiendo y filtrando.
"""
import io
from unittest import mock

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from pypdf import PdfReader

from apps.warehouse.models import MovementGroup
from apps.warehouse.services import movements as svc
from apps.warehouse.services.pdf_generator import generate_group_pdf, generate_movement_pdf, get_group_filename
from .conftest import client_for

pytestmark = pytest.mark.django_db

BATCH_EXIT = '/api/v1/warehouse/movements/batch-exit/'


def pdf_text(pdf: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    return ' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload') as enqueue:
        yield enqueue


@pytest.fixture
def item(make_item):
    return make_item('EPP000001', 'GUANTE T: L', 'EA', stock=100)


def new_exit(user, item, **extra):
    base = dict(
        items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user,
    )
    base.update(extra)
    return svc.register_exit_batch(**base)


def historic_exit(user, item):
    """An exit as it was stored before SYSPCC-041: no automatic guide."""
    group = new_exit(user, item)
    MovementGroup.objects.filter(pk=group.pk).update(internal_guide_number=None, guide_number='')
    group.refresh_from_db()
    return group


class TestGroupPdf:
    def test_a_new_exit_prints_the_guide_and_the_internal_vale(self, central_warehouse, item):
        group = new_exit(central_warehouse, item)
        text = pdf_text(generate_group_pdf(group))

        assert f'N° de guía {group.internal_guide_number}' in text
        assert group.internal_guide_number.startswith('GR-')
        assert f'Vale interno {group.group_number}' in text
        assert 'no reemplaza la guía de remisión electrónica' in text

    def test_the_guide_is_the_next_number_on_each_vale(self, central_warehouse, item):
        first, second = new_exit(central_warehouse, item), new_exit(central_warehouse, item)
        assert first.internal_guide_number in pdf_text(generate_group_pdf(first))
        assert second.internal_guide_number in pdf_text(generate_group_pdf(second))
        assert second.internal_guide_number not in pdf_text(generate_group_pdf(first))

    def test_a_historic_exit_keeps_the_old_layout(self, central_warehouse, item):
        group = historic_exit(central_warehouse, item)
        text = pdf_text(generate_group_pdf(group))

        assert 'N° de guía' not in text and 'GR-' not in text
        assert group.group_number in text

    def test_the_physical_vale_is_still_printed_when_the_group_has_one(self, central_warehouse, item):
        group = new_exit(central_warehouse, item, voucher_number='3425')
        text = pdf_text(generate_group_pdf(group))
        assert 'N° de vale (físico) 3425' in text and group.internal_guide_number in text

    def test_an_entry_never_prints_an_internal_guide(self, central_warehouse, item):
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 5}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='Proveedor Prueba', invoice_number='F-1', notes='',
            registered_by=central_warehouse, guide_number='T001-0007',
        )
        text = pdf_text(generate_group_pdf(group))
        assert 'N° de guía' not in text and 'T001-0007' in text           # the supplier's guide, as before

    def test_the_file_name_leads_with_the_guide(self, central_warehouse, item):
        group = new_exit(central_warehouse, item)
        assert get_group_filename(group).startswith(f'{group.internal_guide_number}_{group.group_number}_')
        legacy = historic_exit(central_warehouse, item)
        assert get_group_filename(legacy).startswith(legacy.group_number)

    def test_the_download_endpoint_returns_a_pdf_with_the_guide(self, central_warehouse, item):
        group = new_exit(central_warehouse, item)
        response = client_for(central_warehouse).get(f'/api/v1/warehouse/movements/groups/{group.pk}/pdf/')

        assert response.status_code == 200 and response['Content-Type'] == 'application/pdf'
        assert group.internal_guide_number in pdf_text(response.content)
        assert group.internal_guide_number in response['Content-Disposition']


class TestMovementPdf:
    def test_a_line_of_a_new_exit_prints_the_guide(self, central_warehouse, item):
        group = new_exit(central_warehouse, item)
        movement = group.movements.get()
        assert f'N° de guía {group.internal_guide_number}' in pdf_text(generate_movement_pdf(movement))

    def test_a_historic_line_does_not(self, central_warehouse, item):
        movement = historic_exit(central_warehouse, item).movements.get()
        assert 'N° de guía' not in pdf_text(generate_movement_pdf(movement))

    def test_the_download_endpoint(self, central_warehouse, item):
        group = new_exit(central_warehouse, item)
        movement = group.movements.get()
        response = client_for(central_warehouse).get(f'/api/v1/warehouse/movements/{movement.pk}/pdf/')
        assert response.status_code == 200
        assert group.internal_guide_number in pdf_text(response.content)


class TestPhysicalValeStaysSearchable:
    def test_no_voucher_ignores_exits_with_an_automatic_guide_and_keeps_the_historic_ones(
        self, central_warehouse, item,
    ):
        # SYSPCC-041: the dashboard counter «Egresos sin vale» and the history filter use `no_voucher`.
        new_without_vale = new_exit(central_warehouse, item)
        historic_without_vale = historic_exit(central_warehouse, item)
        historic_with_vale = new_exit(central_warehouse, item, voucher_number='3425')
        MovementGroup.objects.filter(pk=historic_with_vale.pk).update(internal_guide_number=None)
        client = client_for(central_warehouse)

        listed = client.get('/api/v1/warehouse/movements/', {'no_voucher': 'true'}).json()
        export_rows = client.get('/api/v1/warehouse/movements/export/', {'no_voucher': 'true'})

        assert listed['count'] == 1
        assert listed['results'][0]['movement_number'].startswith(historic_without_vale.group_number)
        assert new_without_vale.internal_guide_number not in [
            m['internal_guide_number'] for m in listed['results']
        ]
        assert export_rows.status_code == 200

    def test_the_movement_list_does_not_query_per_row(self, central_warehouse, item, django_assert_max_num_queries):
        # The list serializes `internal_guide_number` from the group: `group` must be select_related.
        for _ in range(3):
            new_exit(central_warehouse, item)
        client = client_for(central_warehouse)
        with CaptureQueriesContext(connection) as small:
            assert client.get('/api/v1/warehouse/movements/').json()['count'] == 3
        for _ in range(12):
            new_exit(central_warehouse, item)
        with django_assert_max_num_queries(len(small)):
            assert client.get('/api/v1/warehouse/movements/').json()['count'] == 15

    def test_the_group_voucher_does_not_query_per_line(self, central_warehouse, make_item):
        items = [make_item(f'EPP{n:06d}', f'ITEM {n}', 'EA', stock=50) for n in range(1, 11)]
        client = client_for(central_warehouse)

        def vale(count):
            return svc.register_exit_batch(
                items_data=[{'inventory_id': i.pk, 'quantity': 1, 'line': n} for n, i in enumerate(items[:count], 1)],
                warehouse='CENTRAL', project_id=None, destination_type='EMPLOYEE', destination_detail='X',
                requested_by_id=None, authorized_by_id=None, notes='', registered_by=central_warehouse)

        small_group, large_group = vale(1), vale(10)
        with CaptureQueriesContext(connection) as small:
            client.get(f'/api/v1/warehouse/movements/groups/{small_group.pk}/voucher/')
        with CaptureQueriesContext(connection) as large:
            response = client.get(f'/api/v1/warehouse/movements/groups/{large_group.pk}/voucher/')
        assert len(response.json()['movements']) == 10 and len(large) == len(small)

    def test_the_recent_movements_of_an_item_do_not_query_per_row(self, central_warehouse, item):
        client = client_for(central_warehouse)
        for _ in range(2):
            new_exit(central_warehouse, item)
        with CaptureQueriesContext(connection) as small:
            client.get(f'/api/v1/warehouse/inventory/{item.pk}/recent-movements/')
        for _ in range(3):
            new_exit(central_warehouse, item)
        with CaptureQueriesContext(connection) as large:
            response = client.get(f'/api/v1/warehouse/inventory/{item.pk}/recent-movements/')
        assert len(response.json()) == 5 and len(large) == len(small)

    def test_filters_by_voucher_number_keep_working(self, central_warehouse, item):
        with_vale = new_exit(central_warehouse, item, voucher_number='3425')
        new_exit(central_warehouse, item)
        client = client_for(central_warehouse)

        by_number = client.get('/api/v1/warehouse/movements/', {'voucher_number': '3425'}).json()['results']

        assert [m['internal_guide_number'] for m in by_number] == [with_vale.internal_guide_number]

    def test_a_vale_sent_by_an_old_client_is_stored_and_still_checked_for_duplicates(self, central_warehouse, item):
        client = client_for(central_warehouse)
        body = {
            'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona de Prueba',
            'voucher_number': 'V-77', 'items': [{'inventory': item.pk, 'quantity': '1'}],
        }
        assert client.post(BATCH_EXIT, body, format='json').status_code == 201
        again = client.post(BATCH_EXIT, body, format='json')
        assert again.status_code == 409 and again.json()['code'] == 'voucher_number_exists'
        assert client.post(BATCH_EXIT, body | {'allow_duplicate_voucher': True}, format='json').status_code == 201
        assert MovementGroup.objects.count() == 2
        year = timezone.localdate().year
        assert set(MovementGroup.objects.values_list('internal_guide_number', flat=True)) == {
            f'GR-{year}-000001', f'GR-{year}-000002',
        }
