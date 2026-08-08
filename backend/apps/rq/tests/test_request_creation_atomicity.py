"""
SYSPCC-007: concurrency/atomicity regression tests for RQ creation.

Covers fixes #4 and #5 from the ticket:
  - rq_number is generated server-side (RQNumberGenerator) and a client-supplied
    value is ignored, closing the TOCTOU window in the old validate_rq_number.
  - RequestCreateSerializer.create() is atomic: if any step in the create fails
    (e.g. a RequestItem), no orphan Request is left behind.
"""
from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.rq.models import Request, RequestItem


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _payload(**overrides):
    payload = {
        'flow': 'OPERATIONS',
        'project': overrides.pop('project_id'),
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': [
            {'line_number': 1, 'description': 'Cemento', 'quantity': '10.000', 'unit': 'bls'},
        ],
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
class TestRQNumberGeneratedByBackend:
    def test_client_supplied_rq_number_is_ignored(self, requester, project):
        """
        FIX #5: rq_number must be read-only. A malicious/careless client sending
        its own rq_number should not be able to force a specific value.
        """
        client = _client_for(requester)
        payload = _payload(project_id=project.pk, rq_number='RQ-2026-9999')
        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data['rq_number'] != 'RQ-2026-9999'
        assert response.data['rq_number'].startswith('RQ-')

    def test_generated_numbers_are_sequential_and_unique(self, requester, project):
        """Two successive creates must get two distinct, backend-generated numbers."""
        client = _client_for(requester)

        r1 = client.post('/api/v1/requests/', _payload(project_id=project.pk), format='json')
        r2 = client.post('/api/v1/requests/', _payload(project_id=project.pk), format='json')

        assert r1.status_code == status.HTTP_201_CREATED, r1.data
        assert r2.status_code == status.HTTP_201_CREATED, r2.data
        assert r1.data['rq_number'] != r2.data['rq_number']


@pytest.mark.django_db
class TestRequestCreateAtomicity:
    def test_create_rolls_back_when_item_creation_fails(self, requester, project):
        """
        FIX #4: if creating a RequestItem blows up partway through the loop,
        the whole create() must roll back — no orphan Request/rq_number burned.
        """
        client = _client_for(requester)
        client.raise_request_exception = True  # let the mocked failure propagate to us
        payload = _payload(
            project_id=project.pk,
            items=[
                {'line_number': 1, 'description': 'Cemento', 'quantity': '10.000', 'unit': 'bls'},
                {'line_number': 2, 'description': 'Fierro', 'quantity': '5.000', 'unit': 'kg'},
            ],
        )

        requests_before = Request.objects.count()

        with patch(
            'apps.rq.serializers.request.RequestItem.objects.create',
            side_effect=[
                RequestItem(),  # first item "succeeds" (unsaved stand-in)
                RuntimeError('boom — simulated failure on second item'),
            ],
        ):
            with pytest.raises(RuntimeError):
                client.post('/api/v1/requests/', payload, format='json')

        assert Request.objects.count() == requests_before, (
            'A partial Request was left behind — create() is not atomic.'
        )
