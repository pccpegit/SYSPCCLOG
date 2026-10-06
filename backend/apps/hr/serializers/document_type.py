from decimal import Decimal

from rest_framework import serializers


class FieldSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    type = serializers.CharField()
    required = serializers.BooleanField()
    required_when = serializers.CharField(allow_blank=True)
    choices = serializers.ListField(child=serializers.DictField(), required=False)
    source = serializers.CharField()
    help = serializers.CharField(allow_blank=True)
    question = serializers.CharField(allow_blank=True)
    default = serializers.JSONField(allow_null=True)


class VariableSerializer(serializers.Serializer):
    name = serializers.CharField()
    label = serializers.CharField()
    group = serializers.CharField()
    field = serializers.CharField(allow_null=True)
    required = serializers.BooleanField()


def serialize_spec(spec) -> dict:
    from django.conf import settings
    from apps.hr.documents.contract import DEFAULT_PROBATION_MONTHS

    constraints = {}
    if spec.key == 'CONTRACT':
        constraints = {
            'min_wage': f'{Decimal(str(settings.HR_MIN_WAGE)):.2f}',
            'default_probation_months': DEFAULT_PROBATION_MONTHS,
        }
    return {
        'key': spec.key,
        'label': spec.label,
        'default_slug': spec.default_slug,
        'constraints': constraints,
        'assistant_supported': spec.extraction_model is not None,
        'fields': [
            {
                'key': f.key, 'label': f.label, 'type': f.type, 'required': f.required,
                'required_when': f.required_when,
                'choices': [{'value': v, 'label': l} for v, l in f.choices],
                'source': f.source, 'help': f.help, 'question': f.question, 'default': f.default,
            }
            for f in spec.fields
        ],
        'variables': [
            {'name': v.name, 'label': v.label, 'group': v.group, 'field': v.field, 'required': v.required}
            for v in spec.variables
        ],
    }
