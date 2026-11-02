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
        _('N° de vale interno'),
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

    # SYSPCC-025 — datos de documento del libro real (todos opcionales).
    movement_date = models.DateField(
        _('fecha del movimiento'),
        null=True,
        blank=True,
        db_index=True,
        help_text=_('Fecha operativa; distinta de created_at (auditoría). NULL solo en filas importadas sin fecha.'),
    )
    voucher_number = models.CharField(
        _('N° de vale (físico)'),
        max_length=30,
        blank=True,
        db_index=True,
        help_text=_('Número impreso en el vale firmado. No es único: un vale lleva varias líneas.'),
    )
    po_number = models.CharField(_('PO / OC'), max_length=50, blank=True)
    guide_number = models.CharField(_('guía de remisión'), max_length=50, blank=True)
    # SYSPCC-041 — N° de guía interno automático (GR-AAAA-NNNNNN) de las SALIDAS nuevas. Fuente de
    # verdad del correlativo; ``guide_number`` queda como espejo para los lectores existentes. NULL
    # en ingresos, reversas e historial (no se renumera).
    internal_guide_number = models.CharField(
        _('N° de guía interno'),
        max_length=20,
        null=True,
        blank=True,
        editable=False,
        help_text=_('GR-AAAA-NNNNNN, asignado al registrar la salida. Correlativo único por año.'),
    )
    internal_transfer = models.CharField(_('transferencia interna'), max_length=100, blank=True)
    destination_personal = models.ForeignKey(
        'core.Personal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='warehouse_groups',
        verbose_name=_('trabajador destino'),
        help_text=_('destination_detail se conserva siempre como texto (instantánea).'),
    )

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
        verbose_name = _('vale de movimiento')
        verbose_name_plural = _('vales de movimiento')
        ordering = ['-created_at']
        constraints = [
            # Los NULL históricos no chocan entre sí (PostgreSQL y SQLite).
            models.UniqueConstraint(fields=['internal_guide_number'], name='uniq_movgroup_internal_guide'),
            models.CheckConstraint(
                condition=models.Q(internal_guide_number__isnull=True) | models.Q(movement_type='EXIT'),
                name='chk_movgroup_guide_only_exit',
            ),
        ]

    def __str__(self) -> str:
        return self.group_number


class GuideSequence(models.Model):
    """
    Contador del N° de guía interno (SYSPCC-041): una fila por año (America/Lima).

    Se incrementa dentro de la MISMA transacción que descuenta el stock, con la fila bloqueada
    (``select_for_update``): si la transacción revierte, el contador revierte (sin saltos) y la fila
    bloqueada serializa a los concurrentes (sin duplicados). No es una SEQUENCE de PostgreSQL
    porque esa no es transaccional. Ver ``services/guides.py``.
    """

    year = models.PositiveSmallIntegerField(_('año'), primary_key=True)
    last_value = models.PositiveIntegerField(_('último número emitido'), default=0)

    class Meta:
        db_table = 'warehouse_guide_sequences'
        verbose_name = _('correlativo de guías')
        verbose_name_plural = _('correlativos de guías')
        constraints = [
            models.CheckConstraint(condition=models.Q(last_value__gte=0), name='chk_guide_sequence_nonneg'),
        ]

    def __str__(self) -> str:
        return f'{self.year}: {self.last_value}'


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
        verbose_name=_('ítem de inventario'),
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
        verbose_name=_('vale'),
    )

    # SYSPCC-025 — datos del libro real (todos opcionales).
    movement_date = models.DateField(
        _('fecha del movimiento'),
        null=True,
        blank=True,
        help_text=_('Fecha operativa; distinta de created_at (auditoría). NULL solo en filas importadas sin fecha.'),
    )
    voucher_number = models.CharField(_('N° de vale (físico)'), max_length=30, blank=True)
    po_number = models.CharField(_('PO / OC'), max_length=50, blank=True)
    guide_number = models.CharField(_('guía de remisión'), max_length=50, blank=True)
    internal_transfer = models.CharField(_('transferencia interna'), max_length=100, blank=True)
    tag = models.CharField(_('TAG'), max_length=50, blank=True)
    destination_personal = models.ForeignKey(
        'core.Personal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='warehouse_movements',
        verbose_name=_('trabajador destino'),
        help_text=_('destination_detail se conserva siempre como texto (instantánea).'),
    )
    source_key = models.CharField(
        _('clave de origen'),
        max_length=64,
        null=True,
        blank=True,
        unique=True,
        help_text=_('Clave de idempotencia de la importación (huella de la fila).'),
    )
    import_batch = models.ForeignKey(
        'warehouse.InventoryImport',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='movements',
        verbose_name=_('importación'),
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
            models.Index(fields=['inventory', 'movement_date'], name='invmov_inv_date_idx'),
            models.Index(fields=['movement_type', 'movement_date'], name='invmov_type_date_idx'),
        ]

    def __str__(self) -> str:
        return (
            f'{self.movement_number} | {self.get_movement_type_display()} | '
            f'{self.inventory.product_code} x {self.quantity}'
        )
