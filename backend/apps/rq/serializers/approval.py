"""
Approval and WorkflowAction serializers.
"""

from rest_framework import serializers
from apps.rq.models import Approval
from apps.core.enums import ApprovalActionChoices, RoleChoices


class ApprovalSerializer(serializers.ModelSerializer):
    performed_by_name = serializers.CharField(source='performed_by.get_full_name', read_only=True)
    action_display = serializers.CharField(source='get_action_display', read_only=True)
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    previous_status_display = serializers.CharField(source='get_previous_status_display', read_only=True)
    new_status_display = serializers.CharField(source='get_new_status_display', read_only=True)

    class Meta:
        model = Approval
        fields = [
            'id',
            'request',
            'workflow_step',
            'action',
            'action_display',
            'performed_by',
            'performed_by_name',
            'role',
            'role_display',
            'previous_status',
            'previous_status_display',
            'new_status',
            'new_status_display',
            'comments',
            'performed_at',
        ]
        read_only_fields = [
            'id', 'request', 'workflow_step', 'action', 'performed_by',
            'role', 'previous_status', 'new_status', 'comments', 'performed_at',
        ]


class WorkflowActionSerializer(serializers.Serializer):
    """
    Payload for executing a workflow action on a request.
    POST to /api/v1/requests/{id}/action/
    """

    action = serializers.ChoiceField(choices=ApprovalActionChoices.choices)
    acting_role = serializers.ChoiceField(choices=RoleChoices.choices)
    comments = serializers.CharField(required=False, allow_blank=True, default='')
    extra_data = serializers.DictField(required=False, default=dict)

    # FIX-20: Only known keys are permitted in extra_data to prevent injection
    # of unexpected workflow parameters.
    ALLOWED_EXTRA_DATA_KEYS = frozenset({
        'classification',
        'within_plan',
        'has_stock',
        'within_budget',
    })

    def validate_extra_data(self, value: dict) -> dict:
        unknown_keys = set(value.keys()) - self.ALLOWED_EXTRA_DATA_KEYS
        if unknown_keys:
            raise serializers.ValidationError(
                f'Claves no permitidas en extra_data: {", ".join(sorted(unknown_keys))}. '
                f'Claves válidas: {", ".join(sorted(self.ALLOWED_EXTRA_DATA_KEYS))}.'
            )
        return value
