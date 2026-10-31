"""
SYSPCC-025 (seguridad, ronda 1) — alcance por rol de los endpoints de movimiento y del catálogo.

Hallazgos cerrados aquí:

* El estrechamiento de ``epp-delivery`` era cosmético: ``batch-exit`` / ``exit`` aceptaban la misma carga
  (destino trabajador) de los 5 roles y de cualquier almacén. Ahora un único criterio rige para
  ``entry``, ``exit``, ``batch-entry``, ``batch-exit`` y ``epp-delivery``:
    - ``SITE_WAREHOUSE`` solo opera el almacén de obra;
    - entregar a un trabajador (EMPLOYEE) o a otro piso (TRANSFER_OUT) es trabajo de mostrador de
      Almacén Central / Almacén de Obra (``CanDeliverEPP``), nunca de los roles de logística.
* ``PATCH inventory/{id}/`` con ``location`` / ``floor`` / ``project`` eludía ``CanAssignLocations``.

El resultado esperado se escribe aquí como tabla, independiente del código de producción.
"""
import itertools
from unittest import mock

import pytest
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.core.models import UserRole
from apps.warehouse.models import Inventory, InventoryStock, MovementGroup

from .conftest import make_user
from .qa_support import INVENTORY, MOVEMENTS, snapshot_database, tolerant_client

pytestmark = pytest.mark.django_db

CENTRAL = RoleChoices.CENTRAL_WAREHOUSE
SITE = RoleChoices.SITE_WAREHOUSE
COORD = RoleChoices.LOGISTICS_COORDINATOR
SUPERV = RoleChoices.LOGISTICS_SUPERVISOR
CHIEF = RoleChoices.LOGISTICS_CHIEF
WAREHOUSE_ROLES = [CENTRAL, SITE, COORD, SUPERV, CHIEF]
LOGISTICS_ROLES = [COORD, SUPERV, CHIEF]

WAREHOUSES = ['CENTRAL', 'SITE', 'OFFICE']
NON_PERSON_DESTINATIONS = ['PROJECT', 'DEPARTMENT', 'ADJUSTMENT']
PERSON_DESTINATIONS = ['EMPLOYEE', 'TRANSFER_OUT']


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def item(make_item):
    made = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)
    for warehouse in ('SITE', 'OFFICE'):
        InventoryStock.objects.create(inventory=made, warehouse_type=warehouse, quantity=10)
    return made


def expected_status(roles, warehouse, *, person_destination):
    """403 or 'allowed' for a user holding ``roles`` (independent of the production helper)."""
    roles = set(roles)
    if person_destination:
        if not roles & {CENTRAL, SITE}:
            return 403
        if warehouse != 'SITE' and CENTRAL not in roles:
            return 403
        return 'allowed'
    if warehouse != 'SITE' and not roles & {CENTRAL, COORD, SUPERV, CHIEF}:
        return 403
    return 'allowed'


def entry_body(item, warehouse):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': warehouse, 'source_type': 'PURCHASE'}


def batch_entry_body(item, warehouse):
    return {'items': [{'inventory': item.pk, 'quantity': 1}], 'warehouse': warehouse, 'source_type': 'PURCHASE'}


def exit_body(item, warehouse, destination_type='PROJECT'):
    return {'inventory': item.pk, 'quantity': 1, 'warehouse': warehouse,
            'destination_type': destination_type, 'destination_detail': 'Destino Prueba'}


def batch_exit_body(item, warehouse, destination_type='PROJECT'):
    return {'items': [{'inventory': item.pk, 'quantity': 1}], 'warehouse': warehouse,
            'destination_type': destination_type, 'destination_detail': 'Destino Prueba'}


def epp_body(item, warehouse):
    return {'warehouse': warehouse, 'voucher_number': f'V-{warehouse}-{timezone.now().timestamp()}',
            'movement_date': timezone.localdate().isoformat(), 'recipient': {'name': 'Persona Prueba'},
            'items': [{'inventory': item.pk, 'quantity': 1}]}


def assert_outcome(response, expected, before):
    if expected == 403:
        assert response.status_code == 403, (response.status_code, response.content)
        assert snapshot_database() == before                     # a rejected request leaves no trace
    else:
        assert response.status_code in (200, 201), (response.status_code, response.content)


# ---------------------------------------------------------------------------
# Entradas: SITE_WAREHOUSE solo el almacén de obra
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('path,body_for', [
    ('entry/', entry_body), ('batch-entry/', batch_entry_body),
], ids=['entry', 'batch-entry'])
@pytest.mark.parametrize('warehouse', WAREHOUSES)
@pytest.mark.parametrize('role', WAREHOUSE_ROLES)
def test_entries_the_site_warehouse_role_only_operates_the_site_warehouse(role, warehouse, path, body_for, item):
    user = make_user(f'e_{role.lower()}', role)
    before = snapshot_database()
    response = tolerant_client(user).post(MOVEMENTS + path, body_for(item, warehouse), format='json')
    assert_outcome(response, expected_status([role], warehouse, person_destination=False), before)


# ---------------------------------------------------------------------------
# Salidas: alcance por almacén y por tipo de destino
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('path,body_for', [
    ('exit/', exit_body), ('batch-exit/', batch_exit_body),
], ids=['exit', 'batch-exit'])
@pytest.mark.parametrize('destination', NON_PERSON_DESTINATIONS + PERSON_DESTINATIONS)
@pytest.mark.parametrize('warehouse', WAREHOUSES)
@pytest.mark.parametrize('role', WAREHOUSE_ROLES)
def test_exits_follow_the_scope_table(role, warehouse, destination, path, body_for, item):
    user = make_user(f'x_{role.lower()}', role)
    before = snapshot_database()
    response = tolerant_client(user).post(
        MOVEMENTS + path, body_for(item, warehouse, destination), format='json',
    )
    expected = expected_status([role], warehouse, person_destination=destination in PERSON_DESTINATIONS)
    assert_outcome(response, expected, before)


@pytest.mark.parametrize('role', LOGISTICS_ROLES)
def test_logistics_roles_cannot_hand_material_to_a_worker_through_batch_exit(role, item):
    """El caso del hallazgo: 403 en epp-delivery pero 201 en batch-exit con destino EMPLOYEE."""
    client = tolerant_client(make_user(f'lw_{role.lower()}', role))
    before = snapshot_database()
    assert client.post(MOVEMENTS + 'epp-delivery/', epp_body(item, 'CENTRAL'), format='json').status_code == 403
    assert client.post(
        MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'CENTRAL', 'EMPLOYEE'), format='json',
    ).status_code == 403
    assert snapshot_database() == before and not MovementGroup.objects.exists()


@pytest.mark.parametrize('role', LOGISTICS_ROLES)
def test_logistics_roles_keep_their_project_and_department_exits(role, item):
    client = tolerant_client(make_user(f'lp_{role.lower()}', role))
    for destination in ('PROJECT', 'DEPARTMENT'):
        response = client.post(
            MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'CENTRAL', destination), format='json',
        )
        assert response.status_code == 201, (destination, response.content)


@pytest.mark.parametrize('role', LOGISTICS_ROLES)
def test_a_linked_worker_on_a_non_person_destination_is_still_a_delivery_to_a_person(role, item, make_personal):
    worker = make_personal()
    body = batch_exit_body(item, 'CENTRAL', 'PROJECT') | {'destination_personal': worker.pk}
    before = snapshot_database()
    response = tolerant_client(make_user(f'ld_{role.lower()}', role)).post(
        MOVEMENTS + 'batch-exit/', body, format='json',
    )
    assert response.status_code == 403
    assert snapshot_database() == before


@pytest.mark.parametrize('warehouse', WAREHOUSES)
@pytest.mark.parametrize('role', WAREHOUSE_ROLES)
def test_epp_delivery_follows_the_same_table(role, warehouse, item):
    user = make_user(f'ep_{role.lower()}', role)
    before = snapshot_database()
    response = tolerant_client(user).post(MOVEMENTS + 'epp-delivery/', epp_body(item, warehouse), format='json')
    expected = expected_status([role], warehouse, person_destination=True)
    if expected == 403:
        assert response.status_code == 403
        assert snapshot_database() == before
    else:
        assert response.status_code == 201, response.content


# ---------------------------------------------------------------------------
# Usuarios con varios roles y sin bypass
# ---------------------------------------------------------------------------

def with_extra_role(user, role):
    UserRole.objects.create(user=user, role=role, is_primary=False)
    return user


@pytest.mark.parametrize('extra', [COORD, SUPERV, CHIEF])
def test_site_plus_logistics_may_enter_central_stock_but_not_hand_it_to_a_person(extra, item):
    user = with_extra_role(make_user(f'multi_{extra.lower()}', SITE), extra)
    client = tolerant_client(user)
    assert client.post(MOVEMENTS + 'entry/', entry_body(item, 'CENTRAL'), format='json').status_code == 201
    assert client.post(MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'CENTRAL', 'PROJECT'), format='json').status_code == 201
    assert client.post(MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'CENTRAL', 'EMPLOYEE'), format='json').status_code == 403
    assert client.post(MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'SITE', 'EMPLOYEE'), format='json').status_code == 201


def test_central_plus_site_hands_out_from_any_warehouse(item):
    user = with_extra_role(make_user('multi_central_site', CENTRAL), SITE)
    client = tolerant_client(user)
    for warehouse, destination in itertools.product(WAREHOUSES, PERSON_DESTINATIONS):
        assert client.post(
            MOVEMENTS + 'batch-exit/', batch_exit_body(item, warehouse, destination), format='json',
        ).status_code == 201, (warehouse, destination)


@pytest.mark.parametrize('path,body_for', [
    ('entry/', lambda i: entry_body(i, 'SITE')), ('batch-entry/', lambda i: batch_entry_body(i, 'SITE')),
    ('exit/', lambda i: exit_body(i, 'SITE', 'EMPLOYEE')), ('batch-exit/', lambda i: batch_exit_body(i, 'SITE', 'EMPLOYEE')),
])
def test_a_superuser_without_a_warehouse_role_has_no_bypass(path, body_for, item, superuser):
    assert tolerant_client(superuser).post(MOVEMENTS + path, body_for(item), format='json').status_code == 403


def test_the_denial_uses_the_project_error_envelope_and_is_logged_without_names(item, app_logs):
    client = tolerant_client(make_user('env_coord', COORD))
    response = client.post(MOVEMENTS + 'batch-exit/', batch_exit_body(item, 'CENTRAL', 'EMPLOYEE'), format='json')
    body = response.json()
    assert response.status_code == 403
    assert body['error'] is True and body['status_code'] == 403 and 'trabajadores' in body['detail']
    assert 'warehouse.movement.scope_denied' in app_logs.events()
    assert 'Destino Prueba' not in app_logs.dump()


# ---------------------------------------------------------------------------
# Catálogo: ubicación / piso / proyecto solo con CanAssignLocations
# ---------------------------------------------------------------------------

@pytest.fixture
def catalog_item(make_item):
    return make_item('EPP000010', 'CASCO T: M', 'EA', location='A1-1', floor=1)


@pytest.fixture
def project():
    from apps.core.models import Project
    return Project.objects.create(code='PRY-ESC-1', name='Proyecto Escala')


@pytest.fixture
def floor_only_item(make_item):
    """'Pendiente de ubicar': solo el piso (como los 254 ítems del libro real)."""
    return make_item('EPP000011', 'GUANTE T: L', 'EA', floor=2)


@pytest.mark.parametrize('payload', [{'location': 'B3-2'}, {'location': ''}], ids=lambda p: str(p))
@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_roles_without_assign_locations_cannot_change_the_location_through_patch(role, payload, catalog_item):
    client = tolerant_client(make_user(f'cp_{role.lower()}', role))
    response = client.patch(f'{INVENTORY}{catalog_item.pk}/', payload, format='json')
    assert response.status_code == 403, (response.status_code, response.content)
    catalog_item.refresh_from_db()
    assert (catalog_item.location, catalog_item.floor) == ('A1-1', 1)


@pytest.mark.parametrize('payload', [{'floor': 1}, {'floor': None}], ids=lambda p: str(p))
@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_nor_the_floor(role, payload, floor_only_item):
    client = tolerant_client(make_user(f'cf_{role.lower()}', role))
    response = client.patch(f'{INVENTORY}{floor_only_item.pk}/', payload, format='json')
    assert response.status_code == 403, (response.status_code, response.content)
    floor_only_item.refresh_from_db()
    assert floor_only_item.floor == 2


@pytest.mark.parametrize('role', [CENTRAL, CHIEF])
def test_the_roles_with_assign_locations_change_the_floor_too(role, floor_only_item):
    client = tolerant_client(make_user(f'cg_{role.lower()}', role))
    assert client.patch(f'{INVENTORY}{floor_only_item.pk}/', {'floor': 1}, format='json').status_code == 200
    floor_only_item.refresh_from_db()
    assert floor_only_item.floor == 1


@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_nor_the_project_attribute(role, catalog_item, project):
    client = tolerant_client(make_user(f'pp_{role.lower()}', role))
    response = client.patch(f'{INVENTORY}{catalog_item.pk}/', {'project': project.pk}, format='json')
    assert response.status_code == 403
    catalog_item.refresh_from_db()
    assert catalog_item.project_id is None


@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_nor_through_put_with_changed_values(role, catalog_item):
    client = tolerant_client(make_user(f'pu_{role.lower()}', role))
    body = {'product_code': 'EPP000010', 'description': 'CASCO T: M', 'unit': 'EA', 'location': 'C2-1'}
    assert client.put(f'{INVENTORY}{catalog_item.pk}/', body, format='json').status_code == 403
    catalog_item.refresh_from_db()
    assert catalog_item.location == 'A1-1'


@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_nor_when_creating_an_item_with_a_location(role):
    client = tolerant_client(make_user(f'pc_{role.lower()}', role))
    body = {'product_code': 'EPP000777', 'description': 'NUEVO', 'unit': 'EA', 'location': 'A1-1'}
    assert client.post(INVENTORY, body, format='json').status_code == 403
    assert not Inventory.objects.filter(product_code='EPP000777').exists()


@pytest.mark.parametrize('role', [SITE, COORD, SUPERV])
def test_those_roles_still_edit_every_other_field_and_resend_the_current_values(role, catalog_item):
    client = tolerant_client(make_user(f'po_{role.lower()}', role))
    same = {'description': 'CASCO T: M (nuevo)', 'location': 'A1-1', 'floor': 1, 'project': None}
    response = client.patch(f'{INVENTORY}{catalog_item.pk}/', same, format='json')
    assert response.status_code == 200, response.content
    catalog_item.refresh_from_db()
    assert (catalog_item.description, catalog_item.location, catalog_item.floor) == ('CASCO T: M (nuevo)', 'A1-1', 1)
    created = client.post(INVENTORY, {'product_code': 'EPP000778', 'description': 'SIN UBICAR', 'unit': 'EA'}, format='json')
    assert created.status_code == 201, created.content


@pytest.mark.parametrize('role', [CENTRAL, CHIEF])
def test_the_roles_with_assign_locations_still_change_them(role, catalog_item, project):
    client = tolerant_client(make_user(f'pa_{role.lower()}', role))
    response = client.patch(
        f'{INVENTORY}{catalog_item.pk}/', {'location': 'B3-2', 'project': project.pk}, format='json',
    )
    assert response.status_code == 200, response.content
    catalog_item.refresh_from_db()
    assert (catalog_item.location, catalog_item.project_id) == ('B3-2', project.pk)


def test_assign_locations_stays_closed_to_the_same_roles(catalog_item):
    """Control: el endpoint dedicado y el CRUD genérico ahora dicen lo mismo."""
    for role in (SITE, COORD, SUPERV):
        client = tolerant_client(make_user(f'pz_{role.lower()}', role))
        body = {'assignments': [{'inventory': catalog_item.pk, 'location': 'B3-2'}]}
        assert client.post(f'{INVENTORY}assign-locations/', body, format='json').status_code == 403
