from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from apps.hr.enums import HRDocumentType
from apps.hr.storage import get_private_storage, template_upload_to


class DocumentTemplate(models.Model):
    """An approved Word (.docx) template. The file is immutable: a new
    version is a new row. Exactly one version per (type, slug) is active."""

    document_type = models.CharField(
        _('tipo de documento'), max_length=20, choices=HRDocumentType.choices
    )
    slug = models.SlugField(_('serie'), max_length=60)
    name = models.CharField(_('nombre'), max_length=150)
    version = models.PositiveIntegerField(_('versión'))
    file = models.FileField(
        _('archivo'), upload_to=template_upload_to, storage=get_private_storage, max_length=255
    )
    original_filename = models.CharField(_('nombre original'), max_length=255, blank=True)
    file_sha256 = models.CharField(_('hash SHA-256'), max_length=64)
    detected_variables = models.JSONField(_('variables detectadas'), default=list, blank=True)
    unknown_variables = models.JSONField(_('variables desconocidas'), default=list, blank=True)
    missing_required_variables = models.JSONField(
        _('variables obligatorias no usadas'), default=list, blank=True
    )
    is_active = models.BooleanField(_('activa'), default=False)
    activated_at = models.DateTimeField(_('activada el'), null=True, blank=True)
    notes = models.TextField(_('notas'), blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hr_templates_uploaded',
        verbose_name=_('subida por'),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_document_template'
        verbose_name = _('plantilla de documento')
        verbose_name_plural = _('plantillas de documento')
        ordering = ['document_type', 'slug', '-version']
        constraints = [
            models.UniqueConstraint(
                fields=['document_type', 'slug', 'version'], name='hr_template_unique_version'
            ),
            models.UniqueConstraint(
                fields=['document_type', 'slug'],
                condition=Q(is_active=True),
                name='hr_template_one_active_per_series',
            ),
            models.CheckConstraint(condition=Q(version__gte=1), name='hr_template_version_gte_1'),
        ]
        indexes = [models.Index(fields=['document_type', 'is_active'], name='hr_tpl_type_active_idx')]

    def __str__(self):
        return f'{self.name} v{self.version}'
