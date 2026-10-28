from rest_framework import serializers

from apps.hr.enums import DocumentSource, HRDocumentType
from apps.hr.models import DocumentEvent, GeneratedDocument
from apps.hr.services import document_service


class GeneratedDocumentListSerializer(serializers.ModelSerializer):
    """Summary row: no `data` snapshot and no DNI."""

    document_type_label = serializers.CharField(source='get_document_type_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    pdf_available = serializers.SerializerMethodField()

    class Meta:
        model = GeneratedDocument
        fields = [
            'id', 'document_type', 'document_type_label', 'subject_name', 'status', 'status_label',
            'reference_number', 'source', 'template_version', 'pdf_available',
            'created_by_name', 'created_at', 'issued_at',
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj) -> str:
        return obj.created_by.get_full_name() if obj.created_by_id else ''

    def get_pdf_available(self, obj) -> bool:
        return obj.pdf_is_current


class GeneratedDocumentDetailSerializer(GeneratedDocumentListSerializer):
    data = serializers.SerializerMethodField()
    company = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()
    template = serializers.SerializerMethodField()
    personal_id = serializers.IntegerField(read_only=True)
    issued_by_name = serializers.SerializerMethodField()
    voided_at = serializers.DateTimeField(read_only=True)
    void_reason = serializers.CharField(read_only=True)

    class Meta(GeneratedDocumentListSerializer.Meta):
        fields = GeneratedDocumentListSerializer.Meta.fields + [
            'data', 'company', 'warnings', 'template', 'personal_id', 'issued_by_name',
            'voided_at', 'void_reason', 'updated_at',
        ]
        read_only_fields = fields

    def get_data(self, obj) -> dict:
        return {k: v for k, v in (obj.data or {}).items() if k != 'company'}

    def get_company(self, obj) -> dict:
        return (obj.data or {}).get('company') or {}

    def get_warnings(self, obj) -> list:
        return document_service.compute_warnings(obj)

    def get_template(self, obj) -> dict:
        return {'id': obj.template_id, 'name': obj.template.name, 'version': obj.template_version}

    def get_issued_by_name(self, obj) -> str:
        return obj.issued_by.get_full_name() if obj.issued_by_id else ''


class DocumentCreateSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=HRDocumentType.choices)
    template_id = serializers.IntegerField()
    personal_id = serializers.IntegerField(required=False, allow_null=True)
    source = serializers.ChoiceField(choices=DocumentSource.choices, default=DocumentSource.MANUAL)
    data = serializers.DictField()


class DocumentUpdateSerializer(serializers.Serializer):
    data = serializers.DictField(required=False)
    template_id = serializers.IntegerField(required=False)


class DocumentVoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class DocumentEventSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source='get_action_display', read_only=True)
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentEvent
        fields = ['id', 'action', 'action_label', 'actor_name', 'metadata', 'created_at']
        read_only_fields = fields

    def get_actor_name(self, obj) -> str:
        return obj.actor.get_full_name() if obj.actor_id else ''
