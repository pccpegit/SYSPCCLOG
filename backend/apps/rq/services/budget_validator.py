"""
Budget validator service.
Checks estimated costs against project budget lines (OPS) or annual plan lines (ADM).
"""

from decimal import Decimal
from apps.core.enums import RQFlowChoices
from apps.core.exceptions import BudgetValidationError


class BudgetValidator:
    """
    Validates that a request's estimated cost is within the allocated budget.
    Handles both Operations and Administrative flows.
    """

    @classmethod
    def validate(cls, request) -> dict:
        """
        Check if the request's estimated cost is within available budget.

        Args:
            request: Request instance with flow, estimated_cost, and budget line references.

        Returns:
            dict with keys: is_valid (bool), available_amount (Decimal),
                           required_amount (Decimal), message (str)

        Raises:
            BudgetValidationError: If the request has no budget line assigned.
        """
        if request.flow == RQFlowChoices.OPERATIONS:
            return cls._validate_operations(request)
        else:
            return cls._validate_administrative(request)

    @classmethod
    def _validate_operations(cls, request) -> dict:
        """Validate against ProjectBudgetLine."""
        if not request.budget_line_id:
            raise BudgetValidationError(
                message='El RQ de operaciones no tiene partida presupuestal asignada.',
            )

        budget_line = request.budget_line
        available = (
            budget_line.budgeted_amount
            - budget_line.committed_amount
            - budget_line.spent_amount
        )
        required = request.estimated_cost or Decimal('0')

        return {
            'is_valid': available >= required,
            'available_amount': available,
            'required_amount': required,
            'budget_line_code': budget_line.code,
            'message': (
                f'Dentro del presupuesto. Disponible: {available}'
                if available >= required
                else f'Excede el presupuesto. Disponible: {available}, Requerido: {required}'
            ),
        }

    @classmethod
    def _validate_administrative(cls, request) -> dict:
        """Validate against AnnualPlanLine."""
        if not request.annual_plan_line_id:
            raise BudgetValidationError(
                message='El RQ administrativo no tiene línea de Plan Anual asignada.',
            )

        plan_line = request.annual_plan_line
        available = (
            plan_line.budgeted_amount
            - plan_line.committed_amount
            - plan_line.spent_amount
        )
        required = request.estimated_cost or Decimal('0')

        return {
            'is_valid': available >= required,
            'available_amount': available,
            'required_amount': required,
            'plan_line_code': plan_line.code,
            'message': (
                f'Dentro del plan anual. Disponible: {available}'
                if available >= required
                else f'Excede el plan anual. Disponible: {available}, Requerido: {required}'
            ),
        }

    @classmethod
    def commit_budget(cls, request) -> None:
        """
        Add the estimated_cost to committed_amount on the relevant budget line.
        Call when a request transitions to VALIDATED.
        """
        if request.flow == RQFlowChoices.OPERATIONS and request.budget_line_id:
            from apps.core.models import ProjectBudgetLine
            ProjectBudgetLine.objects.filter(pk=request.budget_line_id).update(
                committed_amount=models_F('committed_amount') + (request.estimated_cost or 0)
            )
        elif request.flow == RQFlowChoices.ADMINISTRATIVE and request.annual_plan_line_id:
            from apps.core.models import AnnualPlanLine
            AnnualPlanLine.objects.filter(pk=request.annual_plan_line_id).update(
                committed_amount=models_F('committed_amount') + (request.estimated_cost or 0)
            )

    @classmethod
    def release_budget(cls, request) -> None:
        """
        Release committed budget when a request is cancelled or rejected.
        """
        if request.flow == RQFlowChoices.OPERATIONS and request.budget_line_id:
            from apps.core.models import ProjectBudgetLine
            from django.db.models import F
            ProjectBudgetLine.objects.filter(pk=request.budget_line_id).update(
                committed_amount=F('committed_amount') - (request.estimated_cost or 0)
            )
        elif request.flow == RQFlowChoices.ADMINISTRATIVE and request.annual_plan_line_id:
            from apps.core.models import AnnualPlanLine
            from django.db.models import F
            AnnualPlanLine.objects.filter(pk=request.annual_plan_line_id).update(
                committed_amount=F('committed_amount') - (request.estimated_cost or 0)
            )


def models_F(field_name):
    """Helper to import F lazily."""
    from django.db.models import F
    return F(field_name)
