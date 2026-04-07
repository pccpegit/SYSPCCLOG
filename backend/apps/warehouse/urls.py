"""
Warehouse app URL configuration.
Placeholder for future warehouse API endpoints.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

app_name = 'warehouse'

router = DefaultRouter()
# TODO: Register warehouse viewsets when implemented
# router.register(r'inventory', InventoryViewSet, basename='inventory')
# router.register(r'receipts', WarehouseReceiptViewSet, basename='receipt')
# router.register(r'dispatches', WarehouseDispatchViewSet, basename='dispatch')

urlpatterns = [
    path('', include(router.urls)),
]
