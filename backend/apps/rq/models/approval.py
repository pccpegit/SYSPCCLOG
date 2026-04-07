"""
Approval model - immutable audit trail of all workflow actions.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.enums import ApprovalActionChoices, RoleChoices, RQStatusChoices


class Approval(models.Model):
    """
    Immutable record of every workflow action performed on a Request.
    Acts as an audit trail - records who did what, when, and what changed.
    Never update records; always create new ones.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='approvals',
        verbose_name=_('requerimiento'),
    )
    workflow_step = models.ForeignKey(
        'rq.WorkflowStep',
        on_delete=models.SET_NULL,
        related_name='approvals',
        null=True,
        blank=True,
        verbose_name=_('paso del workflow'),
    )
    action = models.CharField(
        _('acción'),
        max_length=30,
        choices=ApprovalActionChoices.choices,
    )
    performed_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='approvals_performed',
        verbose_name=_('realizado por'),
    )
    role = models.CharField(
        _('rol del ejecutor'),
        max_length=30,
        choices=RoleChoices.choices,
    )
    previous_status = models.CharField(
        _('estado anterior'),
        max_length=30,
        choices=RQStatusChoices.choices,
    )
    new_status = models.CharField(
        _('estado nuevo'),
        max_length=30,
        choices=RQStatusChoices.choices,
    )
    comments = models.TextField(_('comentarios'), blank=True)
    performed_at = models.DateTimeField(_('realizado el'), auto_now_add=True)

    class Meta:
        db_table = 'approvals'
        verbose_name = _('aprobación')
        verbose_name_plural = _('aprobaciones')
        ordering = ['performed_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['performed_by']),
            models.Index(fields=['performed_at']),
        ]

    def __str__(self) -> str:
        return (
            f'{self.request.rq_number} | {self.get_action_display()} '
            f'por {self.performed_by.username} → {self.get_new_status_display()}'
        )
