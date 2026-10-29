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
    LINKED lines carry stock figures and a `coverage` (FULL / PARTIAL / NONE); for the
    others those fields are null.
    `available_net` = pool minus what is still owed to other requests already in
    IN_STOCK; `coverage` and `shortfall` are computed against the net figure.
    """

    item_id = serializers.IntegerField()
    line_number = serializers.IntegerField()
    description = serializers.CharField()
    unit = serializers.CharField()
    requested = serializers.DecimalField(max_digits=14, decimal_places=3)
    inventory_item = _LinkedProductSerializer(allow_null=True)
    link_status = serializers.ChoiceField(choices=['LINKED', 'OFF_CATALOG', 'UNLINKED'])
    link_confirmed = serializers.BooleanField()
    available_central = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    committed_other_requests = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    available_net = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    shortfall = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    coverage = serializers.ChoiceField(choices=['FULL', 'PARTIAL', 'NONE'], allow_null=True)


class StockAvailabilitySummarySerializer(serializers.Serializer):
    items_total = serializers.IntegerField()
    full = serializers.IntegerField()
    partial = serializers.IntegerField()
    none = serializers.IntegerField()
    off_catalog = serializers.IntegerField()
    unlinked = serializers.IntegerField()


class StockAvailabilitySerializer(serializers.Serializer):
    """Response of GET /api/v1/requests/{id}/stock-availability/."""

    request_id = serializers.IntegerField()
    rq_number = serializers.CharField()
    items = StockAvailabilityItemSerializer(many=True)
    summary = StockAvailabilitySummarySerializer()
