"""
Django-filter filterset classes for the rq app.
"""

import django_filters
from apps.rq.models import Request
from apps.core.enums import RQFlowChoices, RQStatusChoices, PriorityChoices, AcquisitionTypeChoices


class RequestFilter(django_filters.FilterSet):
    """
    Filterset for Request list endpoint.
    Supports: rq_number, flow, status, priority, acquisition_type, project,
              department, requested_by, date range filters.
    """

    rq_number = django_filters.CharFilter(field_name='rq_number', lookup_expr='exact')
    flow = django_filters.ChoiceFilter(choices=RQFlowChoices.choices)
    status = django_filters.ChoiceFilter(choices=RQStatusChoices.choices)
    status_in = django_filters.BaseInFilter(field_name='status', lookup_expr='in')
    priority = django_filters.ChoiceFilter(choices=PriorityChoices.choices)
    acquisition_type = django_filters.ChoiceFilter(choices=AcquisitionTypeChoices.choices)
    project = django_filters.NumberFilter(field_name='project__id')
    department = django_filters.NumberFilter(field_name='department__id')
    requested_by = django_filters.NumberFilter(field_name='requested_by__id')

    # Date ranges
    created_after = django_filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_before = django_filters.DateFilter(field_name='created_at', lookup_expr='lte')
    necesidad_after = django_filters.DateFilter(field_name='fecha_necesidad', lookup_expr='gte')
    necesidad_before = django_filters.DateFilter(field_name='fecha_necesidad', lookup_expr='lte')

    # Cost ranges
    estimated_cost_min = django_filters.NumberFilter(field_name='estimated_cost', lookup_expr='gte')
    estimated_cost_max = django_filters.NumberFilter(field_name='estimated_cost', lookup_expr='lte')

    class Meta:
        model = Request
        fields = [
            'rq_number',
            'flow',
            'status',
            'priority',
            'acquisition_type',
            'project',
            'department',
            'requested_by',
            'budget_classification',
        ]
