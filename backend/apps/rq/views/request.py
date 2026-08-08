"""
Request (RQ) viewset - the central API resource.
"""

import logging

from django.db.models import Case, When, Value, CharField

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
    UpdateItemsSerializer,
)
from apps.rq.serializers.approval import ApprovalSerializer, WorkflowActionSerializer
from apps.rq.serializers.activity_log import ActivityLogSerializer
from apps.rq.serializers.attachment import AttachmentSerializer
from apps.rq.serializers.notification import NotificationSerializer
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.core.permissions import IsLogisticsStaff
from apps.rq.filters import RequestFilter
from apps.rq.permissions import get_accessible_requests_queryset, CanPerformWorkflowAction

logger = logging.getLogger(__name__)


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
        # SYSPCC-011 FIX 1: scoping now lives in a single place —
        # apps.rq.permissions.get_accessible_requests_queryset — so it can't
        # drift from the scoping used by Quotation/PurchaseOrder/Claim
        # visibility. See that function's docstring for the exact rules.
        return get_accessible_requests_queryset(self.request.user).select_related(
            'project', 'department', 'requested_by', 'current_step',
            'budget_line', 'annual_plan_line',
        ).prefetch_related('items')

    def get_permissions(self):
        # SYSPCC-011 FIX 2: only logistics roles may rewrite item supply_source.
        if self.action == 'update_items':
            return [IsAuthenticated(), IsLogisticsStaff()]
        # SYSPCC-011 FIX 5: defense-in-depth HTTP-layer rejection in addition to
        # WorkflowEngine's own acting_role validation (see execute_action below).
        if self.action == 'execute_action':
            return [IsAuthenticated(), CanPerformWorkflowAction()]
        return [permission() for permission in self.permission_classes]

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

        action_ctx = {
            'rq_id': rq_instance.pk,
            'user_id': request.user.id,
            'action': data['action'],
        }

        try:
            approval = engine.execute(
                action=data['action'],
                comments=data.get('comments', ''),
                extra_data=data.get('extra_data', {}),
            )
        except WorkflowError as e:
            # Expected: invalid transition for the current state — warning only.
            logger.warning('rq.action.invalid', extra=action_ctx | {'reason': str(e.message)})
            return Response({'detail': str(e.message)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionDeniedForAction as e:
            logger.warning('rq.action.forbidden', extra=action_ctx | {'reason': str(e.message)})
            return Response({'detail': str(e.message)}, status=status.HTTP_403_FORBIDDEN)
        except Exception:
            # Last barrier: unexpected failure inside WorkflowEngine.execute —
            # log full stack with context for production traceability, then
            # re-raise so DRF's exception handler returns a 500 as usual.
            logger.exception('rq.action.unexpected', extra=action_ctx)
            raise

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

    @extend_schema(
        tags=['requests'],
        summary='Update supply source for request items',
        request=UpdateItemsSerializer,
    )
    @action(detail=True, methods=['patch'], url_path='update-items')
    def update_items(self, request, pk=None):
        """
        Update supply_source for each item (set by logistics during stock check).
        SYSPCC-011 FIX 2: restricted to logistics roles (see get_permissions) and
        payload is validated by UpdateItemsSerializer — item_id must be an
        integer and supply_source must be a valid choice, so a malformed
        payload returns 400 instead of failing inside the Case/When update.
        """
        rq_instance = self.get_object()
        serializer = UpdateItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items_data = serializer.validated_data['items']

        cases = []
        item_ids = []
        for item_update in items_data:
            item_id = item_update['item_id']
            supply_source = item_update['supply_source']
            cases.append(When(id=item_id, then=Value(supply_source)))
            item_ids.append(item_id)
        if cases:
            # Scoped to rq_instance.items so an item_id belonging to a
            # different Request can never be touched from this endpoint.
            rq_instance.items.filter(id__in=item_ids).update(
                supply_source=Case(*cases, output_field=CharField())
            )
        return Response({'detail': 'Items actualizados.'})
