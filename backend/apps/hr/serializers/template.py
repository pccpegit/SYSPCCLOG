from rest_framework import serializers

from apps.hr.enums import HRDocumentType
from apps.hr.models import DocumentTemplate


class DocumentTemplateSerializer(serializers.ModelSerializer):
    """Read serializer. The stored path/URL of the file is never exposed."""

    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentTemplate
        fields = [
            'id', 'document_type', 'slug', 'name', 'version', 'original_filename',
            'detected_variables', 'unknown_variables', 'missing_required_variables',
            'is_active', 'activated_at', 'notes', 'uploaded_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj) -> str:
        return obj.uploaded_by.get_full_name() if obj.uploaded_by_id else ''


class DocumentTemplateUploadSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=HRDocumentType.choices)
    name = serializers.CharField(max_length=150)
    slug = serializers.SlugField(max_length=60, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    file = serializers.FileField()


class DocumentTemplateUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
