"""
RQ-specific permissions.
"""

from rest_framework.permissions import BasePermission
from apps.core.enums import RoleChoices


# Roles with visibility over every Request regardless of project/department scope.
# Kept here so other apps/rq resources (e.g. Claim creation, Quotation/PO
# scoping) can validate access to a single Request without duplicating the
# role list ad-hoc.
WIDE_REQUEST_ACCESS_ROLES = [
    RoleChoices.GENERAL_MANAGER,
    RoleChoices.LOGISTICS_COORDINATOR,
    RoleChoices.LOGISTICS_SUPERVISOR,
    RoleChoices.LOGISTICS_CHIEF,
    RoleChoices.CENTRAL_WAREHOUSE,
]

# SYSPCC-011 FIX 1: roles that legitimately need to see every Request within
# their assigned project — because they act on the OPS approval/workflow for
# that project (PROJECT_RESIDENT, PROJECT_CONTROL) or dispatch/receive site
# deliveries for it (SITE_WAREHOUSE). A UserRole tied to a project with any
# *other* role (most commonly REQUESTER) must NOT grant project-wide visibility
# — that was the SYSPCC-011 bug: a REQUESTER assigned to a project could see
# every RQ in that project, not just their own.
PROJECT_SCOPE_ROLES = [
    RoleChoices.PROJECT_RESIDENT,
    RoleChoices.PROJECT_CONTROL,
    RoleChoices.SITE_WAREHOUSE,
]

# Same idea for the ADMINISTRATIVE flow: only these roles get department-wide
# visibility via a department-scoped UserRole.
DEPARTMENT_SCOPE_ROLES = [
    RoleChoices.DIRECT_SUPERVISOR,
    RoleChoices.ADMIN_MANAGER,
]


def get_accessible_requests_queryset(user):
    """
    SYSPCC-006 FIX 3 / SYSPCC-011 FIX 1: queryset of `Request` objects the
    given user may see/act on.

    - Staff/superuser and WIDE_REQUEST_ACCESS_ROLES: every Request.
    - PROJECT_SCOPE_ROLES / DEPARTMENT_SCOPE_ROLES: every Request in the
      project/department their UserRole is scoped to.
    - Everyone else (in particular a plain REQUESTER): only requests they
      created themselves.

    This is the single source of truth for Request visibility — RequestViewSet
    and the Quotation/PurchaseOrder viewsets all filter through this function
    (directly or via `request__in=`) so the scoping can't drift between them.
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
        | Q(project__in=user.user_roles.filter(role__in=PROJECT_SCOPE_ROLES).values('project'))
        | Q(department__in=user.user_roles.filter(role__in=DEPARTMENT_SCOPE_ROLES).values('department_obj'))
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
