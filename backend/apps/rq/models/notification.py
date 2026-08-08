"""
Notification model for in-app notifications.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class Notification(models.Model):
    """
    In-app notification sent to users when workflow actions occur.
    """

    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        related_name='notifications',
        verbose_name=_('destinatario'),
    )
    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='notifications',
        null=True,
        blank=True,
        verbose_name=_('requerimiento'),
    )
    title = models.CharField(_('título'), max_length=200)
    message = models.TextField(_('mensaje'))
    is_read = models.BooleanField(_('leída'), default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    dedup_key = models.CharField(
        _('clave de deduplicación'),
        max_length=255,
        null=True,
        blank=True,
        help_text=_(
            'Clave determinística usada por tareas programadas (SLA, recordatorios) '
            'para evitar notificaciones duplicadas si la tarea se reintenta o corre '
            'más de una vez con el mismo estado. Nula para notificaciones creadas '
            'por transiciones de workflow, que no requieren deduplicación.'
        ),
    )

    class Meta:
        db_table = 'notifications'
        verbose_name = _('notificación')
        verbose_name_plural = _('notificaciones')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['dedup_key'],
                condition=models.Q(dedup_key__isnull=False),
                name='notification_dedup_key_unique_when_set',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.user.username}: {self.title}'
