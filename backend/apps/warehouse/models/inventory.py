"""
Inventory and InventoryStock models.
"""

from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.enums import WarehouseOriginChoices, ItemTypeChoices

# Largest value ``InventoryStock.quantity`` can hold: DECIMAL(12, 3). A sum of entries that goes
# past it must be refused (400) before it reaches the column: SQLite would store an unreadable
# value and PostgreSQL would fail the commit with ``numeric field overflow`` (500).
MAX_STOCK_QUANTITY = Decimal('999999999.999')


class Inventory(models.Model):
    """
    Product/material catalog item tracked in inventory.
    """

    product_code = models.CharField(
        _('código de producto'),
        max_length=50,
        unique=True,
    )
    description = models.CharField(_('descripción'), max_length=300)
    unit = models.CharField(_('unidad'), max_length=30)
    category = models.CharField(_('categoría'), max_length=100, blank=True)
    item_type = models.CharField(
        _('tipo de ítem'),
        max_length=20,
        choices=ItemTypeChoices.choices,
        default=ItemTypeChoices.MATERIAL,
    )
    brand = models.CharField(_('marca'), max_length=100, blank=True)
    model_name = models.CharField(_('modelo'), max_length=100, blank=True)
    location = models.CharField(
        _('ubicación'),
        max_length=100,
        blank=True,
        help_text=_('Formato Pabellón + Sección – Nivel, por ejemplo B3-2.'),
    )
    min_stock = models.DecimalField(
        _('stock mínimo'),
        max_digits=12,
        decimal_places=3,
        default=0,
        validators=[MinValueValidator(0)],
    )

    # SYSPCC-025 — datos del libro real de EPP (todos opcionales).
    order_number = models.CharField(_('número de orden'), max_length=50, blank=True)
    purchase_order_ref = models.CharField(
        _('OC'),
        max_length=30,
        blank=True,
        help_text=_('Referencia de OC tal como figura en el libro (texto).'),
    )
    packing_list = models.CharField(_('packing list'), max_length=50, blank=True)
    size = models.CharField(_('talla'), max_length=20, blank=True)
    floor = models.PositiveSmallIntegerField(
        _('piso'),
        null=True,
        blank=True,
        choices=[(1, _('1er piso')), (2, _('2do piso'))],
        help_text=_('Piso del almacén cuando aún no se conoce la ubicación exacta.'),
    )
    observation = models.CharField(_('observación'), max_length=300, blank=True)
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_items',
        verbose_name=_('proyecto'),
        help_text=_('Proyecto propietario/asignado del ítem (atributo del catálogo, no alcance de stock).'),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory'
        verbose_name = _('inventario')
        verbose_name_plural = _('inventario')
        ordering = ['product_code']

    def __str__(self) -> str:
        return f'{self.product_code} - {self.description}'

    @property
    def location_status(self) -> str:
        """EXACT / FLOOR_ONLY / NONE — derived, never stored."""
        from apps.warehouse.services.locations import location_status

        return location_status(self.location, self.floor)

    @property
    def location_display(self) -> str:
        """Exact location, else 'PISO n', else ''."""
        from apps.warehouse.services.locations import location_display

        return location_display(self.location, self.floor)


class InventoryStock(models.Model):
    """
    Stock level of an inventory item at a specific warehouse.
    Scoped by warehouse type and project/department.
    """

    inventory = models.ForeignKey(
        Inventory,
        on_delete=models.CASCADE,
        related_name='stocks',
        verbose_name=_('inventario'),
    )
    warehouse_type = models.CharField(
        _('tipo de almacén'),
        max_length=10,
        choices=WarehouseOriginChoices.choices,
    )
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.CASCADE,
        related_name='inventory_stocks',
        null=True,
        blank=True,
        verbose_name=_('proyecto'),
        help_text=_('Para almacén de obra'),
    )
    department = models.ForeignKey(
        'core.Department',
        on_delete=models.CASCADE,
        related_name='inventory_stocks',
        null=True,
        blank=True,
        verbose_name=_('departamento'),
        help_text=_('Para almacén de oficina'),
    )
    quantity = models.DecimalField(
        _('cantidad'),
        max_digits=12,
        decimal_places=3,
        default=0,
        validators=[MinValueValidator(0)],
    )
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_stock'
        verbose_name = _('stock de inventario')
        verbose_name_plural = _('stocks de inventario')
        unique_together = [('inventory', 'warehouse_type', 'project', 'department')]
        constraints = [
            # SYSPCC-007: DB-level safety net against negative stock. The application
            # already locks the row (select_for_update) before decrementing in
            # apps/warehouse/services/movements.py, but this constraint guarantees
            # correctness even if a future code path forgets to lock.
            models.CheckConstraint(
                condition=models.Q(quantity__gte=0),
                name='inventory_stock_quantity_gte_0',
            ),
        ]

    def __str__(self) -> str:
        scope = self.project or self.department or 'Global'
        return f'{self.inventory.product_code} | {self.get_warehouse_type_display()} | {scope}: {self.quantity}'
