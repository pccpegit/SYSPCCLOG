"""
Views for the support app.
"""

from django.utils import timezone
from django.db.models import Q

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.filters import SearchFilter, OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend

from apps.support.models import Ticket, TicketComment
from apps.support.serializers import (
    TicketListSerializer,
    TicketDetailSerializer,
    TicketCreateSerializer,
    TicketCommentSerializer,
    TicketCommentCreateSerializer,
)
from apps.core.enums import TicketStatusChoices


class TicketViewSet(viewsets.ModelViewSet):
    """
    API endpoint for IT support tickets.

    Regular users see only their own tickets.
    Staff users see all tickets.
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'priority', 'category']
    search_fields = ['title', 'description', 'ticket_number']
    ordering_fields = ['created_at', 'updated_at', 'priority', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        # Guard for drf-spectacular schema introspection
        if getattr(self, 'swagger_fake_view', False):
            return Ticket.objects.none()

        user = self.request.user
        qs = Ticket.objects.select_related(
            'created_by',
            'assigned_to',
        ).prefetch_related(
            'comments__author',
        )
        if user.is_staff or user.is_superuser:
            return qs
        return qs.filter(created_by=user)

    def get_serializer_class(self):
        if self.action == 'list':
            return TicketListSerializer
        if self.action == 'retrieve':
            return TicketDetailSerializer
        if self.action == 'create':
            return TicketCreateSerializer
        return TicketListSerializer

    # ------------------------------------------------------------------
    # Custom actions
    # ------------------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='change-status')
    def change_status(self, request, pk=None):
        """
        Change the status of a ticket.

        Request body:
            status  (required) — one of TicketStatusChoices values
            comment (optional) — narrative for the status-change log entry
        """
        ticket = self.get_object()
        new_status = request.data.get('status')
        comment_text = request.data.get('comment', '').strip()

        valid_statuses = [choice[0] for choice in TicketStatusChoices.choices]
        if not new_status or new_status not in valid_statuses:
            return Response(
                {'detail': f"Estado inválido. Opciones: {', '.join(valid_statuses)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_status = ticket.status

        if old_status == new_status:
            return Response(
                {'detail': 'El ticket ya se encuentra en ese estado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ticket.status = new_status

        if new_status == TicketStatusChoices.RESOLVED and not ticket.resolved_at:
            ticket.resolved_at = timezone.now()

        ticket.save()

        # Build system comment content
        old_label = TicketStatusChoices(old_status).label
        new_label = TicketStatusChoices(new_status).label
        system_content = f"Estado cambiado de '{old_label}' a '{new_label}'."
        if comment_text:
            system_content += f" Nota: {comment_text}"

        TicketComment.objects.create(
            ticket=ticket,
            author=request.user,
            content=system_content,
            is_status_change=True,
            old_status=old_status,
            new_status=new_status,
        )

        serializer = TicketDetailSerializer(ticket, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add-comment')
    def add_comment(self, request, pk=None):
        """
        Add a plain comment to a ticket.

        Not allowed when the ticket is CLOSED.
        """
        ticket = self.get_object()

        if ticket.status == TicketStatusChoices.CLOSED:
            return Response(
                {'detail': 'No se pueden agregar comentarios a un ticket cerrado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TicketCommentCreateSerializer(
            data=request.data,
            context={'request': request, 'ticket': ticket},
        )
        serializer.is_valid(raise_exception=True)
        comment = serializer.save()

        return Response(
            TicketCommentSerializer(comment, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get'], url_path='my-stats')
    def my_stats(self, request):
        """
        Return ticket counts grouped by status for the current user.
        """
        user = request.user
        base_qs = Ticket.objects.filter(created_by=user)

        data = {
            'open': base_qs.filter(status=TicketStatusChoices.OPEN).count(),
            'in_progress': base_qs.filter(status=TicketStatusChoices.IN_PROGRESS).count(),
            'resolved': base_qs.filter(status=TicketStatusChoices.RESOLVED).count(),
            'total': base_qs.count(),
        }
        return Response(data)
