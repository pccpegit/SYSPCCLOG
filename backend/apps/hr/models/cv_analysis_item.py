from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from apps.hr.enums import CVFileKind, CVItemStatus, CVRecommendation
from apps.hr.storage import cv_report_upload_to, cv_upload_to, get_private_storage


class CVAnalysisItem(models.Model):
    """One CV inside an analysis. `result` and the denormalized candidate
    columns are PII at rest: never exposed in the admin nor in logs."""

    analysis = models.ForeignKey('hr.CVAnalysis', on_delete=models.CASCADE, related_name='items')
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='hr_cv_items_uploaded', verbose_name=_('subido por'),
    )
    position = models.PositiveIntegerField(_('orden de subida'), default=0)
    original_name = models.CharField(_('nombre original'), max_length=255)
    file = models.FileField(
        _('archivo'), upload_to=cv_upload_to, storage=get_private_storage, blank=True, max_length=255,
    )
    size_bytes = models.PositiveIntegerField(_('tamaño (bytes)'), default=0)
    sha256 = models.CharField(max_length=64)
    detected_mime = models.CharField(max_length=100, blank=True)
    kind = models.CharField(max_length=6, choices=CVFileKind.choices)
    page_count = models.PositiveSmallIntegerField(null=True, blank=True)

    status = models.CharField(max_length=12, choices=CVItemStatus.choices, default=CVItemStatus.QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    error_code = models.CharField(max_length=40, blank=True)
    error_message = models.CharField(max_length=200, blank=True)

    result = models.JSONField(null=True, blank=True)
    candidate_name = models.CharField(max_length=150, blank=True)
    headline = models.CharField(max_length=150, blank=True)
    experience_years = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    recommendation = models.CharField(max_length=12, choices=CVRecommendation.choices, blank=True)
    injection_suspected = models.BooleanField(default=False)

    model_name = models.CharField(max_length=60, blank=True)
    prompt_version = models.CharField(max_length=20, blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    cost_usd = models.DecimalField(max_digits=8, decimal_places=4, default=0)

    report_pdf = models.FileField(
        upload_to=cv_report_upload_to, storage=get_private_storage, blank=True, max_length=255,
    )
    report_generated_at = models.DateTimeField(null=True, blank=True)

    enqueued_at = models.DateTimeField(null=True, blank=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_cv_analysis_item'
        verbose_name = _('CV')
        verbose_name_plural = _('CVs')
        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(fields=['analysis', 'sha256'], name='uniq_cv_item_analysis_sha256'),
            models.CheckConstraint(
                condition=Q(score__isnull=True) | (Q(score__gte=0) & Q(score__lte=100)),
                name='hr_cv_item_score_0_100',
            ),
        ]
        indexes = [
            models.Index(fields=['analysis', 'status'], name='hr_cvit_an_status_idx'),
            models.Index(fields=['analysis', '-score'], name='hr_cvit_an_score_idx'),
            models.Index(fields=['analysis', 'updated_at'], name='hr_cvit_an_upd_idx'),
            models.Index(fields=['status', 'locked_at'], name='hr_cvit_status_lock_idx'),
            models.Index(fields=['uploaded_by', 'created_at'], name='hr_cvit_user_day_idx'),
        ]

    def __str__(self):
        return f'CV #{self.pk}'
