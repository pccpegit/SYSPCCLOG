"""
SYSPCC-018 — direct unit tests for `UserAdminService`, below the API layer.

Complements `test_user_admin_crud.py` (which exercises the same behavior
through the HTTP endpoints): these call the service directly so the
password-generation loop and the `sync_roles` diff logic are pinned without
needing a full request/response round trip for every case.
"""

from unittest import mock

import pytest
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError

from apps.core.enums import RoleChoices
from apps.core.models import UserRole
from apps.core.services.user_admin import UserAdminService

# "N generaciones" per the ticket spec — comfortably above the service's own
# internal MAX_PASSWORD_GENERATION_ATTEMPTS (5) retry budget, to prove real
# variety, not just that the first draw happened to pass.
PASSWORD_GENERATION_SAMPLE_SIZE = 20


@pytest.mark.django_db
class TestGenerateTemporaryPassword:
    def test_generated_passwords_pass_validate_password(self):
        for _ in range(PASSWORD_GENERATION_SAMPLE_SIZE):
            candidate = UserAdminService.generate_temporary_password()
            # Raises DjangoValidationError on failure — a bare call is the
            # assertion.
            validate_password(candidate)

    def test_generated_passwords_meet_minimum_length(self):
        for _ in range(PASSWORD_GENERATION_SAMPLE_SIZE):
            candidate = UserAdminService.generate_temporary_password()
            assert len(candidate) >= 12

    def test_generated_passwords_are_not_trivially_repeated(self):
        """Sanity check on the entropy source — `secrets.token_urlsafe`
        should never draw the same value twice in a small sample."""
        candidates = {UserAdminService.generate_temporary_password() for _ in range(PASSWORD_GENERATION_SAMPLE_SIZE)}
        assert len(candidates) == PASSWORD_GENERATION_SAMPLE_SIZE

    def test_exhausted_retries_raise_runtime_error(self):
        """Every candidate is rejected by validate_password -> the service
        gives up after MAX_PASSWORD_GENERATION_ATTEMPTS instead of looping
        forever, and surfaces a domain-level failure."""
        with mock.patch(
            'apps.core.services.user_admin.validate_password',
            side_effect=DjangoValidationError('siempre inválida'),
        ):
            with pytest.raises(RuntimeError):
                UserAdminService.generate_temporary_password()


@pytest.mark.django_db
class TestSyncRoles:
    def test_sync_roles_called_with_none_deletes_everything_like_empty_list(self, requester):
        """`sync_roles` itself does NOT special-case `None` vs `[]` — both
        collapse to "no entries survive" (`roles_data = roles_data or []`).
        The omitted-vs-empty distinction the ticket describes ("roles
        omitido no toca nada") lives one layer up, in `update_user`, which
        only calls `sync_roles` at all when `roles_data is not None` — see
        `TestUpdateUserRolesSemantics` below for that actual contract."""
        assert requester.user_roles.exists()

        UserAdminService.sync_roles(requester, None)

        assert not requester.user_roles.exists()

    def test_empty_list_deletes_all_existing_roles(self, requester):
        assert requester.user_roles.exists()

        UserAdminService.sync_roles(requester, [])

        assert not requester.user_roles.exists()

    def test_non_empty_list_replaces_existing_assignments(self, requester, project, other_project):
        UserAdminService.sync_roles(
            requester,
            [{'role': RoleChoices.PROJECT_CONTROL, 'project': other_project, 'is_primary': True}],
        )

        roles = list(requester.user_roles.all())
        assert len(roles) == 1
        assert roles[0].role == RoleChoices.PROJECT_CONTROL
        assert roles[0].project_id == other_project.id
        assert roles[0].is_primary is True
        # The original REQUESTER/project assignment is gone, not merely
        # supplemented.
        assert not requester.user_roles.filter(role=RoleChoices.REQUESTER).exists()

    def test_matching_existing_assignment_is_kept_and_updates_is_primary(self, requester, project):
        existing = requester.user_roles.get(role=RoleChoices.REQUESTER, project=project)
        assert existing.is_primary is True

        UserAdminService.sync_roles(
            requester,
            [{'role': RoleChoices.REQUESTER, 'project': project, 'is_primary': False}],
        )

        existing.refresh_from_db()
        assert existing.is_primary is False
        # Same row (id unchanged) — proves this was an update, not a
        # delete+recreate.
        assert requester.user_roles.count() == 1

    def test_duplicate_entry_in_same_payload_raises_validation_error(self, user, project):
        with pytest.raises(DRFValidationError):
            UserAdminService.sync_roles(
                user,
                [
                    {'role': RoleChoices.REQUESTER, 'project': project, 'is_primary': True},
                    {'role': RoleChoices.REQUESTER, 'project': project, 'is_primary': False},
                ],
            )
        assert not UserRole.objects.filter(user=user, role=RoleChoices.REQUESTER).exists()

    def test_add_and_remove_in_one_call(self, requester, project, other_project):
        """A single sync_roles call can both drop the old assignment and add
        a new, unrelated one — not just replace like-for-like."""
        UserAdminService.sync_roles(
            requester,
            [
                {'role': RoleChoices.REQUESTER, 'project': project, 'is_primary': True},
                {'role': RoleChoices.PROJECT_RESIDENT, 'project': other_project, 'is_primary': False},
            ],
        )

        roles = {(ur.role, ur.project_id) for ur in requester.user_roles.all()}
        assert roles == {
            (RoleChoices.REQUESTER, project.id),
            (RoleChoices.PROJECT_RESIDENT, other_project.id),
        }


@pytest.mark.django_db
class TestCreateUser:
    def test_creates_user_with_must_change_password_true(self, superuser):
        created_user, temp_password = UserAdminService.create_user(
            actor=superuser,
            username='creado_service',
            email='creado_service@test.com',
            first_name='Creado',
            last_name='Service',
            roles_data=None,
        )

        assert created_user.pk is not None
        assert created_user.must_change_password is True
        assert created_user.check_password(temp_password)

    def test_creates_roles_alongside_the_user(self, superuser, project):
        created_user, _temp_password = UserAdminService.create_user(
            actor=superuser,
            username='creado_con_rol',
            email='creado_con_rol@test.com',
            first_name='Creado',
            last_name='ConRol',
            roles_data=[{'role': RoleChoices.REQUESTER, 'project': project, 'is_primary': True}],
        )

        assert created_user.user_roles.count() == 1
        assert created_user.user_roles.first().project_id == project.id

    def test_duplicate_username_raises_validation_error(self, superuser, user):
        with pytest.raises(DRFValidationError):
            UserAdminService.create_user(
                actor=superuser,
                username=user.username,  # already taken
                email='otro-email@test.com',
                first_name='Dup',
                last_name='User',
                roles_data=None,
            )


@pytest.mark.django_db
class TestResetPassword:
    def test_sets_new_password_and_forces_change(self, superuser, user):
        old_hash = user.password

        new_temp_password = UserAdminService.reset_password(actor=superuser, user=user)

        user.refresh_from_db()
        assert user.password != old_hash
        assert user.check_password(new_temp_password)
        assert user.must_change_password is True

    def test_old_password_stops_working(self, superuser, user):
        UserAdminService.reset_password(actor=superuser, user=user)

        user.refresh_from_db()
        assert not user.check_password('TestPass2026!')


@pytest.mark.django_db
class TestSetActive:
    def test_deactivate_then_activate_is_idempotent(self, superuser, user):
        UserAdminService.set_active(actor=superuser, user=user, is_active=False)
        UserAdminService.set_active(actor=superuser, user=user, is_active=False)
        user.refresh_from_db()
        assert user.is_active is False

        UserAdminService.set_active(actor=superuser, user=user, is_active=True)
        UserAdminService.set_active(actor=superuser, user=user, is_active=True)
        user.refresh_from_db()
        assert user.is_active is True

    def test_actor_cannot_deactivate_self(self, superuser):
        with pytest.raises(DRFValidationError):
            UserAdminService.set_active(actor=superuser, user=superuser, is_active=False)
        superuser.refresh_from_db()
        assert superuser.is_active is True

    def test_actor_can_deactivate_someone_else(self, superuser, other_superuser):
        UserAdminService.set_active(actor=superuser, user=other_superuser, is_active=False)
        other_superuser.refresh_from_db()
        assert other_superuser.is_active is False


@pytest.mark.django_db
class TestUpdateUserRolesSemantics:
    """The actual "omitted vs. empty vs. replace" contract the ticket
    describes lives in `update_user`, not `sync_roles` (see the note in
    `TestSyncRoles.test_sync_roles_called_with_none_deletes_everything...`
    above): `update_user` only calls `sync_roles` when `roles_data is not
    None`."""

    def test_roles_data_none_leaves_existing_roles_untouched(self, superuser, requester):
        before = set(requester.user_roles.values_list('id', flat=True))

        UserAdminService.update_user(actor=superuser, user=requester, roles_data=None)

        after = set(requester.user_roles.values_list('id', flat=True))
        assert before == after

    def test_roles_data_empty_list_clears_all_roles(self, superuser, requester):
        assert requester.user_roles.exists()

        UserAdminService.update_user(actor=superuser, user=requester, roles_data=[])

        assert not requester.user_roles.exists()

    def test_roles_data_with_content_replaces_existing_assignments(self, superuser, requester, other_project):
        UserAdminService.update_user(
            actor=superuser,
            user=requester,
            roles_data=[{'role': RoleChoices.PROJECT_CONTROL, 'project': other_project, 'is_primary': True}],
        )

        roles = list(requester.user_roles.all())
        assert len(roles) == 1
        assert roles[0].role == RoleChoices.PROJECT_CONTROL


@pytest.mark.django_db
class TestUpdateUserSelfDeactivationGuard:
    """Pins the FASE 1 deviation: the same guard from `set_active` is
    duplicated in `update_user` because `is_active` is also editable through
    the generic PATCH/PUT path, not just the dedicated activate/deactivate
    actions."""

    def test_generic_update_cannot_deactivate_self(self, superuser):
        with pytest.raises(DRFValidationError):
            UserAdminService.update_user(actor=superuser, user=superuser, is_active=False)
        superuser.refresh_from_db()
        assert superuser.is_active is True

    def test_generic_update_can_deactivate_someone_else(self, superuser, other_superuser):
        UserAdminService.update_user(actor=superuser, user=other_superuser, is_active=False)
        other_superuser.refresh_from_db()
        assert other_superuser.is_active is False
