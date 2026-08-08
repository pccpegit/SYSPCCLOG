"""
PurchaseOrder and PurchaseOrderItem models.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.models.base import TimeStampedModel
from apps.core.enums import POStatusChoices


class PurchaseOrder(TimeStampedModel):
    """
    Purchase Order (Orden de Compra) generated from a selected quotation.
    Auto-generated number: OC-YYYY-NNNN.
    """

    po_number = models.CharField(
        _('número de OC'),
        max_length=20,
        unique=True,
        help_text=_('Auto-generado: OC-YYYY-NNNN'),
    )
    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.PROTECT,
        related_name='purchase_orders',
        verbose_name=_('requerimiento'),
    )
    quotation = models.ForeignKey(
        'rq.Quotation',
        on_delete=models.PROTECT,
        related_name='purchase_orders',
        verbose_name=_('cotización seleccionada'),
    )
    supplier = models.ForeignKey(
        'rq.Supplier',
        on_delete=models.PROTECT,
        related_name='purchase_orders',
        verbose_name=_('proveedor'),
    )
    generated_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='purchase_orders_generated',
        verbose_name=_('generada por'),
        help_text=_('OPS: Coord. Logístico / ADM: Sup. Logístico'),
    )
    status = models.CharField(
        _('estado'),
        max_length=20,
        choices=POStatusChoices.choices,
        default=POStatusChoices.DRAFT,
    )
    total_amount = models.DecimalField(
        _('monto total'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    currency = models.CharField(_('moneda'), max_length=3, default='PEN')
    payment_terms = models.CharField(_('condiciones de pago'), max_length=200, blank=True)
    expected_delivery_date = models.DateField(_('fecha estimada de entrega'), null=True, blank=True)
    actual_delivery_date = models.DateField(_('fecha real de entrega'), null=True, blank=True)
    document_url = models.CharField(_('URL del documento'), max_length=500, blank=True)
    notes = models.TextField(_('notas'), blank=True)

    class Meta:
        db_table = 'purchase_orders'
        verbose_name = _('orden de compra')
        verbose_name_plural = _('órdenes de compra')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['supplier']),
            models.Index(fields=['status']),
        ]

    def __str__(self) -> str:
        return f'{self.po_number} - {self.supplier.business_name} ({self.get_status_display()})'


class PurchaseOrderItem(models.Model):
    """
    Line item in a Purchase Order.
    """

    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name=_('orden de compra'),
    )
    request_item = models.ForeignKey(
        'rq.RequestItem',
        on_delete=models.PROTECT,
        related_name='po_items',
        verbose_name=_('ítem del requerimiento'),
    )
    quotation_item = models.ForeignKey(
        'rq.QuotationItem',
        on_delete=models.SET_NULL,
        related_name='po_items',
        null=True,
        blank=True,
        verbose_name=_('ítem de cotización'),
    )
    description = models.CharField(_('descripción'), max_length=300)
    quantity = models.DecimalField(
        _('cantidad'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    unit = models.CharField(_('unidad'), max_length=30)
    unit_price = models.DecimalField(
        _('precio unitario'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    total_price = models.DecimalField(
        _('precio total'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'purchase_order_items'
        verbose_name = _('ítem de orden de compra')
        verbose_name_plural = _('ítems de orden de compra')

    def __str__(self) -> str:
        return f'{self.purchase_order.po_number} / {self.description}'
