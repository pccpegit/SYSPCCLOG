from rest_framework import serializers
from apps.rq.models import Claim


class ClaimSerializer(serializers.ModelSerializer):
    claim_type_display = serializers.CharField(source='get_claim_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    raised_by_name = serializers.CharField(source='raised_by.get_full_name', read_only=True)

    class Meta:
        model = Claim
        fields = '__all__'
        read_only_fields = ['created_at', 'resolved_at']
