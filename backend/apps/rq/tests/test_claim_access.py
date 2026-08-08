"""
Impersonation / IDOR regression tests for ClaimViewSet — SYSPCC-006 FIX 3.

Before the fix, `ClaimSerializer` used `fields = '__all__'`, letting a
requester set `raised_by`, `status`, `managed_by`, and `resolved_by` directly
in the creation payload, and there was no check that the referenced `request`
belonged to a request the caller could actually see.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.enums import ClaimStatusChoices, ClaimTypeChoices
from apps.rq.models import Claim


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestClaimCreateForcesRaisedBy:
    def test_raised_by_is_forced_to_authenticated_user(
        self, requester, other_requester, ops_request
    ):
        client = _client_for(requester)
        payload = {
            'request': ops_request.pk,
            'claim_type': ClaimTypeChoices.USER_COMPLAINT,
            'description': 'El material llegó dañado.',
            # Attempted impersonation — must be ignored.
            'raised_by': other_requester.pk,
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_201_CREATED, response.data
        claim = Claim.objects.get(pk=response.data['id'])
        assert claim.raised_by_id == requester.id
        assert claim.raised_by_id != other_requester.id

    def test_status_cannot_be_set_to_resolved_on_creation(self, requester, ops_request):
        client = _client_for(requester)
        payload = {
            'request': ops_request.pk,
            'claim_type': ClaimTypeChoices.USER_COMPLAINT,
            'description': 'Reclamo intentando auto-resolverse.',
            'status': ClaimStatusChoices.RESOLVED,
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_201_CREATED, response.data
        claim = Claim.objects.get(pk=response.data['id'])
        assert claim.status == ClaimStatusChoices.OPEN
        assert claim.status != ClaimStatusChoices.RESOLVED

    def test_managed_by_and_resolved_by_cannot_be_set_on_creation(
        self, requester, other_requester, ops_request
    ):
        client = _client_for(requester)
        payload = {
            'request': ops_request.pk,
            'claim_type': ClaimTypeChoices.SUPPLIER_CLAIM,
            'description': 'Producto no conforme.',
            'managed_by': other_requester.pk,
            'resolved_by': other_requester.pk,
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_201_CREATED, response.data
        claim = Claim.objects.get(pk=response.data['id'])
        assert claim.managed_by_id is None
        assert claim.resolved_by_id is None


@pytest.mark.django_db
class TestClaimCreateRequestScoping:
    def test_cannot_create_claim_against_foreign_request(
        self, requester, foreign_request
    ):
        client = _client_for(requester)
        payload = {
            'request': foreign_request.pk,
            'claim_type': ClaimTypeChoices.USER_COMPLAINT,
            'description': 'Reclamo sobre un RQ ajeno.',
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Claim.objects.filter(request=foreign_request).exists()

    def test_can_create_claim_against_own_request(self, requester, ops_request):
        client = _client_for(requester)
        payload = {
            'request': ops_request.pk,
            'claim_type': ClaimTypeChoices.USER_COMPLAINT,
            'description': 'Reclamo sobre mi propio RQ.',
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_logistics_coordinator_can_create_claim_on_any_request(
        self, logistics_coordinator, foreign_request
    ):
        client = _client_for(logistics_coordinator)
        payload = {
            'request': foreign_request.pk,
            'claim_type': ClaimTypeChoices.SUPPLIER_CLAIM,
            'description': 'Reclamo gestionado por logística sobre RQ ajeno.',
        }
        response = client.post('/api/v1/claims/', payload)
        assert response.status_code == status.HTTP_201_CREATED, response.data


@pytest.mark.django_db
class TestClaimUpdateStillWorksForLogistics:
    """Regression: locking fields on creation must not block the existing management flow."""

    def test_logistics_staff_can_update_status_after_creation(
        self, requester, logistics_coordinator, ops_request
    ):
        claim = Claim.objects.create(
            request=ops_request,
            claim_type=ClaimTypeChoices.USER_COMPLAINT,
            raised_by=requester,
            description='Reclamo inicial.',
        )
        client = _client_for(logistics_coordinator)
        response = client.patch(
            f'/api/v1/claims/{claim.pk}/',
            {'status': ClaimStatusChoices.IN_REVIEW, 'managed_by': logistics_coordinator.pk},
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        claim.refresh_from_db()
        assert claim.status == ClaimStatusChoices.IN_REVIEW
        assert claim.managed_by_id == logistics_coordinator.id
