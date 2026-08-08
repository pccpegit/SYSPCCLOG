"""
SYSPCC-011 FIX 2: RequestViewSet.update_items (PATCH .../update-items/).

Before the fix, any authenticated user with visibility of the RQ (including
the REQUESTER who owns it) could rewrite `supply_source` on its line items at
any workflow stage, bypassing the logistics-only stock-check step. The fix
restricts the action to logistics roles and validates the payload with
UpdateItemsSerializer instead of silently ignoring malformed entries.
"""
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.rq.models import RequestItem


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def item(db, ops_request):
    return RequestItem.objects.create(
        request=ops_request,
        line_number=1,
        description='Cemento Portland Tipo I',
        quantity=Decimal('100.000'),
        unit='bolsa',
    )


@pytest.mark.django_db
class TestUpdateItemsRoleRestriction:
    def test_requester_cannot_update_items(self, requester, ops_request, item):
        client = _client_for(requester)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': item.pk, 'supply_source': 'STOCK'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        item.refresh_from_db()
        assert item.supply_source == ''

    def test_project_resident_cannot_update_items(self, project_resident, ops_request, item):
        """Not just REQUESTER — any non-logistics role must be rejected too."""
        client = _client_for(project_resident)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': item.pk, 'supply_source': 'STOCK'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_logistics_coordinator_can_update_items(self, logistics_coordinator, ops_request, item):
        """Legitimate access must keep working: logistics staff sets supply_source
        during the stock-check step."""
        client = _client_for(logistics_coordinator)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': item.pk, 'supply_source': 'PURCHASE'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        item.refresh_from_db()
        assert item.supply_source == 'PURCHASE'


@pytest.mark.django_db
class TestUpdateItemsPayloadValidation:
    def test_invalid_supply_source_returns_400_not_500(self, logistics_coordinator, ops_request, item):
        client = _client_for(logistics_coordinator)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': item.pk, 'supply_source': 'DROP TABLE items'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        item.refresh_from_db()
        assert item.supply_source == ''

    def test_non_integer_item_id_returns_400_not_500(self, logistics_coordinator, ops_request, item):
        client = _client_for(logistics_coordinator)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': 'not-an-id', 'supply_source': 'STOCK'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_item_id_from_another_request_is_not_updated(
        self, logistics_coordinator, ops_request, item, foreign_request,
    ):
        """Even with a valid integer item_id, an item belonging to a different
        Request must never be touched via this RQ's update-items endpoint."""
        foreign_item = RequestItem.objects.create(
            request=foreign_request,
            line_number=1,
            description='Fierro corrugado',
            quantity=Decimal('50.000'),
            unit='varilla',
        )
        client = _client_for(logistics_coordinator)
        response = client.patch(
            f'/api/v1/requests/{ops_request.pk}/update-items/',
            {'items': [{'item_id': foreign_item.pk, 'supply_source': 'STOCK'}]},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        foreign_item.refresh_from_db()
        assert foreign_item.supply_source == ''
