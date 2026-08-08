"""
Request (RQ) and RequestItem models.
The core entity of the SYSPCCLOG system.
"""

from decimal import Decimal

from django.db import models
from django.db.models import Sum
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.models.base import TimeStampedModel
from apps.core.enums import (
    RQFlowChoices,
    RQStatusChoices,
    PriorityChoices,
    AcquisitionTypeChoices,
    BudgetClassificationChoices,
)


class Request(TimeStampedModel):
    """
    Supply request (Requerimiento de Abastecimiento).
    Central entity of the system - represents a procurement request
    from either the Operations or Administrative flow.
    """

    rq_number = models.CharField(
        _('número de RQ'),
        max_length=20,
        unique=True,
        help_text=_('Auto-generado: RQ-YYYY-NNNN'),
    )
    flow = models.CharField(
        _('flujo'),
        max_length=20,
        choices=RQFlowChoices.choices,
        help_text=_('OPERATIONS o ADMINISTRATIVE - define la cadena de aprobación'),
    )

    # Origin (by flow)
    project = models.ForeignKey(
        'core.Project',
        on_delete=models.PROTECT,
        related_name='requests',
        null=True,
        blank=True,
        verbose_name=_('proyecto'),
        help_text=_('Flujo Operaciones: proyecto de obra'),
    )
    department = models.ForeignKey(
        'core.Department',
        on_delete=models.PROTECT,
        related_name='requests',
        null=True,
        blank=True,
        verbose_name=_('departamento'),
        help_text=_('Flujo Administración: departamento solicitante'),
    )

    requested_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='requests_created',
        verbose_name=_('solicitado por'),
    )

    # Request details
    front_area = models.CharField(
        _('frente de trabajo'),
        max_length=100,
        blank=True,
        help_text=_('Solo Operaciones: frente de trabajo en la obra'),
    )
    service = models.CharField(
        _('servicio/actividad'),
        max_length=100,
        blank=True,
    )
    specific_use = models.CharField(
        _('uso específico'),
        max_length=300,
        blank=True,
    )
    description = models.TextField(_('descripción'), blank=True)
    justification = models.TextField(_('justificación'), blank=True)

    # Acquisition and workflow
    acquisition_type = models.CharField(
        _('tipo de adquisición'),
        max_length=20,
        choices=AcquisitionTypeChoices.choices,
    )
    priority = models.CharField(
        _('prioridad'),
        max_length=10,
        choices=PriorityChoices.choices,
        default=PriorityChoices.NORMAL,
    )
    status = models.CharField(
        _('estado'),
        max_length=30,
        choices=RQStatusChoices.choices,
        default=RQStatusChoices.DRAFT,
        db_index=True,
    )
    current_step = models.ForeignKey(
        'rq.WorkflowStep',
        on_delete=models.SET_NULL,
        related_name='active_requests',
        null=True,
        blank=True,
        verbose_name=_('paso activo del workflow'),
    )

    # Budget classification
    budget_classification = models.CharField(
        _('clasificación presupuestal'),
        max_length=30,
        choices=BudgetClassificationChoices.choices,
        null=True,
        blank=True,
    )
    budget_line = models.ForeignKey(
        'core.ProjectBudgetLine',
        on_delete=models.PROTECT,
        related_name='requests',
        null=True,
        blank=True,
        verbose_name=_('partida presupuestal (OPS)'),
    )
    annual_plan_line = models.ForeignKey(
        'core.AnnualPlanLine',
        on_delete=models.PROTECT,
        related_name='requests',
        null=True,
        blank=True,
        verbose_name=_('línea plan anual (ADM)'),
    )

    # Costs
    estimated_cost = models.DecimalField(
        _('costo estimado'),
        max_digits=15,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    final_cost = models.DecimalField(
        _('costo final'),
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )

    # Dates
    fecha_necesidad = models.DateField(
        _('fecha de necesidad'),
        help_text=_('Fecha en que se necesitan los materiales/servicios'),
    )
    fecha_estimada_entrega = models.DateField(
        _('fecha estimada de entrega'),
        null=True,
        blank=True,
        help_text=_('Calculada según tipo de adquisición + SLA desde fecha de validación'),
    )
    fecha_real_entrega = models.DateField(
        _('fecha real de entrega'),
        null=True,
        blank=True,
    )

    class Meta:
        db_table = 'requests'
        verbose_name = _('requerimiento')
        verbose_name_plural = _('requerimientos')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['flow']),
            models.Index(fields=['project']),
            models.Index(fields=['department']),
            models.Index(fields=['requested_by']),
            models.Index(fields=['status']),
            models.Index(fields=['acquisition_type']),
            models.Index(fields=['priority']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.rq_number} - {self.get_status_display()}'

    @property
    def is_terminal(self) -> bool:
        """True if the request is in a final state."""
        terminal = {
            RQStatusChoices.CLOSED,
            RQStatusChoices.CANCELLED,
            RQStatusChoices.TECHNICAL_REJECTED,
            RQStatusChoices.SUPERVISOR_REJECTED,
            RQStatusChoices.GM_REJECTED,
            RQStatusChoices.COST_OVERRUN_REJECTED,
        }
        return self.status in terminal

    @property
    def total_items_cost(self) -> Decimal:
        """
        Sum of all items' total_price.

        SYSPCC-013 FIX 4: aggregate in the DB and keep the result a Decimal —
        the previous `sum(float(item.total_price or 0) for item in ...)`
        converted money to float (binary-rounding error, e.g. 0.1 + 0.2 !=
        0.3) and pulled every item into Python just to add them up.
        """
        return self.items.aggregate(total=Sum('total_price'))['total'] or Decimal('0')


class RequestItem(models.Model):
    """
    Individual line item within a supply request.
    Represents a single product/material/service being requested.
    """

    request = models.ForeignKey(
        Request,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name=_('requerimiento'),
    )
    line_number = models.PositiveIntegerField(_('línea'))
    description = models.CharField(_('descripción'), max_length=300)
    specifications = models.TextField(_('especificaciones'), blank=True)
    quantity = models.DecimalField(
        _('cantidad'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    unit = models.CharField(
        _('unidad'),
        max_length=30,
        help_text=_('Ej: und, kg, m, m2, m3, gln'),
    )
    unit_price = models.DecimalField(
        _('precio unitario'),
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    total_price = models.DecimalField(
        _('precio total'),
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=_('quantity * unit_price'),
    )
    stock_almacen_obra = models.DecimalField(
        _('stock almacén obra'),
        max_digits=12,
        decimal_places=3,
        default=0,
        help_text=_('Solo Operaciones'),
    )
    stock_almacen_central = models.DecimalField(
        _('stock almacén central'),
        max_digits=12,
        decimal_places=3,
        default=0,
    )
    x_atender = models.DecimalField(
        _('x atender'),
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
        help_text=_('quantity - stocks disponibles'),
    )
    presupuestado_adicional = models.CharField(
        _('P/A'),
        max_length=20,
        blank=True,
        help_text=_('P = Presupuestado, A = Adicional'),
    )
    rfi_fwo = models.CharField(
        _('RFI/FWO'),
        max_length=50,
        blank=True,
        help_text=_('Solo Operaciones: referencia RFI o FWO'),
    )
    estatus_guia = models.CharField(
        _('estatus guía'),
        max_length=100,
        blank=True,
    )
    supply_source = models.CharField(
        _('fuente de atención'),
        max_length=20,
        blank=True,
        choices=[('STOCK', 'Atender de stock'), ('PURCHASE', 'Requiere compra')],
        help_text=_('Definido por logística en verificación de stock'),
    )
    inventory_item = models.ForeignKey(
        'warehouse.Inventory',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='request_items',
        verbose_name=_('Producto de inventario'),
        help_text=_('Vinculacion directa al catalogo de inventario'),
    )
    comentarios = models.TextField(_('comentarios'), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'request_items'
        verbose_name = _('ítem de requerimiento')
        verbose_name_plural = _('ítems de requerimiento')
        unique_together = [('request', 'line_number')]
        ordering = ['line_number']

    def __str__(self) -> str:
        return f'{self.request.rq_number} / Línea {self.line_number}: {self.description}'

    def save(self, *args, **kwargs):
        # Auto-calculate total_price if unit_price is set
        if self.unit_price is not None and self.quantity is not None:
            self.total_price = self.quantity * self.unit_price
        super().save(*args, **kwargs)
