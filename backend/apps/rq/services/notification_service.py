"""
Notification service - creates in-app notifications on workflow transitions.
"""

import logging
from apps.core.enums import (
    RQStatusChoices,
    RoleChoices,
    ApprovalActionChoices,
    RQFlowChoices,
)

logger = logging.getLogger(__name__)

# Maps (flow, new_status) → list of roles to notify
NOTIFY_MAP: dict[tuple, list[str]] = {
    (RQFlowChoices.OPERATIONS, RQStatusChoices.SUBMITTED): [RoleChoices.PROJECT_RESIDENT],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.TECHNICAL_APPROVED): [RoleChoices.PROJECT_CONTROL],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.ADDITIONAL_REQ): [RoleChoices.GENERAL_MANAGER],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.GM_REVIEW): [RoleChoices.GENERAL_MANAGER],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.VALIDATED): [RoleChoices.LOGISTICS_COORDINATOR],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.IN_STOCK): [RoleChoices.CENTRAL_WAREHOUSE],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.QUOTING): [RoleChoices.LOGISTICS_COORDINATOR],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.PO_GENERATED): [RoleChoices.CENTRAL_WAREHOUSE],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.DELIVERED): [RoleChoices.REQUESTER],
    (RQFlowChoices.OPERATIONS, RQStatusChoices.CLOSED): [RoleChoices.REQUESTER],

    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.SUBMITTED): [RoleChoices.DIRECT_SUPERVISOR],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.SUPERVISOR_APPROVED): [RoleChoices.ADMIN_MANAGER],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.GM_REVIEW): [RoleChoices.GENERAL_MANAGER],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.VALIDATED): [RoleChoices.LOGISTICS_SUPERVISOR],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.QUOTING): [RoleChoices.LOGISTICS_CHIEF],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.QUOTE_COMPARISON): [RoleChoices.LOGISTICS_CHIEF],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.PO_GENERATED): [RoleChoices.LOGISTICS_SUPERVISOR],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.DELIVERED): [RoleChoices.CENTRAL_WAREHOUSE],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.WAREHOUSE_UPDATED): [RoleChoices.REQUESTER],
    (RQFlowChoices.ADMINISTRATIVE, RQStatusChoices.CLOSED): [RoleChoices.REQUESTER],
}


class NotificationService:
    """Sends in-app notifications to relevant users after workflow transitions."""

    @classmethod
    def notify_on_transition(cls, request, action: str, new_status: str, actor) -> None:
        """
        Send notifications to the appropriate role group for the new status.
        """
        from apps.rq.models import Notification
        from apps.core.models import User

        roles_to_notify = NOTIFY_MAP.get((request.flow, new_status), [])

        if not roles_to_notify:
            return

        title = f'RQ {request.rq_number} - Acción requerida'
        message = cls._build_message(request, action, new_status)

        # Find users with the required roles
        # Scope to project/department if applicable
        user_role_qs = User.objects.filter(
            user_roles__role__in=roles_to_notify,
            is_active=True,
        ).distinct()

        if request.project_id:
            # Prefer users assigned to this project, fall back to global
            project_users = user_role_qs.filter(
                user_roles__project=request.project
            )
            if project_users.exists():
                user_role_qs = project_users

        if request.department_id:
            dept_users = user_role_qs.filter(
                user_roles__department_obj=request.department
            )
            if dept_users.exists():
                user_role_qs = dept_users

        # Always notify the requester on terminal states
        terminal_statuses = {
            RQStatusChoices.TECHNICAL_REJECTED,
            RQStatusChoices.SUPERVISOR_REJECTED,
            RQStatusChoices.GM_REJECTED,
            RQStatusChoices.COST_OVERRUN_REJECTED,
            RQStatusChoices.CANCELLED,
            RQStatusChoices.CLOSED,
        }
        if new_status in terminal_statuses:
            user_role_qs = user_role_qs | User.objects.filter(pk=request.requested_by_id)

        notifications = [
            Notification(
                user=u,
                request=request,
                title=title,
                message=message,
            )
            for u in user_role_qs
            if u != actor  # Don't notify the person who performed the action
        ]

        if notifications:
            Notification.objects.bulk_create(notifications, ignore_conflicts=True)

    @classmethod
    def _build_message(cls, request, action: str, new_status: str) -> str:
        try:
            status_label = RQStatusChoices(new_status).label
        except ValueError:
            status_label = new_status
        return (
            f'El requerimiento {request.rq_number} ha cambiado al estado: {status_label}. '
            f'Por favor revise y tome las acciones necesarias.'
        )
