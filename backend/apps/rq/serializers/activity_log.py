from rest_framework import serializers
from apps.rq.models import ActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = ActivityLog
        fields = ['id', 'request', 'user', 'user_name', 'action', 'detail', 'ip_address', 'created_at']
        read_only_fields = ['id', 'request', 'user', 'action', 'detail', 'ip_address', 'created_at']
