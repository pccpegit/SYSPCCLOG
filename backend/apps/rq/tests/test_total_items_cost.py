"""
SYSPCC-013 FIX 4: `Request.total_items_cost` must aggregate in the DB and
stay a Decimal.

Before the fix, `sum(float(item.total_price or 0) for item in self.items.all())`
converted money to float — binary floating point cannot represent 0.10 or
0.20 exactly, so summing several such values accumulates rounding error
(e.g. 0.10 + 0.20 == 0.30000000000000004 as a float, not 0.30). It also
pulled every RequestItem into Python just to add them up instead of letting
the DB do it.
"""
from decimal import Decimal

import pytest

from apps.rq.models import RequestItem


@pytest.mark.django_db
class TestTotalItemsCost:
    def test_returns_decimal_instance(self, ops_request):
        RequestItem.objects.create(
            request=ops_request, line_number=1, description='Item 1',
            quantity=Decimal('1'), unit='und', total_price=Decimal('10.00'),
        )
        assert isinstance(ops_request.total_items_cost, Decimal)

    def test_sum_is_exact_no_float_rounding_error(self, ops_request):
        """0.10 + 0.20 famously != 0.30 in binary float — the Decimal-based
        aggregation must not reproduce that error."""
        RequestItem.objects.create(
            request=ops_request, line_number=1, description='Item 1',
            quantity=Decimal('1'), unit='und', total_price=Decimal('0.10'),
        )
        RequestItem.objects.create(
            request=ops_request, line_number=2, description='Item 2',
            quantity=Decimal('1'), unit='und', total_price=Decimal('0.20'),
        )
        assert ops_request.total_items_cost == Decimal('0.30')
        # Demonstrates the bug this test guards against: the float
        # equivalent is NOT exactly 0.30.
        assert float('0.10') + float('0.20') != 0.30

    def test_sum_matches_across_many_items(self, ops_request):
        for i in range(1, 6):
            RequestItem.objects.create(
                request=ops_request, line_number=i, description=f'Item {i}',
                quantity=Decimal('1'), unit='und', total_price=Decimal('33.33'),
            )
        assert ops_request.total_items_cost == Decimal('166.65')

    def test_items_with_null_total_price_are_ignored_not_erroring(self, ops_request):
        RequestItem.objects.create(
            request=ops_request, line_number=1, description='Sin precio',
            quantity=Decimal('1'), unit='und', total_price=None,
        )
        RequestItem.objects.create(
            request=ops_request, line_number=2, description='Con precio',
            quantity=Decimal('1'), unit='und', total_price=Decimal('5.00'),
        )
        assert ops_request.total_items_cost == Decimal('5.00')

    def test_no_items_returns_zero_decimal(self, ops_request):
        assert ops_request.total_items_cost == Decimal('0')
        assert isinstance(ops_request.total_items_cost, Decimal)
