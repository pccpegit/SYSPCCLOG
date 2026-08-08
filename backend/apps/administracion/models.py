"""
Models for the Administración app — Gestión de Pasajes (Travel Tickets).

Covers:
  - ProveedorPasajes: travel ticket suppliers (airlines, agencies)
  - PoliticaPasajeDevoluciones: refund policy per worker type and route
  - Pasaje: individual travel ticket record with full billing, amounts and audit trail
"""

from django.db import models


class Puesto(models.Model):
    """Job position / title lookup table for the pasajes module."""

    cargo = models.CharField('Cargo', max_length=200, unique=True)
    habilitado = models.BooleanField('Habilitado', default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'puesto'
        ordering = ['cargo']
        verbose_name = 'Puesto'
        verbose_name_plural = 'Puestos'

    def __str__(self):
        return self.cargo


class ProveedorPasajes(models.Model):
    """Travel ticket supplier (airline or travel agency)."""

    ruc = models.CharField('RUC', max_length=11, unique=True)
    razon_social = models.CharField('Razón Social', max_length=255)
    created_at = models.DateTimeField('Fecha de registro', auto_now_add=True)

    class Meta:
        db_table = 'proveedor_pasajes'
        ordering = ['razon_social']
        verbose_name = 'Proveedor de Pasajes'
        verbose_name_plural = 'Proveedores de Pasajes'

    def __str__(self):
        return f'{self.ruc} - {self.razon_social}'


class PoliticaPasajeDevoluciones(models.Model):
    """
    Refund policy for a given worker type and route.
    Defines how much is reimbursed when a ticket is returned.
    """

    TIPO_TRABAJADOR = [
        ('STAFF', 'Staff'),
        ('WORKER', 'Worker'),
    ]

    tipo_trabajador = models.CharField(
        'Tipo de Trabajador',
        max_length=10,
        choices=TIPO_TRABAJADOR,
    )
    tramo = models.CharField('Tramo (Ruta)', max_length=100)
    en_dolares = models.BooleanField(
        'Tarifa en Dólares',
        default=False,
        help_text='Si el monto de referencia de la política está en dólares.',
    )
    no_devolucion = models.BooleanField(
        'Sin Devolución',
        default=False,
        help_text='Si está marcado, este tramo no tiene devolución.',
    )
    monto_dolares = models.DecimalField(
        'Monto de Devolución (USD)',
        max_digits=10,
        decimal_places=2,
        default=0,
    )
    monto_soles = models.DecimalField(
        'Monto de Devolución (PEN)',
        max_digits=10,
        decimal_places=2,
        default=0,
    )
    habilitado = models.BooleanField('Habilitado', default=True)

    class Meta:
        db_table = 'politica_pasaje_devoluciones'
        ordering = ['tramo']
        verbose_name = 'Política de Devolución de Pasajes'
        verbose_name_plural = 'Políticas de Devolución de Pasajes'

    def __str__(self):
        return f'{self.tramo} — {self.get_tipo_trabajador_display()}'


class Pasaje(models.Model):
    """
    Individual travel ticket record.

    Covers the full lifecycle of a mining-operation flight/bus ticket:
    travel details, personnel, billing, amounts, payment status and audit trail.
    """

    TIPO_CHOICES = [
        ('B', 'Bajada'),
        ('S', 'Subida'),
        ('S/B', 'Subida/Bajada'),
    ]
    ESTADO_CHOICES = [
        ('PENDIENTE', 'Pendiente'),
        ('PAGADO', 'Pagado'),
    ]
    TIPO_TRABAJADOR = [
        ('STAFF', 'Staff'),
        ('WORKER', 'Worker'),
    ]
    MONEDA_CHOICES = [
        ('SOLES', 'Soles'),
        ('DOLARES', 'Dólares'),
    ]

    # ------------------------------------------------------------------
    # Legacy import tracking
    # ------------------------------------------------------------------

    # Natural key from the legacy SQL Server export (`CodigoId` column).
    # Nullable because rows created directly in the app (not via CSV import)
    # have no legacy id; NULLs don't collide under a UNIQUE constraint in
    # either PostgreSQL or SQLite. Used by `import_pasajes_csv` to make
    # re-running the same CSV idempotent (update_or_create) instead of
    # duplicating every row.
    codigo_id_legado = models.CharField(
        'Código ID (legado)',
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        help_text='ID del registro en el sistema legado (SQL Server). Clave natural para reimportar el CSV histórico sin duplicar.',
    )

    # ------------------------------------------------------------------
    # Travel info
    # ------------------------------------------------------------------

    tipo = models.CharField('Tipo', max_length=10, choices=TIPO_CHOICES)
    fecha_bajada = models.DateField('Fecha Bajada', null=True, blank=True)
    embarque_bajada = models.CharField('Embarque Bajada', max_length=100, blank=True)
    destino_bajada = models.CharField('Destino Bajada', max_length=100, blank=True)
    fecha_subida = models.DateField('Fecha Subida', null=True, blank=True)
    embarque_subida = models.CharField('Embarque Subida', max_length=100, blank=True)
    destino_subida = models.CharField('Destino Subida', max_length=100, blank=True)

    # ------------------------------------------------------------------
    # Personnel
    # ------------------------------------------------------------------

    personal = models.ForeignKey(
        'core.Personal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pasajes_personal',
        verbose_name='personal',
    )
    dni = models.CharField('DNI', max_length=20)
    nombres = models.CharField('Nombres', max_length=255)
    cargo = models.CharField('Cargo', max_length=255, blank=True)
    tipo_trabajador = models.CharField(
        'Tipo de Trabajador',
        max_length=10,
        choices=TIPO_TRABAJADOR,
    )
    centro_costo = models.ForeignKey(
        'core.Project',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pasajes',
        verbose_name='Centro de Costo',
    )

    # ------------------------------------------------------------------
    # Billing
    # ------------------------------------------------------------------

    proveedor = models.ForeignKey(
        ProveedorPasajes,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pasajes',
        verbose_name='Proveedor',
    )
    # Denormalised fields — copied from supplier at the time of registration
    # so they survive supplier record changes.
    ruc = models.CharField('RUC (factura)', max_length=11, blank=True)
    razon_social = models.CharField('Razón Social (factura)', max_length=255, blank=True)
    factura_ticket = models.CharField('N. Factura / Ticket', max_length=50, blank=True)
    detalle = models.TextField('Detalle / Ruta', blank=True)
    fecha = models.DateField('Fecha de Factura', null=True, blank=True)
    # Derived automatically from `fecha` in save()
    mes = models.CharField('Mes', max_length=20, blank=True)

    # ------------------------------------------------------------------
    # Amounts
    # ------------------------------------------------------------------

    moneda = models.CharField(
        'Moneda',
        max_length=10,
        choices=MONEDA_CHOICES,
        default='SOLES',
    )
    monto_con_igv_soles = models.DecimalField(
        'Monto con IGV (PEN)',
        max_digits=18,
        decimal_places=2,
        default=0,
    )
    monto_con_igv_dolares = models.DecimalField(
        'Monto con IGV (USD)',
        max_digits=18,
        decimal_places=2,
        default=0,
    )
    tipo_cambio = models.DecimalField(
        'Tipo de Cambio',
        max_digits=18,
        decimal_places=3,
        default=0,
    )
    devolucion = models.DecimalField(
        'Devolución',
        max_digits=18,
        decimal_places=2,
        default=0,
    )
    total = models.DecimalField(
        'Total (PEN)',
        max_digits=18,
        decimal_places=2,
        default=0,
    )

    # ------------------------------------------------------------------
    # Payment
    # ------------------------------------------------------------------

    estado = models.CharField(
        'Estado',
        max_length=20,
        choices=ESTADO_CHOICES,
        default='PENDIENTE',
    )
    fecha_pago = models.DateField('Fecha de Pago', null=True, blank=True)
    numero_operacion = models.CharField('N. Operación', max_length=50, blank=True)

    # ------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------

    habilitado = models.BooleanField('Habilitado', default=True)
    creado_por = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='pasajes_creados',
        verbose_name='Creado por',
    )
    fecha_registro = models.DateTimeField('Fecha de Registro', auto_now_add=True)
    actualizado_por = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pasajes_actualizados',
        verbose_name='Actualizado por',
    )
    fecha_actualizacion = models.DateTimeField('Fecha de Actualización', auto_now=True)

    class Meta:
        db_table = 'pasajes'
        ordering = ['-fecha_registro']
        verbose_name = 'Pasaje'
        verbose_name_plural = 'Pasajes'
        indexes = [
            models.Index(fields=['dni']),
            models.Index(fields=['estado']),
            models.Index(fields=['fecha']),
        ]

    def __str__(self):
        return f'{self.dni} — {self.nombres} [{self.tipo}] {self.fecha or ""}'

    # ------------------------------------------------------------------
    # Auto-calculations on save
    # ------------------------------------------------------------------

    _MESES = {
        1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
        5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
        9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
    }

    def save(self, *args, **kwargs):
        # Derive mes from fecha
        if self.fecha:
            self.mes = self._MESES.get(self.fecha.month, '')

        # Calculate total in soles
        if self.moneda == 'SOLES':
            self.total = self.monto_con_igv_soles - self.devolucion
        else:
            # Dollar ticket: convert to soles then subtract devolucion
            self.total = (self.monto_con_igv_dolares * self.tipo_cambio) - self.devolucion

        super().save(*args, **kwargs)
