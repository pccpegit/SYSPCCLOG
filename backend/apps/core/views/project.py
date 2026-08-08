"""
Project and ProjectBudgetLine viewsets.
"""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.core.models import Project, ProjectBudgetLine
from apps.core.serializers.project import (
    ProjectSerializer,
    ProjectListSerializer,
    ProjectBudgetLineSerializer,
)
from apps.core.permissions import IsAdminOrReadOnly


@extend_schema_view(
    list=extend_schema(tags=['projects'], summary='List projects'),
    retrieve=extend_schema(tags=['projects'], summary='Get project detail'),
    create=extend_schema(tags=['projects'], summary='Create project'),
    update=extend_schema(tags=['projects'], summary='Update project'),
    partial_update=extend_schema(tags=['projects'], summary='Partial update project'),
    destroy=extend_schema(tags=['projects'], summary='Delete project'),
)
class ProjectViewSet(viewsets.ModelViewSet):
    """CRUD endpoints for Projects (Obras)."""

    queryset = Project.objects.prefetch_related('budget_lines').all()
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name', 'client', 'location']
    ordering_fields = ['code', 'name', 'start_date', 'created_at']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return ProjectListSerializer
        return ProjectSerializer


@extend_schema_view(
    list=extend_schema(tags=['projects'], summary='List budget lines'),
    retrieve=extend_schema(tags=['projects'], summary='Get budget line'),
    create=extend_schema(tags=['projects'], summary='Create budget line'),
    update=extend_schema(tags=['projects'], summary='Update budget line'),
    destroy=extend_schema(tags=['projects'], summary='Delete budget line'),
)
class ProjectBudgetLineViewSet(viewsets.ModelViewSet):
    """CRUD endpoints for Project Budget Lines (Partidas)."""

    queryset = ProjectBudgetLine.objects.select_related('project').all()
    serializer_class = ProjectBudgetLineSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['project']
    search_fields = ['code', 'description']
