"""
Workflow configuration models:
- AcquisitionTypeConfig: SLA days per acquisition type
- WorkflowStep: State machine definition for both flows
"""

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.enums import (
    AcquisitionTypeChoices,
    RQFlowChoices,
    RoleChoices,
    RQStatusChoices,
)


class AcquisitionTypeConfig(models.Model):
    """
    Defines SLA (Service Level Agreement) times and approval requirements
    for each acquisition type.
    Populated via the seed_data management command.
    """

    type = models.CharField(
        _('tipo de adquisición'),
        max_length=20,
        choices=AcquisitionTypeChoices.choices,
        unique=True,
    )
    min_days = models.PositiveIntegerField(_('días mínimos'))
    max_days = models.PositiveIntegerField(_('días máximos'))
    max_extended_days = models.PositiveIntegerField(
        _('días máximos con extensión'),
        null=True,
        blank=True,
        help_text=_('Máximo con extensión, ej: fabricaciones +7d'),
    )
    requires_gm_approval = models.BooleanField(
        _('requiere aprobación GG'),
        default=False,
    )
    requires_admin_approval = models.BooleanField(
        _('requiere aprobación Gte. Administrativo'),
        default=False,
    )
    requires_project_manager_approval = models.BooleanField(
        _('requiere aprobación Gerente de Proyecto'),
        default=False,
    )
    requires_cost_control_approval = models.BooleanField(
        _('requiere aprobación Control de Costos'),
        default=False,
    )
    notes = models.TextField(_('notas'), blank=True)

    class Meta:
        db_table = 'acquisition_type_config'
        verbose_name = _('configuración de tipo de adquisición')
        verbose_name_plural = _('configuraciones de tipos de adquisición')
        ordering = ['type']

    def __str__(self) -> str:
        return f'{self.get_type_display()} ({self.min_days}-{self.max_days} días)'


class WorkflowStep(models.Model):
    """
    Defines each step in the Operations and Administrative workflow.
    Used by the workflow engine to validate and execute state transitions.
    Populated via the seed_data management command.
    """

    flow = models.CharField(
        _('flujo'),
        max_length=20,
        choices=RQFlowChoices.choices,
    )
    step_order = models.PositiveIntegerField(
        _('orden'),
        help_text=_('Orden del paso en el flujo'),
    )
    step_code = models.CharField(
        _('código de paso'),
        max_length=50,
        help_text=_('Código único del paso, ej: OPS_SUBMIT'),
    )
    step_name = models.CharField(_('nombre'), max_length=200)
    responsible_role = models.CharField(
        _('rol responsable'),
        max_length=30,
        choices=RoleChoices.choices,
    )
    from_status = models.CharField(
        _('estado de origen'),
        max_length=30,
        choices=RQStatusChoices.choices,
        help_text=_('Estado requerido para ejecutar este paso'),
    )
    to_status_approve = models.CharField(
        _('estado si aprueba'),
        max_length=30,
        choices=RQStatusChoices.choices,
        help_text=_('Estado resultante si se aprueba/completa el paso'),
    )
    to_status_reject = models.CharField(
        _('estado si rechaza'),
        max_length=30,
        choices=RQStatusChoices.choices,
        null=True,
        blank=True,
        help_text=_('Estado resultante si se rechaza. Null = no aplica rechazo.'),
    )
    is_conditional = models.BooleanField(
        _('es condicional'),
        default=False,
        help_text=_('True si el paso depende de una condición'),
    )
    condition_description = models.TextField(
        _('descripción de condición'),
        blank=True,
        help_text=_('Ej: solo si es adicional al presupuesto'),
    )
    is_terminal_on_reject = models.BooleanField(
        _('rechazo termina el proceso'),
        default=False,
        help_text=_('True si el rechazo en este paso finaliza el RQ'),
    )
    phase = models.PositiveSmallIntegerField(
        _('fase'),
        help_text=_('Fase del lifecycle (1=Solicitud, 2=Aprobación, 3=Logística, 4=Recepción, 5=Conformidad)'),
    )

    class Meta:
        db_table = 'workflow_steps'
        verbose_name = _('paso de workflow')
        verbose_name_plural = _('pasos de workflow')
        unique_together = [
            ('flow', 'step_order'),
            ('flow', 'step_code'),
        ]
        ordering = ['flow', 'step_order']
        indexes = [
            models.Index(fields=['flow', 'from_status']),
            models.Index(fields=['responsible_role']),
        ]

    def __str__(self) -> str:
        return f'[{self.flow}] Paso {self.step_order}: {self.step_name}'
