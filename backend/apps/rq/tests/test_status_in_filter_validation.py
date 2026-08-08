"""
SYSPCC-013 FIX 5: `status_in` on the Request list endpoint must validate its
values against RQStatusChoices.

Before the fix, `django_filters.BaseInFilter(field_name='status', lookup_expr='in')`
performed no validation — an unknown value like `?status_in=NOPE` silently
produced `status__in=['NOPE']`, which matches nothing, indistinguishable from
"there really are no requests with that status". The caller has no way to
tell "your filter is malformed" from "there are zero results".
"""
import pytest
from rest_framework import status

from apps.core.enums import RQStatusChoices


@pytest.mark.django_db
class TestStatusInFilterValidation:
    def test_invalid_value_returns_400(self, auth_client):
        response = auth_client.get('/api/v1/requests/', {'status_in': 'NOPE'})
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_one_invalid_value_among_valid_ones_still_returns_400(self, auth_client):
        response = auth_client.get('/api/v1/requests/', {'status_in': 'DRAFT,NOPE'})
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_valid_values_return_200(self, auth_client):
        response = auth_client.get(
            '/api/v1/requests/',
            {'status_in': f'{RQStatusChoices.DRAFT},{RQStatusChoices.SUBMITTED}'},
        )
        assert response.status_code == status.HTTP_200_OK

    def test_single_valid_value_filters_correctly(self, requester, ops_request):
        ops_request.status = RQStatusChoices.SUBMITTED
        ops_request.save(update_fields=['status'])

        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=requester)

        response = client.get('/api/v1/requests/', {'status_in': RQStatusChoices.SUBMITTED})
        assert response.status_code == status.HTTP_200_OK
        rq_numbers = [r['rq_number'] for r in response.data['results']]
        assert ops_request.rq_number in rq_numbers
