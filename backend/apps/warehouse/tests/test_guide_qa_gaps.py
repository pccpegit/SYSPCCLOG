"""
SYSPCC-041 · FASE 4 (qa-engineer): huecos de cobertura del N° de guía automático y del selector.

Complementa `test_guide_numbering.py`, `test_guide_pdf.py`, `test_rq_deliverable.py` y
`test_rq_delivery.py` con lo que quedaba sin cubrir:

  * el cambio de año de Lima de punta a punta (por `register_exit_batch`, no solo por el servicio);
  * una salida rechazada POR LA API (stock insuficiente) no consume número, ni en batch-exit ni en EPP;
  * `internal_guide_number` es de solo lectura: un cliente que lo envía es ignorado en TODAS las rutas;
  * el selector `deliverable`: delega la visibilidad en `get_accessible_requests_queryset`, throttle
    propio, tope de `page_size`, página fuera de rango, tope de candidatos, ítems mixtos;
  * el PDF descargado desde el `movement_group_id` de la entrega de RQ trae la guía; nombre de archivo
    seguro en el encabezado `Content-Disposition`;
  * la ventana de `DUPLICATE_DELIVERY` (justo dentro y justo fuera) y que el rechazo no deja rastro.
"""
import datetime
import io
import re
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from pypdf import PdfReader
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    client_for,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
    ops_rq,
)
from apps.warehouse.models import GuideSequence, MovementGroup, WarehouseDispatch
from apps.warehouse.services import movements as svc
from apps.warehouse.services.pdf_generator import get_group_filename, get_movement_filename
from apps.warehouse.services.rq_fulfillment import DUPLICATE_DELIVERY_WINDOW

pytestmark = pytest.mark.django_db

BATCH_EXIT = '/api/v1/warehouse/movements/batch-exit/'
EPP = '/api/v1/warehouse/movements/epp-delivery/'
DELIVER = '/api/v1/warehouse/pending-requests/{}/deliver/'
DELIVERABLE = '/api/v1/warehouse/pending-requests/deliverable/'
GUIDE_RE = re.compile(r'^GR-\d{4}-\d{6}$')
SAFE_FILENAME = re.compile(r'^[A-Za-z0-9_.\-]+$')
THIS_YEAR = timezone.localdate().year


def guide(n, year=THIS_YEAR):
    return f'GR-{year}-{n:06d}'


def pdf_text(pdf: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    return ' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload') as enqueue:
        yield enqueue


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND', location='B3-2')
    make_stock(product, 100)
    return product


@pytest.fixture
def ops_in_stock(ops_rq, helmet):
    ops_rq.status = 'IN_STOCK'
    ops_rq.save(update_fields=['status'])
    item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
    return ops_rq, item


def exit_group(user, product, qty=1):
    return svc.register_exit_batch(
        items_data=[{'inventory_id': product.pk, 'quantity': qty}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona de Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user,
    )


def exit_body(product, qty='1', **over):
    body = {
        'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona de Prueba',
        'items': [{'inventory': product.pk, 'quantity': qty}],
    }
    body.update(over)
    return body


def epp_body(product, qty='1', **over):
    body = {
        'warehouse': 'CENTRAL', 'recipient': {'name': 'Persona de Prueba'}, 'movement_date': timezone.localdate().isoformat(),
        'items': [{'inventory': product.pk, 'quantity': qty}],
    }
    body.update(over)
    return body


def deliver_body(item, qty='1', **over):
    return {'lines': [{'request_item_id': item.pk, 'quantity': qty}]} | over


# ═══════════════════ cambio de año de Lima, de punta a punta ═══════════════════

class TestYearRolloverEndToEnd:
    def test_exits_around_the_lima_new_year_restart_the_counter_on_the_vale_and_the_mirrors(
        self, central_warehouse, helmet,
    ):
        before = datetime.datetime(2027, 1, 1, 4, 59, tzinfo=ZoneInfo('UTC'))     # 23:59 31/12 in Lima
        after = datetime.datetime(2027, 1, 1, 5, 0, tzinfo=ZoneInfo('UTC'))       # 00:00 01/01 in Lima

        with mock.patch('django.utils.timezone.now', return_value=before):
            last_of_2026 = exit_group(central_warehouse, helmet)
        with mock.patch('django.utils.timezone.now', return_value=after):
            first_of_2027 = exit_group(central_warehouse, helmet)
        with mock.patch('django.utils.timezone.now', return_value=after):
            second_of_2027 = exit_group(central_warehouse, helmet)

        assert last_of_2026.internal_guide_number == 'GR-2026-000001'
        assert first_of_2027.internal_guide_number == 'GR-2027-000001'
        assert second_of_2027.internal_guide_number == 'GR-2027-000002'
        # every mirror carries the guide of ITS year, not the one of the previous document
        for group in (last_of_2026, first_of_2027, second_of_2027):
            assert group.guide_number == group.internal_guide_number
            assert set(group.movements.values_list('guide_number', flat=True)) == {group.internal_guide_number}
        assert dict(GuideSequence.objects.values_list('year', 'last_value')) == {2026: 1, 2027: 2}

    def test_a_retroactive_operational_date_in_another_year_does_not_pick_that_years_counter(
        self, central_warehouse, helmet,
    ):
        group = svc.register_exit_batch(
            items_data=[{'inventory_id': helmet.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            destination_type='EMPLOYEE', destination_detail='Persona', requested_by_id=None,
            authorized_by_id=None, notes='', registered_by=central_warehouse,
            movement_date=datetime.date(2019, 12, 31),
        )
        assert group.internal_guide_number == guide(1)
        assert list(GuideSequence.objects.values_list('year', flat=True)) == [THIS_YEAR]


# ═══════════════ una salida rechazada por la API no consume número ═══════════════

class TestRejectedApiExitsLeaveNoGap:
    def test_batch_exit_without_stock_is_a_client_error_and_the_next_one_is_consecutive(
        self, central_warehouse, helmet,
    ):
        client = client_for(central_warehouse)
        assert client.post(BATCH_EXIT, exit_body(helmet), format='json').json()['internal_guide_number'] == guide(1)

        refused = client.post(BATCH_EXIT, exit_body(helmet, qty='5000'), format='json')
        assert 400 <= refused.status_code < 500, refused.content
        assert refused.json().get('internal_guide_number') is None

        ok = client.post(BATCH_EXIT, exit_body(helmet), format='json')
        assert ok.status_code == 201 and ok.json()['internal_guide_number'] == guide(2)
        assert GuideSequence.objects.get().last_value == 2
        assert MovementGroup.objects.count() == 2

    def test_a_batch_exit_with_one_good_and_one_impossible_line_writes_nothing_and_keeps_the_number(
        self, central_warehouse, helmet,
    ):
        gloves = make_inventory('EPP-0002', 'Guantes', 'PAR')
        make_stock(gloves, 1)
        body = exit_body(helmet) | {'items': [
            {'inventory': helmet.pk, 'quantity': '1'}, {'inventory': gloves.pk, 'quantity': '9'}]}

        refused = client_for(central_warehouse).post(BATCH_EXIT, body, format='json')

        assert 400 <= refused.status_code < 500
        assert not GuideSequence.objects.exists() and not MovementGroup.objects.exists()
        from apps.warehouse.models import InventoryStock
        assert InventoryStock.objects.get(inventory=helmet).quantity == Decimal('100.000')

    def test_epp_delivery_without_stock_does_not_burn_a_number(self, central_warehouse, helmet):
        client = client_for(central_warehouse)
        refused = client.post(EPP, epp_body(helmet, qty='5000'), format='json')
        assert 400 <= refused.status_code < 500, refused.content
        assert not GuideSequence.objects.exists()

        ok = client.post(EPP, epp_body(helmet), format='json')
        assert ok.status_code == 201, ok.content
        assert ok.json()['internal_guide_number'] == guide(1)

    def test_an_invalid_payload_is_a_400_before_any_number_is_taken(self, central_warehouse, helmet):
        for body in (exit_body(helmet, qty='0'), exit_body(helmet, qty='-1'), exit_body(helmet, items=[])):
            assert client_for(central_warehouse).post(BATCH_EXIT, body, format='json').status_code == 400
        assert not GuideSequence.objects.exists()

    def test_a_request_delivery_refused_over_the_api_does_not_burn_a_number(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)

        refused = client.post(DELIVER.format(rq.pk), deliver_body(item, '11'), format='json')
        assert refused.status_code == 409 and refused.json()['code'] == 'DELIVERY_LINES_INVALID'
        assert not GuideSequence.objects.exists()

        ok = client.post(DELIVER.format(rq.pk), deliver_body(item, '2'), format='json')
        assert ok.status_code == 201 and ok.json()['delivery']['dispatch_guide_number'] == guide(1)


# ═════════════════ el N° de guía es de solo lectura para el cliente ═════════════════

class TestTheClientCannotChooseTheGuide:
    def test_batch_exit_ignores_internal_guide_number_and_guide_number(self, central_warehouse, helmet):
        body = exit_body(helmet, internal_guide_number='GR-1999-000777', guide_number='MANUAL-1')
        response = client_for(central_warehouse).post(BATCH_EXIT, body, format='json')

        assert response.status_code == 201, response.content
        assert response.json()['internal_guide_number'] == guide(1)
        assert not MovementGroup.objects.filter(internal_guide_number='GR-1999-000777').exists()

    def test_epp_delivery_ignores_internal_guide_number(self, central_warehouse, helmet):
        body = epp_body(helmet, internal_guide_number='GR-1999-000777', guide_number='MANUAL-2')
        response = client_for(central_warehouse).post(EPP, body, format='json')

        assert response.status_code == 201, response.content
        assert response.json()['internal_guide_number'] == guide(1)
        group = MovementGroup.objects.get()
        assert group.internal_guide_number == guide(1) and group.guide_number == guide(1)

    def test_the_delivery_ignores_both_guide_fields(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        body = deliver_body(item, '2', dispatch_guide_number='MANUAL-3', internal_guide_number='GR-1999-000001',
                            guide_number='MANUAL-4')
        response = client_for(central_warehouse).post(DELIVER.format(rq.pk), body, format='json')

        assert response.status_code == 201, response.content
        assert response.json()['delivery']['dispatch_guide_number'] == guide(1)
        assert WarehouseDispatch.objects.get().dispatch_guide_number == guide(1)
        assert not MovementGroup.objects.filter(internal_guide_number='GR-1999-000001').exists()

    def test_the_entry_endpoint_never_issues_a_guide(self, central_warehouse, helmet):
        body = {'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', 'supplier_name': 'Proveedor Prueba',
                'items': [{'inventory': helmet.pk, 'quantity': '5'}],
                'guide_number': 'T001-77', 'internal_guide_number': 'GR-2026-000050'}
        response = client_for(central_warehouse).post('/api/v1/warehouse/movements/batch-entry/', body, format='json')

        assert response.status_code == 201, response.content
        assert response.json().get('internal_guide_number') is None
        assert not GuideSequence.objects.exists()
        assert not MovementGroup.objects.exclude(internal_guide_number=None).exists()


# ═══════════════════ PDF de la entrega y nombre de archivo seguro ═══════════════════

class TestDeliveryPdfAndFileName:
    def test_the_pdf_of_the_group_returned_by_the_delivery_prints_its_guide(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        delivery = client.post(DELIVER.format(rq.pk), deliver_body(item, '3'), format='json').json()['delivery']

        pdf = client.get(f'/api/v1/warehouse/movements/groups/{delivery["movement_group_id"]}/pdf/')

        assert pdf.status_code == 200 and pdf['Content-Type'] == 'application/pdf'
        assert delivery['dispatch_guide_number'] in pdf_text(pdf.content)
        assert delivery['dispatch_number'] in pdf_text(pdf.content)

    def test_the_pdf_endpoint_requires_authentication(self, central_warehouse, helmet):
        group = exit_group(central_warehouse, helmet)
        response = APIClient().get(f'/api/v1/warehouse/movements/groups/{group.pk}/pdf/')
        assert response.status_code in (401, 403)

    def test_the_file_name_only_has_safe_characters(self, central_warehouse, helmet):
        group = exit_group(central_warehouse, helmet)
        client = client_for(central_warehouse)

        for url, expected in (
            (f'/api/v1/warehouse/movements/groups/{group.pk}/pdf/', get_group_filename(group)),
            (f'/api/v1/warehouse/movements/{group.movements.get().pk}/pdf/',
             get_movement_filename(group.movements.get())),
        ):
            disposition = client.get(url)['Content-Disposition']
            match = re.fullmatch(r'inline; filename="([^"]+)"', disposition)
            assert match, disposition
            assert SAFE_FILENAME.match(match.group(1)), match.group(1)
            assert match.group(1) == expected
            assert '\r' not in disposition and '\n' not in disposition

        assert get_group_filename(group).startswith(f'{group.internal_guide_number}_')
        assert GUIDE_RE.match(group.internal_guide_number)

    def test_a_hostile_destination_text_cannot_reach_the_file_name_or_break_the_pdf(self, central_warehouse, helmet):
        group = svc.register_exit_batch(
            items_data=[{'inventory_id': helmet.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            destination_type='EMPLOYEE', destination_detail='<b>x</b>"\r\nSet-Cookie: a=b&amp;<para>',
            requested_by_id=None, authorized_by_id=None, notes='<script>1</script>', registered_by=central_warehouse,
        )
        response = client_for(central_warehouse).get(f'/api/v1/warehouse/movements/groups/{group.pk}/pdf/')

        assert response.status_code == 200
        assert group.internal_guide_number in pdf_text(response.content)
        assert SAFE_FILENAME.match(re.fullmatch(r'inline; filename="([^"]+)"', response['Content-Disposition']).group(1))
        assert 'Set-Cookie' not in response.headers


# ═════════════════════════ DUPLICATE_DELIVERY: la ventana ═════════════════════════

class TestDuplicateDeliveryWindow:
    def _first(self, client, rq, item, qty='2'):
        assert client.post(DELIVER.format(rq.pk), deliver_body(item, qty), format='json').status_code == 201

    def test_just_inside_the_window_it_is_refused_and_leaves_no_trace(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        self._first(client, rq, item)
        WarehouseDispatch.objects.update(
            dispatched_at=timezone.now() - DUPLICATE_DELIVERY_WINDOW + datetime.timedelta(seconds=3))

        again = client.post(DELIVER.format(rq.pk), deliver_body(item, '2'), format='json')

        assert again.status_code == 409 and again.json()['code'] == 'DUPLICATE_DELIVERY'
        assert GuideSequence.objects.get().last_value == 1           # the refused click took no number
        assert MovementGroup.objects.count() == 1 and WarehouseDispatch.objects.count() == 1

    def test_the_refusal_does_not_block_a_later_legitimate_retry(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        self._first(client, rq, item)
        assert client.post(DELIVER.format(rq.pk), deliver_body(item, '2'), format='json').status_code == 409

        WarehouseDispatch.objects.update(
            dispatched_at=timezone.now() - DUPLICATE_DELIVERY_WINDOW - datetime.timedelta(seconds=5))
        retry = client.post(DELIVER.format(rq.pk), deliver_body(item, '2'), format='json')

        assert retry.status_code == 201
        assert retry.json()['delivery']['dispatch_guide_number'] == guide(2)

    def test_the_same_quantity_on_another_rq_is_not_a_duplicate(self, ops_in_stock, central_warehouse, helmet,
                                                                  requester, project):
        rq, item = ops_in_stock
        other = make_request(number='RQ-2026-0502', requester=requester, project=project, status='IN_STOCK')
        other_item = make_item(other, 1, quantity=10, inventory_item=helmet, confirmed=True)
        client = client_for(central_warehouse)
        self._first(client, rq, item)

        assert client.post(DELIVER.format(other.pk), deliver_body(other_item, '2'), format='json').status_code == 201


# ═════════════════════════════ selector `deliverable` ═════════════════════════════

@pytest.fixture
def logistics_coordinator(db, project):
    return make_user('logistics_coordinator', RoleChoices.LOGISTICS_COORDINATOR, project=project)


def rq_in_stock(requester, product, project, number, *, qty=10, status='IN_STOCK'):
    rq = make_request(number=number, requester=requester, project=project, status=status)
    item = make_item(rq, 1, quantity=qty, inventory_item=product, confirmed=True)
    return rq, item


def listed(user, **params):
    response = client_for(user).get(DELIVERABLE, params)
    assert response.status_code == 200, response.content
    return response.json()


class TestDeliverableSelector:
    def test_visibility_is_delegated_to_get_accessible_requests_queryset(
        self, central_warehouse, requester, helmet, project,
    ):
        from apps.rq.models import Request

        visible, _ = rq_in_stock(requester, helmet, project, 'RQ-2026-0701')
        hidden, _ = rq_in_stock(requester, helmet, project, 'RQ-2026-0702')

        def only_visible(_user):
            return Request.objects.filter(pk=visible.pk)

        with mock.patch('apps.warehouse.services.rq_deliverable.get_accessible_requests_queryset',
                        side_effect=only_visible):
            numbers = [row['rq_number'] for row in listed(central_warehouse)['results']]

        assert numbers == ['RQ-2026-0701']
        assert hidden.rq_number not in numbers

    def test_a_draft_that_was_never_sent_is_not_listed_even_for_a_delivering_role(
        self, central_warehouse, requester, helmet, project,
    ):
        rq_in_stock(requester, helmet, project, 'RQ-2026-0703', status='DRAFT')
        assert listed(central_warehouse)['results'] == []

    def test_it_has_its_own_throttle_bucket(self, central_warehouse, requester, helmet, project, monkeypatch):
        from apps.warehouse.throttling import WarehouseLookupThrottle

        monkeypatch.setattr(WarehouseLookupThrottle, 'THROTTLE_RATES',
                            {'user': '1000/min', 'warehouse_lookup': '2/min'})
        rq_in_stock(requester, helmet, project, 'RQ-2026-0704')
        client = client_for(central_warehouse)

        statuses = [client.get(DELIVERABLE).status_code for _ in range(3)]

        assert statuses == [200, 200, 429]

    def test_page_size_is_capped_at_one_hundred(self, central_warehouse, requester, helmet, project):
        rq_in_stock(requester, helmet, project, 'RQ-2026-0705')
        body = listed(central_warehouse, page_size=100000)
        assert body['count'] == 1 and len(body['results']) == 1

    def test_a_page_past_the_end_is_a_404_not_a_500(self, central_warehouse, requester, helmet, project):
        rq_in_stock(requester, helmet, project, 'RQ-2026-0706')
        assert client_for(central_warehouse).get(DELIVERABLE, {'page': 9}).status_code == 404

    def test_the_candidate_cap_is_logged_and_the_list_stays_bounded(
        self, central_warehouse, requester, helmet, project, monkeypatch,
    ):
        from apps.warehouse.services import rq_deliverable

        for n in range(4):
            rq_in_stock(requester, helmet, project, f'RQ-2026-08{n:02d}')
        monkeypatch.setattr(rq_deliverable, 'MAX_CANDIDATES', 2)

        with mock.patch.object(rq_deliverable.logger, 'warning') as warn:
            body = listed(central_warehouse)

        assert body['count'] == 2
        warn.assert_called_once()
        assert warn.call_args.args[0] == 'warehouse.rq_deliverable.candidates_capped'

    def test_mixed_items_count_pending_and_partial_separately(
        self, central_warehouse, requester, helmet, project, ops_rq,
    ):
        from apps.warehouse.services.rq_fulfillment import deliver_request_items

        gloves = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')
        make_stock(gloves, 100)
        boots = make_inventory('EPP-0003', 'Botas', 'PAR')
        make_stock(boots, 100)
        rq = ops_rq
        rq.status = 'IN_STOCK'
        rq.save(update_fields=['status'])
        untouched = make_item(rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
        half = make_item(rq, 2, description='Guantes', quantity=10, inventory_item=gloves, confirmed=True)
        done = make_item(rq, 3, description='Botas', quantity=4, inventory_item=boots, confirmed=True)
        deliver_request_items(rq.pk, central_warehouse, [
            {'request_item_id': half.pk, 'quantity': Decimal('4')},
            {'request_item_id': done.pk, 'quantity': Decimal('4')},
        ])

        row = listed(central_warehouse)['results'][0]

        assert (row['items_total'], row['items_pending'], row['items_partial'], row['items_deliverable']) == (
            3, 1, 1, 2)
        assert untouched.pk and row['percent'] is not None and 0 < row['percent'] < 100

    def test_the_selector_does_not_expose_prices_or_worker_data(self, central_warehouse, requester, helmet, project):
        rq_in_stock(requester, helmet, project, 'RQ-2026-0707')
        row = listed(central_warehouse)['results'][0]
        leaked = {key for key in row if re.search(r'price|precio|cost|dni|worker|trabajador|email', key, re.I)}
        assert leaked == set()

    def test_logistics_coordinator_cannot_see_the_in_stock_backlog_of_the_keeper(
        self, logistics_coordinator, requester, helmet, project,
    ):
        rq_in_stock(requester, helmet, project, 'RQ-2026-0708')                      # IN_STOCK: keeper only
        rq_in_stock(requester, helmet, project, 'RQ-2026-0709', status='QUALITY_APPROVED')

        assert [r['rq_number'] for r in listed(logistics_coordinator)['results']] == ['RQ-2026-0709']


# ══════════════════════════ consultas acotadas (N+1) ══════════════════════════

class TestNoNPlusOne:
    def _kardex_queries(self, client, product):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as queries:
            response = client.get(f'/api/v1/warehouse/inventory/{product.pk}/kardex/')
        assert response.status_code == 200, response.content
        return len(queries), response.json()['movements']

    def test_the_kardex_does_not_query_per_row(self, central_warehouse, helmet):
        client = client_for(central_warehouse)
        for _ in range(2):
            exit_group(central_warehouse, helmet)
        few, rows = self._kardex_queries(client, helmet)
        assert len(rows) == 2 and all(r['internal_guide_number'] for r in rows)

        for _ in range(10):
            exit_group(central_warehouse, helmet)
        many, rows = self._kardex_queries(client, helmet)

        assert len(rows) == 12 and many == few, (few, many)

    def test_the_picking_history_does_not_query_per_delivery(self, ops_in_stock, central_warehouse):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        rq, item = ops_in_stock
        client = client_for(central_warehouse)

        def history_queries():
            with CaptureQueriesContext(connection) as queries:
                body = client.get(f'/api/v1/warehouse/pending-requests/{rq.pk}/picking/').json()
            return len(queries), body['deliveries']

        assert client.post(DELIVER.format(rq.pk), deliver_body(item, '1'), format='json').status_code == 201
        few, rows = history_queries()
        assert len(rows) == 1
        for qty in ('2', '3', '4'):
            assert client.post(DELIVER.format(rq.pk), deliver_body(item, qty), format='json').status_code == 201
        many, rows = history_queries()

        assert len(rows) == 4 and many == few, (few, many)
        assert [r['dispatch_guide_number'] for r in rows] == [guide(n) for n in range(1, 5)]
        assert all(r['movement_group_id'] and r['first_movement_id'] for r in rows)
