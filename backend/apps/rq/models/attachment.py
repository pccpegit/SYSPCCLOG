"""
Attachment model for file documents linked to requests.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class Attachment(models.Model):
    """
    Document attached to a supply request.
    Covers: cotizaciones, guías de remisión, OC PDFs, fotos, planos, etc.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='attachments',
        verbose_name=_('requerimiento'),
    )
    uploaded_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='attachments_uploaded',
        verbose_name=_('subido por'),
    )
    file_name = models.CharField(_('nombre del archivo'), max_length=255)
    file_path = models.CharField(
        _('ruta del archivo'),
        max_length=500,
        help_text=_('Ruta relativa en MEDIA_ROOT o URL externa'),
    )
    file_type = models.CharField(_('tipo de archivo'), max_length=50, blank=True)
    file_size = models.PositiveIntegerField(
        _('tamaño en bytes'),
        null=True,
        blank=True,
    )
    category = models.CharField(
        _('categoría'),
        max_length=50,
        blank=True,
        help_text=_('Ej: cotizacion, guia, oc, foto, plano'),
    )
    description = models.CharField(_('descripción'), max_length=300, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attachments'
        verbose_name = _('adjunto')
        verbose_name_plural = _('adjuntos')
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['category']),
        ]

    def __str__(self) -> str:
        return f'{self.request.rq_number} | {self.file_name}'
