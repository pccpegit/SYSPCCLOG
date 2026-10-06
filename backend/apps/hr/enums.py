"""Enums for the RR. HH. document generator (SYSPCC-022)."""

from django.db import models
from django.utils.translation import gettext_lazy as _


class HRDocumentType(models.TextChoices):
    # Ceses (CE) and boletas (BP) are future tickets: adding a type means
    # adding a choice here + one DocumentTypeSpec in documents/registry.py.
    CONTRACT = 'CONTRACT', _('Contrato de trabajo')


class DocumentStatus(models.TextChoices):
    DRAFT = 'DRAFT', _('Borrador')
    ISSUED = 'ISSUED', _('Emitido')
    VOIDED = 'VOIDED', _('Anulado')


class ContractType(models.TextChoices):
    INDEFINITE = 'INDEFINITE', _('A plazo indeterminado')
    FIXED_TERM = 'FIXED_TERM', _('A plazo fijo')


class FixedTermModality(models.TextChoices):
    OBRA_SERVICIO = 'OBRA_SERVICIO', _('Por obra o servicio específico')
    NECESIDAD_MERCADO = 'NECESIDAD_MERCADO', _('Por necesidades del mercado')
    OCASIONAL = 'OCASIONAL', _('Ocasional')
    SUPLENCIA = 'SUPLENCIA', _('De suplencia')
    EMERGENCIA = 'EMERGENCIA', _('De emergencia')
    INICIO_ACTIVIDAD = 'INICIO_ACTIVIDAD', _('Por inicio o incremento de actividad')
    RECONVERSION = 'RECONVERSION', _('Por reconversión empresarial')
    INTERMITENTE = 'INTERMITENTE', _('Intermitente')
    # D.S. 003-97-TR: contratos para obra o servicio (obra/servicio específico, intermitente, temporada)
    TEMPORADA = 'TEMPORADA', _('De temporada')
    EXPORTACION = 'EXPORTACION', _('De exportación no tradicional')


class Currency(models.TextChoices):
    PEN = 'PEN', _('Soles (PEN)')
    USD = 'USD', _('Dólares (USD)')


class PaymentFrequency(models.TextChoices):
    MONTHLY = 'MONTHLY', _('Mensual')
    BIWEEKLY = 'BIWEEKLY', _('Quincenal')


class DocumentSource(models.TextChoices):
    MANUAL = 'MANUAL', _('Formulario')
    ASSISTANT = 'ASSISTANT', _('Asistente')


class DocumentEventAction(models.TextChoices):
    CREATED = 'CREATED', _('Creado')
    UPDATED = 'UPDATED', _('Actualizado')
    ISSUED = 'ISSUED', _('Emitido')
    VOIDED = 'VOIDED', _('Anulado')
    DOWNLOADED = 'DOWNLOADED', _('Descargado')
    PDF_RENDERED = 'PDF_RENDERED', _('PDF generado')
