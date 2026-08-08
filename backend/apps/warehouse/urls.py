"""
Warehouse app URL configuration — standalone inventory management.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.warehouse.views import InventoryViewSet, MovementViewSet, OneDriveViewSet, PendingRequestsViewSet

app_name = 'warehouse'

router = DefaultRouter()
router.register(r'inventory', InventoryViewSet, basename='inventory')
router.register(r'movements', MovementViewSet, basename='movements')
router.register(r'onedrive', OneDriveViewSet, basename='onedrive')
router.register(r'pending-requests', PendingRequestsViewSet, basename='pending-requests')

urlpatterns = [
    path('', include(router.urls)),
]
