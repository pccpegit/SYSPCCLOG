from rest_framework import serializers

from apps.rq.models import Quotation, QuotationItem


class QuotationItemSerializer(serializers.ModelSerializer):
    request_item_description = serializers.CharField(
        source='request_item.description', read_only=True
    )

    class Meta:
        model = QuotationItem
        fields = '__all__'
        read_only_fields = ['quotation', 'total_price', 'created_at']


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, required=False)
    supplier_name = serializers.CharField(source='supplier.business_name', read_only=True)
    supplier_ruc = serializers.CharField(source='supplier.ruc', read_only=True)

    class Meta:
        model = Quotation
        fields = '__all__'
        read_only_fields = ['quoted_at', 'created_at', 'selected_at']

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        quotation = Quotation.objects.create(**validated_data)
        for item_data in items_data:
            item_data.pop('quotation', None)
            QuotationItem.objects.create(quotation=quotation, **item_data)
        return quotation
