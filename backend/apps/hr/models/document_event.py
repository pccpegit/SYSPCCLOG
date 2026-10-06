from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.hr.enums import DocumentEventAction


class DocumentEvent(models.Model):
    """Audit log. `metadata` must never hold PII (only format/version/hash)."""

    document = models.ForeignKey(
        'hr.GeneratedDocument', on_delete=models.CASCADE, related_name='events',
        verbose_name=_('documento'),
    )
    action = models.CharField(_('acción'), max_length=15, choices=DocumentEventAction.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='hr_document_events', verbose_name=_('usuario'),
    )
    metadata = models.JSONField(_('metadatos'), default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_document_event'
        verbose_name = _('evento de documento')
        verbose_name_plural = _('eventos de documento')
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['document', 'created_at'], name='hr_event_doc_created_idx')]

    def __str__(self):
        return f'{self.action} #{self.document_id}'
