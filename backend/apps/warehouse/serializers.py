"""
Warehouse serializers for standalone inventory management.
"""
from decimal import Decimal

from rest_framework import serializers

from apps.warehouse.models import Inventory, InventoryStock, InventoryMovement, MovementGroup
from apps.core.enums import WarehouseOriginChoices, MovementSourceChoices, MovementDestinationChoices


class InventoryStockSerializer(serializers.ModelSerializer):
    warehouse_type_display = serializers.CharField(
        source='get_warehouse_type_display', read_only=True
    )
    project_code = serializers.CharField(
        source='project.code', read_only=True, default=None
    )

    class Meta:
        model = InventoryStock
        fields = [
            'id', 'warehouse_type', 'warehouse_type_display',
            'project_id', 'project_code', 'department_id',
            'quantity', 'last_updated',
        ]


class InventoryListSerializer(serializers.ModelSerializer):
    stocks = InventoryStockSerializer(many=True, read_only=True)
    item_type_display = serializers.CharField(
        source='get_item_type_display', read_only=True
    )
    total_stock = serializers.SerializerMethodField()

    class Meta:
        model = Inventory
        fields = [
            'id', 'product_code', 'description', 'unit', 'category',
            'item_type', 'item_type_display', 'brand', 'model_name',
            'location', 'min_stock', 'total_stock', 'stocks', 'created_at',
        ]

    def get_total_stock(self, obj):
        return float(sum(s.quantity for s in obj.stocks.all()))


class InventoryCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Inventory
        fields = [
            'product_code', 'description', 'unit', 'category',
            'item_type', 'brand', 'model_name', 'location', 'min_stock',
        ]


class MovementListSerializer(serializers.ModelSerializer):
    movement_type_display = serializers.CharField(
        source='get_movement_type_display', read_only=True
    )
    inventory_code = serializers.CharField(
        source='inventory.product_code', read_only=True
    )
    inventory_description = serializers.CharField(
        source='inventory.description', read_only=True
    )
    inventory_unit = serializers.CharField(
        source='inventory.unit', read_only=True
    )
    warehouse_display = serializers.CharField(
        source='get_warehouse_display', read_only=True
    )
    registered_by_name = serializers.CharField(
        source='registered_by.get_full_name', read_only=True
    )
    requested_by_name = serializers.SerializerMethodField()
    authorized_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMovement
        fields = [
            'id', 'movement_number', 'movement_type', 'movement_type_display',
            'inventory', 'inventory_code', 'inventory_description', 'inventory_unit',
            'quantity', 'warehouse', 'warehouse_display', 'project',
            'source_type', 'supplier_name', 'invoice_number',
            'destination_type', 'destination_detail',
            'requested_by', 'requested_by_name',
            'authorized_by', 'authorized_by_name',
            'registered_by', 'registered_by_name',
            'notes', 'created_at',
        ]

    def get_requested_by_name(self, obj):
        return obj.requested_by.get_full_name() if obj.requested_by else None

    def get_authorized_by_name(self, obj):
        return obj.authorized_by.get_full_name() if obj.authorized_by else None


class EntryCreateSerializer(serializers.Serializer):
    inventory = serializers.PrimaryKeyRelatedField(queryset=Inventory.objects.all())
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=0.001)
    warehouse = serializers.ChoiceField(choices=['CENTRAL', 'SITE', 'OFFICE'])
    project = serializers.IntegerField(required=False, allow_null=True)
    source_type = serializers.ChoiceField(
        choices=['PURCHASE', 'RETURN', 'TRANSFER_IN', 'INITIAL_LOAD', 'ADJUSTMENT']
    )
    supplier_name = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=''
    )
    invoice_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default=''
    )
    notes = serializers.CharField(required=False, allow_blank=True, default='')


class ExitCreateSerializer(serializers.Serializer):
    inventory = serializers.PrimaryKeyRelatedField(queryset=Inventory.objects.all())
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=0.001)
    warehouse = serializers.ChoiceField(choices=['CENTRAL', 'SITE', 'OFFICE'])
    project = serializers.IntegerField(required=False, allow_null=True)
    destination_type = serializers.ChoiceField(
        choices=['PROJECT', 'DEPARTMENT', 'EMPLOYEE', 'TRANSFER_OUT', 'ADJUSTMENT']
    )
    destination_detail = serializers.CharField(max_length=200)
    requested_by = serializers.IntegerField(required=False, allow_null=True)
    authorized_by = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default='')


# ---------------------------------------------------------------------------
# Batch (multi-item) serializers
# ---------------------------------------------------------------------------

class BatchEntryItemSerializer(serializers.Serializer):
    """A single line inside a batch entry request."""
    inventory = serializers.PrimaryKeyRelatedField(queryset=Inventory.objects.all())
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal('0.001')
    )


class BatchEntryCreateSerializer(serializers.Serializer):
    """
    POST body for a multi-item inventory entry.
    At least one item is required.
    """
    items = BatchEntryItemSerializer(many=True, min_length=1)
    warehouse = serializers.ChoiceField(choices=WarehouseOriginChoices.choices)
    project = serializers.IntegerField(required=False, allow_null=True)
    source_type = serializers.ChoiceField(choices=MovementSourceChoices.choices)
    supplier_name = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=''
    )
    invoice_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default=''
    )
    notes = serializers.CharField(required=False, allow_blank=True, default='')


class BatchExitItemSerializer(serializers.Serializer):
    """A single line inside a batch exit request."""
    inventory = serializers.PrimaryKeyRelatedField(queryset=Inventory.objects.all())
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal('0.001')
    )


class BatchExitCreateSerializer(serializers.Serializer):
    """
    POST body for a multi-item inventory exit.
    At least one item is required.
    """
    items = BatchExitItemSerializer(many=True, min_length=1)
    warehouse = serializers.ChoiceField(choices=WarehouseOriginChoices.choices)
    project = serializers.IntegerField(required=False, allow_null=True)
    destination_type = serializers.ChoiceField(choices=MovementDestinationChoices.choices)
    destination_detail = serializers.CharField(max_length=200)
    requested_by = serializers.IntegerField(required=False, allow_null=True)
    authorized_by = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default='')


# ---------------------------------------------------------------------------
# MovementGroup serializer (read)
# ---------------------------------------------------------------------------

class MovementGroupSerializer(serializers.ModelSerializer):
    """Read serializer for a MovementGroup, including all its movement lines."""

    movement_type_display = serializers.CharField(
        source='get_movement_type_display', read_only=True
    )
    warehouse_display = serializers.CharField(
        source='get_warehouse_display', read_only=True
    )
    project_name = serializers.CharField(source='project.name', read_only=True, default=None)
    registered_by_name = serializers.CharField(
        source='registered_by.get_full_name', read_only=True
    )
    movements = MovementListSerializer(many=True, read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = MovementGroup
        fields = [
            'id', 'group_number', 'movement_type', 'movement_type_display',
            'warehouse', 'warehouse_display',
            'project', 'project_name',
            'source_type', 'supplier_name', 'invoice_number',
            'destination_type', 'destination_detail',
            'notes', 'document_url',
            'registered_by', 'registered_by_name',
            'created_at', 'item_count', 'movements',
        ]

    def get_item_count(self, obj):
        return obj.movements.count()
