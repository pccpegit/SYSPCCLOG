"""
ActivityLog model for auditing all actions on requests.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class ActivityLog(models.Model):
    """
    Audit log that records every action performed on a supply request.
    Immutable - records are never updated.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='activity_logs',
        verbose_name=_('requerimiento'),
    )
    user = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='activity_logs',
        verbose_name=_('usuario'),
    )
    action = models.CharField(_('acción'), max_length=100)
    detail = models.TextField(_('detalle'), blank=True)
    ip_address = models.GenericIPAddressField(
        _('dirección IP'),
        null=True,
        blank=True,
        protocol='both',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'activity_log'
        verbose_name = _('registro de actividad')
        verbose_name_plural = _('registros de actividad')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['user']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.request.rq_number} | {self.action} por {self.user.username}'
