"""
Department, AnnualPlan, and AnnualPlanLine models.
Used for Administrative flow.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator


class Department(models.Model):
    """
    Administrative department/area of the company.
    Used in the Administrative (Administración) flow.
    """

    code = models.CharField(
        _('código'),
        max_length=20,
        unique=True,
        help_text=_('Ej: ADM, RRHH, CONT, TI'),
    )
    name = models.CharField(_('nombre'), max_length=200)
    frente = models.CharField(
        _('frente'),
        max_length=200,
        blank=True,
        default='OFICINA CENTRAL',
        help_text=_('Frente/ubicación. Ej: OFICINA CENTRAL'),
    )
    manager = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='managed_departments',
        null=True,
        blank=True,
        verbose_name=_('jefe directo'),
        help_text=_('Usuario con rol Jefe Directo del departamento'),
    )
    is_active = models.BooleanField(_('activo'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'departments'
        verbose_name = _('departamento')
        verbose_name_plural = _('departamentos')
        ordering = ['name']

    def __str__(self) -> str:
        return f'{self.code} - {self.name}'


class AnnualPlan(models.Model):
    """
    Annual spending plan for a department.
    Budget reference for the Administrative flow.
    """

    year = models.PositiveIntegerField(_('año'))
    department = models.ForeignKey(
        Department,
        on_delete=models.CASCADE,
        related_name='annual_plans',
        verbose_name=_('departamento'),
    )
    total_budget = models.DecimalField(
        _('presupuesto total'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    approved_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='approved_annual_plans',
        null=True,
        blank=True,
        verbose_name=_('aprobado por (GG)'),
    )
    approved_at = models.DateTimeField(_('aprobado el'), null=True, blank=True)
    is_active = models.BooleanField(_('activo'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'annual_plans'
        verbose_name = _('plan anual')
        verbose_name_plural = _('planes anuales')
        unique_together = [('year', 'department')]
        ordering = ['-year', 'department__name']

    def __str__(self) -> str:
        return f'Plan Anual {self.year} - {self.department.code}'


class AnnualPlanLine(models.Model):
    """
    Line item within an Annual Plan.
    Used to validate RQ costs in the Administrative flow.
    """

    annual_plan = models.ForeignKey(
        AnnualPlan,
        on_delete=models.CASCADE,
        related_name='lines',
        verbose_name=_('plan anual'),
    )
    code = models.CharField(_('código'), max_length=50)
    description = models.CharField(_('descripción'), max_length=300)
    category = models.CharField(
        _('categoría'),
        max_length=100,
        blank=True,
        help_text=_('Ej: materiales oficina, equipos TI, mobiliario'),
    )
    budgeted_amount = models.DecimalField(
        _('monto presupuestado'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    committed_amount = models.DecimalField(
        _('monto comprometido'),
        max_digits=15,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    spent_amount = models.DecimalField(
        _('monto ejecutado'),
        max_digits=15,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'annual_plan_lines'
        verbose_name = _('línea de plan anual')
        verbose_name_plural = _('líneas de plan anual')
        unique_together = [('annual_plan', 'code')]

    def __str__(self) -> str:
        return f'{self.annual_plan} / {self.code} - {self.description}'

    @property
    def available_amount(self) -> float:
        """Amount available for new commitments."""
        return float(self.budgeted_amount) - float(self.committed_amount) - float(self.spent_amount)
