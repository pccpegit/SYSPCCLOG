from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from apps.hr.enums import DocumentSource, DocumentStatus, HRDocumentType
from apps.hr.storage import document_docx_upload_to, document_pdf_upload_to, get_private_storage


class GeneratedDocument(models.Model):
    """A document produced from a template. DRAFT until RR. HH. issues it.

    `data` is a snapshot (worker + contract fields + the company data used)
    and is PII at rest: it is never exposed in list endpoints nor in the
    Django admin.
    """

    document_type = models.CharField(
        _('tipo de documento'), max_length=20, choices=HRDocumentType.choices
    )
    template = models.ForeignKey(
        'hr.DocumentTemplate',
        on_delete=models.PROTECT,
        related_name='documents',
        verbose_name=_('plantilla'),
    )
    template_version = models.PositiveIntegerField(_('versión de plantilla'))
    template_sha256 = models.CharField(_('hash de plantilla'), max_length=64)
    personal = models.ForeignKey(
        'core.Personal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hr_documents',
        verbose_name=_('trabajador'),
    )
    subject_name = models.CharField(_('nombre del trabajador'), max_length=255)
    data = models.JSONField(_('datos'), default=dict)
    status = models.CharField(
        _('estado'), max_length=10, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT
    )
    source = models.CharField(
        _('origen'), max_length=10, choices=DocumentSource.choices, default=DocumentSource.MANUAL
    )
    docx_file = models.FileField(
        _('archivo Word'), upload_to=document_docx_upload_to, storage=get_private_storage,
        blank=True, max_length=255,
    )
    pdf_file = models.FileField(
        _('archivo PDF'), upload_to=document_pdf_upload_to, storage=get_private_storage,
        blank=True, max_length=255,
    )
    docx_sha256 = models.CharField(_('hash del Word'), max_length=64, blank=True)
    pdf_docx_sha256 = models.CharField(
        _('hash del Word del que se generó el PDF'), max_length=64, blank=True,
    )
    reference_number = models.CharField(
        _('número de documento'), max_length=20, null=True, blank=True, unique=True
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='hr_documents_created',
        verbose_name=_('creado por'),
    )
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hr_documents_issued',
        verbose_name=_('emitido por'),
    )
    issued_at = models.DateTimeField(_('emitido el'), null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hr_documents_voided',
        verbose_name=_('anulado por'),
    )
    voided_at = models.DateTimeField(_('anulado el'), null=True, blank=True)
    void_reason = models.TextField(_('motivo de anulación'), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_generated_document'
        verbose_name = _('documento generado')
        verbose_name_plural = _('documentos generados')
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                condition=~Q(status='ISSUED')
                | (Q(issued_at__isnull=False) & Q(reference_number__isnull=False)),
                name='hr_doc_issued_has_number_and_date',
            ),
            models.CheckConstraint(
                condition=~Q(status='VOIDED') | ~Q(void_reason=''),
                name='hr_doc_voided_has_reason',
            ),
        ]
        indexes = [
            models.Index(fields=['document_type', 'status', '-created_at'], name='hr_doc_type_status_idx'),
            models.Index(fields=['personal'], name='hr_doc_personal_idx'),
            models.Index(fields=['created_by'], name='hr_doc_created_by_idx'),
            models.Index(fields=['subject_name'], name='hr_doc_subject_idx'),
        ]

    @property
    def pdf_is_current(self) -> bool:
        """The PDF is served only if it was rendered from the CURRENT Word."""
        return bool(self.pdf_file) and bool(self.docx_sha256) and self.pdf_docx_sha256 == self.docx_sha256

    def __str__(self):
        return self.reference_number or f'Borrador #{self.pk}'
