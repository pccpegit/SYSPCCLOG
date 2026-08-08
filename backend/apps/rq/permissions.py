"""
RQ-specific permissions.
"""

from rest_framework.permissions import BasePermission
from apps.core.enums import RoleChoices


# Roles with visibility over every Request regardless of project/department scope.
# Mirrors RequestViewSet.get_queryset's wide_access_roles — kept here so other
# apps/rq resources (e.g. Claim creation) can validate access to a single Request
# without duplicating the role list ad-hoc.
WIDE_REQUEST_ACCESS_ROLES = [
    RoleChoices.GENERAL_MANAGER,
    RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR,
    RoleChoices.LOGISTICS_CHIEF,
    RoleChoices.CENTRAL_WAREHOUSE,
]


def get_accessible_requests_queryset(user):
    """
    SYSPCC-006 FIX 3: queryset of `Request` objects the given user may see/act on.
    Mirrors the scoping in RequestViewSet.get_queryset (own requests, or requests
    in the user's assigned project/department, or all for staff/wide-access roles).
    """
    from django.db.models import Q
    from apps.rq.models import Request

    qs = Request.objects.all()
    if user.is_staff or user.is_superuser:
        return qs

    roles = list(user.user_roles.values_list('role', flat=True))
    if any(r in WIDE_REQUEST_ACCESS_ROLES for r in roles):
        return qs

    return qs.filter(
        Q(requested_by=user)
        | Q(project__in=user.user_roles.values('project'))
        | Q(department__in=user.user_roles.values('department_obj'))
    )


def user_can_access_request(user, request_obj):
    """SYSPCC-006 FIX 3: True if `user` may see/act on `request_obj`."""
    return get_accessible_requests_queryset(user).filter(pk=request_obj.pk).exists()


class CanPerformWorkflowAction(BasePermission):
    """
    Allows workflow actions only if the user actually holds the declared acting_role.
    The acting_role is also re-validated inside WorkflowEngine as a defence-in-depth
    measure, but this permission provides an early HTTP-layer rejection.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.exists()

    def has_object_permission(self, request, view, obj):
        # FIX-06: Verify the acting_role from the request body is actually
        # held by the user in the database.  Returning True unconditionally
        # allowed any authenticated user to impersonate any role.
        acting_role = request.data.get('acting_role')
        if not acting_role:
            return False
        return request.user.user_roles.filter(role=acting_role).exists()
