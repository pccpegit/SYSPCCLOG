"""RBAC matrix for EVERY route of /api/v1/hr/ (SYSPCC-022, FASE 4).

Rows: routes. Columns: actors. The permission layer runs before any lookup or
validation, so for actors without access the expected code is the same whether
or not the object exists.

Contract (decision of the user, FASE 0):
- anonymous                          -> 401 on every route
- HR_MANAGER                         -> full access
- GENERAL_MANAGER                    -> read-only (R routes), 403 on M routes
- everyone else (no role, REQUESTER, ADMIN_MANAGER, PASAJES_MANAGER, staff and
  superuser WITHOUT the HR role)     -> 403 on every route (no staff bypass)
"""

import pytest
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.core.models import Personal, UserRole
from apps.hr.tests.conftest import client_for
from apps.hr.tests.test_documents import URL as DOCS, create_draft

pytestmark = pytest.mark.django_db

BASE = '/api/v1/hr/'
R, M = 'reader', 'manager'

# (id, method, path template, body, access class, HR_MANAGER expected status)
# Placeholders: {t} template id, {d} document id, {p} personal id.
ROUTES = [
    ('document-types', 'get', 'document-types/', None, R, 200),
    ('personal-search', 'get', 'personal/?search=ab', None, M, 200),
    ('personal-prefill', 'get', 'personal/{p}/prefill/', None, M, 200),
    ('assistant-status', 'get', 'assistant/status/', None, R, 200),
    ('assistant-extract', 'post', 'assistant/extract/',
     {'document_type': 'CONTRACT', 'text': 'contrato para Ana'}, M, 503),
    ('templates-list', 'get', 'templates/', None, R, 200),
    ('templates-create', 'post', 'templates/', {}, M, 400),
    ('templates-retrieve', 'get', 'templates/{t}/', None, R, 200),
    ('templates-patch', 'patch', 'templates/{t}/', {'name': 'Nuevo nombre'}, M, 200),
    ('templates-activate', 'post', 'templates/{t}/activate/', {}, M, 200),
    ('templates-deactivate', 'post', 'templates/{t}/deactivate/', {}, M, 200),
    ('templates-download', 'get', 'templates/{t}/download/', None, M, 200),
    ('templates-delete', 'delete', 'templates/{t}/', None, M, 409),  # active template
    ('documents-list', 'get', 'documents/', None, R, 200),
    ('documents-create', 'post', 'documents/', {'document_type': 'CONTRACT', 'template_id': 0, 'data': {}}, M, 400),
    ('documents-retrieve', 'get', 'documents/{d}/', None, R, 200),
    ('documents-patch', 'patch', 'documents/{d}/', {'data': {'position': 'Jefa'}}, M, 200),
    ('documents-delete', 'delete', 'documents/{d}/', None, M, 204),
    ('documents-issue', 'post', 'documents/{d}/issue/', {}, M, 200),
    ('documents-void', 'post', 'documents/{d}/void/', {'reason': 'corto'}, M, 400),
    ('documents-render-pdf', 'post', 'documents/{d}/render-pdf/', {}, M, 501),
    ('documents-download', 'get', 'documents/{d}/download/', None, R, 200),
    ('documents-events', 'get', 'documents/{d}/events/', None, R, 200),
]
ROUTE_IDS = [r[0] for r in ROUTES]

ACTORS = [
    'anonymous', 'no_role', 'requester', 'admin_manager', 'pasajes_manager',
    'staff_no_role', 'superuser_no_role', 'general_manager', 'hr_manager',
]


@pytest.fixture
def world(hr_manager, active_template, contract_data, hr_client):
    """One template, one draft and one worker shared by every cell."""
    doc_id = create_draft(hr_client, active_template, contract_data).data['id']
    personal = Personal.objects.create(dni='44556677', apellidos_nombres='RAMOS DIAZ, LUIS', puesto='Maestro')
    return {'t': active_template.pk, 'd': doc_id, 'p': personal.pk}


def actor_client(name, request):
    if name == 'anonymous':
        return APIClient()
    fixture = {
        'no_role': 'user', 'requester': 'requester', 'admin_manager': 'admin_manager',
        'pasajes_manager': 'pasajes_manager', 'staff_no_role': 'staff_user',
        'superuser_no_role': 'superuser', 'general_manager': 'general_manager',
        'hr_manager': 'hr_manager',
    }[name]
    return client_for(request.getfixturevalue(fixture))


def expected_status(actor, access, hr_status):
    if actor == 'anonymous':
        return 401
    if actor == 'hr_manager':
        return hr_status
    if actor == 'general_manager' and access == R:
        return hr_status
    return 403


@pytest.mark.parametrize('actor', ACTORS)
@pytest.mark.parametrize('route', ROUTES, ids=ROUTE_IDS)
def test_rbac_matrix(route, actor, world, request):
    _id, method, path, body, access, hr_status = route
    client = actor_client(actor, request)
    url = BASE + path.format(**world)
    kwargs = {'format': 'json'} if body is not None else {}
    response = getattr(client, method)(url, *( [body] if body is not None else [] ), **kwargs)
    assert response.status_code == expected_status(actor, access, hr_status), (
        f'{actor} {method.upper()} {path}: {response.status_code} {getattr(response, "data", "")}'
    )


@pytest.mark.parametrize('actor', ['anonymous', 'no_role', 'admin_manager', 'general_manager'])
@pytest.mark.parametrize('route', ROUTES, ids=ROUTE_IDS)
def test_denied_actors_get_the_same_code_for_nonexistent_objects(route, actor, world, request):
    """No object-existence oracle: 401/403 do not depend on whether the id exists."""
    _id, method, path, body, access, _hr = route
    if actor == 'general_manager' and access == R:
        pytest.skip('GM is allowed on R routes (404 is legitimate there)')
    ghost = {'t': 999999, 'd': 999999, 'p': 999999}
    client = actor_client(actor, request)
    url = BASE + path.format(**ghost)
    kwargs = {'format': 'json'} if body is not None else {}
    response = getattr(client, method)(url, *([body] if body is not None else []), **kwargs)
    assert response.status_code == (401 if actor == 'anonymous' else 403)


@pytest.mark.parametrize('route', ROUTES, ids=ROUTE_IDS)
def test_hr_manager_gets_404_not_403_on_nonexistent_objects(route, hr_client):
    """For the authorised role a missing id is a clean 404 (never a 500)."""
    _id, method, path, body, _access, _hr = route
    if '{t}' not in path and '{d}' not in path and '{p}' not in path:
        pytest.skip('route has no object id')
    url = BASE + path.format(t=999999, d=999999, p=999999)
    kwargs = {'format': 'json'} if body is not None else {}
    response = getattr(hr_client, method)(url, *([body] if body is not None else []), **kwargs)
    assert response.status_code == 404, f'{method.upper()} {path}: {response.status_code}'


class TestRoleCombinations:
    def test_superuser_with_hr_role_is_allowed(self, superuser):
        UserRole.objects.create(user=superuser, role=RoleChoices.HR_MANAGER, is_primary=True)
        assert client_for(superuser).get(DOCS).status_code == 200

    def test_superuser_with_admin_manager_role_is_still_denied(self, superuser):
        UserRole.objects.create(user=superuser, role=RoleChoices.ADMIN_MANAGER, is_primary=True)
        assert client_for(superuser).get(DOCS).status_code == 403

    def test_staff_with_general_manager_role_is_read_only(self, staff_user):
        UserRole.objects.create(user=staff_user, role=RoleChoices.GENERAL_MANAGER, is_primary=True)
        c = client_for(staff_user)
        assert c.get(DOCS).status_code == 200
        assert c.post(DOCS, {}, format='json').status_code == 403

    def test_secondary_hr_role_grants_access(self, requester):
        UserRole.objects.create(user=requester, role=RoleChoices.HR_MANAGER, is_primary=False)
        assert client_for(requester).get(DOCS).status_code == 200

    def test_inactive_user_cannot_authenticate_through_login(self, hr_manager, settings):
        """An inactive HR_MANAGER must not get a session (real login, not force_authenticate)."""
        from django.core.cache import cache

        cache.clear()
        hr_manager.is_active = False
        hr_manager.save()
        resp = APIClient().post(
            '/api/v1/auth/login/', {'username': hr_manager.username, 'password': 'TestPass2026!'}, format='json'
        )
        assert resp.status_code in (400, 401, 403)
        cache.clear()
