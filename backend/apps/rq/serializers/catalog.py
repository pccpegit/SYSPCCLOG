"""
Serializers for the catalog search and the stock availability report (SYSPCC-026).

Both are READ-ONLY views over warehouse data and deliberately narrow: no costs,
no exact location, no supplier data, no brand/model.
"""

from rest_framework import serializers


class RequestCatalogItemSerializer(serializers.Serializer):
    """
    One row of GET /api/v1/request-catalog/. `available` is the CENTRAL pool
    quantity (project and department both NULL).
    """

    id = serializers.IntegerField(read_only=True)
    product_code = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    unit = serializers.CharField(read_only=True)
    category = serializers.CharField(read_only=True)
    available = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)


class _LinkedProductSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    product_code = serializers.CharField()
    description = serializers.CharField()
    unit = serializers.CharField()


class StockAvailabilityItemSerializer(serializers.Serializer):
    """
    Availability of one request line against the CENTRAL pool.

    link_status: LINKED (catalog product), OFF_CATALOG (marked on purpose) or UNLINKED
    (nothing chosen yet). `link_confirmed` says whether logistics already confirmed that
    decision: a product proposed by the requester is LINKED but not confirmed. Only
    LINKED lines carry stock figures and a `coverage` (FULL / PARTIAL / NONE /
    NOT_COMPARABLE); for the others those fields are null.
    `available_net` = pool minus what other requests still hold of it (IN_STOCK requests
    that wait for their dispatch and purchases already received into the pool and not yet
    dispatched) minus what the EARLIER lines of this same request take of the same product
    (`committed_earlier_lines`, lines are served in `line_number` order); `coverage` and
    `shortfall` are computed against the net figure.
    The stock figures are in the product's unit (`product_unit`). When the line's unit is
    not the product's (`unit_mismatch`) the quantities cannot be compared: `coverage` is
    NOT_COMPARABLE and `shortfall` is null.
    """

    item_id = serializers.IntegerField()
    line_number = serializers.IntegerField()
    description = serializers.CharField()
    unit = serializers.CharField()
    requested = serializers.DecimalField(max_digits=14, decimal_places=3)
    inventory_item = _LinkedProductSerializer(allow_null=True)
    product_unit = serializers.CharField(allow_null=True)
    unit_mismatch = serializers.BooleanField()
    link_status = serializers.ChoiceField(choices=['LINKED', 'OFF_CATALOG', 'UNLINKED'])
    link_confirmed = serializers.BooleanField()
    available_central = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    committed_other_requests = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    committed_earlier_lines = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    available_net = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    shortfall = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    coverage = serializers.ChoiceField(
        choices=['FULL', 'PARTIAL', 'NONE', 'NOT_COMPARABLE'], allow_null=True,
    )


class StockAvailabilitySummarySerializer(serializers.Serializer):
    items_total = serializers.IntegerField()
    full = serializers.IntegerField()
    partial = serializers.IntegerField()
    none = serializers.IntegerField()
    not_comparable = serializers.IntegerField()
    off_catalog = serializers.IntegerField()
    unlinked = serializers.IntegerField()


class StockAvailabilitySerializer(serializers.Serializer):
    """Response of GET /api/v1/requests/{id}/stock-availability/."""

    request_id = serializers.IntegerField()
    rq_number = serializers.CharField()
    items = StockAvailabilityItemSerializer(many=True)
    summary = StockAvailabilitySummarySerializer()
