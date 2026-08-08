"""
SYSPCC-011 FIX 5: CanPerformWorkflowAction wired into
RequestViewSet.execute_action as an HTTP-layer defense-in-depth check, on top
of (not instead of) WorkflowEngine's own acting_role validation
(WorkflowEngine._validate_acting_role). Before this fix the permission class
existed but was never referenced by any view.
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestExecuteActionRoleEnforcement:
    def test_project_resident_can_approve_technically(self, project_resident, ops_request):
        """Legitimate access must keep working: PROJECT_RESIDENT approving a
        SUBMITTED OPS request technically."""
        ops_request.status = 'SUBMITTED'
        ops_request.save(update_fields=['status'])

        client = _client_for(project_resident)
        response = client.post(
            f'/api/v1/requests/{ops_request.pk}/action/',
            {
                'action': 'TECHNICAL_APPROVED',
                'acting_role': 'PROJECT_RESIDENT',
                'comments': 'Aprobado técnicamente.',
            },
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        ops_request.refresh_from_db()
        assert ops_request.status == 'TECHNICAL_APPROVED'

    def test_requester_cannot_impersonate_project_resident_role(self, requester, ops_request):
        """The RQ owner (REQUESTER) must be rejected at the HTTP layer when
        claiming a role they don't hold — no state change happens."""
        ops_request.status = 'SUBMITTED'
        ops_request.save(update_fields=['status'])

        client = _client_for(requester)
        response = client.post(
            f'/api/v1/requests/{ops_request.pk}/action/',
            {
                'action': 'TECHNICAL_APPROVED',
                'acting_role': 'PROJECT_RESIDENT',
                'comments': 'intento no autorizado',
            },
            format='json',
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        ops_request.refresh_from_db()
        assert ops_request.status == 'SUBMITTED'

    def test_user_with_no_roles_at_all_is_rejected(self, user, ops_request):
        """A user with zero UserRole rows is rejected by
        CanPerformWorkflowAction.has_permission before even reaching get_object."""
        ops_request.status = 'SUBMITTED'
        ops_request.save(update_fields=['status'])

        client = _client_for(user)
        response = client.post(
            f'/api/v1/requests/{ops_request.pk}/action/',
            {
                'action': 'TECHNICAL_APPROVED',
                'acting_role': 'PROJECT_RESIDENT',
                'comments': 'x',
            },
            format='json',
        )
        assert response.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        ops_request.refresh_from_db()
        assert ops_request.status == 'SUBMITTED'
