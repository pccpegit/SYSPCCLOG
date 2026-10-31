"""SYSPCC-025 — matriz de permisos por rol (sin bypass de superusuario)."""
import pytest

from apps.core.enums import RoleChoices
from .conftest import client_for, make_user

API = '/api/v1/warehouse/'

READ_ENDPOINTS = [
    'inventory/', 'inventory/movement-summary/', 'inventory/movement-summary/export/',
    'inventory/location-layout/', 'inventory/summary/', 'movements/', 'movements/export/',
]

WAREHOUSE_ROLES = [
    RoleChoices.CENTRAL_WAREHOUSE, RoleChoices.SITE_WAREHOUSE, RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.LOGISTICS_CHIEF,
]
OUTSIDE_ROLES = [
    RoleChoices.REQUESTER, RoleChoices.PROJECT_RESIDENT, RoleChoices.PROJECT_CONTROL,
    RoleChoices.GENERAL_MANAGER, RoleChoices.DIRECT_SUPERVISOR, RoleChoices.ADMIN_MANAGER,
    RoleChoices.PASAJES_MANAGER, RoleChoices.HR_MANAGER,
]


@pytest.mark.django_db
@pytest.mark.parametrize('endpoint', READ_ENDPOINTS)
class TestReadAccess:
    @pytest.mark.parametrize('role', WAREHOUSE_ROLES)
    def test_warehouse_and_logistics_roles_can_read(self, endpoint, role):
        user = make_user(f'r_{role.lower()}', role)
        assert client_for(user).get(API + endpoint).status_code == 200

    @pytest.mark.parametrize('role', OUTSIDE_ROLES)
    def test_other_roles_get_403(self, endpoint, role):
        user = make_user(f'o_{role.lower()}', role)
        assert client_for(user).get(API + endpoint).status_code == 403

    def test_superuser_without_warehouse_role_gets_403(self, endpoint, superuser):
        assert client_for(superuser).get(API + endpoint).status_code == 403

    def test_anonymous(self, endpoint, api_client):
        assert api_client.get(API + endpoint).status_code in (401, 403)


@pytest.mark.django_db
class TestAssignLocationsRoles:
    URL = API + 'inventory/assign-locations/'

    @pytest.fixture
    def body(self, make_item):
        return {'assignments': [{'inventory': make_item('EPP1', 'a').pk, 'location': 'A1-1'}]}

    @pytest.mark.parametrize('role,expected', [
        (RoleChoices.CENTRAL_WAREHOUSE, 200), (RoleChoices.LOGISTICS_CHIEF, 200),
        (RoleChoices.SITE_WAREHOUSE, 403), (RoleChoices.LOGISTICS_SUPERVISOR, 403),
        (RoleChoices.LOGISTICS_COORDINATOR, 403), (RoleChoices.REQUESTER, 403),
    ])
    def test_matrix(self, body, role, expected):
        user = make_user(f'al_{role.lower()}', role)
        assert client_for(user).post(self.URL, body, format='json').status_code == expected

    def test_superuser_has_no_bypass(self, body, superuser):
        assert client_for(superuser).post(self.URL, body, format='json').status_code == 403
