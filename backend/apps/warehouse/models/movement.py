"""
InventoryMovement model — tracks all inventory entries, exits, transfers, and adjustments.
MovementGroup groups multiple InventoryMovement rows into a single vale (voucher).
"""
from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.enums import (
    WarehouseOriginChoices,
    MovementTypeChoices,
    MovementSourceChoices,
    MovementDestinationChoices,
)


class MovementGroup(models.Model):
    """
    Groups multiple InventoryMovement rows into a single vale (voucher).
    Created for every entry or exit — even single-item ones — so the PDF
    upload task always operates on a group.
    """

    group_number = models.CharField(
        _('número de vale'),
        max_length=30,
        unique=True,
    )
    movement_type = models.CharField(
        _('tipo'),
        max_length=15,
        choices=MovementTypeChoices.choices,
    )
    warehouse = models.CharField(
        _('almacén'),
        max_length=10,
        choices=WarehouseOriginChoices.choices,
    )
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='movement_groups',
        verbose_name=_('proyecto'),
    )

    # Entry fields
    source_type = models.CharField(
        _('origen'),
        max_length=20,
        choices=MovementSourceChoices.choices,
        blank=True,
    )
    supplier_name = models.CharField(_('proveedor'), max_length=200, blank=True)
    invoice_number = models.CharField(_('factura'), max_length=50, blank=True)

    # Exit fields
    destination_type = models.CharField(
        _('destino'),
        max_length=20,
        choices=MovementDestinationChoices.choices,
        blank=True,
    )
    destination_detail = models.CharField(_('detalle destino'), max_length=200, blank=True)

    notes = models.TextField(_('observaciones'), blank=True)
    document_url = models.URLField(_('URL documento'), max_length=500, blank=True)
    registered_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='registered_groups',
        verbose_name=_('registrado por'),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'movement_groups'
        verbose_name = _('grupo de movimiento')
        verbose_name_plural = _('grupos de movimiento')
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.group_number


class InventoryMovement(models.Model):
    """
    Single inventory movement record.
    Every entry/exit/transfer/adjustment is recorded here.
    Stock is updated automatically via the service layer.
    """

    movement_number = models.CharField(
        _('número de movimiento'),
        max_length=30,
        unique=True,
    )
    movement_type = models.CharField(
        _('tipo de movimiento'),
        max_length=15,
        choices=MovementTypeChoices.choices,
    )
    inventory = models.ForeignKey(
        'warehouse.Inventory',
        on_delete=models.PROTECT,
        related_name='movements',
        verbose_name=_('item de inventario'),
    )
    quantity = models.DecimalField(
        _('cantidad'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0.001)],
    )

    # Where the movement happens
    warehouse = models.CharField(
        _('almacén'),
        max_length=10,
        choices=WarehouseOriginChoices.choices,
    )
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        related_name='inventory_movements',
        null=True,
        blank=True,
        verbose_name=_('proyecto'),
    )

    # Entry fields
    source_type = models.CharField(
        _('origen'),
        max_length=20,
        choices=MovementSourceChoices.choices,
        blank=True,
    )
    supplier_name = models.CharField(_('proveedor'), max_length=200, blank=True)
    invoice_number = models.CharField(_('número de factura'), max_length=50, blank=True)

    # Exit fields
    destination_type = models.CharField(
        _('destino'),
        max_length=20,
        choices=MovementDestinationChoices.choices,
        blank=True,
    )
    destination_detail = models.CharField(
        _('detalle de destino'),
        max_length=200,
        blank=True,
        help_text=_('Nombre del proyecto, departamento o persona que recibe'),
    )
    requested_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='requested_movements',
        null=True,
        blank=True,
        verbose_name=_('solicitado por'),
    )
    authorized_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='authorized_movements',
        null=True,
        blank=True,
        verbose_name=_('autorizado por'),
    )

    # Group (vale)
    group = models.ForeignKey(
        'warehouse.MovementGroup',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='movements',
        verbose_name=_('grupo'),
    )

    # Common
    notes = models.TextField(_('observaciones'), blank=True)
    document_url = models.URLField(
        _('URL del documento'),
        max_length=500,
        blank=True,
        help_text=_('Link al PDF del vale en OneDrive'),
    )
    registered_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='registered_movements',
        verbose_name=_('registrado por'),
    )
    created_at = models.DateTimeField(_('fecha'), auto_now_add=True)

    class Meta:
        db_table = 'inventory_movements'
        verbose_name = _('movimiento de inventario')
        verbose_name_plural = _('movimientos de inventario')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['inventory', '-created_at']),
            models.Index(fields=['movement_type', '-created_at']),
            models.Index(fields=['warehouse', '-created_at']),
        ]

    def __str__(self) -> str:
        return (
            f'{self.movement_number} | {self.get_movement_type_display()} | '
            f'{self.inventory.product_code} x {self.quantity}'
        )
