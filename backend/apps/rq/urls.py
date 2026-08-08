"""
RQ app URL configuration.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.rq.views.request import RequestViewSet
from apps.rq.views.supplier import SupplierViewSet, QuotationViewSet, PurchaseOrderViewSet
from apps.rq.views.claim import ClaimViewSet, NotificationViewSet, ActivityLogViewSet, AttachmentViewSet
from apps.rq.views.workflow import AcquisitionTypeConfigViewSet, WorkflowStepViewSet

app_name = 'rq'

router = DefaultRouter()
router.register(r'requests', RequestViewSet, basename='request')
router.register(r'suppliers', SupplierViewSet, basename='supplier')
router.register(r'quotations', QuotationViewSet, basename='quotation')
router.register(r'purchase-orders', PurchaseOrderViewSet, basename='purchase-order')
router.register(r'claims', ClaimViewSet, basename='claim')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'activity-logs', ActivityLogViewSet, basename='activity-log')
router.register(r'attachments', AttachmentViewSet, basename='attachment')
router.register(r'acquisition-type-configs', AcquisitionTypeConfigViewSet, basename='acquisition-type-config')
router.register(r'workflow-steps', WorkflowStepViewSet, basename='workflow-step')

urlpatterns = [
    path('', include(router.urls)),
]
