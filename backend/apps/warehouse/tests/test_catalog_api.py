"""SYSPCC-025 — catálogo: campos EPP, filtros, ubicación validada, asignación masiva, layout."""
import pytest

from apps.core.enums import ItemTypeChoices
from apps.warehouse.models import Inventory
from .conftest import client_for

BASE = '/api/v1/warehouse/inventory/'


@pytest.mark.django_db
class TestCatalogFields:
    def test_create_with_epp_fields_derives_size_and_floor(self, central_warehouse, project):
        client = client_for(central_warehouse)
        resp = client.post(BASE, {
            'product_code': 'EPP000900', 'description': 'GUANTE ANTICORTE T: XL', 'unit': 'EA',
            'category': 'EPP', 'item_type': 'EPP', 'location': 'f3-2',
            'order_number': 'ORD-1', 'purchase_order_ref': '1.02', 'packing_list': '24003-13',
            'observation': 'sin novedad', 'project': project.pk,
        }, format='json')
        assert resp.status_code == 201, resp.data
        item = Inventory.objects.get(product_code='EPP000900')
        assert item.location == 'F3-2'          # normalizado
        assert item.floor == 2                   # derivado del pabellón
        assert item.size == 'XL'                 # derivado de la descripción
        assert item.item_type == ItemTypeChoices.EPP
        assert item.project_id == project.pk
        assert (item.order_number, item.purchase_order_ref, item.packing_list) == ('ORD-1', '1.02', '24003-13')

    def test_list_exposes_new_fields(self, central_warehouse, make_item, project):
        make_item('EPP1', 'BOTA T: 42', size='42', floor=2, project=project, packing_list='P-1')
        resp = client_for(central_warehouse).get(BASE)
        row = resp.data['results'][0]
        for key in ('order_number', 'purchase_order_ref', 'packing_list', 'size', 'floor',
                    'location_status', 'location_display', 'observation',
                    'project_id', 'project_code', 'project_name'):
            assert key in row, key
        assert row['location_status'] == 'FLOOR_ONLY'
        assert row['location_display'] == 'PISO 2'
        assert row['project_code'] == project.code

    @pytest.mark.parametrize('bad', ['F9-7', 'Z1-1', 'A3-6', 'PISO 2'])
    def test_invalid_location_is_rejected_on_create(self, central_warehouse, bad):
        resp = client_for(central_warehouse).post(BASE, {
            'product_code': 'X1', 'description': 'x', 'unit': 'EA', 'location': bad,
        }, format='json')
        assert resp.status_code == 400
        assert 'location' in str(resp.data)

    def test_floor_must_match_pavilion(self, central_warehouse):
        resp = client_for(central_warehouse).post(BASE, {
            'product_code': 'X1', 'description': 'x', 'unit': 'EA', 'location': 'F3-2', 'floor': 1,
        }, format='json')
        assert resp.status_code == 400
        assert 'floor' in str(resp.data)

    def test_legacy_location_does_not_block_patch_of_other_fields(self, central_warehouse, make_item):
        item = make_item('LEG1', 'Item legado', location='Estante A-3, Rack B')
        client = client_for(central_warehouse)
        resp = client.patch(f'{BASE}{item.pk}/', {'description': 'Item legado editado'}, format='json')
        assert resp.status_code == 200, resp.data
        item.refresh_from_db()
        assert item.location == 'Estante A-3, Rack B'
        # but CHANGING it to another non-conforming value is rejected
        resp = client.patch(f'{BASE}{item.pk}/', {'location': 'Rack Z'}, format='json')
        assert resp.status_code == 400
        # and a valid one is accepted (floor follows)
        resp = client.patch(f'{BASE}{item.pk}/', {'location': 'B3-2'}, format='json')
        assert resp.status_code == 200
        item.refresh_from_db()
        assert (item.location, item.floor) == ('B3-2', 1)


@pytest.mark.django_db
class TestCatalogFilters:
    @pytest.fixture(autouse=True)
    def _items(self, make_item, project):
        make_item('EPP1', 'Casco', stock=5, floor=2, location='', project=project, packing_list='PL-77')
        make_item('EPP2', 'Guante', stock=0, floor=2, location='F1-1')
        make_item('TMT1', 'Tubo', stock=3, location='', category='Otros', item_type='MATERIAL')
        make_item('EPP3', 'Botas', stock=None, location='A1-1', floor=1, purchase_order_ref='2.03')

    def _codes(self, user, **params):
        resp = client_for(user).get(BASE, params)
        assert resp.status_code == 200
        return sorted(r['product_code'] for r in resp.data['results'])

    def test_location_status_filters(self, central_warehouse):
        assert self._codes(central_warehouse, location_status='exact') == ['EPP2', 'EPP3']
        assert self._codes(central_warehouse, location_status='floor_only') == ['EPP1']
        assert self._codes(central_warehouse, location_status='none') == ['TMT1']
        assert self._codes(central_warehouse, location_status='pending') == ['EPP1', 'TMT1']

    def test_floor_project_stock_category_search(self, central_warehouse, project):
        assert self._codes(central_warehouse, floor='2') == ['EPP1', 'EPP2']
        assert self._codes(central_warehouse, project=project.pk) == ['EPP1']
        assert self._codes(central_warehouse, has_stock='true') == ['EPP1', 'TMT1']
        assert self._codes(central_warehouse, has_stock='false') == ['EPP2', 'EPP3']
        assert self._codes(central_warehouse, category='otros') == ['TMT1']
        assert self._codes(central_warehouse, item_type='EPP') == ['EPP1', 'EPP2', 'EPP3']
        assert self._codes(central_warehouse, search='PL-77') == ['EPP1']
        assert self._codes(central_warehouse, search='2.03') == ['EPP3']

    def test_summary_new_counters(self, central_warehouse):
        data = client_for(central_warehouse).get(BASE + 'summary/').data
        assert data['pending_location_count'] == 2
        assert data['zero_stock_count'] == 2   # EPP2 (0) and EPP3 (sin filas de stock)
        assert data['undated_movements'] == 0
        assert {'total_items', 'low_stock_count', 'today_entries', 'today_exits'} <= set(data)

    def test_check_stock_keeps_keys_and_adds_location(self, central_warehouse):
        data = client_for(central_warehouse).get(
            BASE + 'check-stock/', {'descriptions': 'Guante,No existe'}
        ).data
        found, missing = data
        for key in ('description', 'matched_product', 'stock_central', 'stock_obra', 'has_stock'):
            assert key in found and key in missing
        assert (found['location'], found['floor'], found['location_status']) == ('F1-1', 2, 'EXACT')
        assert missing['location_status'] == 'NONE'


@pytest.mark.django_db
class TestLocationLayoutAndAssignment:
    def test_layout_endpoint(self, central_warehouse):
        data = client_for(central_warehouse).get(BASE + 'location-layout/').data
        assert data['levels'] == [1, 2, 3, 4, 5]
        assert [f['floor'] for f in data['floors']] == [1, 2]

    def test_assign_locations_updates_location_and_floor(self, central_warehouse, make_item):
        a, b = make_item('EPP1', 'a'), make_item('EPP2', 'b')
        resp = client_for(central_warehouse).post(BASE + 'assign-locations/', {
            'assignments': [{'inventory': a.pk, 'location': 'F3-2'},
                            {'inventory': b.pk, 'location': 'b7-5'}],
        }, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data == {'updated': 2}
        a.refresh_from_db(); b.refresh_from_db()
        assert (a.location, a.floor) == ('F3-2', 2)
        assert (b.location, b.floor) == ('B7-5', 1)

    def test_assign_locations_is_all_or_nothing_with_per_row_errors(self, central_warehouse, make_item):
        a, b = make_item('EPP1', 'a'), make_item('EPP2', 'b')
        resp = client_for(central_warehouse).post(BASE + 'assign-locations/', {
            'assignments': [{'inventory': a.pk, 'location': 'F3-2'},
                            {'inventory': b.pk, 'location': 'F9-7'},
                            {'inventory': 999999, 'location': 'A1-1'},
                            {'inventory': a.pk, 'location': 'A1-1'}],
        }, format='json')
        assert resp.status_code == 400
        errors = {(e['index'], e['field']) for e in resp.data['errors']}
        assert errors == {(1, 'location'), (2, 'inventory'), (3, 'inventory')}
        assert 'layout' in next(e for e in resp.data['errors'] if e['index'] == 1)['error']
        a.refresh_from_db()
        assert a.location == ''   # nothing applied

    def test_assign_locations_limit_is_300(self, central_warehouse, make_item):
        item = make_item('EPP1', 'a')
        resp = client_for(central_warehouse).post(BASE + 'assign-locations/', {
            'assignments': [{'inventory': item.pk, 'location': 'A1-1'}] * 301,
        }, format='json')
        assert resp.status_code == 400

    def test_assign_locations_requires_at_least_one_assignment(self, central_warehouse):
        resp = client_for(central_warehouse).post(BASE + 'assign-locations/', {'assignments': []}, format='json')
        assert resp.status_code == 400
