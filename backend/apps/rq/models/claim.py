"""
Claim model - supplier claims and user complaints.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.enums import ClaimTypeChoices, ClaimStatusChoices


class Claim(models.Model):
    """
    Claim raised either against a supplier (non-conforming delivery)
    or by the user (non-conforming final delivery).
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='claims',
        verbose_name=_('requerimiento'),
    )
    claim_type = models.CharField(
        _('tipo de reclamo'),
        max_length=20,
        choices=ClaimTypeChoices.choices,
    )
    raised_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='claims_raised',
        verbose_name=_('levantado por'),
    )
    managed_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='claims_managed',
        null=True,
        blank=True,
        verbose_name=_('gestionado por'),
        help_text=_('OPS: Coord. Logístico / ADM: Sup. Logístico'),
    )
    status = models.CharField(
        _('estado'),
        max_length=15,
        choices=ClaimStatusChoices.choices,
        default=ClaimStatusChoices.OPEN,
    )
    description = models.TextField(_('descripción'))
    resolution = models.TextField(_('resolución'), blank=True)
    resolved_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='claims_resolved',
        null=True,
        blank=True,
        verbose_name=_('resuelto por'),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(_('resuelto el'), null=True, blank=True)

    class Meta:
        db_table = 'claims'
        verbose_name = _('reclamo')
        verbose_name_plural = _('reclamos')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['claim_type']),
            models.Index(fields=['status']),
        ]

    def __str__(self) -> str:
        return f'{self.request.rq_number} | {self.get_claim_type_display()} - {self.get_status_display()}'
