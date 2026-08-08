"""
Personal model — employee/personnel data for RRHH.
Linked optionally to User (1-to-1) for employees who also have system access.
"""
from django.db import models
from django.utils.translation import gettext_lazy as _


class Personal(models.Model):
    """Complete employee record with all RRHH attributes."""

    ESTADO_CHOICES = [
        ('ACTIVO', 'Activo'),
        ('CESADO', 'Cesado'),
        ('VACACIONES', 'Vacaciones'),
        ('LICENCIA', 'Licencia'),
    ]
    ESTADO_CIVIL_CHOICES = [
        ('SOLTERO', 'Soltero/a'),
        ('CASADO', 'Casado/a'),
        ('DIVORCIADO', 'Divorciado/a'),
        ('VIUDO', 'Viudo/a'),
        ('CONVIVIENTE', 'Conviviente'),
    ]
    SEXO_CHOICES = [('M', 'Masculino'), ('F', 'Femenino')]
    GUARDIA_CHOICES = [
        ('A', 'Guardia A'),
        ('B', 'Guardia B'),
        ('C', 'Guardia C'),
        ('D', 'Dia'),
    ]
    CONDICION_CHOICES = [
        ('PLANILLA', 'Planilla'),
        ('RECIBO', 'Recibo por Honorarios'),
        ('CONTRATO', 'Contrato'),
    ]
    PENSION_CHOICES = [
        ('ONP', 'ONP'),
        ('AFP_HABITAT', 'AFP Habitat'),
        ('AFP_INTEGRA', 'AFP Integra'),
        ('AFP_PRIMA', 'AFP Prima'),
        ('AFP_PROFUTURO', 'AFP Profuturo'),
    ]
    NIVEL_EDUCATIVO_CHOICES = [
        ('PRIMARIA', 'Primaria'),
        ('SECUNDARIA', 'Secundaria'),
        ('TECNICO', 'Técnico'),
        ('UNIVERSITARIO', 'Universitario'),
        ('POSTGRADO', 'Postgrado'),
    ]

    # Link to system user (optional — not all personnel have system access)
    user = models.OneToOneField(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='personal',
        verbose_name=_('usuario del sistema'),
    )

    # Identity
    dni = models.CharField(_('DNI'), max_length=20, unique=True)
    apellidos_nombres = models.CharField(_('apellidos y nombres'), max_length=255)
    fecha_nacimiento = models.DateField(_('fecha de nacimiento'), null=True, blank=True)
    sexo = models.CharField(_('sexo'), max_length=1, choices=SEXO_CHOICES, blank=True)
    estado_civil = models.CharField(
        _('estado civil'), max_length=15, choices=ESTADO_CIVIL_CHOICES, blank=True
    )

    # Contact
    celular = models.CharField(_('celular'), max_length=20, blank=True)
    email_personal = models.EmailField(_('email personal'), blank=True)

    # Emergency contact
    contacto_emergencia_nombre = models.CharField(
        _('nombre contacto emergencia'), max_length=255, blank=True
    )
    contacto_emergencia_telefono = models.CharField(
        _('telefono contacto emergencia'), max_length=20, blank=True
    )
    contacto_emergencia_vinculo = models.CharField(
        _('vinculo contacto emergencia'), max_length=50, blank=True
    )

    # Address
    departamento_residencia = models.CharField(
        _('departamento residencia'), max_length=100, blank=True
    )
    provincia_residencia = models.CharField(
        _('provincia residencia'), max_length=100, blank=True
    )
    distrito_residencia = models.CharField(
        _('distrito residencia'), max_length=100, blank=True
    )
    direccion_residencia = models.CharField(
        _('direccion residencia'), max_length=300, blank=True
    )

    # Education
    nivel_educativo = models.CharField(
        _('nivel educativo'), max_length=20, choices=NIVEL_EDUCATIVO_CHOICES, blank=True
    )
    grado_academico = models.CharField(_('grado academico'), max_length=100, blank=True)
    especialidad_carrera = models.CharField(
        _('especialidad / carrera'), max_length=200, blank=True
    )

    # Employment
    estado = models.CharField(
        _('estado'), max_length=15, choices=ESTADO_CHOICES, default='ACTIVO'
    )
    fecha_ingreso = models.DateField(_('fecha de ingreso'), null=True, blank=True)
    fecha_cese = models.DateField(_('fecha de cese'), null=True, blank=True)
    motivo_cese = models.CharField(_('motivo cese'), max_length=255, blank=True)
    proyecto = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='personal',
        verbose_name=_('proyecto'),
    )
    sede = models.CharField(_('sede'), max_length=100, blank=True)
    puesto = models.CharField(_('puesto'), max_length=200, blank=True)
    guardia = models.CharField(
        _('guardia'), max_length=5, choices=GUARDIA_CHOICES, blank=True
    )
    condicion_trabajo = models.CharField(
        _('condicion de trabajo'), max_length=20, choices=CONDICION_CHOICES, blank=True
    )

    # Compensation
    salario = models.DecimalField(
        _('salario'), max_digits=10, decimal_places=2, default=0
    )
    sistema_pensiones = models.CharField(
        _('sistema de pensiones'), max_length=20, choices=PENSION_CHOICES, blank=True
    )
    entidad_bancaria = models.CharField(_('entidad bancaria'), max_length=100, blank=True)
    numero_cuenta = models.CharField(_('numero de cuenta'), max_length=30, blank=True)
    cci = models.CharField(_('CCI'), max_length=30, blank=True)

    # Family
    tiene_hijos = models.BooleanField(_('tiene hijos'), default=False)
    hijos_menores_18 = models.BooleanField(_('hijos menores de 18'), default=False)
    cantidad_hijos_menores = models.PositiveIntegerField(
        _('cantidad hijos menores'), default=0
    )
    nombres_hijos_menores = models.TextField(_('nombres hijos menores'), blank=True)
    asignacion_familiar = models.BooleanField(_('asignacion familiar'), default=False)

    # Work gear
    numero_fotocheck = models.CharField(_('N fotocheck'), max_length=20, blank=True)
    talla_zapato = models.CharField(_('talla zapato'), max_length=10, blank=True)
    talla_pantalon = models.CharField(_('talla pantalon'), max_length=10, blank=True)
    talla_camisa = models.CharField(_('talla camisa'), max_length=10, blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'personal'
        verbose_name = _('personal')
        verbose_name_plural = _('personal')
        ordering = ['apellidos_nombres']
        indexes = [
            models.Index(fields=['dni']),
            models.Index(fields=['estado']),
            models.Index(fields=['proyecto']),
        ]

    def __str__(self):
        return f'{self.dni} - {self.apellidos_nombres}'

    @property
    def edad(self):
        if not self.fecha_nacimiento:
            return None
        from datetime import date
        today = date.today()
        return today.year - self.fecha_nacimiento.year - (
            (today.month, today.day)
            < (self.fecha_nacimiento.month, self.fecha_nacimiento.day)
        )
