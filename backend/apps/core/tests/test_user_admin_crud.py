"""
SYSPCC-018 — admin-module CRUD contract for Users/Projects, at the API
level: temporary password lifecycle, `roles` sync semantics through the
serializer, self-deactivation guard (both paths), idempotent
activate/deactivate, list-serializer shape (roles nested only for
superadmins), `ProjectSerializer.residents`, and payload validation.

Permission gating itself (401/403/2xx per actor) lives in
`test_admin_module_permissions.py` — every test here authenticates as
`superuser` unless the actor is specifically what's under test.
"""

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.core.models import User, UserRole


def _client_for(actor):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client


@pytest.mark.django_db
class TestCreateUserTemporaryPassword:
    def test_response_includes_temporary_password_once(self, superuser):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': 'flor_creada',
                'email': 'flor_creada@test.com',
                'first_name': 'Flor',
                'last_name': 'Creada',
            },
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['temporary_password']
        assert isinstance(response.data['temporary_password'], str)

    def test_created_user_has_must_change_password_true_in_db(self, superuser):
        client = _client_for(superuser)
        client.post(
            '/api/v1/users/',
            {
                'username': 'debe_cambiar',
                'email': 'debe_cambiar@test.com',
                'first_name': 'Debe',
                'last_name': 'Cambiar',
            },
            format='json',
        )

        created = User.objects.get(username='debe_cambiar')
        assert created.must_change_password is True

    def test_created_user_password_is_usable_to_log_in(self, superuser):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': 'login_con_temp',
                'email': 'login_con_temp@test.com',
                'first_name': 'Login',
                'last_name': 'Temp',
            },
            format='json',
        )
        temp_password = response.data['temporary_password']

        created = User.objects.get(username='login_con_temp')
        assert created.check_password(temp_password)

    def test_temporary_password_not_repeated_on_subsequent_retrieve(self, superuser):
        client = _client_for(superuser)
        create_response = client.post(
            '/api/v1/users/',
            {
                'username': 'no_repetir',
                'email': 'no_repetir@test.com',
                'first_name': 'No',
                'last_name': 'Repetir',
            },
            format='json',
        )
        user_id = create_response.data['id']

        retrieve_response = client.get(f'/api/v1/users/{user_id}/')

        assert retrieve_response.status_code == status.HTTP_200_OK
        assert 'temporary_password' not in retrieve_response.data

    def test_temporary_password_never_logged(self, superuser, caplog):
        import logging

        client = _client_for(superuser)
        with caplog.at_level(logging.DEBUG):
            response = client.post(
                '/api/v1/users/',
                {
                    'username': 'sin_logs',
                    'email': 'sin_logs@test.com',
                    'first_name': 'Sin',
                    'last_name': 'Logs',
                },
                format='json',
            )
        temp_password = response.data['temporary_password']

        all_log_text = '\n'.join(record.getMessage() for record in caplog.records)
        assert temp_password not in all_log_text

    def test_roles_created_with_project_and_department(self, superuser, project, department):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': 'con_roles',
                'email': 'con_roles@test.com',
                'first_name': 'Con',
                'last_name': 'Roles',
                'roles': [
                    {'role': RoleChoices.PROJECT_RESIDENT, 'project': project.id, 'is_primary': True},
                    {'role': RoleChoices.DIRECT_SUPERVISOR, 'department_obj': department.id},
                ],
            },
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED
        created = User.objects.get(username='con_roles')
        assert created.user_roles.count() == 2
        assert created.user_roles.filter(role=RoleChoices.PROJECT_RESIDENT, project=project).exists()
        assert created.user_roles.filter(role=RoleChoices.DIRECT_SUPERVISOR, department_obj=department).exists()


@pytest.mark.django_db
class TestCreateUserValidation:
    def test_invalid_role_choice_returns_400(self, superuser):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': 'rol_invalido',
                'email': 'rol_invalido@test.com',
                'first_name': 'Rol',
                'last_name': 'Invalido',
                'roles': [{'role': 'NOT_A_REAL_ROLE'}],
            },
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not User.objects.filter(username='rol_invalido').exists()

    def test_duplicate_role_project_in_same_payload_returns_400_clean(self, superuser, project):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': 'rol_duplicado',
                'email': 'rol_duplicado@test.com',
                'first_name': 'Rol',
                'last_name': 'Duplicado',
                'roles': [
                    {'role': RoleChoices.REQUESTER, 'project': project.id},
                    {'role': RoleChoices.REQUESTER, 'project': project.id},
                ],
            },
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # The whole create is transactional — a bad `roles` array must not
        # leave a half-created user behind.
        assert not User.objects.filter(username='rol_duplicado').exists()

    def test_duplicate_username_returns_400(self, superuser, user):
        client = _client_for(superuser)
        response = client.post(
            '/api/v1/users/',
            {
                'username': user.username,
                'email': 'otro-correo@test.com',
                'first_name': 'Otro',
                'last_name': 'Usuario',
            },
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_required_field_returns_400(self, superuser):
        client = _client_for(superuser)
        response = client.post('/api/v1/users/', {'username': 'incompleto'}, format='json')
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestUpdateUserRolesSync:
    def test_roles_omitted_leaves_roles_intact(self, superuser, requester):
        before = set(requester.user_roles.values_list('id', flat=True))
        client = _client_for(superuser)

        response = client.patch(f'/api/v1/users/{requester.id}/', {'position': 'Nuevo cargo'}, format='json')

        assert response.status_code == status.HTTP_200_OK
        after = set(requester.user_roles.values_list('id', flat=True))
        assert before == after

    def test_roles_empty_array_clears_all_roles(self, superuser, requester):
        client = _client_for(superuser)

        response = client.patch(f'/api/v1/users/{requester.id}/', {'roles': []}, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert not requester.user_roles.exists()

    def test_roles_with_content_is_a_full_replacement(self, superuser, requester, other_project):
        client = _client_for(superuser)

        response = client.patch(
            f'/api/v1/users/{requester.id}/',
            {'roles': [{'role': RoleChoices.LOGISTICS_COORDINATOR, 'project': other_project.id, 'is_primary': True}]},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        roles = list(requester.user_roles.all())
        assert len(roles) == 1
        assert roles[0].role == RoleChoices.LOGISTICS_COORDINATOR
        assert not requester.user_roles.filter(role=RoleChoices.REQUESTER).exists()


@pytest.mark.django_db
class TestSelfDeactivationGuard:
    """Both paths must be blocked — the generic PATCH `is_active` path
    duplicates the guard from the dedicated `deactivate` action (FASE 1
    deviation 1); a test that only covers one path would miss a real
    bypass."""

    def test_deactivate_action_on_self_returns_400(self, superuser):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/users/{superuser.id}/deactivate/')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        superuser.refresh_from_db()
        assert superuser.is_active is True

    def test_generic_patch_is_active_false_on_self_returns_400(self, superuser):
        client = _client_for(superuser)
        response = client.patch(f'/api/v1/users/{superuser.id}/', {'is_active': False}, format='json')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        superuser.refresh_from_db()
        assert superuser.is_active is True

    def test_deactivating_someone_else_succeeds(self, superuser, other_superuser):
        client = _client_for(superuser)
        response = client.post(f'/api/v1/users/{other_superuser.id}/deactivate/')
        assert response.status_code == status.HTTP_200_OK
        other_superuser.refresh_from_db()
        assert other_superuser.is_active is False


@pytest.mark.django_db
class TestActivateDeactivateIdempotency:
    def test_deactivate_called_twice_stays_200_and_inactive(self, superuser, user):
        client = _client_for(superuser)

        first = client.post(f'/api/v1/users/{user.id}/deactivate/')
        second = client.post(f'/api/v1/users/{user.id}/deactivate/')

        assert first.status_code == status.HTTP_200_OK
        assert second.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is False

    def test_activate_called_twice_stays_200_and_active(self, superuser, user):
        client = _client_for(superuser)
        client.post(f'/api/v1/users/{user.id}/deactivate/')

        first = client.post(f'/api/v1/users/{user.id}/activate/')
        second = client.post(f'/api/v1/users/{user.id}/activate/')

        assert first.status_code == status.HTTP_200_OK
        assert second.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is True


@pytest.mark.django_db
class TestResetPasswordChangesCredentials:
    def test_old_password_stops_working_and_new_one_logs_in(self, superuser, user):
        # Real logins below hit `LoginRateThrottle` — clear its counter
        # first so back-to-back suite runs within the same window can't
        # make this fail on an unrelated 429 (see the equivalent fixture's
        # docstring in test_must_change_password_gate.py).
        cache.clear()
        client = _client_for(superuser)
        response = client.post(f'/api/v1/users/{user.id}/reset-password/')
        assert response.status_code == status.HTTP_200_OK
        new_temp_password = response.data['temporary_password']

        anon = APIClient()
        old_login = anon.post(
            '/api/v1/auth/login/', {'username': user.username, 'password': 'TestPass2026!'}
        )
        assert old_login.status_code == status.HTTP_401_UNAUTHORIZED

        new_login = anon.post(
            '/api/v1/auth/login/', {'username': user.username, 'password': new_temp_password}
        )
        assert new_login.status_code == status.HTTP_200_OK

    def test_reset_password_sets_must_change_password_true(self, superuser, user):
        client = _client_for(superuser)
        client.post(f'/api/v1/users/{user.id}/reset-password/')

        user.refresh_from_db()
        assert user.must_change_password is True


@pytest.mark.django_db
class TestUserListContract:
    def test_non_superadmin_list_has_no_roles_key(self, requester, project_resident):
        client = _client_for(requester)
        response = client.get('/api/v1/users/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['results']
        for item in response.data['results']:
            assert 'roles' not in item

    def test_superadmin_list_includes_roles_key(self, superuser, requester):
        client = _client_for(superuser)
        response = client.get('/api/v1/users/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['results']
        for item in response.data['results']:
            assert 'roles' in item

    def test_superadmin_list_includes_is_superuser_field(self, superuser):
        client = _client_for(superuser)
        response = client.get('/api/v1/users/')
        assert response.status_code == status.HTTP_200_OK
        superadmin_row = next(u for u in response.data['results'] if u['username'] == superuser.username)
        assert superadmin_row['is_superuser'] is True


@pytest.mark.django_db
class TestProjectResidents:
    def test_residents_empty_when_no_one_assigned(self, superuser, project):
        client = _client_for(superuser)
        response = client.get(f'/api/v1/projects/{project.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['residents'] == []

    def test_residents_lists_project_resident_role_holders(self, superuser, project, project_resident):
        client = _client_for(superuser)
        response = client.get(f'/api/v1/projects/{project.id}/')

        assert response.status_code == status.HTTP_200_OK
        residents = response.data['residents']
        assert len(residents) == 1
        assert residents[0]['id'] == project_resident.id
        assert residents[0]['username'] == project_resident.username
        assert residents[0]['full_name'] == project_resident.full_name

    def test_residents_excludes_other_roles_on_same_project(self, superuser, project, project_control):
        """`project_control` (PROJECT_CONTROL) is assigned to `project` too
        — only PROJECT_RESIDENT holders should appear."""
        client = _client_for(superuser)
        response = client.get(f'/api/v1/projects/{project.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['residents'] == []


@pytest.mark.django_db
class TestMustChangePasswordDefaultsFalseForExistingUsers:
    """SYSPCC-018 migration 0007 adds `must_change_password` with
    `default=False` — pre-existing users (anything created via the plain
    `user`/`requester`/etc. fixtures, mirroring pre-ticket signups) must not
    be retroactively forced through the change-password flow."""

    def test_plain_user_fixture_defaults_to_false(self, user):
        assert user.must_change_password is False

    def test_role_fixtures_default_to_false(self, requester, general_manager, admin_manager):
        assert requester.must_change_password is False
        assert general_manager.must_change_password is False
        assert admin_manager.must_change_password is False
