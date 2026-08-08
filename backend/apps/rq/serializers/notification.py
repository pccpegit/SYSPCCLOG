from rest_framework import serializers
from apps.rq.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'user', 'request', 'title', 'message', 'is_read', 'created_at']
        read_only_fields = ['created_at']
