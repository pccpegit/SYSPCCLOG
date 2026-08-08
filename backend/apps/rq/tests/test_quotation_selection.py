"""
SYSPCC-007 (yellow items): QuotationViewSet.select() concurrency + write-protection.

  - select() must leave exactly one quotation selected for the RQ, even when
    called against a quotation while a sibling is already selected.
  - is_selected/selected_by/selected_at must not be settable via a plain
    PATCH — only through select(), which holds the lock and clears siblings.
"""
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.rq.models import Quotation, Supplier


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def supplier(db):
    return Supplier.objects.create(ruc='20123456789', business_name='Proveedor Uno')


@pytest.fixture
def other_supplier(db):
    return Supplier.objects.create(ruc='20987654321', business_name='Proveedor Dos')


@pytest.fixture
def quotation_a(db, ops_request, supplier):
    return Quotation.objects.create(
        request=ops_request, supplier=supplier, total_amount=Decimal('100.00'),
    )


@pytest.fixture
def quotation_b(db, ops_request, other_supplier):
    return Quotation.objects.create(
        request=ops_request, supplier=other_supplier, total_amount=Decimal('90.00'),
    )


@pytest.mark.django_db
class TestQuotationSelectExclusivity:
    def test_select_marks_exactly_one_quotation_selected(
        self, logistics_coordinator, quotation_a, quotation_b
    ):
        client = _client_for(logistics_coordinator)

        resp_a = client.post(f'/api/v1/quotations/{quotation_a.pk}/select/')
        assert resp_a.status_code == status.HTTP_200_OK, resp_a.data

        quotation_a.refresh_from_db()
        quotation_b.refresh_from_db()
        assert quotation_a.is_selected is True
        assert quotation_b.is_selected is False

        # Now select B — A must be cleared, only one selected overall.
        resp_b = client.post(f'/api/v1/quotations/{quotation_b.pk}/select/')
        assert resp_b.status_code == status.HTTP_200_OK, resp_b.data

        quotation_a.refresh_from_db()
        quotation_b.refresh_from_db()
        assert quotation_a.is_selected is False
        assert quotation_b.is_selected is True

        selected_count = Quotation.objects.filter(
            request=quotation_a.request, is_selected=True
        ).count()
        assert selected_count == 1

    def test_is_selected_not_writable_via_patch(self, logistics_coordinator, quotation_a):
        """FIX (yellow): is_selected/selected_by/selected_at are read-only on the
        serializer — only select() may set them."""
        client = _client_for(logistics_coordinator)

        response = client.patch(
            f'/api/v1/quotations/{quotation_a.pk}/',
            {'is_selected': True},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK, response.data

        quotation_a.refresh_from_db()
        assert quotation_a.is_selected is False, (
            'is_selected was set via a plain PATCH — it must be read-only.'
        )
