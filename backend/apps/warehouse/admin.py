"""
Django admin for warehouse app.
"""

from django.contrib import admin
from apps.warehouse.models import (
    Inventory,
    InventoryStock,
    WarehouseReceipt,
    WarehouseReceiptItem,
    WarehouseDispatch,
    WarehouseDispatchItem,
)


class InventoryStockInline(admin.TabularInline):
    model = InventoryStock
    extra = 0
    readonly_fields = ['last_updated']


@admin.register(Inventory)
class InventoryAdmin(admin.ModelAdmin):
    inlines = [InventoryStockInline]
    list_display = ['product_code', 'description', 'unit', 'category', 'min_stock']
    search_fields = ['product_code', 'description']
    list_filter = ['category']


@admin.register(InventoryStock)
class InventoryStockAdmin(admin.ModelAdmin):
    list_display = ['inventory', 'warehouse_type', 'project', 'department', 'quantity', 'last_updated']
    list_filter = ['warehouse_type']
    search_fields = ['inventory__product_code', 'inventory__description']
    readonly_fields = ['last_updated']


class ReceiptItemInline(admin.TabularInline):
    model = WarehouseReceiptItem
    extra = 0


@admin.register(WarehouseReceipt)
class WarehouseReceiptAdmin(admin.ModelAdmin):
    inlines = [ReceiptItemInline]
    list_display = ['receipt_number', 'request', 'received_by', 'conformity_passed', 'received_at']
    list_filter = ['conformity_passed']
    search_fields = ['request__rq_number', 'receipt_number']


class DispatchItemInline(admin.TabularInline):
    model = WarehouseDispatchItem
    extra = 0


@admin.register(WarehouseDispatch)
class WarehouseDispatchAdmin(admin.ModelAdmin):
    inlines = [DispatchItemInline]
    list_display = ['dispatch_number', 'request', 'origin', 'dispatched_by', 'dispatched_at', 'delivered_at']
    list_filter = ['origin']
    search_fields = ['request__rq_number', 'dispatch_number']
