
"""
SYSPCC-025 (ronda 1 de revisión) — endurecimiento del catálogo, los movimientos y la búsqueda de personal.

Cubre lo que los tests ``test_qa_*`` no fijan con detalle: sobre de error de cada rechazo, referencias
(proyecto / usuarios) inexistentes, normalización del código de producto, borrado de ítems con historial,
parámetros de consulta basura, numeración de vales más allá de 9 999, privacidad de nombres en el detalle
de las importaciones y alcance de la búsqueda de trabajadores.
"""
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock, MovementGroup
from apps.warehouse.services import movements as svc

from .conftest import client_for, make_user
from .import_workbooks import WORKER_A, standard_workbook
from .qa_support import (  # noqa: F401 (import_throttle_isolated is a fixture)
    INVENTORY, MOVEMENTS, confirm, import_throttle_isolated, snapshot_database, tolerant_client, upload,
)

pytestmark = pytest.mark.django_db

LOOKUP = '/api/v1/warehouse/personal-lookup/'


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


@pytest.fixture
def item(make_item):
    return make_item('EPP000001', 'GUANTE T: L', 'EA', stock=20)


def exit_payload(item, **extra):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
            'destination_detail': 'Obra Prueba', **extra}


def batch_exit_payload(item, **extra):
    return {'items': [{'inventory': item.pk, 'quantity': 1}], 'warehouse': 'CENTRAL',
            'destination_type': 'PROJECT', 'destination_detail': 'Obra Prueba', **extra}


def entry_payload(item, **extra):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', **extra}


def epp_payload(item, **extra):
    return {'warehouse': 'CENTRAL', 'voucher_number': 'V-1', 'movement_date': timezone.localdate().isoformat(),
            'recipient': {'name': 'Persona Prueba'}, 'items': [{'inventory': item.pk, 'quantity': 1}], **extra}


# ---------------------------------------------------------------------------
# Referencias inexistentes: 400, nunca una caída silenciosa al pool central
# ---------------------------------------------------------------------------

REFERENCE_ENDPOINTS = [
    ('entry/', entry_payload), ('exit/', exit_payload), ('batch-exit/', batch_exit_payload),
    ('epp-delivery/', epp_payload),
]


@pytest.mark.parametrize('path,body_for', REFERENCE_ENDPOINTS, ids=[e[0] for e in REFERENCE_ENDPOINTS])
class TestReferencesMustExist:
    @pytest.mark.parametrize('bad', [987654, 10 ** 30, 0, -3, 'abc', 1.5])
    def test_an_unknown_or_malformed_project_is_a_400_with_the_error_envelope(self, client, item, path, body_for, bad):
        before = snapshot_database()
        response = client.post(MOVEMENTS + path, body_for(item, project=bad), format='json')
        assert response.status_code == 400, (bad, response.status_code)
        body = response.json()
        assert body['error'] is True and 'project' in body['detail']
        assert snapshot_database() == before and not MovementGroup.objects.exists()

    def test_an_existing_project_is_accepted(self, client, item, project, path, body_for):
        InventoryStock.objects.create(inventory=item, warehouse_type='CENTRAL', project=project, quantity=5)
        response = client.post(MOVEMENTS + path, body_for(item, project=project.pk), format='json')
        assert response.status_code == 201, response.content

    def test_a_null_project_means_the_central_pool(self, client, item, path, body_for):
        assert client.post(MOVEMENTS + path, body_for(item, project=None), format='json').status_code == 201


@pytest.mark.parametrize('path,body_for', [('exit/', exit_payload), ('batch-exit/', batch_exit_payload)])
class TestUsersMustExist:
    @pytest.mark.parametrize('field', ['requested_by', 'authorized_by'])
    def test_an_unknown_user_is_a_400(self, client, item, path, body_for, field):
        before = snapshot_database()
        response = client.post(MOVEMENTS + path, body_for(item, **{field: 987654}), format='json')
        assert response.status_code == 400 and field in response.json()['detail']
        assert snapshot_database() == before

    def test_an_existing_user_is_accepted(self, client, item, path, body_for, central_warehouse):
        response = client.post(
            MOVEMENTS + path, body_for(item, requested_by=central_warehouse.pk, authorized_by=central_warehouse.pk),
            format='json',
        )
        assert response.status_code == 201, response.content


# ---------------------------------------------------------------------------
# Código de producto normalizado
# ---------------------------------------------------------------------------

class TestProductCodeNormalization:
    def body(self, **extra):
        return {'product_code': 'EPP000500', 'description': 'CASCO', 'unit': 'EA', **extra}

    def test_the_code_is_stored_stripped_and_upper_case(self, client):
        response = client.post(INVENTORY, self.body(product_code='  epp000500 '), format='json')
        assert response.status_code == 201, response.content
        assert Inventory.objects.get().product_code == 'EPP000500'

    @pytest.mark.parametrize('variant', ['epp000500', ' EPP000500', 'EPP000500 ', ' Epp000500 '])
    def test_a_variant_of_an_existing_code_is_refused_with_a_clear_message(self, client, make_item, variant):
        make_item('EPP000500', 'CASCO')
        response = client.post(INVENTORY, self.body(product_code=variant), format='json')
        assert response.status_code == 400
        assert 'Ya existe un ítem con ese código' in str(response.json()['detail']['product_code'])
        assert Inventory.objects.count() == 1

    def test_the_exact_duplicate_gets_the_same_message(self, client, make_item):
        make_item('EPP000500', 'CASCO')
        response = client.post(INVENTORY, self.body(), format='json')
        assert response.status_code == 400
        assert 'Ya existe un ítem con ese código' in str(response.json()['detail']['product_code'])

    def test_a_legacy_lower_case_code_collides_with_its_normalized_form(self, client):
        Inventory.objects.create(product_code='epp000500', description='LEGADO', unit='EA')
        assert client.post(INVENTORY, self.body(), format='json').status_code == 400

    def test_editing_an_item_does_not_collide_with_itself(self, client, make_item):
        made = make_item('EPP000500', 'CASCO')
        response = client.patch(f'{INVENTORY}{made.pk}/', {'product_code': ' epp000500 ', 'description': 'CASCO 2'}, format='json')
        assert response.status_code == 200, response.content
        made.refresh_from_db()
        assert (made.product_code, made.description) == ('EPP000500', 'CASCO 2')

    def test_renaming_into_another_items_code_is_refused(self, client, make_item):
        make_item('EPP000500', 'CASCO')
        other = make_item('EPP000501', 'OTRO')
        response = client.patch(f'{INVENTORY}{other.pk}/', {'product_code': 'epp000500'}, format='json')
        assert response.status_code == 400
        other.refresh_from_db()
        assert other.product_code == 'EPP000501'

    @pytest.mark.parametrize('blank', ['', '   '])
    def test_a_blank_code_is_refused(self, client, blank):
        assert client.post(INVENTORY, self.body(product_code=blank), format='json').status_code == 400


# ---------------------------------------------------------------------------
# Borrado de ítems
# ---------------------------------------------------------------------------

class TestDeletingItems:
    def test_an_item_with_history_is_a_409_with_the_envelope_and_survives(self, client, item):
        assert client.post(MOVEMENTS + 'exit/', exit_payload(item), format='json').status_code == 201
        response = client.delete(f'{INVENTORY}{item.pk}/')
        body = response.json()
        assert response.status_code == 409
        assert body['error'] is True and body['status_code'] == 409
        assert body['code'] == 'item_has_movements' and 'historial' in body['detail']
        assert Inventory.objects.filter(pk=item.pk).exists()
        assert InventoryStock.objects.filter(inventory=item).exists()          # nothing was half-deleted

    def test_a_second_attempt_answers_the_same(self, client, item):
        client.post(MOVEMENTS + 'exit/', exit_payload(item), format='json')
        assert client.delete(f'{INVENTORY}{item.pk}/').status_code == 409
        assert client.delete(f'{INVENTORY}{item.pk}/').status_code == 409

    def test_an_item_without_history_is_still_deleted(self, client, make_item):
        fresh = make_item('EPP000800', 'SIN HISTORIA', stock=1)
        assert client.delete(f'{INVENTORY}{fresh.pk}/').status_code == 204
        assert not Inventory.objects.filter(pk=fresh.pk).exists()


# ---------------------------------------------------------------------------
# Parámetros de consulta
# ---------------------------------------------------------------------------

class TestQueryParameters:
    @pytest.mark.parametrize('params', [
        {'project': 'abc'}, {'project': '-1'}, {'project': '0'}, {'project': '9' * 30}, {'project': '1.5'},
        {'qty_min': 'abc'}, {'qty_max': 'abc'}, {'qty_min': 'nan'}, {'qty_max': 'inf'}, {'qty_max': '1e999'},
        {'qty_min': '1' + '0' * 30}, {'qty_min': '١٢٣x'}, {'destination_personal': 'abc'},
        {'destination_personal': '9' * 30},
    ], ids=lambda p: str(p)[:50])
    @pytest.mark.parametrize('path', ['movements/', 'movements/export/'])
    def test_junk_is_a_400_with_the_envelope(self, client, item, path, params):
        response = client.get('/api/v1/warehouse/' + path, params)
        assert response.status_code == 400, (params, response.status_code)
        body = response.json()
        assert body['error'] is True and body['status_code'] == 400 and next(iter(params)) in body['detail']

    def test_valid_filters_still_filter(self, client, item, project):
        client.post(MOVEMENTS + 'entry/', entry_payload(item, quantity='5'), format='json')
        client.post(MOVEMENTS + 'entry/', entry_payload(item, quantity='2', project=project.pk), format='json')
        listed = lambda **p: client.get(MOVEMENTS, {'no_page': 'true', **p}).json()      # noqa: E731
        assert len(listed()) == 2
        assert [Decimal(str(m['quantity'])) for m in listed(qty_min='3')] == [Decimal('5')]
        assert [Decimal(str(m['quantity'])) for m in listed(qty_max='3')] == [Decimal('2')]
        assert len(listed(qty_min='2', qty_max='5')) == 2
        assert len(listed(project=str(project.pk))) == 1
        assert listed(project='999999') == []

    def test_the_largest_quantity_the_column_holds_is_a_valid_bound(self, client, item):
        client.post(MOVEMENTS + 'entry/', entry_payload(item), format='json')
        assert client.get(MOVEMENTS, {'qty_max': '999999999.999'}).status_code == 200

    def test_an_absurd_catalog_project_filter_is_ignored_not_a_crash(self, client, item):
        assert client.get(INVENTORY, {'project': '9' * 30}).status_code == 200
        assert client.get(INVENTORY + 'movement-summary/', {'project': '9' * 30}).status_code == 200


# ---------------------------------------------------------------------------
# Numeración más allá de 9 999
# ---------------------------------------------------------------------------

class TestNumberingPast9999:
    def test_entry_group_numbers_keep_growing(self, central_warehouse, item):
        year = timezone.now().year
        for number in (9998, 9999, 10000, 10001):
            MovementGroup.objects.create(
                group_number=f'ENT-{year}-G{number}', movement_type='ENTRY', warehouse='CENTRAL',
                registered_by=central_warehouse,
            )
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='', invoice_number='', notes='', registered_by=central_warehouse,
        )
        assert group.group_number == f'ENT-{year}-G10002'

    def test_numbers_stay_zero_padded_below_that(self, central_warehouse, item):
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='', invoice_number='', notes='', registered_by=central_warehouse,
        )
        assert group.group_number == f'ENT-{timezone.now().year}-G0001'

    def test_adjustment_numbers_keep_growing_too(self, central_warehouse, item):
        year = timezone.now().year
        for number in (9999, 10000):
            InventoryMovement.objects.create(
                movement_number=f'AJU-{year}-{number}', movement_type='ADJUSTMENT', inventory=item,
                quantity=Decimal('1'), warehouse='CENTRAL', registered_by=central_warehouse,
            )
        assert svc._generate_movement_number('ADJUSTMENT') == f'AJU-{year}-10001'

    def test_a_consecutive_registration_after_the_rollover_does_not_collide(self, client, central_warehouse, item):
        year = timezone.now().year
        MovementGroup.objects.create(
            group_number=f'SAL-{year}-G9999', movement_type='EXIT', warehouse='CENTRAL', registered_by=central_warehouse,
        )
        first = client.post(MOVEMENTS + 'batch-exit/', batch_exit_payload(item), format='json').json()
        second = client.post(MOVEMENTS + 'batch-exit/', batch_exit_payload(item), format='json').json()
        assert (first['group_number'], second['group_number']) == (f'SAL-{year}-G10000', f'SAL-{year}-G10001')


# ---------------------------------------------------------------------------
# N° de vale: mayúsculas y minúsculas son el mismo vale
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('path,body_for', [('batch-exit/', batch_exit_payload), ('exit/', exit_payload)])
def test_the_duplicate_vale_check_ignores_case_and_surrounding_spaces(client, item, path, body_for):
    assert client.post(MOVEMENTS + path, body_for(item, voucher_number='S-12'), format='json').status_code == 201
    for variant in ('s-12', ' S-12 ', 's-12 '):
        response = client.post(MOVEMENTS + path, body_for(item, voucher_number=variant), format='json')
        assert response.status_code == 409 and response.json()['code'] == 'voucher_number_exists', variant
    allowed = client.post(MOVEMENTS + path, body_for(item, voucher_number='s-12', allow_duplicate_voucher=True), format='json')
    assert allowed.status_code == 201


def test_a_vale_is_unique_per_warehouse_and_only_among_exits(client, item):
    InventoryStock.objects.create(inventory=item, warehouse_type='SITE', quantity=5)
    assert client.post(MOVEMENTS + 'batch-exit/', batch_exit_payload(item, voucher_number='S-1'), format='json').status_code == 201
    other_warehouse = batch_exit_payload(item, voucher_number='s-1', warehouse='SITE')
    assert client.post(MOVEMENTS + 'batch-exit/', other_warehouse, format='json').status_code == 201


# ---------------------------------------------------------------------------
# Búsqueda de trabajadores
# ---------------------------------------------------------------------------

class TestWorkerLookup:
    @pytest.fixture(autouse=True)
    def _staff(self, make_personal):
        make_personal('Li Wu, Ana Prueba')
        make_personal('Quispe Mamani, Rosa Prueba')

    @pytest.mark.parametrize('query', ['...', '---', '%%%', '___', ' .. . ', 'a.b', 'ab ', '!?"', '🙂🙂🙂'])
    def test_a_search_without_three_letters_or_digits_is_a_400(self, central_warehouse, query):
        response = client_for(central_warehouse).get(LOOKUP, {'search': query})
        assert response.status_code == 400, query
        assert 'letras o números' in response.json()['detail']

    @pytest.mark.parametrize('query', ['li w', 'LI WU', 'wu li', 'quispe', 'Ros', 'q.m.r'])
    def test_short_words_still_find_workers_when_there_are_three_letters_in_total(self, central_warehouse, query):
        rows = client_for(central_warehouse).get(LOOKUP, {'search': query}).json()
        assert rows, query

    def test_the_answer_is_never_cached(self, central_warehouse):
        assert client_for(central_warehouse).get(LOOKUP, {'search': 'quispe'})['Cache-Control'] == 'no-store'

    @pytest.mark.parametrize('role', [
        RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.REQUESTER,
        RoleChoices.HR_MANAGER, RoleChoices.GENERAL_MANAGER,
    ])
    def test_roles_without_a_screen_for_it_get_403(self, role):
        user = make_user(f'lk_{role.lower()}', role)
        response = client_for(user).get(LOOKUP, {'search': 'quispe'})
        assert response.status_code == 403 and 'Quispe' not in response.content.decode()

    def test_a_superuser_without_a_role_has_no_bypass(self, superuser):
        assert client_for(superuser).get(LOOKUP, {'search': 'quispe'}).status_code == 403


# ---------------------------------------------------------------------------
# Importaciones: los nombres solo para quien vincula destinos
# ---------------------------------------------------------------------------

class TestImportDetailNames:
    @pytest.fixture(autouse=True)
    def _isolated(self, import_throttle_isolated):
        yield

    @pytest.fixture
    def preview(self, central_warehouse):
        response = upload(tolerant_client(central_warehouse), standard_workbook())
        assert response.status_code == 201, response.content
        return response.json()

    def test_the_uploader_sees_the_unmatched_destinations(self, preview):
        assert WORKER_A in {d['display'] for d in preview['unmatched_destinations']}

    @pytest.mark.parametrize('role', [RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.LOGISTICS_CHIEF])
    def test_the_import_roles_see_them_when_they_reopen_the_import(self, preview, role):
        user = make_user(f'idn_{role.lower()}', role)
        body = tolerant_client(user).get(f"/api/v1/warehouse/imports/{preview['id']}/").json()
        assert WORKER_A in {d['display'] for d in body['unmatched_destinations']}

    @pytest.mark.parametrize('role', [
        RoleChoices.SITE_WAREHOUSE, RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.LOGISTICS_SUPERVISOR,
    ])
    def test_the_other_warehouse_roles_read_the_import_without_names(self, preview, role):
        user = make_user(f'idn_{role.lower()}', role)
        response = tolerant_client(user).get(f"/api/v1/warehouse/imports/{preview['id']}/")
        assert response.status_code == 200
        body = response.json()
        assert body['unmatched_destinations'] == []
        assert WORKER_A not in response.content.decode()
        assert body['summary']['counts'] and body['status'] == 'PREVIEWED'          # the rest is intact

    def test_the_confirmation_response_keeps_them_for_the_confirming_role(self, central_warehouse, preview):
        response = confirm(tolerant_client(central_warehouse), preview)
        assert response.status_code == 200, response.content
        assert response.json()['status'] == 'CONFIRMED'
