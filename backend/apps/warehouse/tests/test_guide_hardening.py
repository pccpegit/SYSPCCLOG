"""
SYSPCC-041 · endurecimiento tras la revisión de seguridad.

* Throttle propio de las salidas libres (`warehouse_exit`) y `lock_timeout` del contador (error 409
  `GUIDE_BUSY` uniforme; la parte que necesita PostgreSQL está en `test_guide_concurrency.py`).
* Anti doble envío de las salidas SIN RQ: `DUPLICATE_EXIT` (409) sin consumir número.
* Un N° de vale no puede imitar una guía interna (`GR-AAAA-N…`).
* El campo `guide_number` ya no es entrada de las salidas; log de la guía asignada.
* `deliverable`: `search` acotado a 100 caracteres e indicador `truncated`.
"""
import datetime
from decimal import Decimal
from unittest import mock

import pytest
from django.conf import settings
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse,
    client_for,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    make_user,
)
from apps.warehouse.models import GuideSequence, InventoryStock, MovementGroup
from apps.warehouse.serializers import (
    BatchEntryCreateSerializer,
    BatchExitCreateSerializer,
    EntryCreateSerializer,
    ExitCreateSerializer,
)
from apps.warehouse.services import movements as svc
from apps.warehouse.services.guides import BUSY_MESSAGE, GuideNumberBusyError

BATCH_EXIT = '/api/v1/warehouse/movements/batch-exit/'
BATCH_ENTRY = '/api/v1/warehouse/movements/batch-entry/'
EXIT = '/api/v1/warehouse/movements/exit/'
EPP = '/api/v1/warehouse/movements/epp-delivery/'
DELIVERABLE = '/api/v1/warehouse/pending-requests/deliverable/'

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload') as enqueue:
        yield enqueue


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')
    make_stock(product, 1000)
    return product


def batch_body(product, *, qty='1', destination='Persona de Prueba', **over):
    body = {
        'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': destination,
        'items': [{'inventory': product.pk, 'quantity': qty}],
    }
    body.update(over)
    return body


def exit_body(product, *, qty='1', destination='Persona de Prueba', **over):
    body = {
        'inventory': product.pk, 'quantity': qty, 'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE',
        'destination_detail': destination,
    }
    body.update(over)
    return body


def epp_body(product, *, qty='1', worker='Trabajador Libre Test', **over):
    body = {
        'warehouse': 'CENTRAL', 'movement_date': timezone.localdate().isoformat(),
        'recipient': {'name': worker}, 'items': [{'inventory': product.pk, 'quantity': qty}],
    }
    body.update(over)
    return body


def stock_of(product):
    return InventoryStock.objects.get(inventory=product).quantity


# ═══════════════════════════ throttle propio ═══════════════════════════

class TestExitThrottle:
    def test_the_scope_is_declared_in_the_settings(self):
        assert settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['warehouse_exit'] == '30/min'

    def test_free_exits_share_one_bucket_per_user(self, real_exit_guards, central_warehouse, helmet, monkeypatch):
        from apps.warehouse.throttling import WarehouseExitThrottle

        monkeypatch.setattr(WarehouseExitThrottle, 'THROTTLE_RATES',
                            {'user': '1000/min', 'warehouse_exit': '3/min'})
        client = client_for(central_warehouse)

        statuses = [
            client.post(BATCH_EXIT, batch_body(helmet, qty='1'), format='json').status_code,
            client.post(EXIT, exit_body(helmet, qty='2'), format='json').status_code,
            client.post(EPP, epp_body(helmet, qty='3'), format='json').status_code,
            client.post(BATCH_EXIT, batch_body(helmet, qty='4'), format='json').status_code,
            client.post(EXIT, exit_body(helmet, qty='5'), format='json').status_code,
            client.post(EPP, epp_body(helmet, qty='6'), format='json').status_code,
        ]

        assert statuses == [201, 201, 201, 429, 429, 429]
        assert MovementGroup.objects.count() == 3 and GuideSequence.objects.get().last_value == 3

    def test_reads_and_entries_are_not_in_that_bucket(self, real_exit_guards, central_warehouse, helmet, monkeypatch):
        from apps.warehouse.throttling import WarehouseExitThrottle

        monkeypatch.setattr(WarehouseExitThrottle, 'THROTTLE_RATES',
                            {'user': '1000/min', 'warehouse_exit': '1/min'})
        client = client_for(central_warehouse)
        assert client.post(BATCH_EXIT, batch_body(helmet), format='json').status_code == 201
        assert client.post(BATCH_EXIT, batch_body(helmet, qty='2'), format='json').status_code == 429

        assert client.get('/api/v1/warehouse/movements/').status_code == 200
        entry = {'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
                 'items': [{'inventory': helmet.pk, 'quantity': '5'}]}
        assert client.post(BATCH_ENTRY, entry, format='json').status_code == 201

    def test_each_user_has_their_own_bucket(self, real_exit_guards, central_warehouse, helmet, monkeypatch):
        from apps.warehouse.throttling import WarehouseExitThrottle

        monkeypatch.setattr(WarehouseExitThrottle, 'THROTTLE_RATES',
                            {'user': '1000/min', 'warehouse_exit': '1/min'})
        other = make_user('otro_almacenero', RoleChoices.CENTRAL_WAREHOUSE)
        assert client_for(central_warehouse).post(BATCH_EXIT, batch_body(helmet), format='json').status_code == 201
        assert client_for(other).post(BATCH_EXIT, batch_body(helmet, qty='2'), format='json').status_code == 201


# ═══════════════════════ contador ocupado (lock_timeout) ═══════════════════════

class TestGuideBusy:
    def _busy(self):
        return mock.patch('apps.warehouse.services.movements.next_guide_number',
                          side_effect=GuideNumberBusyError(BUSY_MESSAGE))

    @pytest.mark.parametrize('url, body', [
        (BATCH_EXIT, lambda p: batch_body(p)), (EXIT, lambda p: exit_body(p)), (EPP, lambda p: epp_body(p)),
    ])
    def test_a_busy_counter_is_a_readable_retryable_409_and_writes_nothing(
        self, central_warehouse, helmet, url, body,
    ):
        with self._busy():
            response = client_for(central_warehouse).post(url, body(helmet), format='json')

        assert response.status_code == 409
        assert response.json()['code'] == 'GUIDE_BUSY'
        assert 'Espere unos segundos' in response.json()['detail']
        assert not MovementGroup.objects.exists() and stock_of(helmet) == Decimal('1000.000')

    def test_a_busy_counter_in_a_delivery_uses_the_uniform_envelope(self, central_warehouse, helmet, project,
                                                                    requester):
        rq = make_request(number='RQ-2026-0900', requester=requester, project=project, status='IN_STOCK')
        item = make_item(rq, 1, quantity=5, inventory_item=helmet, confirmed=True)
        with self._busy():
            response = client_for(central_warehouse).post(
                f'/api/v1/warehouse/pending-requests/{rq.pk}/deliver/',
                {'lines': [{'request_item_id': item.pk, 'quantity': '1'}]}, format='json')

        body = response.json()
        assert response.status_code == 409
        assert body['error'] is True and body['code'] == 'GUIDE_BUSY' and body['status_code'] == 409
        assert not MovementGroup.objects.exists()

    def test_no_lock_timeout_statement_runs_outside_postgresql(self, central_warehouse, helmet):
        from django.db import connection

        if connection.vendor == 'postgresql':
            pytest.skip('SQLite only: PostgreSQL runs the statement (see test_guide_concurrency.py)')
        from apps.warehouse.services import guides

        assert guides._set_lock_timeout() is None


# ═══════════════════════ anti doble envío sin RQ ═══════════════════════

class TestDuplicateExit:
    def test_an_identical_batch_exit_is_refused_and_takes_no_number(
        self, real_exit_guards, central_warehouse, helmet,
    ):
        client = client_for(central_warehouse)
        assert client.post(BATCH_EXIT, batch_body(helmet, qty='4'), format='json').status_code == 201

        again = client.post(BATCH_EXIT, batch_body(helmet, qty='4'), format='json')

        assert again.status_code == 409
        assert again.json()['code'] == 'DUPLICATE_EXIT'
        assert 'espere unos segundos' in again.json()['detail']
        assert MovementGroup.objects.count() == 1
        assert GuideSequence.objects.get().last_value == 1                 # no number consumed
        assert stock_of(helmet) == Decimal('996.000')                      # discounted once

    def test_the_next_identical_request_after_a_refusal_still_gets_the_next_number(
        self, real_exit_guards, central_warehouse, helmet,
    ):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, batch_body(helmet), format='json')
        client.post(BATCH_EXIT, batch_body(helmet), format='json')                      # refused
        other = client.post(BATCH_EXIT, batch_body(helmet, qty='2'), format='json')
        assert other.status_code == 201 and other.json()['internal_guide_number'].endswith('000002')

    def test_the_single_exit_and_the_epp_delivery_are_covered_too(
        self, real_exit_guards, central_warehouse, helmet,
    ):
        client = client_for(central_warehouse)
        assert client.post(EXIT, exit_body(helmet), format='json').status_code == 201
        assert client.post(EXIT, exit_body(helmet), format='json').json()['code'] == 'DUPLICATE_EXIT'
        assert client.post(EPP, epp_body(helmet), format='json').status_code == 201
        assert client.post(EPP, epp_body(helmet), format='json').json()['code'] == 'DUPLICATE_EXIT'
        assert MovementGroup.objects.count() == 2

    def test_a_different_quantity_destination_item_or_user_is_a_new_exit(
        self, real_exit_guards, central_warehouse, helmet,
    ):
        gloves = make_inventory('EPP-0002', 'Guantes', 'PAR')
        make_stock(gloves, 100)
        other_user = make_user('otro_almacenero', RoleChoices.CENTRAL_WAREHOUSE)
        client = client_for(central_warehouse)
        assert client.post(BATCH_EXIT, batch_body(helmet, qty='1'), format='json').status_code == 201

        assert client.post(BATCH_EXIT, batch_body(helmet, qty='2'), format='json').status_code == 201
        assert client.post(BATCH_EXIT, batch_body(helmet, destination='Otra Persona'), format='json').status_code == 201
        assert client.post(BATCH_EXIT, batch_body(gloves), format='json').status_code == 201
        assert client_for(other_user).post(BATCH_EXIT, batch_body(helmet), format='json').status_code == 201

    def test_the_same_item_split_over_lines_counts_as_the_same_exit(
        self, real_exit_guards, central_warehouse, helmet,
    ):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, batch_body(helmet, qty='2'), format='json')
        split = batch_body(helmet, items=[{'inventory': helmet.pk, 'quantity': '1'},
                                          {'inventory': helmet.pk, 'quantity': '1'}])
        assert client.post(BATCH_EXIT, split, format='json').json()['code'] == 'DUPLICATE_EXIT'

    def test_after_the_window_the_same_exit_is_allowed(self, real_exit_guards, central_warehouse, helmet):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, batch_body(helmet), format='json')
        MovementGroup.objects.update(
            created_at=timezone.now() - svc.DUPLICATE_EXIT_WINDOW - datetime.timedelta(seconds=1))

        assert client.post(BATCH_EXIT, batch_body(helmet), format='json').status_code == 201

    def test_just_inside_the_window_it_is_still_refused(self, real_exit_guards, central_warehouse, helmet):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, batch_body(helmet), format='json')
        MovementGroup.objects.update(created_at=timezone.now() - svc.DUPLICATE_EXIT_WINDOW + datetime.timedelta(seconds=3))

        assert client.post(BATCH_EXIT, batch_body(helmet), format='json').status_code == 409

    def test_an_rq_delivery_is_not_compared_with_free_exits(self, real_exit_guards, central_warehouse, helmet,
                                                             project, requester):
        from apps.warehouse.services.rq_fulfillment import deliver_request_items

        rq = make_request(number='RQ-2026-0901', requester=requester, project=project, status='IN_STOCK')
        item = make_item(rq, 1, quantity=5, inventory_item=helmet, confirmed=True)
        deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('1')}])

        free = client_for(central_warehouse).post(
            BATCH_EXIT, batch_body(helmet, destination=project.name, destination_type='PROJECT'), format='json')
        assert free.status_code == 201

    def test_the_service_default_does_not_apply_the_guard(self, real_exit_guards, central_warehouse, helmet):
        def exit_once(**extra):
            return svc.register_exit_batch(
                items_data=[{'inventory_id': helmet.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
                destination_type='EMPLOYEE', destination_detail='X', requested_by_id=None,
                authorized_by_id=None, notes='', registered_by=central_warehouse, **extra)

        exit_once()
        exit_once()                                                  # internal callers are not affected
        with pytest.raises(svc.DuplicateExitError):
            exit_once(reject_recent_duplicate=True)

    def test_the_delivery_message_also_explains_how_to_continue(self, central_warehouse, helmet, project, requester):
        rq = make_request(number='RQ-2026-0902', requester=requester, project=project, status='IN_STOCK')
        item = make_item(rq, 1, quantity=5, inventory_item=helmet, confirmed=True)
        client = client_for(central_warehouse)
        url = f'/api/v1/warehouse/pending-requests/{rq.pk}/deliver/'
        body = {'lines': [{'request_item_id': item.pk, 'quantity': '1'}]}
        client.post(url, body, format='json')

        again = client.post(url, body, format='json')

        assert again.status_code == 409 and again.json()['code'] == 'DUPLICATE_DELIVERY'
        assert 'espere unos segundos' in again.json()['detail']


# ═══════════════════════ el vale no puede imitar una guía ═══════════════════════

class TestVoucherCannotImitateAGuide:
    LOOKALIKES = ['GR-2026-000001', 'gr-2026-12', ' GR-1999-0 ', 'Gr-2030-123456789']
    FINE = ['GR-26-1', 'XGR-2026-1', 'GRU-2026-1', 'GR-2026-ABC', 'GR-2026', '3425', 'GR 2026 1']

    @pytest.mark.parametrize('voucher', LOOKALIKES)
    @pytest.mark.parametrize('url, body', [
        (BATCH_EXIT, batch_body), (EXIT, exit_body), (EPP, epp_body),
    ], ids=['batch-exit', 'exit', 'epp'])
    def test_it_is_a_readable_400_and_registers_nothing(self, central_warehouse, helmet, voucher, url, body):
        response = client_for(central_warehouse).post(url, body(helmet, voucher_number=voucher), format='json')

        assert response.status_code == 400
        text = str(response.json())
        assert 'guía interna' in text and 'GR-AAAA-NNNNNN' in text
        assert not MovementGroup.objects.exists() and stock_of(helmet) == Decimal('1000.000')

    def test_an_entry_cannot_either(self, central_warehouse, helmet):
        body = {'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', 'voucher_number': 'GR-2026-000001',
                'items': [{'inventory': helmet.pk, 'quantity': '5'}]}
        assert client_for(central_warehouse).post(BATCH_ENTRY, body, format='json').status_code == 400

    @pytest.mark.parametrize('voucher', FINE)
    def test_other_texts_are_accepted(self, central_warehouse, helmet, voucher):
        response = client_for(central_warehouse).post(BATCH_EXIT, batch_body(helmet, voucher_number=voucher),
                                                      format='json')
        assert response.status_code == 201, response.content
        assert response.json()['voucher_number'] == voucher.strip()


# ═══════════════ guide_number ya no es entrada; log de la guía ═══════════════

class TestGuideIsNotAnInput:
    def test_the_exit_serializers_do_not_announce_it(self):
        for serializer in (ExitCreateSerializer, BatchExitCreateSerializer):
            assert 'guide_number' not in serializer().fields
        for serializer in (EntryCreateSerializer, BatchEntryCreateSerializer):
            assert 'guide_number' in serializer().fields                # the supplier's guide stays

    def test_the_api_schema_does_not_offer_it_for_exits(self):
        from drf_spectacular.generators import SchemaGenerator

        schema = SchemaGenerator().get_schema(request=None, public=True)
        schemas = schema['components']['schemas']
        for name in ('BatchExitCreate', 'ExitCreate'):
            if name in schemas:
                assert 'guide_number' not in schemas[name]['properties'], name

    def test_a_client_that_still_sends_it_is_ignored(self, central_warehouse, helmet):
        response = client_for(central_warehouse).post(
            BATCH_EXIT, batch_body(helmet, guide_number='MANUAL-1'), format='json')
        assert response.status_code == 201 and response.json()['guide_number'].startswith('GR-')

    def test_the_assigned_guide_is_logged_without_personal_data(self, central_warehouse, helmet):
        with mock.patch.object(svc.logger, 'info') as info:
            group = svc.register_exit_batch(
                items_data=[{'inventory_id': helmet.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
                destination_type='EMPLOYEE', destination_detail='Nombre Secreto del Trabajador',
                requested_by_id=None, authorized_by_id=None, notes='nota privada', registered_by=central_warehouse)

        calls = [c for c in info.call_args_list if c.args and c.args[0] == 'warehouse.exit.guide_assigned']
        assert len(calls) == 1
        extra = calls[0].kwargs['extra']
        assert extra['guide_number'] == group.internal_guide_number and extra['group_id'] == group.pk
        assert 'Nombre Secreto' not in repr(calls[0]) and 'nota privada' not in repr(calls[0])


# ═══════════════════════ selector: search y truncated ═══════════════════════

def in_stock(requester, product, project, number):
    rq = make_request(number=number, requester=requester, project=project, status='IN_STOCK')
    make_item(rq, 1, quantity=5, inventory_item=product, confirmed=True)
    return rq


class TestDeliverableLimits:
    def test_search_is_cut_at_one_hundred_characters(self, central_warehouse, requester, helmet, project):
        from apps.core.models import Project
        from apps.warehouse.services.rq_deliverable import MAX_SEARCH_LENGTH

        assert MAX_SEARCH_LENGTH == 100
        long_project = Project.objects.create(code='PRY-LARGO', name='P' * 100 + 'Z' * 20, client='C', location='L')
        in_stock(requester, helmet, long_project, 'RQ-2026-0950')
        client = client_for(central_warehouse)

        # 100 characters of the name + 4 more that do not belong to it: matches only because it is cut.
        assert client.get(DELIVERABLE, {'search': 'P' * 100 + 'QQQQ'}).json()['count'] == 1
        assert client.get(DELIVERABLE, {'search': 'P' * 100 + 'Z'}).json()['count'] == 1
        assert client.get(DELIVERABLE, {'search': 'Q' * 100}).json()['count'] == 0

    def test_a_huge_search_is_harmless(self, central_warehouse, requester, helmet, project):
        in_stock(requester, helmet, project, 'RQ-2026-0951')
        response = client_for(central_warehouse).get(DELIVERABLE, {'search': 'x' * 5000})
        assert response.status_code == 200 and response.json()['count'] == 0

    def test_truncated_is_false_below_the_cap_and_true_beyond_it(
        self, central_warehouse, requester, helmet, project, monkeypatch,
    ):
        from apps.warehouse.services import rq_deliverable

        for n in range(3):
            in_stock(requester, helmet, project, f'RQ-2026-096{n}')
        client = client_for(central_warehouse)
        monkeypatch.setattr(rq_deliverable, 'MAX_CANDIDATES', 3)
        exact = client.get(DELIVERABLE).json()
        assert exact['truncated'] is False and exact['count'] == 3          # exactly at the cap: complete

        monkeypatch.setattr(rq_deliverable, 'MAX_CANDIDATES', 2)
        capped = client.get(DELIVERABLE).json()
        assert capped['truncated'] is True and capped['count'] == 2

    def test_truncated_is_present_even_for_an_empty_list(self, logistics_chief_user):
        body = client_for(logistics_chief_user).get(DELIVERABLE).json()
        assert body['results'] == [] and body['truncated'] is False


@pytest.fixture
def logistics_chief_user(db):
    return make_user('logistics_chief', RoleChoices.LOGISTICS_CHIEF)
