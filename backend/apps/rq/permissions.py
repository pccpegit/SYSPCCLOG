"""
RQ-specific permissions.
"""

from rest_framework.permissions import BasePermission
from apps.core.enums import RoleChoices


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
