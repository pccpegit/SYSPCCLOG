from django.conf import settings
from rest_framework import serializers

from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_analysis_service as svc


class CVAnalysisCreateSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=svc.NAME_MIN, max_length=svc.NAME_MAX, trim_whitespace=True)
    requirements_text = serializers.CharField(
        required=False, allow_blank=True, max_length=svc.REQ_TEXT_MAX, trim_whitespace=False)


class PostingExtractSerializer(serializers.Serializer):
    """Optional pasted text (not stored). Bounded by HR_CV_POSTING_MAX_TEXT_CHARS."""

    text = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    def validate_text(self, value):
        limit = settings.HR_CV_POSTING_MAX_TEXT_CHARS
        if len(value) > limit:
            raise serializers.ValidationError(f'Máximo {limit} caracteres. Pega solo la parte de requisitos.')
        return value


class CVAnalysisUpdateSerializer(CVAnalysisCreateSerializer):
    name = serializers.CharField(
        min_length=svc.NAME_MIN, max_length=svc.NAME_MAX, trim_whitespace=True, required=False)


class CVAnalysisSerializer(serializers.ModelSerializer):
    """Requires a queryset annotated with `svc.annotate_counts`."""

    created_by_name = serializers.SerializerMethodField()
    has_requirements = serializers.BooleanField(read_only=True)
    has_posting = serializers.BooleanField(read_only=True)
    counts = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    cost_usd = serializers.SerializerMethodField()

    class Meta:
        model = CVAnalysis
        fields = ['id', 'name', 'created_at', 'created_by_name', 'has_requirements', 'has_posting', 'counts',
                  'status', 'cost_usd']
        read_only_fields = fields

    def get_created_by_name(self, obj) -> str:
        return obj.created_by.get_full_name() if obj.created_by_id else ''

    def get_counts(self, obj) -> dict:
        return {
            'total': obj.n_total, 'done': obj.n_done, 'failed': obj.n_failed,
            'pending': obj.n_queued + obj.n_processing,
        }

    def get_status(self, obj) -> str:
        return svc.derived_status(obj.n_total, obj.n_queued, obj.n_processing, obj.n_failed)

    def get_cost_usd(self, obj) -> float:
        return float(obj.total_cost)


class CVAnalysisDetailSerializer(CVAnalysisSerializer):
    requirements = serializers.JSONField(read_only=True)
    requirements_text = serializers.CharField(read_only=True)
    requirements_locked = serializers.SerializerMethodField()
    posting = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()

    class Meta(CVAnalysisSerializer.Meta):
        fields = CVAnalysisSerializer.Meta.fields + [
            'requirements', 'requirements_text', 'model_name', 'requirements_locked', 'posting']
        read_only_fields = fields

    def get_posting(self, obj) -> dict | None:
        if not obj.posting_file:
            return None
        try:
            available = obj.posting_file.storage.exists(obj.posting_file.name)
        except OSError:
            available = False
        return {
            'original_name': obj.posting_original_name, 'kind': obj.posting_kind,
            'size_bytes': obj.posting_size_bytes, 'uploaded_at': obj.posting_uploaded_at,
            'file_available': available,
        }

    def get_requirements_locked(self, obj) -> bool:
        # DONE (already scored) or in flight (QUEUED/PROCESSING): same rule as the write endpoints.
        return (obj.n_done + obj.n_queued + obj.n_processing) > 0

    def get_counts(self, obj) -> dict:
        data = super().get_counts(obj)
        data.update(queued=obj.n_queued, processing=obj.n_processing, cancelled=obj.n_cancelled)
        return data


class CVItemSerializer(serializers.ModelSerializer):
    rank = serializers.SerializerMethodField()
    experience_years = serializers.FloatField(read_only=True)

    class Meta:
        model = CVAnalysisItem
        fields = ['id', 'rank', 'original_name', 'status', 'error_code', 'error_message', 'candidate_name',
                  'headline', 'experience_years', 'score', 'recommendation', 'injection_suspected']
        read_only_fields = fields

    def get_rank(self, obj):
        return (self.context.get('ranks') or {}).get(obj.pk)


class CVItemDetailSerializer(CVItemSerializer):
    report = serializers.SerializerMethodField()
    computed = serializers.SerializerMethodField()
    cost_usd = serializers.FloatField(read_only=True)
    file_available = serializers.SerializerMethodField()
    report_available = serializers.SerializerMethodField()

    class Meta(CVItemSerializer.Meta):
        fields = CVItemSerializer.Meta.fields + [
            'report', 'computed', 'tokens_in', 'tokens_out', 'cost_usd', 'kind', 'page_count',
            'attempts', 'file_available', 'report_available', 'created_at', 'finished_at']
        read_only_fields = fields

    def get_report(self, obj):
        return (obj.result or {}).get('report')

    def get_computed(self, obj):
        return (obj.result or {}).get('computed')

    def get_file_available(self, obj) -> bool:
        try:
            return bool(obj.file) and obj.file.storage.exists(obj.file.name)
        except OSError:
            return False

    def get_report_available(self, obj) -> bool:
        return obj.status == 'DONE'
