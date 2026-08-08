"""
Workflow configuration viewsets (read-only for frontend reference).
"""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.rq.models import AcquisitionTypeConfig, WorkflowStep
from apps.rq.serializers.workflow import AcquisitionTypeConfigSerializer, WorkflowStepSerializer
from apps.core.permissions import IsAdminOrReadOnly


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='List acquisition type configs'),
    retrieve=extend_schema(tags=['requests'], summary='Get acquisition type config'),
)
class AcquisitionTypeConfigViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AcquisitionTypeConfig.objects.all()
    serializer_class = AcquisitionTypeConfigSerializer
    permission_classes = [IsAuthenticated]


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='List workflow steps'),
    retrieve=extend_schema(tags=['requests'], summary='Get workflow step'),
)
class WorkflowStepViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WorkflowStep.objects.all()
    serializer_class = WorkflowStepSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['flow', 'responsible_role', 'phase']
