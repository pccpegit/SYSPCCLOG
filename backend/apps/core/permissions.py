"""
Custom DRF permissions for role-based access control.
"""

from rest_framework.permissions import BasePermission
from apps.core.enums import RoleChoices


class HasRole(BasePermission):
    """
    Permission class that checks if the user has any of the specified roles.
    Usage: combine with view-level role_required attribute.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        required_roles = getattr(view, 'role_required', None)
        if required_roles is None:
            return True

        if isinstance(required_roles, str):
            required_roles = [required_roles]

        return request.user.user_roles.filter(role__in=required_roles).exists()


class IsGeneralManager(BasePermission):
    """Only Gerente General can access."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.filter(role=RoleChoices.GENERAL_MANAGER).exists()


class IsLogisticsStaff(BasePermission):
    """Logistics roles (coordinator or supervisor or chief)."""

    LOGISTICS_ROLES = [
        RoleChoices.LOGISTICS_COORDINATOR,
        RoleChoices.LOGISTICS_SUPERVISOR,
        RoleChoices.LOGISTICS_CHIEF,
    ]

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.filter(role__in=self.LOGISTICS_ROLES).exists()


class IsWarehouseStaff(BasePermission):
    """Warehouse roles."""

    WAREHOUSE_ROLES = [
        RoleChoices.CENTRAL_WAREHOUSE,
        RoleChoices.SITE_WAREHOUSE,
    ]

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.filter(role__in=self.WAREHOUSE_ROLES).exists()


class IsAdminOrReadOnly(BasePermission):
    """Allow full access to Django admins, read-only to others."""

    def has_permission(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return request.user and request.user.is_authenticated
        return request.user and request.user.is_staff


class IsOwnerOrAdmin(BasePermission):
    """Allow access to resource owner or admin users."""

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True
        if hasattr(obj, 'requested_by'):
            return obj.requested_by == request.user
        if hasattr(obj, 'user'):
            return obj.user == request.user
        return False
