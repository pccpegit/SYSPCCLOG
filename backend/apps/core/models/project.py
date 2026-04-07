"""
Project and ProjectBudgetLine models.
Used for Operations (Obras) flow.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from apps.core.models.base import TimeStampedModel


class Project(TimeStampedModel):
    """
    Construction project (obra) for the Operations flow.
    Budget validation for RQs in Operaciones flow references ProjectBudgetLine.
    """

    code = models.CharField(
        _('código'),
        max_length=20,
        unique=True,
        help_text=_('Ej: PROY-2026-001'),
    )
    name = models.CharField(_('nombre'), max_length=200)
    location = models.CharField(_('ubicación'), max_length=200, blank=True)
    client = models.CharField(_('cliente'), max_length=200, blank=True)
    frente = models.CharField(
        _('frente'),
        max_length=200,
        blank=True,
        help_text=_('Frente/ubicación del proyecto. Ej: MINERA YANACOCHA'),
    )
    total_budget = models.DecimalField(
        _('presupuesto total'),
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    start_date = models.DateField(_('fecha inicio'), null=True, blank=True)
    end_date = models.DateField(_('fecha fin'), null=True, blank=True)
    is_active = models.BooleanField(_('activo'), default=True)

    class Meta:
        db_table = 'projects'
        verbose_name = _('proyecto')
        verbose_name_plural = _('proyectos')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active']),
            models.Index(fields=['code']),
        ]

    def __str__(self) -> str:
        return f'{self.code} - {self.name}'


class ProjectBudgetLine(models.Model):
    """
    Budget line (partida presupuestal) for a project.
    Used to validate RQ costs in the Operations flow.
    """

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='budget_lines',
        verbose_name=_('proyecto'),
    )
    code = models.CharField(
        _('código partida'),
        max_length=50,
        help_text=_('Código de partida presupuestal'),
    )
    description = models.CharField(_('descripción'), max_length=300)
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
        help_text=_('Monto comprometido en RQs'),
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
        db_table = 'project_budget_lines'
        verbose_name = _('partida presupuestal')
        verbose_name_plural = _('partidas presupuestales')
        unique_together = [('project', 'code')]
        indexes = [
            models.Index(fields=['project', 'code']),
        ]

    def __str__(self) -> str:
        return f'{self.project.code} / {self.code} - {self.description}'

    @property
    def available_amount(self) -> float:
        """Amount available for new commitments."""
        return float(self.budgeted_amount) - float(self.committed_amount) - float(self.spent_amount)
