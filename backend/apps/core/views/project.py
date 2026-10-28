"""
Project and ProjectBudgetLine viewsets.
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.core.models import Project, ProjectBudgetLine
from apps.core.serializers.project import (
    ProjectSerializer,
    ProjectListSerializer,
    ProjectBudgetLineSerializer,
)
from apps.core.permissions import IsAdminOrReadOnly, IsSuperUser


@extend_schema_view(
    list=extend_schema(tags=['projects'], summary='List projects'),
    retrieve=extend_schema(tags=['projects'], summary='Get project detail'),
    create=extend_schema(tags=['projects'], summary='Create project'),
    update=extend_schema(tags=['projects'], summary='Update project'),
    partial_update=extend_schema(tags=['projects'], summary='Partial update project'),
    destroy=extend_schema(tags=['projects'], summary='Delete project'),
)
class ProjectViewSet(viewsets.ModelViewSet):
    """
    CRUD endpoints for Projects (Obras).
    Reads: any authenticated user. Writes (create/update/activate/
    deactivate): superadmin only (SYSPCC-018) — there is no business-level
    SUPERADMIN role, `is_superuser` is the gate. Projects are never
    hard-deleted (`destroy` -> 405), only deactivated.
    """

    queryset = Project.objects.prefetch_related('budget_lines').all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name', 'client', 'location']
    ordering_fields = ['code', 'name', 'start_date', 'created_at']
    ordering = ['-created_at']

    # Actions that mutate a project — superadmin only.
    SUPERUSER_ACTIONS = ('create', 'update', 'partial_update', 'destroy', 'activate', 'deactivate')

    def get_permissions(self):
        if self.action in self.SUPERUSER_ACTIONS:
            return [IsAuthenticated(), IsSuperUser()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return ProjectListSerializer
        return ProjectSerializer

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method, detail='Los proyectos no se eliminan. Use desactivar.')

    @extend_schema(tags=['projects'], summary='Activate project', request=None)
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        project = self.get_object()
        if not project.is_active:
            project.is_active = True
            project.save(update_fields=['is_active'])
        return Response(ProjectSerializer(project, context=self.get_serializer_context()).data)

    @extend_schema(tags=['projects'], summary='Deactivate project', request=None)
    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        project = self.get_object()
        if project.is_active:
            project.is_active = False
            project.save(update_fields=['is_active'])
        return Response(ProjectSerializer(project, context=self.get_serializer_context()).data)


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
