from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.hr.enums import CVFileKind
from apps.hr.storage import cv_posting_upload_to, get_private_storage


class CVAnalysis(models.Model):
    """A bulk CV screening process (one position / one batch of CVs).

    Counters and cost are NOT denormalized: they are annotated from the items
    (see services/cv_analysis_service.annotate_counts), so they cannot drift.
    The aggregate status is derived too.
    """

    name = models.CharField(_('nombre'), max_length=150)
    requirements_text = models.TextField(_('requisitos del puesto'), blank=True)
    # [{"id": 1, "text": "...", "weight": 1|3}] parsed by the code from requirements_text
    requirements = models.JSONField(_('requisitos'), default=list, blank=True)
    model_name = models.CharField(_('modelo'), max_length=60, blank=True)
    prompt_version = models.CharField(_('versión del prompt'), max_length=20, blank=True)
    # Job posting (convocatoria), SYSPCC-023 iteration 2. 1 analysis = 1 posting. The
    # extracted text is NOT stored (it is re-read from the file); only the file and metadata.
    posting_file = models.FileField(
        _('convocatoria'), upload_to=cv_posting_upload_to, storage=get_private_storage,
        blank=True, max_length=255)
    posting_original_name = models.CharField(_('nombre original de la convocatoria'), max_length=255, blank=True)
    posting_kind = models.CharField(_('tipo de archivo de la convocatoria'), max_length=6,
                                    choices=CVFileKind.choices, blank=True)
    posting_size_bytes = models.PositiveIntegerField(_('tamaño de la convocatoria'), default=0)
    posting_sha256 = models.CharField(max_length=64, blank=True)
    posting_uploaded_at = models.DateTimeField(null=True, blank=True)
    # Accumulated across extractions; added to the analysis cost.
    posting_tokens_in = models.PositiveIntegerField(default=0)
    posting_tokens_out = models.PositiveIntegerField(default=0)
    posting_cost_usd = models.DecimalField(max_digits=8, decimal_places=4, default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name='hr_cv_analyses', verbose_name=_('creado por'),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_cv_analysis'
        verbose_name = _('análisis de CVs')
        verbose_name_plural = _('análisis de CVs')
        ordering = ['-created_at']
        indexes = [models.Index(fields=['-created_at'], name='hr_cvan_created_idx')]

    @property
    def has_requirements(self) -> bool:
        return bool(self.requirements)

    @property
    def has_posting(self) -> bool:
        return bool(self.posting_file)

    def __str__(self):
        return f'Análisis #{self.pk}'
