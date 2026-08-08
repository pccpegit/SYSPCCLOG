"""
SYSPCC-012 FIX 5: RequestViewSet.execute_action must log unexpected failures
(anything other than WorkflowError / PermissionDeniedForAction) with
logger.exception + structured context before re-raising, instead of letting
them vanish with no trace besides the bare 500.
"""
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestExecuteActionUnexpectedErrorLogging:
    def test_unexpected_exception_is_logged_and_reraised_as_500(self, project_resident, ops_request):
        ops_request.status = 'SUBMITTED'
        ops_request.save(update_fields=['status'])

        client = _client_for(project_resident)
        # The fix intentionally re-raises after logging (so DRF/Django's
        # normal 500 handling still applies) — tell the test client not to
        # propagate the exception itself so we can assert on the response.
        client.raise_request_exception = False

        with mock.patch(
            'apps.rq.views.request.WorkflowEngine.execute',
            side_effect=RuntimeError('unexpected DB blip'),
        ), mock.patch('apps.rq.views.request.logger.exception') as mock_exception:
            response = client.post(
                f'/api/v1/requests/{ops_request.pk}/action/',
                {
                    'action': 'TECHNICAL_APPROVED',
                    'acting_role': 'PROJECT_RESIDENT',
                    'comments': 'x',
                },
                format='json',
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        mock_exception.assert_called_once()
        args, kwargs = mock_exception.call_args
        assert args[0] == 'rq.action.unexpected'
        assert kwargs['extra']['rq_id'] == ops_request.pk
        assert kwargs['extra']['user_id'] == project_resident.id
        assert kwargs['extra']['action'] == 'TECHNICAL_APPROVED'

    def test_workflow_error_does_not_use_the_unexpected_error_logger(self, requester, ops_request):
        """Sanity check the new except Exception barrier doesn't also fire (or
        double-log) for the pre-existing, expected WorkflowError branch."""
        ops_request.status = 'SUBMITTED'
        ops_request.save(update_fields=['status'])

        client = _client_for(requester)

        with mock.patch('apps.rq.views.request.logger.exception') as mock_exception:
            response = client.post(
                f'/api/v1/requests/{ops_request.pk}/action/',
                {
                    'action': 'NOT_A_REAL_ACTION',
                    'acting_role': 'REQUESTER',
                    'comments': 'x',
                },
                format='json',
            )

        assert response.status_code in (
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_403_FORBIDDEN,
        )
        mock_exception.assert_not_called()
