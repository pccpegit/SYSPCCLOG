"""
SYSPCC-007 fix #3: WorkflowEngine.execute() must re-fetch the Request with
select_for_update() at the start of the atomic block, instead of trusting
whatever `self.request` the caller (the view) already had in memory.

These tests also serve as the workflow-engine skill's required regression
coverage: happy path + illegal transition, after the lock was added — proving
the lock didn't change transition logic, only atomicity.
"""
import datetime

import pytest

from apps.core.enums import AcquisitionTypeChoices, RQFlowChoices, RQStatusChoices
from apps.core.exceptions import WorkflowError
from apps.rq.models import Request
from apps.rq.services.workflow_engine import WorkflowEngine


@pytest.mark.django_db
class TestWorkflowEngineHappyAndIllegalPaths:
    """Baseline regression: the OPS SUBMITTED transition still works after the fix."""

    def test_happy_path_submit(self, requester, ops_request):
        engine = WorkflowEngine(ops_request, requester, 'REQUESTER')
        approval = engine.execute(action='SUBMITTED')

        ops_request.refresh_from_db()
        assert ops_request.status == RQStatusChoices.SUBMITTED
        assert approval.previous_status == RQStatusChoices.DRAFT
        assert approval.new_status == RQStatusChoices.SUBMITTED

    def test_illegal_transition_raises_workflow_error(self, requester, ops_request):
        """CLOSED is not a valid action from DRAFT — must raise, not silently no-op."""
        engine = WorkflowEngine(ops_request, requester, 'REQUESTER')
        with pytest.raises(WorkflowError):
            engine.execute(action='CLOSED')

        ops_request.refresh_from_db()
        assert ops_request.status == RQStatusChoices.DRAFT


@pytest.mark.django_db
class TestWorkflowEngineReloadsUnderLock:
    """
    Simulates the lost-update scenario the fix closes: two WorkflowEngine
    instances built from two independent reads of the same Request (as would
    happen with two concurrent requests each loading the row via the view
    before calling engine.execute()).
    """

    def test_stale_in_memory_request_does_not_cause_false_illegal_transition(
        self, requester, project_resident, ops_request
    ):
        # Two independent reads of the same row — both still see DRAFT.
        rq_view_a = Request.objects.get(pk=ops_request.pk)
        rq_view_b = Request.objects.get(pk=ops_request.pk)
        assert rq_view_a.status == RQStatusChoices.DRAFT
        assert rq_view_b.status == RQStatusChoices.DRAFT

        # "Request A" commits DRAFT -> SUBMITTED.
        engine_a = WorkflowEngine(rq_view_a, requester, 'REQUESTER')
        engine_a.execute(action='SUBMITTED')

        # "Request B" still holds a stale in-memory copy (status=DRAFT) built
        # *before* A's commit. Its actor (PROJECT_RESIDENT) legitimately wants
        # to technical-approve, which is only valid from SUBMITTED. Without the
        # select_for_update() re-fetch at the top of execute(), this would
        # incorrectly raise WorkflowError because rq_view_b.status is still
        # the stale 'DRAFT' snapshot instead of the real 'SUBMITTED' in the DB.
        engine_b = WorkflowEngine(rq_view_b, project_resident, 'PROJECT_RESIDENT')
        approval = engine_b.execute(action='TECHNICAL_APPROVED')

        assert approval.previous_status == RQStatusChoices.SUBMITTED
        assert approval.new_status == RQStatusChoices.TECHNICAL_APPROVED

        ops_request.refresh_from_db()
        assert ops_request.status == RQStatusChoices.TECHNICAL_APPROVED
