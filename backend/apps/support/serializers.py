"""
Serializers for the support app.
"""

from rest_framework import serializers

from apps.support.models import Ticket, TicketComment
from apps.support.services import auto_assign_priority
from apps.core.enums import TicketStatusChoices


# ---------------------------------------------------------------------------
# Nested author / user representation
# ---------------------------------------------------------------------------

class TicketUserSerializer(serializers.Serializer):
    """Minimal user representation used inside ticket serializers."""

    id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    username = serializers.CharField(read_only=True)


# ---------------------------------------------------------------------------
# Comment serializers
# ---------------------------------------------------------------------------

class TicketCommentSerializer(serializers.ModelSerializer):
    """Read serializer for a ticket comment."""

    author = TicketUserSerializer(read_only=True)
    old_status_display = serializers.SerializerMethodField()
    new_status_display = serializers.SerializerMethodField()

    class Meta:
        model = TicketComment
        fields = [
            'id',
            'ticket',
            'author',
            'content',
            'is_status_change',
            'old_status',
            'new_status',
            'old_status_display',
            'new_status_display',
            'created_at',
        ]
        read_only_fields = fields

    def get_old_status_display(self, obj) -> str | None:
        if obj.old_status:
            return TicketStatusChoices(obj.old_status).label
        return None

    def get_new_status_display(self, obj) -> str | None:
        if obj.new_status:
            return TicketStatusChoices(obj.new_status).label
        return None


class TicketCommentCreateSerializer(serializers.ModelSerializer):
    """Write serializer to add a plain comment to a ticket."""

    class Meta:
        model = TicketComment
        fields = ['content']

    def create(self, validated_data):
        request = self.context['request']
        ticket = self.context['ticket']
        return TicketComment.objects.create(
            ticket=ticket,
            author=request.user,
            **validated_data,
        )


# ---------------------------------------------------------------------------
# Ticket serializers
# ---------------------------------------------------------------------------

class TicketListSerializer(serializers.ModelSerializer):
    """Compact serializer for list views."""

    created_by = TicketUserSerializer(read_only=True)
    assigned_to = TicketUserSerializer(read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            'id',
            'ticket_number',
            'title',
            'category',
            'category_display',
            'priority',
            'priority_display',
            'status',
            'status_display',
            'created_by',
            'assigned_to',
            'created_at',
            'updated_at',
            'comment_count',
        ]

    def get_comment_count(self, obj) -> int:
        # Only count non-system comments
        return obj.comments.filter(is_status_change=False).count()


class TicketDetailSerializer(TicketListSerializer):
    """Full detail serializer including description, resolved_at, and comments."""

    comments = TicketCommentSerializer(many=True, read_only=True)

    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + [
            'description',
            'resolved_at',
            'comments',
        ]


class TicketCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating a new ticket."""

    class Meta:
        model = Ticket
        fields = ['id', 'title', 'description', 'category', 'ticket_number', 'priority', 'status']
        read_only_fields = ['id', 'ticket_number', 'priority', 'status']

    def create(self, validated_data):
        request = self.context['request']
        priority = auto_assign_priority(
            category=validated_data.get('category', ''),
            title=validated_data.get('title', ''),
            description=validated_data.get('description', ''),
        )
        return Ticket.objects.create(
            created_by=request.user,
            priority=priority,
            **validated_data,
        )
