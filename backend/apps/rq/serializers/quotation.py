from rest_framework import serializers
from apps.rq.models import Quotation, QuotationItem


class QuotationItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuotationItem
        fields = '__all__'
        read_only_fields = ['total_price', 'created_at']


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.business_name', read_only=True)

    class Meta:
        model = Quotation
        fields = '__all__'
        read_only_fields = ['quoted_at', 'created_at', 'selected_at']
