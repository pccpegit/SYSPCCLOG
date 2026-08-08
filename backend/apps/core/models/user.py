"""
User and UserRole models for SYSPCCLOG.
Uses Django's AbstractUser to extend the built-in user model.
"""

from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _

from apps.core.enums import RoleChoices


class User(AbstractUser):
    """
    Custom user model for PCC S.A.C. employees.
    Extends AbstractUser to add company-specific fields.
    """

    email = models.EmailField(_('email address'), unique=True)
    first_name = models.CharField(_('first name'), max_length=100)
    last_name = models.CharField(_('last name'), max_length=100)
    position = models.CharField(_('cargo'), max_length=100, blank=True)
    department = models.CharField(
        _('área/departamento'),
        max_length=100,
        blank=True,
        help_text=_('Área o departamento del usuario (texto libre, referencia informativa)'),
    )
    phone = models.CharField(_('teléfono'), max_length=20, blank=True)
    avatar_url = models.URLField(_('avatar URL'), max_length=255, blank=True)
    signature = models.ImageField(
        _('firma'),
        upload_to='signatures/',
        blank=True,
        help_text=_('Imagen de firma del usuario (PNG transparente)'),
    )

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email', 'first_name', 'last_name']

    class Meta:
        db_table = 'users'
        verbose_name = _('usuario')
        verbose_name_plural = _('usuarios')
        ordering = ['last_name', 'first_name']

    def __str__(self) -> str:
        return f'{self.get_full_name()} ({self.username})'

    @property
    def full_name(self) -> str:
        return self.get_full_name()

    def get_roles(self) -> 'models.QuerySet[UserRole]':
        """Return all active roles assigned to this user."""
        return self.user_roles.select_related('project', 'department_obj')

    def has_role(self, role: str) -> bool:
        """Check if the user has a specific role."""
        return self.user_roles.filter(role=role).exists()


class UserRole(models.Model):
    """
    Maps users to roles in the workflow.
    A user can have multiple roles across different flows and projects/departments.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='user_roles',
        verbose_name=_('usuario'),
    )
    role = models.CharField(
        _('rol'),
        max_length=30,
        choices=RoleChoices.choices,
    )
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.CASCADE,
        related_name='user_roles',
        null=True,
        blank=True,
        verbose_name=_('proyecto'),
        help_text=_('OPS: proyecto asignado. Null = acceso global'),
    )
    department_obj = models.ForeignKey(
        'core.Department',
        on_delete=models.CASCADE,
        related_name='user_roles',
        null=True,
        blank=True,
        verbose_name=_('departamento'),
        help_text=_('ADM: departamento asignado. Null = acceso global'),
    )
    is_primary = models.BooleanField(
        _('es rol primario'),
        default=False,
        help_text=_('Indica si este es el rol principal del usuario'),
    )
    assigned_at = models.DateTimeField(_('asignado el'), auto_now_add=True)

    class Meta:
        db_table = 'user_roles'
        verbose_name = _('rol de usuario')
        verbose_name_plural = _('roles de usuarios')
        unique_together = [('user', 'role', 'project', 'department_obj')]
        indexes = [
            models.Index(fields=['user', 'role']),
        ]

    def __str__(self) -> str:
        parts = [f'{self.user.username} - {self.get_role_display()}']
        if self.project:
            parts.append(f'[{self.project.code}]')
        if self.department_obj:
            parts.append(f'[{self.department_obj.code}]')
        return ' '.join(parts)
