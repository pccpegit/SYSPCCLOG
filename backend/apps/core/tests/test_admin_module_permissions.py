"""
SYSPCC-018 — permission gating for the admin module (Users/Projects
management).

Every write action of `UserViewSet`/`ProjectViewSet` switched from
`is_staff` (`IsAdminOrReadOnly`) to `IsSuperUser` (Django `is_superuser` —
there is no business-level SUPERADMIN role in `RoleChoices`). These tests
pin that contract for every endpoint the design (`FASE 0 §2`) lists:

  - anonymous -> 401
  - authenticated, `is_staff=True` but NOT superuser -> 403 (this actor used
    to be allowed under the old `IsAdminOrReadOnly` gate — the whole point
    of this module is that it no longer is)
  - superuser -> 200/201

Reads (`list`/`retrieve`) are unchanged (`IsAuthenticated`) and covered
separately in `test_user_admin_crud.py`.

`force_authenticate` is used throughout (not real login) because these are
pure permission-layer checks (`get_permissions()`/`has_permission()`), which
run identically either way — DRF applies permission checks after
authentication regardless of how `request.user` was set. Real login is
reserved for `test_must_change_password_gate.py`, where the code under test
lives inside `CookieJWTAuthentication.authenticate()` itself, which
`force_authenticate` bypasses entirely.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Project, User


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestUserCreateRequiresSuperuser:
    URL = '/api/v1/users/'

    def _payload(self, suffix='new'):
        return {
            'username': f'nuevo_{suffix}',
            'email': f'nuevo_{suffix}@test.com',
            'first_name': 'Nuevo',
            'last_name': 'Usuario',
        }

    def test_anonymous_gets_401(self, api_client):
        response = api_client.post(self.URL, self._payload(), format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_and_nothing_created(self, staff_user):
        client = _client_for(staff_user)
        response = client.post(self.URL, self._payload('staffattempt'), format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not User.objects.filter(username='nuevo_staffattempt').exists()

    def test_superuser_gets_201(self, superuser):
        client = _client_for(superuser)
        response = client.post(self.URL, self._payload('bysuper'), format='json')
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
class TestUserUpdateRequiresSuperuser:
    def test_anonymous_gets_401(self, api_client, user):
        response = api_client.patch(f'/api/v1/users/{user.id}/', {'position': 'X'}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403(self, staff_user, user):
        client = _client_for(staff_user)
        response = client.patch(f'/api/v1/users/{user.id}/', {'position': 'X'}, format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN
        user.refresh_from_db()
        assert user.position != 'X'

    def test_superuser_gets_200(self, superuser, user):
        client = _client_for(superuser)
        response = client.patch(f'/api/v1/users/{user.id}/', {'position': 'X'}, format='json')
        assert response.status_code == status.HTTP_200_OK

    def test_put_staff_non_superuser_gets_403(self, staff_user, user):
        """PUT (full update), not just PATCH — the design table lists both."""
        client = _client_for(staff_user)
        payload = {
            'username': user.username,
            'email': user.email,
            'first_name': 'Changed',
            'last_name': user.last_name,
        }
        response = client.put(f'/api/v1/users/{user.id}/', payload, format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestUserResetPasswordRequiresSuperuser:
    URL_TMPL = '/api/v1/users/{}/reset-password/'

    def test_anonymous_gets_401(self, api_client, user):
        response = api_client.post(self.URL_TMPL.format(user.id))
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403(self, staff_user, user):
        client = _client_for(staff_user)
        response = client.post(self.URL_TMPL.format(user.id))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_superuser_gets_200(self, superuser, user):
        client = _client_for(superuser)
        response = client.post(self.URL_TMPL.format(user.id))
        assert response.status_code == status.HTTP_200_OK
        assert 'temporary_password' in response.data


@pytest.mark.django_db
class TestUserActivateDeactivateRequireSuperuser:
    def test_activate_anonymous_gets_401(self, api_client, user):
        response = api_client.post(f'/api/v1/users/{user.id}/activate/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_activate_staff_non_superuser_gets_403(self, staff_user, user):
        client = _client_for(staff_user)
        response = client.post(f'/api/v1/users/{user.id}/activate/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_activate_superuser_gets_200(self, superuser, user):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/users/{user.id}/activate/')
        assert response.status_code == status.HTTP_200_OK

    def test_deactivate_anonymous_gets_401(self, api_client, user):
        response = api_client.post(f'/api/v1/users/{user.id}/deactivate/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_deactivate_staff_non_superuser_gets_403(self, staff_user, user):
        client = _client_for(staff_user)
        response = client.post(f'/api/v1/users/{user.id}/deactivate/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_deactivate_superuser_gets_200(self, superuser, user):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/users/{user.id}/deactivate/')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestUserDestroyIsAlways405:
    """SYSPCC-018: users are never hard-deleted (preserve approval history) —
    405 for every actor, including superuser."""

    def test_anonymous_gets_401_not_405(self, api_client, user):
        # Permission/auth is still checked before the method-not-allowed path.
        response = api_client.delete(f'/api/v1/users/{user.id}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_not_405(self, staff_user, user):
        client = _client_for(staff_user)
        response = client.delete(f'/api/v1/users/{user.id}/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_superuser_gets_405(self, superuser, user):
        client = _client_for(superuser)
        response = client.delete(f'/api/v1/users/{user.id}/')
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
class TestProjectCreateRequiresSuperuser:
    def _payload(self, code):
        return {'code': code, 'name': 'Proyecto Nuevo', 'location': 'Lima', 'client': 'Cliente X'}

    def test_anonymous_gets_401(self, api_client):
        response = api_client.post('/api/v1/projects/', self._payload('PRY-ANON'), format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_and_nothing_created(self, staff_user):
        client = _client_for(staff_user)
        response = client.post('/api/v1/projects/', self._payload('PRY-STAFF'), format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Project.objects.filter(code='PRY-STAFF').exists()

    def test_superuser_gets_201(self, superuser):
        client = _client_for(superuser)
        response = client.post('/api/v1/projects/', self._payload('PRY-SUPER'), format='json')
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
class TestProjectUpdateRequiresSuperuser:
    def test_anonymous_gets_401(self, api_client, project):
        response = api_client.patch(f'/api/v1/projects/{project.id}/', {'name': 'X'}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403(self, staff_user, project):
        client = _client_for(staff_user)
        response = client.patch(f'/api/v1/projects/{project.id}/', {'name': 'X'}, format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN
        project.refresh_from_db()
        assert project.name != 'X'

    def test_superuser_gets_200(self, superuser, project):
        client = _client_for(superuser)
        response = client.patch(f'/api/v1/projects/{project.id}/', {'name': 'X'}, format='json')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestProjectActivateDeactivateRequireSuperuser:
    def test_activate_anonymous_gets_401(self, api_client, project):
        response = api_client.post(f'/api/v1/projects/{project.id}/activate/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_activate_staff_non_superuser_gets_403(self, staff_user, project):
        client = _client_for(staff_user)
        response = client.post(f'/api/v1/projects/{project.id}/activate/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_activate_superuser_gets_200(self, superuser, project):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/projects/{project.id}/activate/')
        assert response.status_code == status.HTTP_200_OK

    def test_deactivate_anonymous_gets_401(self, api_client, project):
        response = api_client.post(f'/api/v1/projects/{project.id}/deactivate/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_deactivate_staff_non_superuser_gets_403(self, staff_user, project):
        client = _client_for(staff_user)
        response = client.post(f'/api/v1/projects/{project.id}/deactivate/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_deactivate_superuser_gets_200(self, superuser, project):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/projects/{project.id}/deactivate/')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestProjectDestroyIsAlways405:
    def test_anonymous_gets_401_not_405(self, api_client, project):
        response = api_client.delete(f'/api/v1/projects/{project.id}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_non_superuser_gets_403_not_405(self, staff_user, project):
        client = _client_for(staff_user)
        response = client.delete(f'/api/v1/projects/{project.id}/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_superuser_gets_405(self, superuser, project):
        client = _client_for(superuser)
        response = client.delete(f'/api/v1/projects/{project.id}/')
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert Project.objects.filter(pk=project.pk).exists()


# NOTE: `UserRoleViewSet` (hallazgo #1/#3 from the FASE 3 security audit) is
# deliberately NOT covered here — the security-auditor's handoff notes
# explicitly require real login (not `force_authenticate`) for "este
# endpoint", for pattern-consistency with the rest of this module's security
# suite. See `test_user_role_viewset_hardening.py`.
