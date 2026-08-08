from rest_framework import serializers
from apps.rq.models import Claim
from apps.rq.permissions import user_can_access_request

# SYSPCC-006 FIX 3: fields that must never be attacker-controlled at creation time.
# `raised_by` is forced to the requesting user in ClaimViewSet.perform_create;
# `status`/`managed_by`/`resolved_by`/`resolved_at` must come from the claim
# management flow (a PATCH by logistics staff), never from the initial payload.
CREATE_PROTECTED_FIELDS = ('raised_by', 'status', 'managed_by', 'resolved_by', 'resolved_at')


class ClaimSerializer(serializers.ModelSerializer):
    claim_type_display = serializers.CharField(source='get_claim_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    raised_by_name = serializers.CharField(source='raised_by.get_full_name', read_only=True)

    class Meta:
        model = Claim
        fields = [
            'id',
            'request',
            'claim_type',
            'claim_type_display',
            'raised_by',
            'raised_by_name',
            'managed_by',
            'status',
            'status_display',
            'description',
            'resolution',
            'resolved_by',
            'created_at',
            'resolved_at',
        ]
        read_only_fields = ['created_at']

    def get_fields(self):
        """
        SYSPCC-006 FIX 3: on creation (POST), lock down who raised the claim and
        its management/resolution state — those are only ever set by the claim
        management flow (PATCH by logistics staff), never by the submitter.
        Left writable on update so logistics staff can still manage the claim
        through this same endpoint.
        """
        fields = super().get_fields()
        request = self.context.get('request')
        if request is not None and request.method == 'POST':
            for field_name in CREATE_PROTECTED_FIELDS:
                fields[field_name].read_only = True
        return fields

    def validate_request(self, value):
        """SYSPCC-006 FIX 3: block creating a claim against a request the user can't access."""
        user = self.context['request'].user
        if not user_can_access_request(user, value):
            raise serializers.ValidationError(
                'No tiene acceso a este requerimiento.'
            )
        return value
