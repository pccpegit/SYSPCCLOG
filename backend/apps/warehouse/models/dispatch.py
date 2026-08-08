"""
WarehouseDispatch and WarehouseDispatchItem models.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.enums import WarehouseOriginChoices


class WarehouseDispatch(models.Model):
    """
    Records the physical dispatch/delivery of goods from the warehouse.
    OPS: Central Warehouse dispatches to Site Warehouse.
    ADM: Logistics Supervisor delivers to department.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='warehouse_dispatches',
        verbose_name=_('requerimiento'),
    )
    receipt = models.ForeignKey(
        'warehouse.WarehouseReceipt',
        on_delete=models.SET_NULL,
        related_name='dispatches',
        null=True,
        blank=True,
        verbose_name=_('recepción origen'),
    )
    dispatched_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='warehouse_dispatches',
        verbose_name=_('despachado por'),
    )
    dispatch_number = models.CharField(_('número de despacho'), max_length=50, blank=True)
    origin = models.CharField(
        _('origen'),
        max_length=10,
        choices=WarehouseOriginChoices.choices,
    )
    destination_project = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        related_name='warehouse_dispatches_received',
        null=True,
        blank=True,
        verbose_name=_('proyecto destino'),
    )
    destination_department = models.ForeignKey(
        'core.Department',
        on_delete=models.SET_NULL,
        related_name='warehouse_dispatches_received',
        null=True,
        blank=True,
        verbose_name=_('departamento destino'),
    )
    dispatch_guide_number = models.CharField(
        _('número de guía interna'),
        max_length=50,
        blank=True,
    )
    dispatched_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(_('entregado el'), null=True, blank=True)
    accepted_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='dispatches_accepted',
        null=True,
        blank=True,
        verbose_name=_('aceptado por'),
    )
    movement_group = models.OneToOneField(
        'warehouse.MovementGroup',
        on_delete=models.SET_NULL,
        related_name='warehouse_dispatch',
        null=True,
        blank=True,
        verbose_name=_('vale de movimiento'),
        help_text=_('MovementGroup (vale de salida) generado automáticamente al registrar DISPATCHED'),
    )
    notes = models.TextField(_('notas'), blank=True)

    class Meta:
        db_table = 'warehouse_dispatches'
        verbose_name = _('despacho de almacén')
        verbose_name_plural = _('despachos de almacén')
        ordering = ['-dispatched_at']
        indexes = [
            models.Index(fields=['request']),
        ]

    def __str__(self) -> str:
        return f'Despacho {self.dispatch_number or self.pk} | {self.request.rq_number}'


class WarehouseDispatchItem(models.Model):
    """
    Line item in a warehouse dispatch.
    """

    dispatch = models.ForeignKey(
        WarehouseDispatch,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name=_('despacho'),
    )
    request_item = models.ForeignKey(
        'rq.RequestItem',
        on_delete=models.CASCADE,
        related_name='dispatch_items',
        verbose_name=_('ítem del requerimiento'),
    )
    quantity_dispatched = models.DecimalField(
        _('cantidad despachada'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    quantity_delivered = models.DecimalField(
        _('cantidad entregada'),
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'warehouse_dispatch_items'
        verbose_name = _('ítem de despacho')
        verbose_name_plural = _('ítems de despacho')

    def __str__(self) -> str:
        return f'{self.dispatch} / {self.request_item.description}'
