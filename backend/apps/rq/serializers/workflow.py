from rest_framework import serializers
from apps.rq.models import AcquisitionTypeConfig, WorkflowStep


class AcquisitionTypeConfigSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source='get_type_display', read_only=True)

    class Meta:
        model = AcquisitionTypeConfig
        fields = '__all__'


class WorkflowStepSerializer(serializers.ModelSerializer):
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
    responsible_role_display = serializers.CharField(source='get_responsible_role_display', read_only=True)

    class Meta:
        model = WorkflowStep
        fields = '__all__'
