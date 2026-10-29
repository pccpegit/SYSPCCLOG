"""
Warehouse app URL configuration — standalone inventory management.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.warehouse.views import InventoryViewSet, MovementViewSet, OneDriveViewSet, PendingRequestsViewSet
from apps.warehouse.views_imports import InventoryImportViewSet
from apps.warehouse.views_personal import PersonalLookupViewSet
from apps.warehouse.views_rq import PendingRequestDeliveryViewSet

app_name = 'warehouse'

router = DefaultRouter()
router.register(r'inventory', InventoryViewSet, basename='inventory')
router.register(r'movements', MovementViewSet, basename='movements')
router.register(r'onedrive', OneDriveViewSet, basename='onedrive')
router.register(r'pending-requests', PendingRequestsViewSet, basename='pending-requests')
# SYSPCC-029: picking / deliver / reverse live under the same prefix (detail routes only).
router.register(r'pending-requests', PendingRequestDeliveryViewSet, basename='pending-requests-delivery')
router.register(r'personal-lookup', PersonalLookupViewSet, basename='personal-lookup')
router.register(r'imports', InventoryImportViewSet, basename='imports')

urlpatterns = [
    path('', include(router.urls)),
]
