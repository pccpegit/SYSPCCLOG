"""
Custom exception handler and exception classes for SYSPCCLOG.
"""

from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    """
    Custom exception handler that returns consistent error responses.
    Format: { "error": "...", "detail": "...", "code": "..." }
    """
    response = exception_handler(exc, context)

    if response is not None:
        error_data = {
            'error': True,
            'status_code': response.status_code,
        }

        if isinstance(response.data, dict):
            if 'detail' in response.data:
                error_data['detail'] = str(response.data['detail'])
                error_data['code'] = getattr(response.data.get('detail', ''), 'code', 'error')
            else:
                error_data['detail'] = response.data
        elif isinstance(response.data, list):
            error_data['detail'] = response.data
        else:
            error_data['detail'] = str(response.data)

        response.data = error_data

    return response


class WorkflowError(Exception):
    """Raised when a workflow transition is invalid."""

    def __init__(self, message: str, current_status: str = None, attempted_action: str = None):
        self.message = message
        self.current_status = current_status
        self.attempted_action = attempted_action
        super().__init__(message)


class BudgetValidationError(Exception):
    """Raised when budget validation fails."""

    def __init__(self, message: str, required_amount: float = None, available_amount: float = None):
        self.message = message
        self.required_amount = required_amount
        self.available_amount = available_amount
        super().__init__(message)


class PermissionDeniedForAction(Exception):
    """Raised when a user lacks the role required for an action."""

    def __init__(self, message: str, required_role: str = None, user_roles: list = None):
        self.message = message
        self.required_role = required_role
        self.user_roles = user_roles or []
        super().__init__(message)
