"""
SYSPCC-018: business logic for the superadmin-only user management module.

Views/serializers validate the request shape and delegate to
`UserAdminService` for anything that touches more than one row (creating a
user + its roles, resetting a password, syncing role assignments). Nothing
here knows about HTTP except for using `rest_framework.exceptions.
ValidationError` to report expected validation failures — DRF's
`EXCEPTION_HANDLER` (`apps.core.exceptions.custom_exception_handler`) is
configured globally, so raising it from a service is caught the same way as
raising it from a view.

The temporary password generated here is returned to the caller exactly
once and must never be logged or persisted in plain text.
"""

import logging
import secrets

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from apps.core.models import User, UserRole

logger = logging.getLogger(__name__)

# Astronomically unlikely to ever be needed — `secrets.token_urlsafe(12)` is
# ~96 bits of entropy — but AUTH_PASSWORD_VALIDATORS could in principle
# reject a candidate (e.g. CommonPasswordValidator on a very unlucky
# collision), so retry a bounded number of times rather than trusting the
# first draw blindly.
MAX_PASSWORD_GENERATION_ATTEMPTS = 5


def _role_key(role, project, department_obj):
    """Natural key matching UserRole's unique_together, using FK ids so it
    is comparable both to model instances (already saved) and to the plain
    dicts validated by `UserRoleAssignmentSerializer`."""
    project_id = project.pk if project is not None else None
    department_id = department_obj.pk if department_obj is not None else None
    return role, project_id, department_id


class UserAdminService:
    """Namespace for the admin-user-management use cases (SYSPCC-018)."""

    @staticmethod
    def generate_temporary_password() -> str:
        """
        Generate a random temporary password that satisfies
        `AUTH_PASSWORD_VALIDATORS` (min length 12, not common, not fully
        numeric). Never derived from user-supplied input, so
        `UserAttributeSimilarityValidator` is not a realistic rejection
        source.
        """
        last_error = None
        for _attempt in range(MAX_PASSWORD_GENERATION_ATTEMPTS):
            candidate = secrets.token_urlsafe(12)
            try:
                validate_password(candidate)
            except DjangoValidationError as exc:
                last_error = exc
                continue
            return candidate

        # Last barrier: this should never realistically happen. Log with
        # the captured stack of the final rejection so it's debuggable if
        # it ever does, then surface as a domain failure (not a raw
        # password-validator error) to whatever caller triggered this.
        logger.exception(
            'user_admin.generate_temporary_password.exhausted',
            extra={'attempts': MAX_PASSWORD_GENERATION_ATTEMPTS},
            exc_info=last_error,
        )
        raise RuntimeError('No se pudo generar una contraseña temporal válida.') from last_error

    @staticmethod
    def sync_roles(user: User, roles_data: list[dict] | None) -> None:
        """
        Replace `user`'s role assignments with `roles_data` (list of dicts
        with keys role/project/department_obj/is_primary, already validated
        by `UserRoleAssignmentSerializer`). Diff-based against the current
        state: deletes roles not present in the incoming list, creates the
        ones missing, and updates `is_primary` on the ones that already
        match.

        Must run inside an already-open `transaction.atomic()` block opened
        by the caller (`create_user`/`update_user`) — does not open its own.
        """
        roles_data = roles_data or []

        seen_keys = set()
        for entry in roles_data:
            key = _role_key(entry['role'], entry.get('project'), entry.get('department_obj'))
            if key in seen_keys:
                raise ValidationError({
                    'roles': 'No se puede asignar el mismo rol/proyecto/departamento más de una vez.',
                })
            seen_keys.add(key)

        # Keyed directly off the FK ids UserRole already carries (matches
        # `_role_key`'s shape without re-fetching the related Project/Department).
        existing_by_key = {
            (ur.role, ur.project_id, ur.department_obj_id): ur
            for ur in user.user_roles.all()
        }

        for key, ur in list(existing_by_key.items()):
            if key not in seen_keys:
                ur.delete()

        for entry in roles_data:
            project = entry.get('project')
            department_obj = entry.get('department_obj')
            is_primary = entry.get('is_primary', False)
            key = _role_key(entry['role'], project, department_obj)

            existing = existing_by_key.get(key)
            if existing is not None:
                if existing.is_primary != is_primary:
                    existing.is_primary = is_primary
                    existing.save(update_fields=['is_primary'])
                continue

            try:
                UserRole.objects.create(
                    user=user,
                    role=entry['role'],
                    project=project,
                    department_obj=department_obj,
                    is_primary=is_primary,
                )
            except IntegrityError as exc:
                logger.warning(
                    'user_admin.sync_roles.integrity_error',
                    extra={'user_id': user.id, 'role': entry['role']},
                )
                raise ValidationError({
                    'roles': 'No se puede asignar el mismo rol/proyecto/departamento más de una vez.',
                }) from exc

    @classmethod
    def create_user(
        cls,
        *,
        actor: User,
        username: str,
        email: str,
        first_name: str,
        last_name: str,
        position: str = '',
        department: str = '',
        phone: str = '',
        roles_data: list[dict] | None = None,
    ) -> tuple[User, str]:
        """
        Create a new user with a system-generated temporary password
        (`must_change_password=True`) and its initial role assignments.
        Returns `(user, temporary_password)` — the caller (the view) is
        responsible for returning the password to the admin exactly once.
        """
        with transaction.atomic():
            temp_password = cls.generate_temporary_password()

            user = User(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                position=position,
                department=department,
                phone=phone,
                must_change_password=True,
            )
            user.set_password(temp_password)
            try:
                user.save()
            except IntegrityError as exc:
                # Defense in depth: the serializer's UniqueValidator already
                # checks username/email uniqueness, this only guards the
                # race between validation and insert.
                logger.warning('user_admin.create.integrity_error', extra={'actor_id': actor.id})
                raise ValidationError({'username': 'Ya existe un usuario con estos datos.'}) from exc

            cls.sync_roles(user, roles_data)

            logger.info('user_admin.create', extra={'actor_id': actor.id, 'user_id': user.id})

        return user, temp_password

    @classmethod
    def update_user(cls, *, actor: User, user: User, roles_data: list[dict] | None = None, **fields) -> User:
        """
        Apply plain-field changes already validated by
        `UserAdminUpdateSerializer` and, when `roles_data` is not `None`,
        replace the user's role assignments. `roles_data=None` means
        "omitted from the payload" (leave roles untouched) vs.
        `roles_data=[]` which clears every role — the serializer is
        responsible for making that distinction before calling in.

        Applies the same self-deactivation guard as `set_active` — `
        is_active` is also editable through this generic update path (per
        design), so the guard must be enforced here too or it would be
        trivially bypassable.
        """
        if fields.get('is_active') is False and user.pk == actor.pk:
            raise ValidationError('No puede desactivarse a sí mismo.')

        with transaction.atomic():
            for field, value in fields.items():
                setattr(user, field, value)
            if fields:
                user.save(update_fields=list(fields.keys()))

            if roles_data is not None:
                cls.sync_roles(user, roles_data)

            logger.info('user_admin.update', extra={'actor_id': actor.id, 'user_id': user.id})

        return user

    @classmethod
    def reset_password(cls, *, actor: User, user: User) -> str:
        """
        Force-reset `user`'s password to a new system-generated temporary
        password and flag `must_change_password=True`. Returns the
        temporary password — shown to the admin exactly once, never logged.
        """
        with transaction.atomic():
            temp_password = cls.generate_temporary_password()
            user.set_password(temp_password)
            user.must_change_password = True
            user.save(update_fields=['password', 'must_change_password'])
            logger.info('user_admin.reset_password', extra={'actor_id': actor.id, 'user_id': user.id})

        return temp_password

    @staticmethod
    def set_active(*, actor: User, user: User, is_active: bool) -> User:
        """
        Activate/deactivate `user`. Idempotent (no-op if already in the
        target state, still returns 200). Guards against a superadmin
        locking themselves out by deactivating their own account.
        """
        if not is_active and user.pk == actor.pk:
            raise ValidationError('No puede desactivarse a sí mismo.')

        with transaction.atomic():
            if user.is_active != is_active:
                user.is_active = is_active
                user.save(update_fields=['is_active'])
            logger.info(
                'user_admin.set_active',
                extra={'actor_id': actor.id, 'user_id': user.id, 'is_active': is_active},
            )

        return user
