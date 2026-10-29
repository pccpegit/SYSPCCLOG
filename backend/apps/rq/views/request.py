"""
Request (RQ) viewset - the central API resource.
"""

import logging

from django.db import IntegrityError

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
    RequestItemSerializer,
    UpdateItemsSerializer,
)
from apps.rq.serializers.approval import ApprovalSerializer, WorkflowActionSerializer
from apps.rq.serializers.activity_log import ActivityLogSerializer
from apps.rq.serializers.attachment import AttachmentSerializer
from apps.rq.serializers.catalog import StockAvailabilitySerializer
from apps.rq.serializers.notification import NotificationSerializer
from apps.rq.serializers.master import AttentionOverrideSerializer, MasterRowSerializer
from apps.rq.services import request_master
from apps.rq.services.item_attention import ItemNotFound, set_attention_override
from apps.rq.services.request_items import update_request_items
from apps.rq.services.stock_availability import build_stock_availability
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction, RequestItemConflict
from apps.core.permissions import IsLogisticsStaff
from apps.rq.filters import RequestFilter
from apps.rq.permissions import get_accessible_requests_queryset, CanPerformWorkflowAction

logger = logging.getLogger(__name__)


def _error_envelope(http_status: int, detail: str, code: str) -> Response:
    """Same envelope as `apps.core.exceptions.custom_exception_handler`, plus a stable `code`."""
    return Response(
        {'error': True, 'status_code': http_status, 'detail': detail, 'code': code}, status=http_status,
    )


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
        ).prefetch_related('items__inventory_item')

    def get_permissions(self):
        # SYSPCC-011 FIX 2: only logistics roles may rewrite item supply_source.
        if self.action in ('update_items', 'attention_override'):
            return [IsAuthenticated(), IsLogisticsStaff()]
        # SYSPCC-026: the net availability carries demand aggregated across
        # projects (what is promised to other RQs), so it is for the stock check,
        # i.e. logistics only. Checked before the object lookup: no oracle on RQ ids.
        if self.action == 'stock_availability':
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
        summary='Update the lines of a request during the stock check (logistics)',
        request=UpdateItemsSerializer,
    )
    @action(detail=True, methods=['patch'], url_path='update-items')
    def update_items(self, request, pk=None):
        """
        Logistics confirms, line by line, the catalog product (`inventory_item`) or
        marks it off-catalog (`is_off_catalog`), the family (`item_source`) and the
        origin of the supply (`supply_source`). Only the keys sent are applied.

        SYSPCC-011 FIX 2: restricted to logistics roles (see get_permissions); the
        payload is validated by UpdateItemsSerializer, so a malformed body returns 400.
        SYSPCC-026: runs atomically under a lock and answers 409 when the RQ is in a
        final state or a line already has warehouse dispatches (nothing is written).
        Item ids that do not belong to this RQ are never touched and come back in
        `ignored_item_ids`. The guard lives here only: it never blocks a workflow transition.
        """
        rq_instance = self.get_object()
        serializer = UpdateItemsSerializer(
            data=request.data, context={'line_count': rq_instance.items.count()},
        )
        serializer.is_valid(raise_exception=True)
        items_data = serializer.validated_data['items']

        ctx = {'rq_id': rq_instance.pk, 'user_id': request.user.id}
        try:
            result = update_request_items(rq_instance, items_data, request.user)
        except RequestItemConflict as exc:
            logger.warning(
                'rq.update_items.conflict',
                extra=ctx | {'code': exc.code, 'item_ids': exc.item_ids},
            )
            return Response(
                {'detail': exc.message, 'code': exc.code, 'item_ids': exc.item_ids},
                status=status.HTTP_409_CONFLICT,
            )
        except Request.DoesNotExist:
            logger.warning('rq.update_items.not_found', extra=ctx)
            return Response(
                {'detail': 'El requerimiento ya no existe.'}, status=status.HTTP_404_NOT_FOUND,
            )
        except IntegrityError:
            # A catalog product deleted between validation and save, or the DB-level
            # catalog/off-catalog constraint: nothing was persisted (atomic rollback).
            logger.warning('rq.update_items.integrity_error', extra=ctx)
            return Response(
                {'detail': 'No se pudieron guardar los cambios porque los datos cambiaron. '
                           'Actualice la página e intente nuevamente.',
                 'code': 'INTEGRITY_ERROR'},
                status=status.HTTP_409_CONFLICT,
            )
        except Exception:
            # Last barrier: unexpected failure — full stack with context, then 500.
            logger.exception('rq.update_items.unexpected', extra=ctx)
            raise

        return Response({
            'detail': 'Ítems actualizados.',
            'updated_item_ids': [item.pk for item in result.updated],
            'unchanged_item_ids': result.unchanged_item_ids,
            'ignored_item_ids': result.ignored_item_ids,
            'items': RequestItemSerializer(result.updated, many=True).data,
        })

    @extend_schema(
        tags=['requests'],
        summary='Stock availability of the request lines against the central warehouse',
        responses={200: StockAvailabilitySerializer},
    )
    @action(detail=True, methods=['get'], url_path='stock-availability')
    def stock_availability(self, request, pk=None):
        """
        For each line: what was requested, the linked catalog product, how much the
        CENTRAL pool holds (minus what other RQs still hold of it: those in IN_STOCK and
        purchases already received and not yet dispatched; minus what the earlier lines of
        this same RQ take of the product) and whether that covers the line fully,
        partially or not at all. A line whose unit differs from the product's is
        NOT_COMPARABLE.

        Read-only and advisory: the stock-check decision stays with logistics.
        Restricted to logistics roles (see get_permissions): `committed_other_requests`
        and `available_net` reveal what other projects have asked for. The RQ is looked
        up through get_accessible_requests_queryset (a foreign RQ answers 404). Uses
        only the `inventory_item` link, never a text match; `link_confirmed` tells
        whether logistics already confirmed it.
        """
        rq_instance = self.get_object()
        report = build_stock_availability(rq_instance)
        return Response(StockAvailabilitySerializer(report).data)

    @extend_schema(
        tags=['requests'],
        summary='Set or clear the manual attention status (STAND BY / DESESTIMADO) of a line',
        request=AttentionOverrideSerializer,
        responses={200: MasterRowSerializer},
    )
    @action(
        detail=True, methods=['post', 'patch'],
        url_path=r'items/(?P<item_id>[0-9]+)/attention-override',
    )
    def attention_override(self, request, pk=None, item_id=None):
        """
        SYSPCC-030 (Master de RQ): logistics sets (`override` STAND_BY | DESESTIMADO, with a
        mandatory `note`) or clears (`override` empty/null) the manual attention status of ONE
        line. It is the only editable datum of the Master: it never changes the RQ status nor
        any workflow transition. Who/when/why goes to the ActivityLog.

        Restricted to logistics roles (checked before the object lookup: no oracle on RQ ids);
        the RQ is looked up through get_accessible_requests_queryset. 404 for an unknown line,
        409 (`REQUEST_TERMINAL`) when the RQ is in a final state. Answers with the refreshed
        Master row of the line. POST and PATCH behave the same; repeating the same request is
        a no-op (`changed: false`).
        """
        rq_instance = self.get_object()
        serializer = AttentionOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ctx = {'rq_id': rq_instance.pk, 'item_id': int(item_id), 'user_id': request.user.id}
        try:
            result = set_attention_override(
                rq_instance.pk, int(item_id), request.user, data['override'], data['note'],
            )
        except RequestItemConflict as exc:
            logger.warning('rq.item_attention.conflict', extra=ctx | {'code': exc.code})
            return _error_envelope(status.HTTP_409_CONFLICT, exc.message, exc.code)
        except ItemNotFound:
            return _error_envelope(
                status.HTTP_404_NOT_FOUND, 'La línea no existe en este requerimiento.', 'ITEM_NOT_FOUND',
            )
        except Request.DoesNotExist:
            return _error_envelope(
                status.HTTP_404_NOT_FOUND, 'El requerimiento ya no existe.', 'REQUEST_NOT_FOUND',
            )
        except Exception:
            logger.exception('rq.item_attention.unexpected', extra=ctx)
            raise

        row = request_master.get_master_row(request.user, result.item.pk)
        return Response({
            'detail': 'Seguimiento actualizado.' if result.changed else 'Sin cambios.',
            'changed': result.changed,
            'item': MasterRowSerializer(row).data if row else None,
        })
