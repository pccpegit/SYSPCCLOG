"""
Supplier, Quotation, and PurchaseOrder viewsets.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.rq.models import Supplier, Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem
from apps.rq.serializers.supplier import SupplierSerializer
from apps.rq.serializers.quotation import QuotationSerializer, QuotationItemSerializer
from apps.rq.serializers.purchase_order import PurchaseOrderSerializer, PurchaseOrderItemSerializer
from apps.core.permissions import IsAdminOrReadOnly, IsLogisticsStaff
from apps.rq.services.number_generator import PONumberGenerator

# Safe (read-only) HTTP methods
SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')


@extend_schema_view(
    list=extend_schema(tags=['suppliers'], summary='List suppliers'),
    retrieve=extend_schema(tags=['suppliers'], summary='Get supplier detail'),
    create=extend_schema(tags=['suppliers'], summary='Create supplier'),
    update=extend_schema(tags=['suppliers'], summary='Update supplier'),
    destroy=extend_schema(tags=['suppliers'], summary='Delete supplier'),
)
class SupplierViewSet(viewsets.ModelViewSet):
    """
    FIX-08: Write operations (create/update/delete) require admin or logistics staff.
    All authenticated users may read supplier data.
    """

    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active', 'category', 'city']
    search_fields = ['ruc', 'business_name', 'trade_name', 'category']
    ordering_fields = ['business_name', 'created_at']
    ordering = ['business_name']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        # Writes require admin or logistics staff
        return [IsAuthenticated(), IsAdminOrReadOnly()]


@extend_schema_view(
    list=extend_schema(tags=['quotations'], summary='List quotations'),
    retrieve=extend_schema(tags=['quotations'], summary='Get quotation detail'),
    create=extend_schema(tags=['quotations'], summary='Create quotation'),
    update=extend_schema(tags=['quotations'], summary='Update quotation'),
    destroy=extend_schema(tags=['quotations'], summary='Delete quotation'),
)
class QuotationViewSet(viewsets.ModelViewSet):
    """
    FIX-08 + FIX-16: Write operations and the select action require logistics staff.
    """

    queryset = Quotation.objects.select_related('request', 'supplier', 'selected_by').prefetch_related('items__request_item').all()
    serializer_class = QuotationSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['request', 'supplier', 'is_selected', 'currency']
    search_fields = ['quotation_number', 'supplier__business_name']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        # Writes and the select action require logistics staff
        return [IsAuthenticated(), IsLogisticsStaff()]

    @extend_schema(tags=['quotations'], summary='Mark quotation as selected')
    @action(
        detail=True,
        methods=['post'],
        url_path='select',
        # FIX-16: Enforce logistics staff role on the select action
        permission_classes=[IsAuthenticated, IsLogisticsStaff],
    )
    def select(self, request, pk=None):
        """Mark this quotation as selected. Clears selection on other quotations for the same RQ."""
        quotation = self.get_object()

        # Clear previously selected quotations for this request
        Quotation.objects.filter(request=quotation.request, is_selected=True).update(
            is_selected=False, selected_by=None, selected_at=None
        )

        quotation.is_selected = True
        quotation.selected_by = request.user
        quotation.selected_at = timezone.now()
        quotation.save()

        return Response(QuotationSerializer(quotation).data)


@extend_schema_view(
    list=extend_schema(tags=['purchase-orders'], summary='List purchase orders'),
    retrieve=extend_schema(tags=['purchase-orders'], summary='Get PO detail'),
    create=extend_schema(tags=['purchase-orders'], summary='Create purchase order'),
    update=extend_schema(tags=['purchase-orders'], summary='Update purchase order'),
)
class PurchaseOrderViewSet(viewsets.ModelViewSet):
    """
    FIX-08: Write operations require logistics staff.
    """

    queryset = PurchaseOrder.objects.select_related(
        'request', 'quotation', 'supplier', 'generated_by'
    ).prefetch_related('items').all()
    serializer_class = PurchaseOrderSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['request', 'supplier', 'status', 'currency']
    search_fields = ['po_number', 'supplier__business_name']
    ordering_fields = ['created_at', 'status']
    ordering = ['-created_at']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsLogisticsStaff()]

    def perform_create(self, serializer):
        po_number = PONumberGenerator.generate()
        serializer.save(
            po_number=po_number,
            generated_by=self.request.user,
        )
