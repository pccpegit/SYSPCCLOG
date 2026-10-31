"""
InventoryImport — one uploaded inventory workbook going through the two-step
import (preview, then confirm). SYSPCC-025.

The importer pipeline itself (parser / planner / applier) lives in
``apps/warehouse/services/imports/``; this module only holds the persistent
state shared by the two steps.

Privacy note: ``file_bytes`` holds the uploaded workbook, which may contain
worker names. It is stored in the database (not on disk) because the
deployment platforms have ephemeral disks and several instances can serve the
"upload" and the "confirm" requests. It must be emptied as soon as the import
is confirmed, cancelled or expired.
"""
import uuid

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.enums import WarehouseOriginChoices


class InventoryImportStatus(models.TextChoices):
    PREVIEWED = 'PREVIEWED', _('Previsualizada')
    PROCESSING = 'PROCESSING', _('En proceso')
    CONFIRMED = 'CONFIRMED', _('Confirmada')
    CANCELLED = 'CANCELLED', _('Cancelada')
    EXPIRED = 'EXPIRED', _('Vencida')
    FAILED = 'FAILED', _('Fallida')


class InventoryImport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploaded_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='inventory_imports',
        verbose_name=_('subido por'),
    )
    warehouse = models.CharField(
        _('almacén'),
        max_length=10,
        choices=WarehouseOriginChoices.choices,
        default=WarehouseOriginChoices.CENTRAL,
    )
    file_name = models.CharField(_('nombre del archivo'), max_length=200)
    file_sha256 = models.CharField(_('huella SHA-256'), max_length=64, db_index=True)
    file_bytes = models.BinaryField(_('archivo'), null=True, blank=True, editable=False)
    status = models.CharField(
        _('estado'),
        max_length=12,
        choices=InventoryImportStatus.choices,
        default=InventoryImportStatus.PREVIEWED,
    )
    is_reimport = models.BooleanField(
        _('reimportación'),
        default=False,
        help_text=_(
            'SYSPCC-032: el mismo libro ya confirmado se vuelve a procesar a propósito (comando con '
            '--reimport) para agregar solo las filas que antes se omitieron. Las filas ya importadas '
            'se reconocen por su source_key y no se duplican.'
        ),
    )
    options = models.JSONField(_('opciones'), default=dict, blank=True)
    summary = models.JSONField(_('resumen'), default=dict, blank=True)
    problems = models.JSONField(_('problemas'), default=dict, blank=True)
    plan_digest = models.CharField(_('huella del plan'), max_length=64, blank=True)
    result = models.JSONField(_('resultado'), default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(_('confirmada el'), null=True, blank=True)
    expires_at = models.DateTimeField(_('vence el'), null=True, blank=True)

    class Meta:
        db_table = 'inventory_imports'
        verbose_name = _('importación de inventario')
        verbose_name_plural = _('importaciones de inventario')
        ordering = ['-created_at']
        constraints = [
            # The same workbook cannot be confirmed twice for the same warehouse, except through an
            # explicit re-import (SYSPCC-032), which only adds rows that were never imported.
            models.UniqueConstraint(
                fields=['file_sha256', 'warehouse'],
                condition=models.Q(status='CONFIRMED', is_reimport=False),
                name='inventory_import_confirmed_file_unique',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.pk} | {self.status}'

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at <= timezone.now())

    def clear_file(self) -> None:
        """Drop the stored workbook (privacy). Caller must save the field."""
        self.file_bytes = b''
