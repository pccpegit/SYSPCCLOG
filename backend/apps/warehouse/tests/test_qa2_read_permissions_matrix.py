"""
SYSPCC-025 · QA ronda 2 — matriz de LECTURA por rol para los endpoints que la ronda 1 no cruzó.

La ronda 1 cruzó los 13 roles con las escrituras y con 7 lecturas del tablero. Quedaban sin matriz el
kardex, los vales (JSON y PDF), la búsqueda de trabajadores, los avisos, la cola de RQ pendientes y las
lecturas del importador. La tabla de resultados esperados se escribe aquí, independiente del código de
producción: los 5 roles de almacén/logística leen; solo Almacén Central, Almacén de Obra y Jefe
Logístico buscan trabajadores; el superusuario sin rol no tiene atajo; sin sesión es 401.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.core.models import UserRole
from apps.warehouse.services import movements as svc

from .conftest import client_for
from .import_workbooks import standard_workbook
from .qa_support import upload

pytestmark = pytest.mark.django_db

API = '/api/v1/warehouse/'
User = get_user_model()
ALL_ROLES = list(RoleChoices.values)
WAREHOUSE_ROLES = {
    RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.SITE_WAREHOUSE, RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.LOGISTICS_CHIEF,
}
LOOKUP_ROLES = {RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.SITE_WAREHOUSE, RoleChoices.LOGISTICS_CHIEF}
IMPORTER_ROLES = {RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.LOGISTICS_CHIEF}


def make_user(username, role):
    """A user with one role and no usable password (hashing a password costs ~0.2 s and is irrelevant here)."""
    user = User.objects.create(username=username, email=f'{username}@test.com')
    user.set_unusable_password()
    user.save(update_fields=['password'])
    UserRole.objects.create(user=user, role=role, is_primary=True)
    return user


@pytest.fixture
def world(make_item, make_personal):
    """An item with history, a vale, a worker and one previewed workbook."""
    central_warehouse = make_user('world_owner', RoleChoices.CENTRAL_WAREHOUSE)
    item = make_item('EPP000001', 'GUANTE DE CUERO T: L', 'EA', stock=10)
    make_personal('Quispe Mamani, Rosa Test')
    group = svc.register_exit_batch(
        items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=central_warehouse, voucher_number='V-1')
    preview = upload(client_for(central_warehouse), standard_workbook())
    assert preview.status_code == 201, preview.content
    return {
        'item': item.pk, 'movement': group.movements.get().pk, 'group': group.pk, 'import': preview.json()['id'],
    }


def endpoints(world):
    """(label, url, roles allowed to read it)."""
    return [
        ('kardex', f"inventory/{world['item']}/kardex/", WAREHOUSE_ROLES),
        ('recent-movements', f"inventory/{world['item']}/recent-movements/", WAREHOUSE_ROLES),
        ('categories', 'inventory/categories/', WAREHOUSE_ROLES),
        ('alerts', 'inventory/alerts/', WAREHOUSE_ROLES),
        ('check-stock', 'inventory/check-stock/?descriptions=guante', WAREHOUSE_ROLES),
        ('voucher', f"movements/{world['movement']}/voucher/", WAREHOUSE_ROLES),
        ('movement-pdf', f"movements/{world['movement']}/pdf/", WAREHOUSE_ROLES),
        ('group-voucher', f"movements/groups/{world['group']}/voucher/", WAREHOUSE_ROLES),
        ('group-pdf', f"movements/groups/{world['group']}/pdf/", WAREHOUSE_ROLES),
        ('pending-list', 'pending-requests/list/', WAREHOUSE_ROLES),
        ('pending-count', 'pending-requests/count/', WAREHOUSE_ROLES),
        ('personal-lookup', 'personal-lookup/?search=rosa', LOOKUP_ROLES),
        ('imports-history', 'imports/', WAREHOUSE_ROLES),
        ('imports-template', 'imports/template/', WAREHOUSE_ROLES),
        ('imports-detail', f"imports/{world['import']}/", WAREHOUSE_ROLES),
        ('imports-problems', f"imports/{world['import']}/problems/", WAREHOUSE_ROLES),
        ('imports-problems-export', f"imports/{world['import']}/problems/export/", WAREHOUSE_ROLES),
    ]


LABELS = [
    'kardex', 'recent-movements', 'categories', 'alerts', 'check-stock', 'voucher', 'movement-pdf', 'group-voucher',
    'group-pdf', 'pending-list', 'pending-count', 'personal-lookup', 'imports-history', 'imports-template',
    'imports-detail', 'imports-problems', 'imports-problems-export',
]


def _url_and_allowed(world, label):
    for name, url, roles in endpoints(world):
        if name == label:
            return API + url, roles
    raise KeyError(label)


@pytest.mark.parametrize('label', LABELS)
class TestReadMatrix:
    @pytest.mark.parametrize('role', ALL_ROLES)
    def test_each_role_gets_exactly_what_the_table_says(self, world, label, role):
        url, allowed = _url_and_allowed(world, label)
        user = make_user(f'm_{role.lower()}', role)
        response = client_for(user).get(url)
        expected = 200 if role in allowed else 403
        assert response.status_code == expected, (label, role, response.status_code, response.content[:120])

    def test_a_superuser_without_a_warehouse_role_has_no_shortcut(self, world, label, superuser):
        url, _allowed = _url_and_allowed(world, label)
        assert client_for(superuser).get(url).status_code == 403

    def test_a_staff_user_without_a_warehouse_role_has_no_shortcut(self, world, label, staff_user):
        url, _allowed = _url_and_allowed(world, label)
        assert client_for(staff_user).get(url).status_code == 403

    def test_a_user_without_any_role_is_refused(self, world, label, auth_client):
        url, _allowed = _url_and_allowed(world, label)
        assert auth_client.get(url).status_code == 403

    def test_without_a_session_it_is_a_401(self, world, label):
        url, _allowed = _url_and_allowed(world, label)
        assert APIClient().get(url).status_code == 401


class TestWhoSeesWorkerNames:
    """The import detail names the destinations of the exit rows: only the roles that link them see the names."""

    @pytest.mark.parametrize('role', sorted(WAREHOUSE_ROLES))
    def test_the_detail_lists_unmatched_destinations_only_to_the_importing_roles(self, world, role):
        user = make_user(f'n_{role.lower()}', role)
        body = client_for(user).get(f"{API}imports/{world['import']}/").json()
        if role in IMPORTER_ROLES:
            assert body['unmatched_destinations']
        else:
            assert body['unmatched_destinations'] == []

    @pytest.mark.parametrize('role', sorted(WAREHOUSE_ROLES))
    def test_the_history_never_lists_destinations_to_anyone(self, world, role):
        user = make_user(f'h_{role.lower()}', role)
        response = client_for(user).get(f'{API}imports/')
        assert response.status_code == 200
        assert 'Quispe' not in response.content.decode() and 'unmatched_destinations' not in response.content.decode()

    @pytest.mark.parametrize('role', sorted(WAREHOUSE_ROLES - LOOKUP_ROLES))
    def test_roles_without_a_worker_screen_cannot_enumerate_the_staff(self, world, role):
        user = make_user(f'e_{role.lower()}', role)
        response = client_for(user).get(f'{API}personal-lookup/', {'search': 'rosa'})
        assert response.status_code == 403 and 'Quispe' not in response.content.decode()
