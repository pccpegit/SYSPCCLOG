"""
Project and ProjectBudgetLine serializers.
"""

from rest_framework import serializers
from apps.core.models import Project, ProjectBudgetLine
from apps.core.enums import RoleChoices


class ProjectBudgetLineSerializer(serializers.ModelSerializer):
    available_amount = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = ProjectBudgetLine
        fields = [
            'id',
            'project',
            'code',
            'description',
            'budgeted_amount',
            'committed_amount',
            'spent_amount',
            'available_amount',
            'created_at',
        ]
        read_only_fields = ['committed_amount', 'spent_amount', 'created_at']


class ProjectSerializer(serializers.ModelSerializer):
    budget_lines = ProjectBudgetLineSerializer(many=True, read_only=True)
    residents = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            'id',
            'code',
            'name',
            'location',
            'client',
            'frente',
            'total_budget',
            'start_date',
            'end_date',
            'is_active',
            'budget_lines',
            'residents',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_residents(self, obj):
        """
        SYSPCC-018: read-only view of who holds PROJECT_RESIDENT on this
        project. There is no FK for this — assignment happens by editing
        the *user* (`roles` array in `UserAdminUpdateSerializer`), never
        here, to avoid a second source of truth.
        """
        qs = obj.user_roles.filter(role=RoleChoices.PROJECT_RESIDENT).select_related('user')
        return [
            {'id': ur.user_id, 'username': ur.user.username, 'full_name': ur.user.full_name}
            for ur in qs
        ]


class ProjectListSerializer(serializers.ModelSerializer):
    """Compact serializer for list views."""

    class Meta:
        model = Project
        fields = ['id', 'code', 'name', 'location', 'client', 'frente', 'is_active', 'start_date', 'end_date']
