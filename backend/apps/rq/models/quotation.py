"""
Quotation and QuotationItem models.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator


class Quotation(models.Model):
    """
    Supplier quotation for a supply request.
    Multiple quotations can be created per request for comparison.
    """

    request = models.ForeignKey(
        'rq.Request',
        on_delete=models.CASCADE,
        related_name='quotations',
        verbose_name=_('requerimiento'),
    )
    supplier = models.ForeignKey(
        'rq.Supplier',
        on_delete=models.PROTECT,
        related_name='quotations',
        verbose_name=_('proveedor'),
    )
    quotation_number = models.CharField(
        _('número de cotización'),
        max_length=50,
        blank=True,
        help_text=_('Número de cotización del proveedor'),
    )
    total_amount = models.DecimalField(
        _('monto total'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    currency = models.CharField(_('moneda'), max_length=3, default='PEN')
    delivery_days = models.PositiveIntegerField(_('días de entrega'), null=True, blank=True)
    payment_terms = models.CharField(_('condiciones de pago'), max_length=200, blank=True)
    validity_days = models.PositiveIntegerField(
        _('días de vigencia'),
        null=True,
        blank=True,
        help_text=_('Días de vigencia de la cotización'),
    )
    notes = models.TextField(_('notas'), blank=True)
    document_url = models.CharField(
        _('URL del documento'),
        max_length=500,
        blank=True,
    )
    is_selected = models.BooleanField(_('seleccionada'), default=False)
    selected_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        related_name='quotations_selected',
        null=True,
        blank=True,
        verbose_name=_('seleccionada por'),
        help_text=_('ADM: Jefe Logístico / OPS: Coord. Logístico'),
    )
    selected_at = models.DateTimeField(_('seleccionada el'), null=True, blank=True)
    quoted_at = models.DateTimeField(_('cotización fecha'), auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quotations'
        verbose_name = _('cotización')
        verbose_name_plural = _('cotizaciones')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['request']),
            models.Index(fields=['supplier']),
            models.Index(fields=['is_selected']),
        ]

    def __str__(self) -> str:
        return f'{self.request.rq_number} | {self.supplier.business_name} - {self.currency} {self.total_amount}'


class QuotationItem(models.Model):
    """
    Line item in a quotation matching a request item.
    """

    quotation = models.ForeignKey(
        Quotation,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name=_('cotización'),
    )
    request_item = models.ForeignKey(
        'rq.RequestItem',
        on_delete=models.CASCADE,
        related_name='quotation_items',
        verbose_name=_('ítem del requerimiento'),
    )
    unit_price = models.DecimalField(
        _('precio unitario'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    quantity = models.DecimalField(
        _('cantidad'),
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    total_price = models.DecimalField(
        _('precio total'),
        max_digits=15,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    brand = models.CharField(_('marca'), max_length=100, blank=True)
    model = models.CharField(_('modelo'), max_length=100, blank=True)
    notes = models.TextField(_('notas'), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quotation_items'
        verbose_name = _('ítem de cotización')
        verbose_name_plural = _('ítems de cotización')

    def __str__(self) -> str:
        return f'{self.quotation} / Ítem {self.request_item.line_number}'

    def save(self, *args, **kwargs):
        if self.unit_price and self.quantity:
            self.total_price = self.unit_price * self.quantity
        super().save(*args, **kwargs)
