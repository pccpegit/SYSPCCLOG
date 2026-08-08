"""
Department, AnnualPlan, and AnnualPlanLine serializers.
"""

from rest_framework import serializers
from apps.core.models import Department, AnnualPlan, AnnualPlanLine


class AnnualPlanLineSerializer(serializers.ModelSerializer):
    available_amount = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = AnnualPlanLine
        fields = [
            'id',
            'annual_plan',
            'code',
            'description',
            'category',
            'budgeted_amount',
            'committed_amount',
            'spent_amount',
            'available_amount',
            'created_at',
        ]
        read_only_fields = ['committed_amount', 'spent_amount', 'created_at']


class AnnualPlanSerializer(serializers.ModelSerializer):
    lines = AnnualPlanLineSerializer(many=True, read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.get_full_name', read_only=True, allow_null=True)

    class Meta:
        model = AnnualPlan
        fields = [
            'id',
            'year',
            'department',
            'department_name',
            'total_budget',
            'approved_by',
            'approved_by_name',
            'approved_at',
            'is_active',
            'lines',
            'created_at',
        ]
        read_only_fields = ['created_at']


class DepartmentSerializer(serializers.ModelSerializer):
    manager_name = serializers.CharField(source='manager.get_full_name', read_only=True, allow_null=True)

    class Meta:
        model = Department
        fields = [
            'id',
            'code',
            'name',
            'frente',
            'manager',
            'manager_name',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['created_at']
