"""
Request and RequestItem serializers.
"""

import logging

from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.rq.models import Request, RequestItem
from apps.core.serializers.user import UserListSerializer

logger = logging.getLogger(__name__)


class RequestItemSerializer(serializers.ModelSerializer):

    class Meta:
        model = RequestItem
        fields = [
            'id',
            'request',
            'line_number',
            'description',
            'specifications',
            'quantity',
            'unit',
            'unit_price',
            'total_price',
            'stock_almacen_obra',
            'stock_almacen_central',
            'x_atender',
            'presupuestado_adicional',
            'rfi_fwo',
            'estatus_guia',
            'supply_source',
            'comentarios',
            'created_at',
        ]
        read_only_fields = ['request', 'total_price', 'created_at']


class UpdateItemPayloadSerializer(serializers.Serializer):
    """
    SYSPCC-011 FIX 2: one line of the update-items payload. Validates types so
    a malformed request body returns 400 instead of reaching the raw
    Case/When queryset update in RequestViewSet.update_items.
    """

    item_id = serializers.IntegerField()
    supply_source = serializers.ChoiceField(
        choices=RequestItem._meta.get_field('supply_source').choices
    )


class UpdateItemsSerializer(serializers.Serializer):
    """Payload for PATCH /api/v1/requests/{id}/update-items/."""

    items = UpdateItemPayloadSerializer(many=True)


class RequestListSerializer(serializers.ModelSerializer):
    """Compact serializer for list views."""

    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    acquisition_type_display = serializers.CharField(source='get_acquisition_type_display', read_only=True)
    project_code = serializers.CharField(source='project.code', read_only=True, allow_null=True)
    project_name = serializers.CharField(source='project.name', read_only=True, allow_null=True)
    department_code = serializers.CharField(source='department.code', read_only=True, allow_null=True)
    department_name = serializers.CharField(source='department.name', read_only=True, allow_null=True)

    class Meta:
        model = Request
        fields = [
            'id',
            'rq_number',
            'flow',
            'flow_display',
            'description',
            'project',
            'project_code',
            'project_name',
            'department',
            'department_code',
            'department_name',
            'requested_by',
            'requested_by_name',
            'acquisition_type',
            'acquisition_type_display',
            'priority',
            'priority_display',
            'status',
            'status_display',
            'estimated_cost',
            'fecha_necesidad',
            'fecha_estimada_entrega',
            'created_at',
        ]


class RequestDetailSerializer(serializers.ModelSerializer):
    """Full detail serializer with nested items."""

    items = RequestItemSerializer(many=True, read_only=True)
    requested_by_detail = UserListSerializer(source='requested_by', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    acquisition_type_display = serializers.CharField(source='get_acquisition_type_display', read_only=True)
    budget_classification_display = serializers.CharField(
        source='get_budget_classification_display', read_only=True, allow_null=True
    )
    project_code = serializers.CharField(source='project.code', read_only=True, allow_null=True)
    project_name = serializers.CharField(source='project.name', read_only=True, allow_null=True)
    project_frente = serializers.CharField(source='project.frente', read_only=True, allow_null=True)
    department_code = serializers.CharField(source='department.code', read_only=True, allow_null=True)
    department_name = serializers.CharField(source='department.name', read_only=True, allow_null=True)
    is_terminal = serializers.BooleanField(read_only=True)
    total_items_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = Request
        fields = [
            'id',
            'rq_number',
            'flow',
            'flow_display',
            'project',
            'project_code',
            'project_name',
            'project_frente',
            'department',
            'department_code',
            'department_name',
            'requested_by',
            'requested_by_name',
            'requested_by_detail',
            'front_area',
            'service',
            'specific_use',
            'description',
            'justification',
            'acquisition_type',
            'acquisition_type_display',
            'priority',
            'priority_display',
            'status',
            'status_display',
            'current_step',
            'budget_classification',
            'budget_classification_display',
            'budget_line',
            'annual_plan_line',
            'estimated_cost',
            'final_cost',
            'fecha_necesidad',
            'fecha_estimada_entrega',
            'fecha_real_entrega',
            'is_terminal',
            'total_items_cost',
            'items',
            'created_at',
            'updated_at',
        ]
        # FIX-17: requested_by must not be writable via the API to prevent
        # request ownership spoofing.
        read_only_fields = ['rq_number', 'status', 'current_step', 'requested_by', 'created_at', 'updated_at']


class RequestCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a new request (DRAFT status)."""

    items = RequestItemSerializer(many=True)

    class Meta:
        model = Request
        fields = [
            'rq_number',
            'flow',
            'project',
            'department',
            'front_area',
            'service',
            'specific_use',
            'description',
            'justification',
            'acquisition_type',
            'priority',
            'budget_line',
            'annual_plan_line',
            'estimated_cost',
            'fecha_necesidad',
            'items',
        ]
        # SYSPCC-007: rq_number is generated server-side (RQNumberGenerator, which
        # locks the latest RQ row). Making it read-only closes the TOCTOU window where
        # a client-supplied number could collide with one generated concurrently, and
        # stops clients from spoofing/forging the RQ number.
        read_only_fields = ['rq_number']

    def validate(self, attrs):
        flow = attrs.get('flow')
        if flow == 'OPERATIONS' and not attrs.get('project'):
            raise serializers.ValidationError({'project': 'El flujo Operaciones requiere un proyecto.'})
        if flow == 'ADMINISTRATIVE' and not attrs.get('department'):
            raise serializers.ValidationError({'department': 'El flujo Administración requiere un departamento.'})
        return attrs

    def create(self, validated_data):
        from apps.rq.models import Approval
        from apps.rq.services.number_generator import RQNumberGenerator

        items_data = validated_data.pop('items', [])
        user = self.context['request'].user
        validated_data.pop('rq_number', None)  # ignore any client-supplied value
        validated_data['requested_by'] = user
        validated_data['status'] = 'SUBMITTED'

        try:
            with transaction.atomic():
                # RQNumberGenerator.generate() locks the latest RQ row for the
                # current year (select_for_update) so two concurrent submissions
                # cannot compute the same rq_number.
                validated_data['rq_number'] = RQNumberGenerator.generate()
                request_obj = Request.objects.create(**validated_data)

                for idx, item_data in enumerate(items_data, start=1):
                    item_data['line_number'] = idx
                    RequestItem.objects.create(request=request_obj, **item_data)

                # Register the submission in the approval chain
                Approval.objects.create(
                    request=request_obj,
                    action='SUBMITTED',
                    performed_by=user,
                    role=user.user_roles.first().role if user.user_roles.exists() else 'REQUESTER',
                    previous_status='DRAFT',
                    new_status='SUBMITTED',
                    comments='Requerimiento enviado para revisión.',
                )
        except IntegrityError:
            # Last barrier: the DB-level unique constraint on rq_number caught a
            # collision the lock should have prevented (or an item/approval FK
            # violation). Nothing was persisted — the atomic block rolled back.
            logger.warning(
                'request.create.integrity_error', extra={'user_id': getattr(user, 'id', None)},
            )
            raise serializers.ValidationError(
                {'rq_number': 'No se pudo generar el número de requerimiento, intente nuevamente.'}
            )

        return request_obj
