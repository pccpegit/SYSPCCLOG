"""
Warehouse app URL configuration — standalone inventory management.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.warehouse.views import InventoryViewSet, MovementViewSet, OneDriveViewSet, PendingRequestsViewSet
from apps.warehouse.views_imports import InventoryImportViewSet
from apps.warehouse.views_personal import PersonalLookupViewSet

app_name = 'warehouse'

router = DefaultRouter()
router.register(r'inventory', InventoryViewSet, basename='inventory')
router.register(r'movements', MovementViewSet, basename='movements')
router.register(r'onedrive', OneDriveViewSet, basename='onedrive')
router.register(r'pending-requests', PendingRequestsViewSet, basename='pending-requests')
router.register(r'personal-lookup', PersonalLookupViewSet, basename='personal-lookup')
router.register(r'imports', InventoryImportViewSet, basename='imports')

urlpatterns = [
    path('', include(router.urls)),
]
