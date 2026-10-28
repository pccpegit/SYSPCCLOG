from django.conf import settings
from rest_framework import serializers

from apps.hr.enums import HRDocumentType


class AssistantExtractRequestSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=HRDocumentType.choices)
    text = serializers.CharField(trim_whitespace=True)
    personal_id = serializers.IntegerField(required=False, allow_null=True)
    known_data = serializers.DictField(required=False)

    def validate_text(self, value):
        limit = settings.HR_ASSISTANT_MAX_INPUT_CHARS
        if len(value) > limit:
            raise serializers.ValidationError(f'La descripción no puede superar {limit} caracteres.')
        return value


class AssistantMissingSerializer(serializers.Serializer):
    field = serializers.CharField()
    label = serializers.CharField()
    question = serializers.CharField(allow_blank=True)


class AssistantExtractResponseSerializer(serializers.Serializer):
    data = serializers.DictField()
    missing = AssistantMissingSerializer(many=True)
    questions = serializers.ListField(child=serializers.CharField())
    warnings = serializers.ListField(child=serializers.CharField())
    personal_match = serializers.DictField(allow_null=True)
    used_ai = serializers.BooleanField()
