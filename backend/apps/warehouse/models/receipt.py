"""
WarehouseReceipt and WarehouseReceiptItem models.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator


class WarehouseReceipt(models.Model):
    """
    Records the physical reception of goods at the warehouse.
    OPS: performed by Central Warehouse / ADM: performed by Logistics Supervisor.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='warehouse_receipts',
        verbose_name=_('requerimiento'),
    )
    purchase_order = models.ForeignKey(
        'rq.PurchaseOrder',
        on_delete=models.SET_NULL,
        related_name='warehouse_receipts',
        null=True,
        blank=True,
        verbose_name=_('orden de compra'),
    )
    received_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='warehouse_receipts',
        verbose_name=_('recibido por'),
    )
    receipt_number = models.CharField(_('número de recepción'), max_length=50, blank=True)
    supplier_guide_number = models.CharField(
        _('número de guía del proveedor'),
        max_length=50,
        blank=True,
    )
    received_at = models.DateTimeField(auto_now_add=True)

    # Quality / Conformity check
    conformity_passed = models.BooleanField(_('conformidad aprobada'), null=True, blank=True)
    conformity_checked_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='conformity_checks',
        null=True,
        blank=True,
        verbose_name=_('conformidad verificada por'),
    )
    conformity_checked_at = models.DateTimeField(_('conformidad verificada el'), null=True, blank=True)
    conformity_notes = models.TextField(_('notas de conformidad'), blank=True)
    movement_group = models.OneToOneField(
        'warehouse.MovementGroup',
        on_delete=models.SET_NULL,
        related_name='warehouse_receipt',
        null=True,
        blank=True,
        verbose_name=_('vale de movimiento'),
        help_text=_('MovementGroup (vale de entrada) generado automáticamente al registrar RECEIVED'),
    )
    notes = models.TextField(_('notas'), blank=True)

    class Meta:
        db_table = 'warehouse_receipts'
        verbose_name = _('recepción de almacén')
        verbose_name_plural = _('recepciones de almacén')
        ordering = ['-received_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['purchase_order']),
        ]

    def __str__(self) -> str:
        return f'Recepción {self.receipt_number or self.pk} | {self.request.rq_number}'


class WarehouseReceiptItem(models.Model):
    """
    Line item detail for a warehouse receipt.
    """

    receipt = models.ForeignKey(
        WarehouseReceipt,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name=_('recepción'),
    )
    request_item = models.ForeignKey(
        'rq.RequestItem',
        on_delete=models.CASCADE,
        related_name='receipt_items',
        verbose_name=_('ítem del requerimiento'),
    )
    purchase_order_item = models.ForeignKey(
        'rq.PurchaseOrderItem',
        on_delete=models.SET_NULL,
        related_name='receipt_items',
        null=True,
        blank=True,
        verbose_name=_('ítem de OC'),
    )
    quantity_received = models.DecimalField(
        _('cantidad recibida'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    quantity_accepted = models.DecimalField(
        _('cantidad aceptada'),
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
    )
    quantity_rejected = models.DecimalField(
        _('cantidad rechazada'),
        max_digits=12,
        decimal_places=3,
        default=0,
    )
    rejection_reason = models.TextField(_('motivo de rechazo'), blank=True)
    notes = models.TextField(_('notas'), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'warehouse_receipt_items'
        verbose_name = _('ítem de recepción')
        verbose_name_plural = _('ítems de recepción')

    def __str__(self) -> str:
        return f'{self.receipt} / {self.request_item.description}'
