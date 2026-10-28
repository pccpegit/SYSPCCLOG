"""
SYSPCC-018 security-auditor hallazgos #1 and #3 — `UserRoleViewSet`.

Hallazgo #1 (critical, escalación de privilegios): before this fix,
`UserRoleViewSet` stayed on `IsAdminOrReadOnly` (`is_staff`), letting any
staff (non-superuser) account grant itself — or anyone else — an arbitrary
business role (e.g. `GENERAL_MANAGER`, which unlocks real cost-overrun
approval power in the `WorkflowEngine`) via `POST /api/v1/user-roles/`,
completely bypassing the `IsSuperUser` gate the rest of this module relies
on. `create`/`destroy` now require `IsSuperUser`; reads stay
`IsAuthenticated`.

Hallazgo #3 (incidental correctness bug, fixed alongside #1):
`filterset_fields` included `'flow'`, a field that does not exist on
`UserRole` — `DjangoFilterBackend.get_filterset_class()` raised `TypeError`
on every read of this endpoint, a 500 for literally everyone, including
superadmins.

Per the security-auditor's explicit instruction in the handoff (FASE 3,
"Para qa-engineer", point 4): every test of THIS endpoint uses a REAL login
(`APIClient(enforce_csrf_checks=True)` + `POST /auth/login/`), not
`force_authenticate` — for pattern-consistency with the rest of this
module's security-focused suite (`test_must_change_password_gate.py`,
`test_csrf_enforcement.py`), even though `force_authenticate` would
technically exercise `get_permissions()`/`has_permission()` identically.
"""

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from apps.core.enums import RoleChoices
from apps.core.models import UserRole
from apps.core.views.user import UserRoleViewSet

LOGIN_URL = '/api/v1/auth/login/'
CSRF_URL = '/api/v1/auth/csrf/'
USER_ROLES_URL = '/api/v1/user-roles/'
USER_PASSWORD = 'TestPass2026!'


@pytest.fixture(autouse=True)
def _reset_login_throttle():
    """See the equivalent fixture in `test_must_change_password_gate.py` —
    real logins here would otherwise accumulate against `LoginRateThrottle`
    across repeated suite runs within the same window."""
    cache.clear()
    yield


def _authenticated_client(actor):
    client = APIClient(enforce_csrf_checks=True)
    csrf_response = client.get(CSRF_URL)
    csrf_token = csrf_response.cookies['csrftoken'].value
    login_response = client.post(
        LOGIN_URL, {'username': actor.username, 'password': USER_PASSWORD}, HTTP_X_CSRFTOKEN=csrf_token
    )
    assert login_response.status_code == status.HTTP_200_OK
    return client, csrf_token


@pytest.mark.django_db
class TestUserRoleCreateRequiresSuperuser:
    def test_anonymous_gets_401(self, api_client, user):
        response = api_client.post(USER_ROLES_URL, {'user': user.id, 'role': RoleChoices.REQUESTER}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_and_nothing_created(self, staff_user, user):
        client, csrf_token = _authenticated_client(staff_user)

        response = client.post(
            USER_ROLES_URL,
            {'user': user.id, 'role': RoleChoices.GENERAL_MANAGER},
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not UserRole.objects.filter(user=user, role=RoleChoices.GENERAL_MANAGER).exists()

    def test_permission_passes_for_superuser(self, superuser):
        """
        A full HTTP round trip is not used for the superuser side of this
        test — `UserRoleSerializer` has a pre-existing, out-of-scope bug
        (hallazgo #4 from the FASE 3 audit) where `user` is missing from
        `Meta.fields`, so even a superuser's POST would hit an unhandled
        `IntegrityError` inside `.save()`, a correctness bug unrelated to
        permissions. Per the security-auditor's own instruction, this
        verifies the permission layer alone: the superuser must clear
        `get_permissions()` for the `create` action. (This check is
        authentication-agnostic by nature — `has_permission()` never calls
        `CookieJWTAuthentication.authenticate()` regardless of how
        `request.user` got set — so real login has nothing to add here; the
        real-login requirement is honored by every other test in this file.)
        """
        factory = APIRequestFactory()
        request = factory.post(USER_ROLES_URL)
        request.user = superuser

        view = UserRoleViewSet()
        view.action = 'create'
        permissions = view.get_permissions()

        assert permissions, 'create debe declarar al menos un permiso'
        assert all(perm.has_permission(request, view) for perm in permissions)


@pytest.mark.django_db
class TestUserRoleDestroyRequiresSuperuser:
    def test_anonymous_gets_401(self, api_client, user, project):
        ur = UserRole.objects.create(user=user, role=RoleChoices.REQUESTER, project=project)
        response = api_client.delete(f'{USER_ROLES_URL}{ur.id}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_and_role_survives(self, staff_user, user, project):
        ur = UserRole.objects.create(user=user, role=RoleChoices.REQUESTER, project=project)
        client, csrf_token = _authenticated_client(staff_user)

        response = client.delete(f'{USER_ROLES_URL}{ur.id}/', HTTP_X_CSRFTOKEN=csrf_token)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert UserRole.objects.filter(pk=ur.pk).exists()

    def test_superuser_gets_204(self, superuser, user, project):
        ur = UserRole.objects.create(user=user, role=RoleChoices.REQUESTER, project=project)
        client, csrf_token = _authenticated_client(superuser)

        response = client.delete(f'{USER_ROLES_URL}{ur.id}/', HTTP_X_CSRFTOKEN=csrf_token)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not UserRole.objects.filter(pk=ur.pk).exists()


@pytest.mark.django_db
class TestUserRoleListRegressionHallazgo3:
    def test_list_no_longer_500s_for_a_regular_authenticated_actor(self, user):
        client, _csrf = _authenticated_client(user)
        response = client.get(USER_ROLES_URL)
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data

    def test_list_no_longer_500s_for_a_superuser(self, superuser):
        client, _csrf = _authenticated_client(superuser)
        response = client.get(USER_ROLES_URL)
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
