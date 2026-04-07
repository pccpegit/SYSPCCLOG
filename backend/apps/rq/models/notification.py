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

    class Meta:
        db_table = 'notifications'
        verbose_name = _('notificación')
        verbose_name_plural = _('notificaciones')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read']),
        ]

    def __str__(self) -> str:
        return f'{self.user.username}: {self.title}'
