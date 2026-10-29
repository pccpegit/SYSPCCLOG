"""SYSPCC-025 — campos de documento en ingresos/egresos, fecha operativa y N° de vale."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.warehouse.models import InventoryMovement, InventoryStock, MovementGroup
from apps.warehouse.services import movements as svc
from .conftest import client_for

MOV = '/api/v1/warehouse/movements/'


def _entry(item, qty, user, **kw):
    return svc.register_entry_batch(
        items_data=kw.pop('items_data', [{'inventory_id': item.pk, 'quantity': qty}]),
        warehouse='CENTRAL', project_id=None, source_type=kw.pop('source_type', 'PURCHASE'),
        supplier_name='', invoice_number='', notes='', registered_by=user, **kw,
    )


def _exit(item, qty, user, **kw):
    return svc.register_exit_batch(
        items_data=kw.pop('items_data', [{'inventory_id': item.pk, 'quantity': qty}]),
        warehouse=kw.pop('warehouse', 'CENTRAL'), project_id=None,
        destination_type=kw.pop('destination_type', 'EMPLOYEE'),
        destination_detail=kw.pop('destination_detail', 'Destino de prueba'),
        requested_by_id=None, authorized_by_id=None, notes='', registered_by=user, **kw,
    )


@pytest.mark.django_db
class TestServiceDocumentFields:
    def test_default_date_is_today_in_lima(self, epp_item, central_warehouse):
        group = _entry(epp_item, 2, central_warehouse)
        assert group.movement_date == timezone.localdate()
        assert group.movements.get().movement_date == timezone.localdate()

    def test_explicit_date_and_header_fields_reach_group_and_lines(self, epp_item, central_warehouse):
        group = _entry(
            epp_item, 2, central_warehouse, movement_date=date(2026, 10, 5),
            voucher_number='V-1', po_number='PO-9', guide_number='T001-55',
            internal_transfer='CAMBIO',
            items_data=[{'inventory_id': epp_item.pk, 'quantity': 2, 'tag': 'TAG-1', 'notes': 'sin daños'}],
        )
        mv = group.movements.get()
        assert group.movement_date == mv.movement_date == date(2026, 10, 5)
        assert (mv.voucher_number, mv.po_number, mv.guide_number, mv.internal_transfer) == (
            'V-1', 'PO-9', 'T001-55', 'CAMBIO')
        assert (mv.tag, mv.notes) == ('TAG-1', 'sin daños')
        assert group.po_number == 'PO-9'

    def test_undated_stores_null_instead_of_today(self, epp_item, central_warehouse):
        group = _entry(epp_item, 2, central_warehouse, undated=True)
        assert group.movement_date is None
        assert group.movements.get().movement_date is None

    def test_existing_callers_without_new_kwargs_keep_working(self, epp_item, central_warehouse):
        group = _exit(epp_item, 1, central_warehouse)
        assert group.voucher_number == '' and group.destination_personal_id is None

    def test_source_key_is_unique(self, epp_item, central_warehouse):
        _entry(epp_item, 1, central_warehouse,
               items_data=[{'inventory_id': epp_item.pk, 'quantity': 1, 'source_key': 'k' * 64}])
        with pytest.raises(IntegrityError), transaction.atomic():
            _entry(epp_item, 1, central_warehouse,
                   items_data=[{'inventory_id': epp_item.pk, 'quantity': 1, 'source_key': 'k' * 64}])

    def test_empty_source_key_is_stored_as_null_so_many_rows_can_coexist(self, epp_item, central_warehouse):
        for _ in range(3):
            _entry(epp_item, 1, central_warehouse)
        assert InventoryMovement.objects.filter(source_key__isnull=True).count() == 3

    def test_exit_checks_repeated_item_lines_as_a_sum(self, make_item, central_warehouse):
        item = make_item('EPP7', 'Lente', stock=5)
        with pytest.raises(ValueError, match='Stock insuficiente'):
            _exit(item, 0, central_warehouse, items_data=[
                {'inventory_id': item.pk, 'quantity': 3}, {'inventory_id': item.pk, 'quantity': 3},
            ])
        assert MovementGroup.objects.count() == 0
        assert InventoryStock.objects.get(inventory=item).quantity == Decimal('5')

    def test_exit_with_repeated_lines_within_stock_decrements_the_total(self, make_item, central_warehouse):
        item = make_item('EPP7', 'Lente', stock=6)
        _exit(item, 0, central_warehouse, items_data=[
            {'inventory_id': item.pk, 'quantity': 3}, {'inventory_id': item.pk, 'quantity': 3},
        ])
        assert InventoryStock.objects.get(inventory=item).quantity == Decimal('0')

    def test_failed_second_line_leaves_nothing_behind(self, make_item, central_warehouse):
        ok, short = make_item('EPP1', 'a', stock=5), make_item('EPP2', 'b', stock=1)
        with pytest.raises(ValueError):
            _exit(ok, 0, central_warehouse, items_data=[
                {'inventory_id': ok.pk, 'quantity': 2}, {'inventory_id': short.pk, 'quantity': 2},
            ])
        assert MovementGroup.objects.count() == 0 and InventoryMovement.objects.count() == 0
        assert InventoryStock.objects.get(inventory=ok).quantity == Decimal('5')

    def test_find_duplicate_voucher_is_scoped_by_warehouse_and_exit(self, epp_item, central_warehouse):
        _exit(epp_item, 1, central_warehouse, voucher_number='3425')
        assert svc.find_duplicate_voucher('CENTRAL', '3425') is True
        assert svc.find_duplicate_voucher('SITE', '3425') is False
        assert svc.find_duplicate_voucher('CENTRAL', '') is False
        _entry(epp_item, 1, central_warehouse, voucher_number='777')
        assert svc.find_duplicate_voucher('CENTRAL', '777') is False  # entradas no cuentan

    def test_adjustment_gets_operational_date(self, epp_item, central_warehouse):
        mv = svc.register_adjustment(epp_item, Decimal('-1'), 'CENTRAL', None, 'merma', central_warehouse)
        assert mv.movement_date == timezone.localdate()


@pytest.mark.django_db
class TestApiDocumentFields:
    def test_batch_entry_accepts_new_fields(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(MOV + 'batch-entry/', {
            'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', 'movement_date': '2026-10-05',
            'po_number': 'PO-1', 'guide_number': 'T001-9', 'internal_transfer': '',
            'items': [{'inventory': epp_item.pk, 'quantity': '2', 'tag': 'T-1', 'notes': 'ok'}],
        }, format='json')
        assert resp.status_code == 201, resp.data
        assert resp.data['movement_date'] == '2026-10-05'
        line = resp.data['movements'][0]
        assert (line['tag'], line['notes'], line['po_number'], line['guide_number']) == ('T-1', 'ok', 'PO-1', 'T001-9')

    def test_without_new_fields_behaves_as_before(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(MOV + 'batch-entry/', {
            'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'items': [{'inventory': epp_item.pk, 'quantity': '1'}],
        }, format='json')
        assert resp.status_code == 201
        assert resp.data['movement_date'] == timezone.localdate().isoformat()

    def test_future_date_is_rejected(self, epp_item, central_warehouse):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        for path, body in (
            ('batch-entry/', {'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
                              'items': [{'inventory': epp_item.pk, 'quantity': '1'}]}),
            ('batch-exit/', {'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE',
                             'destination_detail': 'x',
                             'items': [{'inventory': epp_item.pk, 'quantity': '1'}]}),
        ):
            resp = client_for(central_warehouse).post(MOV + path, {**body, 'movement_date': tomorrow}, format='json')
            assert resp.status_code == 400, path
            assert 'futura' in str(resp.data)
        assert MovementGroup.objects.count() == 0

    def test_single_entry_and_exit_accept_document_fields(self, epp_item, central_warehouse):
        client = client_for(central_warehouse)
        r1 = client.post(MOV + 'entry/', {
            'inventory': epp_item.pk, 'quantity': '1', 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'movement_date': '2026-10-06', 'tag': 'T9', 'guide_number': 'G-1',
        }, format='json')
        assert r1.status_code == 201, r1.data
        assert (r1.data['movement_date'], r1.data['tag'], r1.data['guide_number']) == ('2026-10-06', 'T9', 'G-1')
        r2 = client.post(MOV + 'exit/', {
            'inventory': epp_item.pk, 'quantity': '1', 'warehouse': 'CENTRAL',
            'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona X',
            'voucher_number': '55', 'movement_date': '2026-10-07',
        }, format='json')
        assert r2.status_code == 201, r2.data
        assert (r2.data['voucher_number'], r2.data['movement_date']) == ('55', '2026-10-07')

    def test_duplicate_voucher_returns_409_and_can_be_overridden(self, epp_item, central_warehouse):
        client = client_for(central_warehouse)
        body = {
            'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona X',
            'voucher_number': '3425', 'items': [{'inventory': epp_item.pk, 'quantity': '1'}],
        }
        assert client.post(MOV + 'batch-exit/', body, format='json').status_code == 201
        dup = client.post(MOV + 'batch-exit/', body, format='json')
        assert dup.status_code == 409
        assert dup.data['code'] == 'voucher_number_exists'
        assert MovementGroup.objects.filter(movement_type='EXIT').count() == 1  # nothing created
        forced = client.post(MOV + 'batch-exit/', {**body, 'allow_duplicate_voucher': True}, format='json')
        assert forced.status_code == 201
        assert MovementGroup.objects.filter(voucher_number='3425').count() == 2  # N° de vale no es unique

    def test_blank_voucher_is_never_a_duplicate(self, epp_item, central_warehouse):
        client = client_for(central_warehouse)
        body = {'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'P',
                'items': [{'inventory': epp_item.pk, 'quantity': '1'}]}
        assert client.post(MOV + 'batch-exit/', body, format='json').status_code == 201
        assert client.post(MOV + 'batch-exit/', body, format='json').status_code == 201

    def test_integer_unit_rejects_fractional_quantity_but_decimal_units_accept(self, make_item, central_warehouse):
        ea = make_item('EPP1', 'Casco', 'EA', stock=10)
        m2 = make_item('TMT1', 'Tela', 'M2', stock=10)
        client = client_for(central_warehouse)
        bad = client.post(MOV + 'batch-entry/', {
            'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'items': [{'inventory': ea.pk, 'quantity': '1.5'}],
        }, format='json')
        assert bad.status_code == 400 and 'entero' in str(bad.data)
        ok = client.post(MOV + 'batch-entry/', {
            'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'items': [{'inventory': m2.pk, 'quantity': '1.5'}],
        }, format='json')
        assert ok.status_code == 201

    def test_insufficient_stock_still_400(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(MOV + 'batch-exit/', {
            'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE', 'destination_detail': 'P',
            'items': [{'inventory': epp_item.pk, 'quantity': '11'}],
        }, format='json')
        assert resp.status_code == 400
        assert 'Stock insuficiente' in resp.data['detail']


@pytest.mark.django_db
class TestMovementFilters:
    @pytest.fixture(autouse=True)
    def _movements(self, epp_item, central_warehouse, make_personal):
        self.person = make_personal('Mamani Cruz, Julia Test')
        _entry(epp_item, 5, central_warehouse, movement_date=date(2026, 10, 1))
        _entry(epp_item, 5, central_warehouse, undated=True)
        self.linked = _exit(epp_item, 1, central_warehouse, movement_date=date(2026, 10, 10),
                            voucher_number='A-1', destination_detail='Mamani Cruz, Julia Test',
                            destination_personal_id=self.person.pk)
        self.unlinked = _exit(epp_item, 1, central_warehouse, movement_date=date(2026, 10, 12),
                              destination_detail='Persona Suelta Test')
        self.user = central_warehouse

    def _results(self, **params):
        resp = client_for(self.user).get(MOV, params)
        assert resp.status_code == 200, resp.data
        return resp.data['results']

    def test_date_filters_use_movement_date_not_created_at(self):
        # every row was CREATED today, but their operational dates differ
        assert len(self._results(date_from='2026-10-10', date_to='2026-10-11')) == 1
        assert len(self._results(date_to='2026-10-05')) == 1
        assert len(self._results(date_from='2026-10-01')) == 3  # undated row excluded

    @pytest.mark.parametrize('params', [
        {'date_from': 'ayer'}, {'date_to': '2026-13-45'},
        {'date_from': '2026-10-12', 'date_to': '2026-10-01'},
    ])
    def test_invalid_dates_are_400_not_500(self, params):
        assert client_for(self.user).get(MOV, params).status_code == 400

    def test_voucher_and_no_voucher_filters(self):
        assert [r['voucher_number'] for r in self._results(voucher_number='a-1')] == ['A-1']
        assert len(self._results(no_voucher='true')) == 1   # solo salidas sin vale

    def test_has_date_filter(self):
        assert len(self._results(has_date='false')) == 1
        assert len(self._results(has_date='true')) == 3

    def test_destination_filters(self):
        assert len(self._results(destination_personal=self.person.pk)) == 1
        rows = self._results(unlinked_destination='true')
        assert [r['destination_detail'] for r in rows] == ['Persona Suelta Test']
        assert rows[0]['destination_key']          # clave para vincular
        assert len(self._results(destination='suelta')) == 1

    def test_serializer_exposes_linked_name_and_empty_key_for_linked(self):
        row = self._results(destination_personal=self.person.pk)[0]
        assert row['destination_personal_name'] == 'Mamani Cruz, Julia Test'
        assert row['destination_key'] == ''

    def test_invalid_import_batch_filter_is_400(self):
        assert client_for(self.user).get(MOV, {'import_batch': 'no-es-uuid'}).status_code == 400

    def test_voucher_endpoint_includes_new_keys(self):
        mv = InventoryMovement.objects.get(group=self.linked)
        data = client_for(self.user).get(f'{MOV}{mv.pk}/voucher/').data
        assert data['voucher_number'] == 'A-1' and data['movement_date'] == '2026-10-10'


@pytest.mark.django_db
class TestItemKardexEndpoint:
    @pytest.fixture(autouse=True)
    def _setup(self, make_item, central_warehouse):
        self.item = make_item('EPP9', 'Mameluco', 'EA')
        self.user = central_warehouse
        _entry(self.item, 10, central_warehouse, movement_date=date(2026, 10, 1), source_type='INITIAL_LOAD')
        _exit(self.item, 3, central_warehouse, movement_date=date(2026, 10, 3))
        _entry(self.item, 4, central_warehouse, movement_date=date(2026, 10, 5))
        _entry(self.item, 2, central_warehouse, undated=True)
        _exit(self.item, 1, central_warehouse, movement_date=date(2026, 10, 7))

    def _get(self, **params):
        resp = client_for(self.user).get(f'/api/v1/warehouse/inventory/{self.item.pk}/kardex/', params)
        assert resp.status_code == 200, resp.data
        return resp.data

    def test_running_balance_is_chronological_with_undated_last(self):
        data = self._get()
        assert 'item' in data and data['opening_stock'] == 0
        assert [m['balance_after'] for m in data['movements']] == [10, 7, 11, 10, 12]
        assert data['movements'][-1]['movement_date'] is None
        assert data['closing_stock'] == 12
        assert [m['delta'] for m in data['movements']] == [10, -3, 4, -1, 2]

    def test_date_from_gives_opening_stock_and_leaves_out_undated(self):
        data = self._get(date_from='2026-10-04')
        assert data['opening_stock'] == 7          # 10 - 3 antes del 04/10
        assert [m['balance_after'] for m in data['movements']] == [11, 10]

    def test_movement_type_filter_only_changes_what_is_shown(self):
        data = self._get(movement_type='EXIT')
        assert [m['balance_after'] for m in data['movements']] == [7, 10]   # saldo real, no filtrado

    def test_invalid_date_is_400(self):
        resp = client_for(self.user).get(
            f'/api/v1/warehouse/inventory/{self.item.pk}/kardex/', {'date_from': 'x'})
        assert resp.status_code == 400
