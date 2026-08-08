"""
Supplier model.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class Supplier(models.Model):
    """
    Vendor/supplier registered in the system.
    """

    ruc = models.CharField(
        _('RUC'),
        max_length=11,
        unique=True,
        help_text=_('RUC del proveedor (11 dígitos)'),
    )
    business_name = models.CharField(_('razón social'), max_length=200)
    trade_name = models.CharField(_('nombre comercial'), max_length=200, blank=True)
    contact_name = models.CharField(_('nombre de contacto'), max_length=100, blank=True)
    contact_email = models.EmailField(_('email de contacto'), max_length=100, blank=True)
    contact_phone = models.CharField(_('teléfono de contacto'), max_length=20, blank=True)
    address = models.CharField(_('dirección'), max_length=300, blank=True)
    city = models.CharField(_('ciudad'), max_length=100, blank=True)
    category = models.CharField(
        _('rubro'),
        max_length=100,
        blank=True,
        help_text=_('Rubro: materiales, equipos, servicios, etc.'),
    )
    is_active = models.BooleanField(_('activo'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'suppliers'
        verbose_name = _('proveedor')
        verbose_name_plural = _('proveedores')
        ordering = ['business_name']
        indexes = [
            models.Index(fields=['is_active']),
            models.Index(fields=['category']),
        ]

    def __str__(self) -> str:
        return f'{self.ruc} - {self.business_name}'
