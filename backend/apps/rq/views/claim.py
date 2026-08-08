"""
Claim, Notification, and ActivityLog viewsets.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.rq.models import Claim, Notification, ActivityLog, Attachment
from apps.rq.serializers.claim import ClaimSerializer
from apps.rq.serializers.notification import NotificationSerializer
from apps.rq.serializers.activity_log import ActivityLogSerializer
from apps.rq.serializers.attachment import AttachmentSerializer
from apps.core.permissions import IsAdminOrReadOnly, IsLogisticsStaff
from apps.core.enums import RoleChoices


LOGISTICS_ROLES = [
    RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR,
    RoleChoices.LOGISTICS_CHIEF,
]


@extend_schema_view(
    list=extend_schema(tags=['claims'], summary='List claims'),
    retrieve=extend_schema(tags=['claims'], summary='Get claim detail'),
    create=extend_schema(tags=['claims'], summary='Create claim'),
    update=extend_schema(tags=['claims'], summary='Update claim'),
)
class ClaimViewSet(viewsets.ModelViewSet):
    """
    FIX-07: Queryset is scoped by role.
    - Staff / logistics roles see all claims.
    - Regular requesters see only claims they raised or that belong to their own requests.
    Write operations (update/delete) are restricted to logistics staff and admins.
    """

    serializer_class = ClaimSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['request', 'claim_type', 'status', 'raised_by']
    search_fields = ['description', 'resolution']

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsLogisticsStaff()]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        base_qs = Claim.objects.select_related(
            'request', 'raised_by', 'managed_by', 'resolved_by'
        )
        # Staff and logistics roles see all claims
        if user.is_staff or user.user_roles.filter(role__in=LOGISTICS_ROLES).exists():
            return base_qs.all()
        # Requesters see only claims they raised or related to their own requests
        return base_qs.filter(
            raised_by=user
        ) | base_qs.filter(request__requested_by=user)

    def perform_create(self, serializer):
        # SYSPCC-006 FIX 3: `raised_by` is always the authenticated user — never
        # trust a client-supplied value (impersonation). Also enforced by
        # ClaimSerializer.get_fields() marking it read-only on POST.
        serializer.save(raised_by=self.request.user)


@extend_schema_view(
    list=extend_schema(tags=['notifications'], summary='List my notifications'),
    retrieve=extend_schema(tags=['notifications'], summary='Get notification'),
)
class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_read', 'request']

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user).select_related('request').order_by('-created_at')

    @extend_schema(tags=['notifications'], summary='Mark notification as read')
    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save()
        return Response({'detail': 'Marcada como leída.'})

    @extend_schema(tags=['notifications'], summary='Mark all notifications as read')
    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({'detail': 'Todas marcadas como leídas.'})

    @extend_schema(tags=['notifications'], summary='Count unread notifications')
    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        count = self.get_queryset().filter(is_read=False).count()
        return Response({'unread_count': count})


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='List activity logs'),
)
class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    FIX-12: Activity logs are scoped by role.
    - Staff sees all logs.
    - Other users only see logs for requests they have access to (their own requests).
    """

    serializer_class = ActivityLogSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['request', 'user']

    def get_queryset(self):
        user = self.request.user
        base_qs = ActivityLog.objects.select_related('request', 'user')
        if user.is_staff or user.user_roles.filter(role__in=LOGISTICS_ROLES).exists():
            return base_qs.all()
        # Regular users see only logs tied to requests they own
        return base_qs.filter(request__requested_by=user)


class AttachmentViewSet(viewsets.ModelViewSet):
    """
    SYSPCC-006 FIX 2: `get_queryset()` scopes attachments the same way as
    ClaimViewSet/ActivityLogViewSet — the previous unscoped `queryset = ...all()`
    let any authenticated user GET or DELETE an attachment belonging to a
    request they had no access to (IDOR), just by guessing/enumerating the pk.
    """

    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['request', 'category']
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        base_qs = Attachment.objects.select_related('request', 'uploaded_by')
        # Staff and logistics roles see all attachments
        if user.is_staff or user.user_roles.filter(role__in=LOGISTICS_ROLES).exists():
            return base_qs.all()
        # Regular users see only attachments on requests they own
        return base_qs.filter(request__requested_by=user)

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
