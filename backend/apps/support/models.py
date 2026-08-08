"""
Support ticket models.
"""

import uuid
from datetime import date

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models.base import TimeStampedModel
from apps.core.models import User
from apps.core.enums import (
    TicketStatusChoices,
    TicketPriorityChoices,
    TicketCategoryChoices,
)


class Ticket(TimeStampedModel):
    """
    IT support ticket raised by any authenticated user.
    """

    ticket_number = models.CharField(
        max_length=20,
        unique=True,
        editable=False,
        verbose_name=_('Número de ticket'),
    )
    title = models.CharField(max_length=200, verbose_name=_('Título'))
    description = models.TextField(verbose_name=_('Descripción'))
    category = models.CharField(
        max_length=20,
        choices=TicketCategoryChoices.choices,
        default=TicketCategoryChoices.OTHER,
        verbose_name=_('Categoría'),
    )
    priority = models.CharField(
        max_length=10,
        choices=TicketPriorityChoices.choices,
        default=TicketPriorityChoices.MEDIUM,
        verbose_name=_('Prioridad'),
    )
    status = models.CharField(
        max_length=15,
        choices=TicketStatusChoices.choices,
        default=TicketStatusChoices.OPEN,
        verbose_name=_('Estado'),
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='support_tickets',
        verbose_name=_('Creado por'),
    )
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_tickets',
        verbose_name=_('Asignado a'),
    )
    resolved_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_('Fecha de resolución'),
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = _('Ticket de soporte')
        verbose_name_plural = _('Tickets de soporte')

    def __str__(self):
        return f"{self.ticket_number} - {self.title}"

    def save(self, *args, **kwargs):
        if not self.ticket_number:
            self.ticket_number = self._generate_ticket_number()
        super().save(*args, **kwargs)

    @staticmethod
    def _generate_ticket_number():
        today = date.today()
        date_str = today.strftime('%Y%m%d')
        # Use a short UUID segment to guarantee uniqueness without a DB round-trip.
        # Format: TK-YYYYMMDD-XXXX (4 hex chars from uuid4)
        unique_suffix = uuid.uuid4().hex[:4].upper()
        return f"TK-{date_str}-{unique_suffix}"


class TicketComment(TimeStampedModel):
    """
    Comment or system-generated status-change note attached to a Ticket.
    """

    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.CASCADE,
        related_name='comments',
        verbose_name=_('Ticket'),
    )
    author = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='ticket_comments',
        verbose_name=_('Autor'),
    )
    content = models.TextField(verbose_name=_('Contenido'))
    is_status_change = models.BooleanField(
        default=False,
        verbose_name=_('Es cambio de estado'),
    )
    old_status = models.CharField(
        max_length=15,
        null=True,
        blank=True,
        verbose_name=_('Estado anterior'),
    )
    new_status = models.CharField(
        max_length=15,
        null=True,
        blank=True,
        verbose_name=_('Nuevo estado'),
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = _('Comentario de ticket')
        verbose_name_plural = _('Comentarios de ticket')

    def __str__(self):
        return f"Comentario de {self.author} en {self.ticket.ticket_number}"
