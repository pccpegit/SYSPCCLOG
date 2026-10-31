"""
SYSPCC-025 · QA ronda 1 — contrato backend <-> pantallas de /almacen.

* Cada URL que usa `frontend/src/api/almacen.js` y `almacenImport.js` existe en el backend con ese
  método (el frontend pinta `api/almacen.contract.test.js` con las mismas rutas).
* La forma de las respuestas que las pantallas leen es la que el frontend espera. En particular el
  `result` de la confirmación (ver DEFECTO QA-11 en `ImportResult.test.jsx`): aquí se fija su forma real
  para que el fixture del frontend no se aparte de ella.
"""
from unittest import mock

import pytest

from apps.warehouse.models import MovementGroup
from apps.warehouse.services import movements as svc

from .import_workbooks import standard_workbook
from .qa_support import IMPORTS, confirm, import_throttle_isolated, tolerant_client, upload  # noqa: F401 (fixture)

pytestmark = pytest.mark.django_db

API = '/api/v1/warehouse/'


@pytest.fixture(autouse=True)
def _isolated(import_throttle_isolated):
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def world(central_warehouse, make_item):
    item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)
    group = svc.register_exit_batch(
        items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=central_warehouse,
    )
    client = tolerant_client(central_warehouse)
    preview = upload(client, standard_workbook()).json()
    return {'item': item, 'group': group, 'movement': group.movements.get(), 'import_id': preview['id'],
            'preview': preview, 'client': client}


# (method, path template, expected statuses). {item}/{movement}/{group}/{imp} are filled from `world`.
GET_ROUTES = [
    'inventory/', 'inventory/{item}/', 'inventory/{item}/kardex/', 'inventory/{item}/recent-movements/',
    'inventory/categories/', 'inventory/alerts/', 'inventory/summary/', 'inventory/location-layout/',
    'inventory/movement-summary/', 'inventory/movement-summary/export/', 'inventory/export/',
    'movements/', 'movements/export/', 'movements/{movement}/voucher/', 'movements/{movement}/pdf/',
    'movements/groups/{group}/pdf/', 'movements/groups/{group}/voucher/',
    'personal-lookup/?search=abc', 'pending-requests/list/', 'pending-requests/count/',
    'imports/', 'imports/{imp}/', 'imports/{imp}/problems/', 'imports/{imp}/problems/export/', 'imports/template/',
]


@pytest.mark.parametrize('route', GET_ROUTES)
def test_every_get_route_the_screens_use_exists_and_answers(route, world):
    path = route.format(item=world['item'].pk, movement=world['movement'].pk, group=world['group'].pk,
                        imp=world['import_id'])
    response = world['client'].get(API + path)
    assert response.status_code == 200, (route, response.status_code)


POST_ROUTES = [
    'movements/entry/', 'movements/batch-entry/', 'movements/exit/', 'movements/batch-exit/',
    'movements/epp-delivery/', 'movements/link-personal/', 'inventory/', 'inventory/assign-locations/',
    'imports/{imp}/confirm/',
]


@pytest.mark.parametrize('route', POST_ROUTES)
def test_every_post_route_the_screens_use_exists_and_validates_an_empty_body(route, world):
    path = route.format(imp=world['import_id'])
    response = world['client'].post(API + path, {}, format='json')
    assert response.status_code == 400, (route, response.status_code)           # exists, and validates


def test_upload_route_exists(world):
    assert world['client'].post(IMPORTS, {}, format='multipart').status_code == 400


def test_put_patch_and_delete_routes_exist(world):
    client, item = world['client'], world['item']
    body = {'product_code': item.product_code, 'description': 'X', 'unit': 'EA'}
    assert client.put(f'{API}inventory/{item.pk}/', body, format='json').status_code == 200
    assert client.patch(f'{API}inventory/{item.pk}/', {'observation': 'x'}, format='json').status_code == 200
    assert client.delete(f"{IMPORTS}{world['import_id']}/").status_code == 200


# ---------------------------------------------------------------------------
# Forma de las respuestas
# ---------------------------------------------------------------------------

def test_the_confirmation_result_has_the_shape_the_result_screen_is_tested_with(central_warehouse):
    client = tolerant_client(central_warehouse)
    preview = upload(client, standard_workbook()).json()
    result = confirm(client, preview).json()['result']
    assert set(result) >= {'catalog', 'groups', 'movements', 'skipped', 'stock_total', 'reconciled', 'confirmed_by'}
    assert set(result['catalog']) == {'created', 'updated'}
    assert set(result['groups']) == {'initial', 'entries', 'exits'}
    assert set(result['movements']) == {'initial', 'entries', 'exits'}
    assert set(result['skipped']) == {'rows_with_errors', 'already_imported'}
    assert all(isinstance(v, int) for section in ('groups', 'movements') for v in result[section].values())
    assert result['movements']['entries'] == 2 and result['movements']['exits'] == 3


def test_the_preview_carries_every_field_the_review_step_reads(world):
    preview = world['preview']
    assert {'id', 'status', 'plan_digest', 'can_confirm', 'requires', 'projects', 'unmatched_destinations',
            'summary', 'result', 'expires_at'} <= set(preview)
    assert set(preview['requires']) == {'accept_warnings', 'accept_skipped_rows', 'project_labels'}
    summary = preview['summary']
    assert {'sheets', 'catalog', 'entries', 'exits', 'stock', 'counts', 'by_code', 'skipped_rows'} <= set(summary)
    assert {'to_import', 'skipped_error', 'already_imported', 'groups'} == set(summary['entries'])
    assert {'projected_total', 'sheet_total', 'mismatched_items', 'negative_items'} == set(summary['stock'])
    assert {'blocker', 'error', 'warning', 'info'} == set(summary['counts'])
    assert all({'label', 'items', 'matches', 'suggested_id'} == set(p) for p in preview['projects'])


def test_the_problems_page_has_the_shape_the_panel_reads(world):
    page = world['client'].get(f"{IMPORTS}{world['import_id']}/problems/").json()
    assert {'count', 'results', 'meta'} <= set(page)
    assert {'total', 'truncated', 'counts', 'by_code'} <= set(page['meta'])
    assert all({'code', 'severity', 'sheet', 'row', 'message'} == set(p) for p in page['results'])


def test_the_voucher_has_the_fields_the_print_screen_reads(world):
    body = world['client'].get(f"{API}movements/{world['movement'].pk}/voucher/").json()
    assert {'movement_number', 'movement_date', 'voucher_number', 'warehouse', 'destination_type',
            'destination_detail', 'registered_by', 'items', 'date'} <= set(body)
    assert all({'product_code', 'description', 'unit', 'quantity'} == set(i) for i in body['items'])


def test_the_dashboard_summary_has_the_counters_the_dashboard_reads(world):
    body = world['client'].get(API + 'inventory/summary/').json()
    assert {'total_items', 'low_stock_count', 'today_entries', 'today_exits', 'pending_location_count',
            'zero_stock_count', 'undated_movements', 'total_units'} <= set(body)


def test_the_movement_summary_has_the_columns_and_meta_the_screen_reads(world):
    body = world['client'].get(API + 'inventory/movement-summary/').json()
    assert {'count', 'results', 'meta'} <= set(body)
    assert {'date_from', 'date_to', 'undated_movements', 'totals', 'untracked_stock'} <= set(body['meta'])
    assert {'initial', 'entries', 'exits', 'closing', 'current'} == set(body['meta']['totals'])
    assert {'inventory_id', 'product_code', 'description', 'unit', 'initial_stock', 'entries', 'exits',
            'closing_stock', 'current_stock', 'untracked_stock', 'location', 'location_status', 'floor',
            'observation', 'project_name'} <= set(body['results'][0])


def test_the_kardex_has_opening_closing_and_running_balance(world):
    body = world['client'].get(f"{API}inventory/{world['item'].pk}/kardex/").json()
    assert {'item', 'opening_stock', 'closing_stock', 'movements'} == set(body)
    assert {'delta', 'balance_after', 'movement_date', 'voucher_number', 'destination_detail'} <= set(body['movements'][0])


def test_a_group_created_by_the_api_returns_the_group_number_the_screens_show(world):
    response = world['client'].post(API + 'movements/batch-exit/', {
        'items': [{'inventory': world['item'].pk, 'quantity': 1}], 'warehouse': 'CENTRAL',
        'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona Prueba',
    }, format='json')
    assert response.status_code == 201
    group = MovementGroup.objects.get(pk=response.json()['id'])
    assert response.json()['group_number'] == group.group_number
