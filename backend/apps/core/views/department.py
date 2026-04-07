"""
Department, AnnualPlan, and AnnualPlanLine viewsets.
"""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.core.models import Department, AnnualPlan, AnnualPlanLine
from apps.core.serializers.department import (
    DepartmentSerializer,
    AnnualPlanSerializer,
    AnnualPlanLineSerializer,
)
from apps.core.permissions import IsAdminOrReadOnly


@extend_schema_view(
    list=extend_schema(tags=['departments'], summary='List departments'),
    retrieve=extend_schema(tags=['departments'], summary='Get department detail'),
    create=extend_schema(tags=['departments'], summary='Create department'),
    update=extend_schema(tags=['departments'], summary='Update department'),
    destroy=extend_schema(tags=['departments'], summary='Delete department'),
)
class DepartmentViewSet(viewsets.ModelViewSet):
    """CRUD endpoints for Departments."""

    queryset = Department.objects.select_related('manager').all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name']


@extend_schema_view(
    list=extend_schema(tags=['departments'], summary='List annual plans'),
    retrieve=extend_schema(tags=['departments'], summary='Get annual plan detail'),
    create=extend_schema(tags=['departments'], summary='Create annual plan'),
    update=extend_schema(tags=['departments'], summary='Update annual plan'),
    destroy=extend_schema(tags=['departments'], summary='Delete annual plan'),
)
class AnnualPlanViewSet(viewsets.ModelViewSet):
    """CRUD endpoints for Annual Plans (Plan Anual)."""

    queryset = AnnualPlan.objects.select_related('department', 'approved_by').prefetch_related('lines').all()
    serializer_class = AnnualPlanSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['year', 'department', 'is_active']
    search_fields = ['department__name', 'department__code']


@extend_schema_view(
    list=extend_schema(tags=['departments'], summary='List annual plan lines'),
    retrieve=extend_schema(tags=['departments'], summary='Get annual plan line'),
    create=extend_schema(tags=['departments'], summary='Create annual plan line'),
    update=extend_schema(tags=['departments'], summary='Update annual plan line'),
    destroy=extend_schema(tags=['departments'], summary='Delete annual plan line'),
)
class AnnualPlanLineViewSet(viewsets.ModelViewSet):
    """CRUD endpoints for Annual Plan Lines."""

    queryset = AnnualPlanLine.objects.select_related('annual_plan__department').all()
    serializer_class = AnnualPlanLineSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['annual_plan', 'category']
    search_fields = ['code', 'description']
