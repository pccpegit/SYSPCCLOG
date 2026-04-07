"""
Request (RQ) viewset - the central API resource.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.rq.models import Request
from apps.rq.serializers.request import (
    RequestListSerializer,
    RequestDetailSerializer,
    RequestCreateSerializer,
)
from apps.rq.serializers.approval import ApprovalSerializer, WorkflowActionSerializer
from apps.rq.serializers.activity_log import ActivityLogSerializer
from apps.rq.serializers.attachment import AttachmentSerializer
from apps.rq.serializers.notification import NotificationSerializer
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.rq.filters import RequestFilter


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='List supply requests'),
    retrieve=extend_schema(tags=['requests'], summary='Get request detail'),
    create=extend_schema(tags=['requests'], summary='Create new supply request'),
    update=extend_schema(tags=['requests'], summary='Update request (only DRAFT allowed)'),
    partial_update=extend_schema(tags=['requests'], summary='Partial update request'),
    destroy=extend_schema(tags=['requests'], summary='Delete request (only DRAFT allowed)'),
)
class RequestViewSet(viewsets.ModelViewSet):
    """
    Central API for Supply Requests (RQ).
    Supports full CRUD for DRAFT requests and workflow actions for all others.
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = RequestFilter
    search_fields = ['rq_number', 'description', 'service', 'front_area']
    ordering_fields = ['created_at', 'priority', 'status', 'fecha_necesidad']
    ordering = ['-created_at']

    def get_queryset(self):
        user = self.request.user
        qs = Request.objects.select_related(
            'project', 'department', 'requested_by', 'current_step',
            'budget_line', 'annual_plan_line',
        ).prefetch_related('items')

        # Superusers and staff see all
        if user.is_staff or user.is_superuser:
            return qs

        # Regular users see requests they created or that are in their scope
        roles = list(user.user_roles.values_list('role', flat=True))
        from apps.core.enums import RoleChoices

        # Requester: own requests only
        # Approvers: requests in their project/department scope
        # Logistics/GM: all requests
        wide_access_roles = [
            RoleChoices.GENERAL_MANAGER,
            RoleChoices.LOGISTICS_COORDINATOR,
            RoleChoices.LOGISTICS_SUPERVISOR,
            RoleChoices.LOGISTICS_CHIEF,
            RoleChoices.CENTRAL_WAREHOUSE,
        ]
        if any(r in wide_access_roles for r in roles):
            return qs

        from django.db.models import Q
        return qs.filter(
            Q(requested_by=user)
            | Q(project__in=user.user_roles.values('project'))
            | Q(department__in=user.user_roles.values('department_obj'))
        )

    def get_serializer_class(self):
        if self.action == 'create':
            return RequestCreateSerializer
        if self.action in ('list',):
            return RequestListSerializer
        return RequestDetailSerializer

    def update(self, request, *args, **kwargs):
        """Only DRAFT requests can be updated."""
        instance = self.get_object()
        if instance.status != 'DRAFT':
            return Response(
                {'detail': 'Solo se pueden editar requerimientos en estado BORRADOR.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Only DRAFT requests can be deleted."""
        instance = self.get_object()
        if instance.status != 'DRAFT':
            return Response(
                {'detail': 'Solo se pueden eliminar requerimientos en estado BORRADOR.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @extend_schema(
        tags=['requests'],
        summary='Execute workflow action',
        request=WorkflowActionSerializer,
        responses={200: ApprovalSerializer},
    )
    @action(detail=True, methods=['post'], url_path='action')
    def execute_action(self, request, pk=None):
        """
        Execute a workflow state transition on a request.
        The caller must specify: action, acting_role, optional comments and extra_data.
        """
        rq_instance = self.get_object()
        serializer = WorkflowActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        engine = WorkflowEngine(
            request=rq_instance,
            user=request.user,
            acting_role=data['acting_role'],
        )

        try:
            approval = engine.execute(
                action=data['action'],
                comments=data.get('comments', ''),
                extra_data=data.get('extra_data', {}),
            )
        except WorkflowError as e:
            return Response({'detail': str(e.message)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionDeniedForAction as e:
            return Response({'detail': str(e.message)}, status=status.HTTP_403_FORBIDDEN)

        return Response(ApprovalSerializer(approval).data, status=status.HTTP_200_OK)

    @extend_schema(
        tags=['requests'],
        summary='Get available workflow actions for current user',
    )
    @action(detail=True, methods=['get'], url_path='available-actions')
    def available_actions(self, request, pk=None):
        """
        Returns the list of workflow actions the current user can perform
        on this request given its current status.
        """
        rq_instance = self.get_object()
        # Use the primary role of the user for this query
        acting_role = request.query_params.get('role')
        if not acting_role:
            primary = request.user.user_roles.filter(is_primary=True).first()
            acting_role = primary.role if primary else 'REQUESTER'

        engine = WorkflowEngine(rq_instance, request.user, acting_role)
        return Response({'available_actions': engine.get_available_actions()})

    @extend_schema(tags=['requests'], summary='Get request approval history')
    @action(detail=True, methods=['get'], url_path='approvals')
    def approvals(self, request, pk=None):
        """Return the full approval/action history for this request."""
        rq_instance = self.get_object()
        approvals = rq_instance.approvals.select_related('performed_by', 'workflow_step').order_by('performed_at')
        serializer = ApprovalSerializer(approvals, many=True)
        return Response(serializer.data)

    @extend_schema(tags=['requests'], summary='Get request activity log')
    @action(detail=True, methods=['get'], url_path='activity')
    def activity(self, request, pk=None):
        """Return the activity log for this request."""
        rq_instance = self.get_object()
        logs = rq_instance.activity_logs.select_related('user').order_by('created_at')
        serializer = ActivityLogSerializer(logs, many=True)
        return Response(serializer.data)

    @extend_schema(tags=['requests'], summary='List request attachments')
    @action(detail=True, methods=['get'], url_path='attachments')
    def attachments(self, request, pk=None):
        """Return all attachments for this request."""
        rq_instance = self.get_object()
        attachments = rq_instance.attachments.select_related('uploaded_by').all()
        serializer = AttachmentSerializer(attachments, many=True)
        return Response(serializer.data)
