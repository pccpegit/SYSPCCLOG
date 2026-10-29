"""
SYSPCC-025 · QA ronda 1 — permisos de escritura y casos límite de los endpoints.

La matriz existente (`test_permissions_matrix.py`) cubre lecturas, asignar ubicaciones y el
importador. Aquí se completa con TODOS los endpoints de escritura nuevos y viejos del módulo para los
13 roles, sin bypass de superusuario, y con los casos límite de ubicaciones, entrega de EPP, catálogo,
vinculación y búsqueda de trabajadores.

Los tests marcados "DEFECTO QA-n" describen un comportamiento incorrecto de producción que esta
ronda encontró: fallan a propósito hasta que se corrija.
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock, MovementGroup

from .conftest import make_user
from .qa_support import INVENTORY, MOVEMENTS, snapshot_database, tolerant_client

pytestmark = pytest.mark.django_db

API = '/api/v1/warehouse/'
ALL_ROLES = list(RoleChoices.values)
WAREHOUSE_ROLES = {
    RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.SITE_WAREHOUSE, RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.LOGISTICS_CHIEF,
}


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def item(make_item):
    made = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)
    InventoryStock.objects.create(inventory=made, warehouse_type='SITE', quantity=10)
    return made


# ---------------------------------------------------------------------------
# Matriz de escritura: 13 roles x endpoints
# ---------------------------------------------------------------------------

def _entry(item, personal):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE'}


def _exit(item, personal):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE',
            'destination_detail': 'Persona Prueba'}


def _batch_entry(item, personal):
    return {'items': [{'inventory': item.pk, 'quantity': 1}], 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE'}


def _batch_exit(item, personal):
    return {'items': [{'inventory': item.pk, 'quantity': 1}], 'warehouse': 'CENTRAL',
            'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona Prueba'}


def _epp(item, personal):
    return {'warehouse': 'SITE', 'voucher_number': 'V-' + str(timezone.now().timestamp()),
            'movement_date': timezone.localdate().isoformat(), 'recipient': {'name': 'Persona Prueba'},
            'items': [{'inventory': item.pk, 'quantity': 1}]}


def _link(item, personal):
    return {'destination_key': 'persona prueba', 'personal': personal.pk}


def _create_item(item, personal):
    return {'product_code': 'EPP000555', 'description': 'NUEVO', 'unit': 'EA'}


# SYSPCC-025 (seguridad, ronda 1): el alcance es el mismo en todos los endpoints de movimiento. Los cuerpos
# de arriba operan el almacén CENTRAL: SITE_WAREHOUSE solo opera el almacén de obra, y entregar a un
# trabajador (`_exit` / `_batch_exit` con destino EMPLOYEE) es trabajo de mostrador del Almacén Central.
# La tabla completa (almacén x destino x rol) vive en `test_movement_scope.py`.
CENTRAL_SCOPE_ROLES = WAREHOUSE_ROLES - {RoleChoices.SITE_WAREHOUSE}
WORKER_DELIVERY_ROLES = {RoleChoices.CENTRAL_WAREHOUSE}

WRITE_ENDPOINTS = [
    ('movements/entry/', _entry, CENTRAL_SCOPE_ROLES),
    ('movements/exit/', _exit, WORKER_DELIVERY_ROLES),
    ('movements/batch-entry/', _batch_entry, CENTRAL_SCOPE_ROLES),
    ('movements/batch-exit/', _batch_exit, WORKER_DELIVERY_ROLES),
    ('movements/epp-delivery/', _epp, {RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.SITE_WAREHOUSE}),
    ('movements/link-personal/', _link, {RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.LOGISTICS_CHIEF}),
    ('inventory/', _create_item, WAREHOUSE_ROLES),
]


@pytest.mark.parametrize('path,body_for,allowed', WRITE_ENDPOINTS, ids=[e[0] for e in WRITE_ENDPOINTS])
class TestWriteEndpointsRoleMatrix:
    @pytest.mark.parametrize('role', ALL_ROLES)
    def test_only_the_documented_roles_may_write(self, path, body_for, allowed, role, item, make_personal):
        user = make_user(f'w_{role.lower()}', role)
        body = body_for(item, make_personal())
        before = snapshot_database()
        response = tolerant_client(user).post(API + path, body, format='json')
        if role in allowed:
            assert response.status_code in (200, 201), (role, response.status_code, response.content)
        else:
            assert response.status_code == 403, (role, response.status_code)
            assert snapshot_database() == before                       # a rejected role leaves no trace

    def test_a_superuser_without_a_warehouse_role_has_no_bypass(self, path, body_for, allowed, item, superuser,
                                                                make_personal):
        response = tolerant_client(superuser).post(API + path, body_for(item, make_personal()), format='json')
        assert response.status_code == 403

    def test_anonymous_requests_are_refused(self, path, body_for, allowed, item, api_client, make_personal):
        before = snapshot_database()
        response = api_client.post(API + path, body_for(item, make_personal()), format='json')
        assert response.status_code in (401, 403)
        assert snapshot_database() == before


class TestOtherUnsafeMethods:
    @pytest.mark.parametrize('role', sorted(set(ALL_ROLES) - WAREHOUSE_ROLES))
    def test_outside_roles_cannot_edit_or_delete_catalog_items(self, role, item):
        client = tolerant_client(make_user(f'u_{role.lower()}', role))
        assert client.patch(f'{INVENTORY}{item.pk}/', {'description': 'otro'}, format='json').status_code == 403
        assert client.delete(f'{INVENTORY}{item.pk}/').status_code == 403
        assert Inventory.objects.filter(pk=item.pk, description='GUANTE T: L').exists()

    def test_movements_are_read_only_through_the_api(self, item, central_warehouse):
        client = tolerant_client(central_warehouse)
        client.post(MOVEMENTS + 'exit/', _exit(item, None), format='json')
        movement = InventoryMovement.objects.get()
        assert client.delete(f'{MOVEMENTS}{movement.pk}/').status_code in (404, 405)
        assert client.patch(f'{MOVEMENTS}{movement.pk}/', {'quantity': 99}, format='json').status_code in (404, 405)
        assert InventoryMovement.objects.get().quantity == 1

    def test_import_endpoints_reject_get_on_confirm_and_post_on_problems(self, central_warehouse):
        client = tolerant_client(central_warehouse)
        uuid_ = '11111111-2222-3333-4444-555555555555'
        assert client.get(f'{API}imports/{uuid_}/confirm/').status_code == 405
        assert client.post(f'{API}imports/{uuid_}/problems/', {}, format='json').status_code == 405


# ---------------------------------------------------------------------------
# Ubicaciones
# ---------------------------------------------------------------------------

ASSIGN = INVENTORY + 'assign-locations/'


class TestAssignLocationsEdges:
    @pytest.fixture
    def client(self, central_warehouse):
        return tolerant_client(central_warehouse)

    @pytest.mark.parametrize('location', [
        'A8-1', 'C5-1', 'D5-1', 'E7-1', 'F7-1', 'K7-1', 'L1-1', 'A0-1', 'A1-0', 'A1-6', 'A01-1', 'A1', '1-A1',
        'A1--1', 'A-1', 'A 1-1', 'A1-1-1', '', '   ', 'PISO 2', "A1-1'; DROP TABLE inventory;--", 'Ａ１-１',
        'A1٣-2', 'A1-1\n', 'A1-1\x00',
    ])
    def test_locations_outside_the_layout_are_rejected_and_nothing_changes(self, client, item, location):
        before = snapshot_database()
        response = client.post(ASSIGN, {'assignments': [{'inventory': item.pk, 'location': location}]}, format='json')
        if location == 'A1-1\n':                       # surrounding whitespace is stripped, so this one is valid
            assert response.status_code == 200
            return
        assert response.status_code == 400, (location, response.status_code)
        assert snapshot_database() == before
        item.refresh_from_db()
        assert item.location == ''

    @pytest.mark.parametrize('location,stored,floor', [
        ('a1-1', 'A1-1', 1), (' f3-2 ', 'F3-2', 2), ('B7-5', 'B7-5', 1), ('C4-3', 'C4-3', 1), ('K6-1', 'K6-1', 2),
        ('E6-5', 'E6-5', 1),
    ])
    def test_valid_locations_are_normalised_and_set_the_floor(self, client, item, location, stored, floor):
        response = client.post(ASSIGN, {'assignments': [{'inventory': item.pk, 'location': location}]}, format='json')
        assert response.status_code == 200 and response.json() == {'updated': 1}
        item.refresh_from_db()
        assert (item.location, item.floor) == (stored, floor)

    def test_moving_an_item_between_floors_updates_the_floor(self, client, item):
        client.post(ASSIGN, {'assignments': [{'inventory': item.pk, 'location': 'F3-2'}]}, format='json')
        client.post(ASSIGN, {'assignments': [{'inventory': item.pk, 'location': 'B1-1'}]}, format='json')
        item.refresh_from_db()
        assert (item.location, item.floor) == ('B1-1', 1)

    def test_assigning_the_same_location_twice_is_harmless(self, client, item):
        body = {'assignments': [{'inventory': item.pk, 'location': 'F3-2'}]}
        assert client.post(ASSIGN, body, format='json').status_code == 200
        assert client.post(ASSIGN, body, format='json').status_code == 200
        assert Inventory.objects.get(pk=item.pk).location == 'F3-2'

    def test_the_same_item_twice_in_one_request_is_rejected_whole(self, client, item):
        before = snapshot_database()
        response = client.post(ASSIGN, {'assignments': [
            {'inventory': item.pk, 'location': 'F3-2'}, {'inventory': item.pk, 'location': 'F3-3'},
        ]}, format='json')
        assert response.status_code == 400
        assert response.json()['errors'][0]['index'] == 1
        assert snapshot_database() == before
        assert Inventory.objects.get(pk=item.pk).location == ''

    @pytest.mark.parametrize('body', [
        {}, {'assignments': []}, {'assignments': 'F3-2'}, {'assignments': [{}]},
        {'assignments': [{'inventory': 'x', 'location': 'F3-2'}]},
        {'assignments': [{'inventory': 1}]}, {'assignments': [{'location': 'F3-2'}]},
        {'assignments': [{'inventory': 1, 'location': 'F' * 101}]},
    ])
    def test_malformed_bodies_are_a_400(self, client, body):
        assert client.post(ASSIGN, body, format='json').status_code == 400

    def test_a_missing_item_is_reported_with_its_index_and_blocks_the_rest(self, client, item):
        response = client.post(ASSIGN, {'assignments': [
            {'inventory': item.pk, 'location': 'F3-2'}, {'inventory': 987654, 'location': 'F3-3'},
        ]}, format='json')
        assert response.status_code == 400
        assert [(e['index'], e['field']) for e in response.json()['errors']] == [(1, 'inventory')]
        assert Inventory.objects.get(pk=item.pk).location == ''

    def test_exactly_three_hundred_assignments_are_accepted(self, client, central_warehouse):
        items = Inventory.objects.bulk_create(
            Inventory(product_code=f'Z{n:04d}', description='z', unit='EA') for n in range(300)
        )
        ids = list(Inventory.objects.values_list('pk', flat=True))
        response = client.post(ASSIGN, {'assignments': [{'inventory': pk, 'location': 'F3-2'} for pk in ids]},
                               format='json')
        assert response.status_code == 200 and response.json() == {'updated': 300}
        assert items

    def test_an_assignment_never_touches_the_stock_or_the_movements(self, client, item):
        before = snapshot_database()
        client.post(ASSIGN, {'assignments': [{'inventory': item.pk, 'location': 'F3-2'}]}, format='json')
        after = snapshot_database()
        assert (after['movements'], after['stock']) == (before['movements'], before['stock'])


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------

class TestInventoryCatalogEdges:
    @pytest.fixture
    def client(self, central_warehouse):
        return tolerant_client(central_warehouse)

    def body(self, **over):
        data = {'product_code': 'EPP000900', 'description': 'CASCO', 'unit': 'EA'}
        data.update(over)
        return data

    @pytest.mark.parametrize('over', [
        {'description': 'x' * 301}, {'unit': ''}, {'unit': 'x' * 31}, {'product_code': ''},
        {'product_code': 'x' * 51}, {'min_stock': '-1'}, {'min_stock': 'abc'}, {'location': 'Z9-9'},
        {'floor': 3}, {'floor': 0}, {'floor': -1}, {'project': 99999}, {'item_type': 'COSA'},
        {'location': 'F3-2', 'floor': 1}, {'size': 'x' * 21}, {'observation': 'x' * 301},
    ])
    def test_invalid_payloads_are_a_400_and_create_nothing(self, client, over):
        response = client.post(INVENTORY, self.body(**over), format='json')
        assert response.status_code == 400, (over, response.status_code)
        assert not Inventory.objects.filter(product_code=over.get('product_code', 'EPP000900')).exists()

    def test_an_exact_duplicate_code_is_a_400(self, client, item):
        assert client.post(INVENTORY, self.body(product_code=item.product_code), format='json').status_code == 400

    def test_a_code_that_only_differs_in_case_or_spaces_is_a_duplicate(self, client, item):
        """
        DEFECTO QA-7: `product_code` es único solo en bruto; 'epp000001 ' entra como ítem nuevo, y
        el importador (que busca por Upper(Trim(código))) elige uno de los dos al azar.
        """
        response = client.post(INVENTORY, self.body(product_code=' epp000001 '), format='json')
        assert response.status_code == 400, response.status_code
        assert Inventory.objects.count() == 1

    def test_the_size_is_derived_from_the_description_and_floor_follows_the_location(self, client):
        response = client.post(INVENTORY, self.body(description='GUANTE T: XL', location='f3-2'), format='json')
        assert response.status_code == 201, response.content
        created = Inventory.objects.get(product_code='EPP000900')
        assert (created.size, created.location, created.floor) == ('XL', 'F3-2', 2)

    def test_an_item_with_history_cannot_be_deleted_and_the_answer_is_not_a_crash(self, client, item):
        """
        DEFECTO QA-8: borrar un ítem con movimientos choca con `on_delete=PROTECT` y la excepción no se
        captura: responde 500 en lugar de un 409/400 que explique que tiene historial.
        """
        client.post(MOVEMENTS + 'exit/', _exit(item, None), format='json')
        response = client.delete(f'{INVENTORY}{item.pk}/')
        assert response.status_code in (400, 409), response.status_code
        assert Inventory.objects.filter(pk=item.pk).exists()
        assert InventoryMovement.objects.filter(inventory=item).exists()

    def test_an_item_without_history_can_be_deleted_with_its_stock_rows(self, client, make_item):
        fresh = make_item('EPP000800', 'SIN HISTORIA', 'EA', stock=2)
        assert client.delete(f'{INVENTORY}{fresh.pk}/').status_code == 204
        assert not InventoryStock.objects.filter(inventory_id=fresh.pk).exists()

    def test_a_legacy_free_text_location_does_not_block_other_edits_but_cannot_be_reintroduced(self, client, make_item):
        legacy = make_item('EPP000801', 'LEGADO', 'EA', location='Estante rojo')
        assert client.patch(f'{INVENTORY}{legacy.pk}/', {'description': 'LEGADO 2'}, format='json').status_code == 200
        other = make_item('EPP000802', 'OTRO', 'EA')
        assert client.patch(f'{INVENTORY}{other.pk}/', {'location': 'Estante rojo'}, format='json').status_code == 400


# ---------------------------------------------------------------------------
# Entrega de EPP
# ---------------------------------------------------------------------------

EPP = MOVEMENTS + 'epp-delivery/'


def epp_body(item, **over):
    body = {
        'warehouse': 'CENTRAL', 'voucher_number': '5001', 'movement_date': timezone.localdate().isoformat(),
        'recipient': {'name': 'Trabajador Libre Prueba'}, 'items': [{'inventory': item.pk, 'quantity': 1}],
    }
    body.update(over)
    return body


class TestEppDeliveryEdges:
    @pytest.fixture
    def client(self, central_warehouse):
        return tolerant_client(central_warehouse)

    @pytest.mark.parametrize('over', [
        {'voucher_number': 'V' * 31}, {'voucher_number': ''}, {'voucher_number': '   '},
        {'movement_date': '2026-13-45'}, {'movement_date': 'hoy'}, {'movement_date': ''},
        {'recipient': {}}, {'recipient': {'name': '   '}}, {'recipient': {'name': 'N' * 201}},
        {'recipient': {'name': 'A', 'internal': 'B'}}, {'recipient': 'Juan'}, {'items': []},
        {'items': [{'inventory': 999999, 'quantity': 1}]}, {'items': [{'quantity': 1}]},
        {'warehouse': 'MARTE'}, {'internal_transfer': 'T' * 101},
    ])
    def test_invalid_deliveries_are_a_400_and_change_nothing(self, client, item, over):
        before = snapshot_database()
        response = client.post(EPP, epp_body(item, **over), format='json')
        assert response.status_code == 400, (over, response.status_code)
        assert snapshot_database() == before

    def test_yesterday_and_today_are_accepted_tomorrow_is_not(self, client, item):
        today = timezone.localdate()
        for n, (offset, expected) in enumerate([(-1, 201), (0, 201), (1, 400)]):
            body = epp_body(item, voucher_number=f'D{n}', movement_date=(today + timedelta(days=offset)).isoformat())
            assert client.post(EPP, body, format='json').status_code == expected, offset

    def test_the_vale_is_trimmed_before_checking_for_duplicates(self, client, item):
        assert client.post(EPP, epp_body(item, voucher_number='7777'), format='json').status_code == 201
        again = client.post(EPP, epp_body(item, voucher_number='  7777  '), format='json')
        assert again.status_code == 409 and again.json()['code'] == 'voucher_number_exists'

    def test_a_duplicate_vale_that_is_forced_registers_a_second_group(self, client, item):
        client.post(EPP, epp_body(item, voucher_number='7778'), format='json')
        forced = client.post(EPP, epp_body(item, voucher_number='7778', allow_duplicate_voucher=True), format='json')
        assert forced.status_code == 201
        assert MovementGroup.objects.filter(voucher_number='7778').count() == 2

    def test_vales_of_another_warehouse_are_not_duplicates(self, client, item):
        assert client.post(EPP, epp_body(item, voucher_number='7779'), format='json').status_code == 201
        other = client.post(EPP, epp_body(item, voucher_number='7779', warehouse='SITE'), format='json')
        assert other.status_code == 201

    def test_the_vale_check_ignores_upper_and_lower_case(self, client, item):
        """
        DEFECTO QA-9: el filtro del listado usa `iexact` pero la validación de duplicados compara en
        bruto: el vale físico 'S-12' y 's-12' no se detectan como el mismo.
        """
        assert client.post(EPP, epp_body(item, voucher_number='S-12'), format='json').status_code == 201
        assert client.post(EPP, epp_body(item, voucher_number='s-12'), format='json').status_code == 409

    def test_a_non_existing_project_is_a_400_not_a_silent_fallback_to_the_central_pool(self, client, item):
        """
        DEFECTO QA-10: `project` es un entero sin validar. `_get_or_create_stock` ignora en silencio un id
        inexistente y descuenta del pool central, y el movimiento queda apuntando a un proyecto que no
        existe (en PostgreSQL el commit falla con IntegrityError y la API responde un 409 engañoso).
        """
        before = snapshot_database()
        response = client.post(EPP, epp_body(item, project=987654), format='json')
        after = snapshot_database()
        # the defect leaves a movement with a dangling FK that would also break this test's teardown
        InventoryMovement.objects.all().delete()
        MovementGroup.objects.all().delete()
        assert response.status_code in (400, 404), response.status_code
        assert after == before

    def test_a_delivery_to_a_linked_worker_snapshots_the_name_and_links_the_group(self, client, item, make_personal):
        worker = make_personal('Mamani Torres, Elena Prueba')
        response = client.post(EPP, epp_body(item, recipient={'personal': worker.pk}), format='json')
        assert response.status_code == 201
        group = MovementGroup.objects.get()
        assert group.destination_personal_id == worker.pk
        assert group.destination_detail == 'Mamani Torres, Elena Prueba'
        assert InventoryMovement.objects.get().destination_personal_id == worker.pk

    def test_the_response_is_never_cached(self, client, item):
        assert client.post(EPP, epp_body(item), format='json').headers['Cache-Control'] == 'no-store'


# ---------------------------------------------------------------------------
# Vincular destinos y buscar trabajadores
# ---------------------------------------------------------------------------

LINK = MOVEMENTS + 'link-personal/'
LOOKUP = API + 'personal-lookup/'


class TestLinkPersonalEdges:
    @pytest.fixture
    def client(self, central_warehouse):
        return tolerant_client(central_warehouse)

    @pytest.mark.parametrize('key', ['', '   ', '...', '---', '🙂🙂', 'x' * 301])
    def test_keys_without_name_tokens_are_rejected(self, client, make_personal, key):
        assert client.post(LINK, {'destination_key': key, 'personal': make_personal().pk}, format='json').status_code == 400

    def test_an_unknown_worker_is_a_400(self, client):
        assert client.post(LINK, {'destination_key': 'persona prueba', 'personal': 99999}, format='json').status_code == 400

    def test_it_never_relinks_what_is_already_linked(self, client, item, make_personal, central_warehouse):
        first, second = make_personal('Quispe Soto, Ana Prueba'), make_personal('Quispe Soto, Ana Prueba')
        client.post(EPP, epp_body(item, recipient={'name': 'Quispe Soto, Ana Prueba'}), format='json')
        assert client.post(LINK, {'destination_key': 'quispe soto ana prueba', 'personal': first.pk}, format='json').status_code == 200
        client.post(LINK, {'destination_key': 'quispe soto ana prueba', 'personal': second.pk}, format='json')
        assert InventoryMovement.objects.get().destination_personal_id == first.pk

    def test_nothing_matching_links_zero_rows(self, client, make_personal):
        response = client.post(LINK, {'destination_key': 'nadie existe', 'personal': make_personal().pk}, format='json')
        assert response.json() == {'linked_movements': 0, 'linked_groups': 0}


class TestPersonalLookupEdges:
    @pytest.fixture
    def client(self, central_warehouse):
        return tolerant_client(central_warehouse)

    @pytest.fixture(autouse=True)
    def workers(self, make_personal):
        for name in ('Quispe Mamani, Rosa Prueba', 'Ccori Huaman, Pedro Prueba', 'Apaza Condori, Luis Prueba'):
            make_personal(name)
        make_personal('Cesado Antiguo, Juan Prueba', active=False)

    def test_a_punctuation_only_search_does_not_list_the_workers(self, client):
        """
        DEFECTO QA-6: '...', '---' o '%%%' superan el mínimo de 3 caracteres pero no tienen ninguna
        palabra: `wanted` queda vacío, `all([])` es verdadero y la búsqueda devuelve a los primeros 20
        trabajadores activos (nombre, puesto, proyecto) sin escribir ni una letra.
        """
        for query in ('...', '---', '%%%', '___', '   ...   '):
            response = client.get(LOOKUP, {'search': query})
            assert response.status_code in (200, 400), query
            if response.status_code == 200:
                assert response.json() == [], query

    @pytest.mark.parametrize('query', ["'; DROP TABLE core_personal;--", '%', '_' * 5, 'ñññ', '🙂🙂🙂', 'a' * 5000])
    def test_hostile_text_never_breaks_the_lookup(self, client, query):
        assert client.get(LOOKUP, {'search': query}).status_code in (200, 400)

    def test_a_search_with_too_few_letters_is_a_400(self, client):
        assert client.get(LOOKUP, {'search': 'ab'}).status_code == 400
        assert client.get(LOOKUP, {'search': ' a '}).status_code == 400
        assert client.get(LOOKUP).status_code == 400

    def test_ceased_workers_are_never_offered(self, client):
        assert client.get(LOOKUP, {'search': 'Cesado'}).json() == []

    def test_only_minimal_fields_are_exposed(self, client):
        rows = client.get(LOOKUP, {'search': 'Quispe'}).json()
        assert rows and set(rows[0]) == {'id', 'full_name', 'position', 'project_code'}


# ---------------------------------------------------------------------------
# Vales (voucher y PDF) de grupos importados o sin fecha
# ---------------------------------------------------------------------------

class TestVoucherAndPdfOfImportedGroups:
    @pytest.fixture
    def groups(self, central_warehouse, make_item):
        from datetime import date

        from apps.warehouse.services import movements as svc

        item = make_item('EPP000321', 'CASCO', 'EA', stock=10)
        undated = svc.register_exit_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
            authorized_by_id=None, notes='', registered_by=central_warehouse, undated=True,
        )
        dated = svc.register_exit_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
            authorized_by_id=None, notes='', registered_by=central_warehouse,
            movement_date=date(2026, 10, 5), voucher_number='3425',
        )
        return undated, dated

    def test_the_group_pdf_renders_with_and_without_an_operational_date(self, groups, central_warehouse):
        client = tolerant_client(central_warehouse)
        for group in groups:
            response = client.get(f'{MOVEMENTS}groups/{group.pk}/pdf/')
            assert response.status_code == 200, group.pk
            assert response.content.startswith(b'%PDF')

    def test_the_group_voucher_keeps_a_missing_date_as_null_instead_of_inventing_one(self, groups, central_warehouse):
        undated, dated = groups
        client = tolerant_client(central_warehouse)
        assert client.get(f'{MOVEMENTS}groups/{undated.pk}/voucher/').json()['movement_date'] is None
        body = client.get(f'{MOVEMENTS}groups/{dated.pk}/voucher/').json()
        assert (body['movement_date'], body['voucher_number']) == ('2026-10-05', '3425')

    def test_the_single_movement_voucher_and_pdf_of_an_undated_line_work(self, groups, central_warehouse):
        movement = InventoryMovement.objects.filter(movement_date__isnull=True).get()
        client = tolerant_client(central_warehouse)
        assert client.get(f'{MOVEMENTS}{movement.pk}/voucher/').status_code == 200
        assert client.get(f'{MOVEMENTS}{movement.pk}/pdf/').status_code == 200

    def test_unknown_groups_are_a_404(self, central_warehouse):
        client = tolerant_client(central_warehouse)
        assert client.get(f'{MOVEMENTS}groups/987654/pdf/').status_code == 404
        assert client.get(f'{MOVEMENTS}groups/987654/voucher/').status_code == 404

    @pytest.mark.parametrize('role', sorted(set(ALL_ROLES) - WAREHOUSE_ROLES))
    def test_outside_roles_cannot_read_vales(self, groups, role):
        client = tolerant_client(make_user(f'v_{role.lower()}', role))
        for suffix in ('pdf/', 'voucher/'):
            assert client.get(f'{MOVEMENTS}groups/{groups[0].pk}/{suffix}').status_code == 403

    def test_anonymous_users_cannot_read_vales(self, groups, api_client):
        assert api_client.get(f'{MOVEMENTS}groups/{groups[0].pk}/pdf/').status_code in (401, 403)
