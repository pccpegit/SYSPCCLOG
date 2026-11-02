"""
SYSPCC-041 · N° de guía automático de las salidas del almacén (GR-AAAA-NNNNNN).

Cubre el servicio (`services/guides.py`), su integración con `register_exit_batch` y con TODOS los
caminos de salida (batch-exit, exit, EPP, ajuste por la pantalla Salida, entrega de RQ, despacho
automático del motor), la regla de lo que NO recibe guía (ingresos, reversas, historial importado,
`register_adjustment`), las restricciones de base de datos y el Master. La concurrencia real vive en
`test_guide_concurrency.py` (solo PostgreSQL).
"""
import datetime
import re
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.rq.services.workflow_engine import WorkflowEngine
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
from apps.warehouse.models import (
    GuideSequence,
    InventoryMovement,
    InventoryStock,
    MovementGroup,
    WarehouseDispatch,
)
from apps.warehouse.services import guides
from apps.warehouse.services import movements as svc
from apps.warehouse.services.rq_fulfillment import deliver_request_items, reverse_delivery

GUIDE_RE = re.compile(r'^GR-\d{4}-\d{6}$')
THIS_YEAR = timezone.localdate().year
BATCH_EXIT = '/api/v1/warehouse/movements/batch-exit/'
EXIT = '/api/v1/warehouse/movements/exit/'
EPP = '/api/v1/warehouse/movements/epp-delivery/'
DELIVER = '/api/v1/warehouse/pending-requests/{}/deliver/'


def guide(n, year=THIS_YEAR):
    return f'GR-{year}-{n:06d}'


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload') as enqueue:
        yield enqueue


@pytest.fixture
def helmet(db):
    product = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND', location='B3-2')
    make_stock(product, 100)
    return product


def exit_group(user, product, qty=1, **extra):
    kwargs = dict(
        items_data=[{'inventory_id': product.pk, 'quantity': qty}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona de Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user,
    )
    kwargs.update(extra)
    return svc.register_exit_batch(**kwargs)


def exit_body(product, **over):
    body = {
        'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona de Prueba',
        'items': [{'inventory': product.pk, 'quantity': '1'}],
    }
    body.update(over)
    return body


pytestmark = pytest.mark.django_db


# ══════════════════════════════ el servicio ══════════════════════════════

class TestFormatAndSequence:
    def test_format_pads_to_six_digits_and_grows_past_a_million(self):
        assert guides.format_guide_number(2026, 1) == 'GR-2026-000001'
        assert guides.format_guide_number(2026, 123456) == 'GR-2026-123456'
        assert guides.format_guide_number(2026, 1234567) == 'GR-2026-1234567'

    def test_the_numbers_are_consecutive(self):
        with transaction.atomic():
            issued = [guides.next_guide_number() for _ in range(3)]
        assert issued == [guide(1), guide(2), guide(3)]
        assert GuideSequence.objects.get(year=THIS_YEAR).last_value == 3

    def test_the_first_call_of_the_year_creates_the_counter_row(self):
        assert not GuideSequence.objects.exists()
        with transaction.atomic():
            guides.next_guide_number()
        assert list(GuideSequence.objects.values_list('year', 'last_value')) == [(THIS_YEAR, 1)]

    def test_an_existing_row_is_not_reset_by_the_create_step(self):
        GuideSequence.objects.create(year=THIS_YEAR, last_value=41)
        with transaction.atomic():
            assert guides.next_guide_number() == guide(42)

    def test_the_counter_restarts_every_year(self):
        with transaction.atomic():
            assert guides.next_guide_number(datetime.date(2026, 12, 31)) == 'GR-2026-000001'
            assert guides.next_guide_number(datetime.date(2026, 12, 31)) == 'GR-2026-000002'
            assert guides.next_guide_number(datetime.date(2027, 1, 1)) == 'GR-2027-000001'
            assert guides.next_guide_number(datetime.date(2026, 12, 31)) == 'GR-2026-000003'
        assert dict(GuideSequence.objects.values_list('year', 'last_value')) == {2026: 3, 2027: 1}

    def test_the_year_is_the_Lima_year_not_the_UTC_one(self):
        # 2027-01-01 03:00 UTC is still 2026-12-31 22:00 in Lima (UTC-5).
        new_year_utc = datetime.datetime(2027, 1, 1, 3, 0, tzinfo=ZoneInfo('UTC'))
        with mock.patch('django.utils.timezone.now', return_value=new_year_utc), transaction.atomic():
            assert guides.next_guide_number() == 'GR-2026-000001'
        later = datetime.datetime(2027, 1, 1, 5, 30, tzinfo=ZoneInfo('UTC'))     # 00:30 in Lima
        with mock.patch('django.utils.timezone.now', return_value=later), transaction.atomic():
            assert guides.next_guide_number() == 'GR-2027-000001'

    def test_a_year_in_the_past_does_not_use_the_registration_date_of_the_vale(self, central_warehouse, helmet):
        # An exit loaded with a retroactive operational date is numbered when it is issued.
        group = exit_group(central_warehouse, helmet, movement_date=datetime.date(2020, 3, 1))
        assert group.internal_guide_number == guide(1)

    @pytest.mark.django_db(transaction=True)
    def test_it_refuses_to_run_outside_a_transaction(self):
        with pytest.raises(RuntimeError, match='atomic'):
            guides.next_guide_number()
        assert not GuideSequence.objects.exists()


# ═══════════════════ integración con register_exit_batch ═══════════════════

class TestRegisterExitBatch:
    def test_every_exit_gets_the_next_number_and_the_mirrors(self, central_warehouse, helmet):
        first = exit_group(central_warehouse, helmet)
        second = exit_group(central_warehouse, helmet, qty=2)

        assert (first.internal_guide_number, second.internal_guide_number) == (guide(1), guide(2))
        for group, number in ((first, guide(1)), (second, guide(2))):
            group.refresh_from_db()
            assert group.guide_number == number                       # mirror for the existing readers
            assert set(group.movements.values_list('guide_number', flat=True)) == {number}

    def test_one_guide_per_vale_not_per_line(self, central_warehouse, helmet):
        other = make_inventory('EPP-0002', 'Guantes', 'PAR')
        make_stock(other, 10)
        group = svc.register_exit_batch(
            items_data=[
                {'inventory_id': helmet.pk, 'quantity': 1, 'line': 1},
                {'inventory_id': other.pk, 'quantity': 1, 'line': 2},
            ],
            warehouse='CENTRAL', project_id=None, destination_type='EMPLOYEE', destination_detail='X',
            requested_by_id=None, authorized_by_id=None, notes='', registered_by=central_warehouse,
        )
        assert group.movements.count() == 2
        assert GuideSequence.objects.get().last_value == 1

    def test_a_guide_passed_by_the_caller_is_ignored(self, central_warehouse, helmet):
        group = exit_group(central_warehouse, helmet, guide_number='MANUAL-1')
        assert group.internal_guide_number == guide(1) and group.guide_number == guide(1)
        assert set(group.movements.values_list('guide_number', flat=True)) == {guide(1)}

    def test_insufficient_stock_does_not_burn_a_number(self, central_warehouse, helmet):
        exit_group(central_warehouse, helmet)
        with pytest.raises(ValueError, match='Stock insuficiente'):
            exit_group(central_warehouse, helmet, qty=1000)

        assert exit_group(central_warehouse, helmet).internal_guide_number == guide(2)
        assert GuideSequence.objects.get().last_value == 2

    def test_a_failure_after_the_number_was_taken_rolls_the_counter_back(self, central_warehouse, helmet):
        exit_group(central_warehouse, helmet)
        with mock.patch.object(InventoryMovement.objects, 'create', side_effect=RuntimeError('boom')):
            with pytest.raises(RuntimeError):
                exit_group(central_warehouse, helmet)

        assert GuideSequence.objects.get().last_value == 1             # the taken number went back
        assert MovementGroup.objects.count() == 1
        assert InventoryStock.objects.get(inventory=helmet).quantity == Decimal('99.000')
        assert exit_group(central_warehouse, helmet).internal_guide_number == guide(2)

    def test_the_guide_belongs_to_the_exit_only(self, central_warehouse, helmet):
        entry = svc.register_entry_batch(
            items_data=[{'inventory_id': helmet.pk, 'quantity': 5}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='Proveedor Prueba', invoice_number='F-1', notes='',
            registered_by=central_warehouse, guide_number='GR-DEL-PROVEEDOR',
        )
        assert entry.internal_guide_number is None
        assert entry.guide_number == 'GR-DEL-PROVEEDOR'                 # the supplier's guide is untouched
        assert not GuideSequence.objects.exists()

    def test_register_adjustment_has_no_vale_and_no_guide(self, central_warehouse, helmet):
        movement = svc.register_adjustment(helmet, Decimal('-1'), 'CENTRAL', None, 'conteo', central_warehouse)
        assert movement.group_id is None
        assert not GuideSequence.objects.exists()


# ═════════════════ restricciones de base de datos ═════════════════

class TestDatabaseConstraints:
    def _group(self, user, number, **extra):
        data = dict(group_number=f'SAL-X-{number}', movement_type='EXIT', warehouse='CENTRAL',
                    registered_by=user, internal_guide_number=number)
        data.update(extra)
        return MovementGroup.objects.create(**data)

    def test_a_guide_number_cannot_repeat(self, central_warehouse):
        self._group(central_warehouse, 'GR-2026-000001')
        with pytest.raises(IntegrityError), transaction.atomic():
            self._group(central_warehouse, 'GR-2026-000001', group_number='SAL-X-OTRO')

    def test_many_vales_without_a_guide_do_not_collide(self, central_warehouse):
        for n in range(3):
            self._group(central_warehouse, None, group_number=f'SAL-HIST-{n}')
        assert MovementGroup.objects.filter(internal_guide_number__isnull=True).count() == 3

    def test_an_entry_cannot_carry_a_guide(self, central_warehouse):
        with pytest.raises(IntegrityError), transaction.atomic():
            self._group(central_warehouse, 'GR-2026-000009', movement_type='ENTRY')

    def test_the_counter_cannot_go_negative(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            GuideSequence.objects.create(year=2030, last_value=-1)


# ═══════════════════ todos los caminos de salida ═══════════════════

class TestEveryExitPathGetsAGuide:
    def test_batch_exit(self, central_warehouse, helmet):
        response = client_for(central_warehouse).post(BATCH_EXIT, exit_body(helmet), format='json')
        assert response.status_code == 201, response.content
        assert response.json()['internal_guide_number'] == guide(1)
        assert response.json()['guide_number'] == guide(1)

    def test_batch_exit_ignores_a_guide_sent_by_the_client(self, central_warehouse, helmet):
        response = client_for(central_warehouse).post(
            BATCH_EXIT, exit_body(helmet, guide_number='MANUAL-7'), format='json')
        assert response.status_code == 201
        group = MovementGroup.objects.get()
        assert group.guide_number == guide(1) and group.internal_guide_number == guide(1)

    def test_single_exit(self, central_warehouse, helmet):
        body = {'inventory': helmet.pk, 'quantity': '1', 'warehouse': 'CENTRAL',
                'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona de Prueba',
                'guide_number': 'MANUAL-8'}
        response = client_for(central_warehouse).post(EXIT, body, format='json')
        assert response.status_code == 201, response.content
        assert response.json()['internal_guide_number'] == guide(1)
        assert response.json()['guide_number'] == guide(1)

    def test_epp_delivery_without_a_physical_vale(self, central_warehouse, helmet):
        body = {'warehouse': 'CENTRAL', 'movement_date': timezone.localdate().isoformat(),
                'recipient': {'name': 'Trabajador Libre Test'},
                'items': [{'inventory': helmet.pk, 'quantity': '1'}]}
        response = client_for(central_warehouse).post(EPP, body, format='json')
        assert response.status_code == 201, response.content
        assert response.json()['internal_guide_number'] == guide(1)
        assert response.json()['voucher_number'] == ''

    def test_adjustment_registered_from_the_salida_screen(self, central_warehouse, helmet):
        response = client_for(central_warehouse).post(
            BATCH_EXIT, exit_body(helmet, destination_type='ADJUSTMENT', destination_detail='Conteo físico'),
            format='json')
        assert response.status_code == 201, response.content
        assert MovementGroup.objects.get().internal_guide_number == guide(1)

    def test_the_movement_voucher_endpoint_and_the_list_carry_the_guide(self, central_warehouse, helmet):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, exit_body(helmet), format='json')
        movement = InventoryMovement.objects.get()

        voucher = client.get(f'/api/v1/warehouse/movements/{movement.pk}/voucher/').json()
        listing = client.get('/api/v1/warehouse/movements/').json()['results'][0]
        group_voucher = client.get(f'/api/v1/warehouse/movements/groups/{movement.group_id}/voucher/').json()

        assert voucher['internal_guide_number'] == guide(1)
        assert listing['internal_guide_number'] == guide(1)
        assert group_voucher['internal_guide_number'] == guide(1)
        assert group_voucher['movements'][0]['internal_guide_number'] == guide(1)

    def test_all_paths_share_one_counter(self, central_warehouse, helmet):
        client = client_for(central_warehouse)
        client.post(BATCH_EXIT, exit_body(helmet), format='json')
        exit_group(central_warehouse, helmet)
        client.post(BATCH_EXIT, exit_body(helmet, destination_type='ADJUSTMENT'), format='json')

        numbers = list(MovementGroup.objects.order_by('pk').values_list('internal_guide_number', flat=True))
        assert numbers == [guide(1), guide(2), guide(3)]


@pytest.fixture
def ops_in_stock(ops_rq, helmet):
    ops_rq.status = 'IN_STOCK'
    ops_rq.save(update_fields=['status'])
    item = make_item(ops_rq, 1, quantity=10, inventory_item=helmet, confirmed=True)
    return ops_rq, item


class TestRequestDeliveriesAndTheEngine:
    def test_a_delivery_gets_the_guide_and_copies_it_to_the_dispatch(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        result = deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('3')}])

        assert result.group.internal_guide_number == guide(1)
        assert result.dispatch.dispatch_guide_number == guide(1)
        assert result.group.guide_number == guide(1)

    def test_a_rejected_delivery_does_not_consume_a_number(self, ops_in_stock, central_warehouse):
        from apps.warehouse.services.rq_fulfillment import DeliveryError

        rq, item = ops_in_stock
        with pytest.raises(DeliveryError) as exc:
            deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('99')}])
        assert exc.value.code == 'DELIVERY_LINES_INVALID'
        assert not GuideSequence.objects.exists() and not MovementGroup.objects.exists()

        result = deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('1')}])
        assert result.group.internal_guide_number == guide(1)

    def test_the_automatic_engine_dispatch_gets_a_guide_too(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        WorkflowEngine(rq, central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')

        dispatch = WarehouseDispatch.objects.get()
        assert dispatch.dispatch_guide_number == guide(1)
        assert dispatch.movement_group.internal_guide_number == guide(1)

    def test_the_reversal_quotes_the_original_guide_and_takes_no_new_number(self, ops_in_stock, central_warehouse):
        rq, item = ops_in_stock
        delivered = deliver_request_items(rq.pk, central_warehouse, [{'request_item_id': item.pk, 'quantity': Decimal('4')}])

        reversal = reverse_delivery(rq.pk, delivered.dispatch.pk, central_warehouse, reason='Cantidad mal digitada')

        assert reversal.dispatch_guide_number == guide(1)
        assert reversal.movement_group.movement_type == 'ENTRY'
        assert reversal.movement_group.internal_guide_number is None
        assert GuideSequence.objects.get().last_value == 1

    def test_the_master_shows_the_guide_status_and_progress_after_a_delivery(
        self, ops_in_stock, central_warehouse, logistics_coordinator_user,
    ):
        rq, item = ops_in_stock
        client = client_for(central_warehouse)
        response = client.post(DELIVER.format(rq.pk), {'lines': [{'request_item_id': item.pk, 'quantity': '4'}]},
                               format='json')
        assert response.status_code == 201, response.content
        delivered_guide = response.json()['delivery']['dispatch_guide_number']
        assert delivered_guide == guide(1)

        master = client_for(logistics_coordinator_user).get('/api/v1/request-master/').json()['results']
        row = next(r for r in master if r['rq_number'] == rq.rq_number)
        assert row['status'] == 'PARCIAL'
        assert Decimal(row['quantity_attended']) == Decimal('4')
        assert row['guides'] == [guide(1)] and row['guide_text'] == guide(1)
        assert row['rq_progress']['percent'] == 40.0

        # The whole remainder: ATENDIDO, and the second guide is listed too.
        client.post(DELIVER.format(rq.pk), {'lines': [{'request_item_id': item.pk, 'quantity': '6'}]}, format='json')
        row = next(r for r in client_for(logistics_coordinator_user).get('/api/v1/request-master/').json()['results']
                   if r['rq_number'] == rq.rq_number)
        assert row['status'] == 'ATENDIDO' and row['rq_progress']['percent'] == 100.0
        assert row['guides'] == [guide(1), guide(2)]

    def test_the_master_search_finds_the_rq_by_its_guide_and_the_engine_dispatch_shows_it(
        self, ops_in_stock, central_warehouse, logistics_coordinator_user,
    ):
        rq, _ = ops_in_stock
        WorkflowEngine(rq, central_warehouse, RoleChoices.CENTRAL_WAREHOUSE).execute('DISPATCHED')

        found = client_for(logistics_coordinator_user).get('/api/v1/request-master/', {'search': guide(1)})
        assert [r['rq_number'] for r in found.json()['results']] == [rq.rq_number]
        assert found.json()['results'][0]['guides'] == [guide(1)]
        none = client_for(logistics_coordinator_user).get('/api/v1/request-master/', {'search': guide(99)})
        assert none.json()['results'] == []


@pytest.fixture
def logistics_coordinator_user(db, project):
    return make_user('logistics_coordinator', RoleChoices.LOGISTICS_COORDINATOR, project=project)
