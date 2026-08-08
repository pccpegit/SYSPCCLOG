"""
Django admin configuration for the support app.
"""

from django.contrib import admin

from apps.support.models import Ticket, TicketComment


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ['ticket_number', 'title', 'category', 'priority', 'status', 'created_by', 'assigned_to', 'created_at']
    list_filter = ['status', 'priority', 'category']
    search_fields = ['ticket_number', 'title', 'created_by__username', 'created_by__email']
    readonly_fields = ['ticket_number', 'created_at', 'updated_at']
    ordering = ['-created_at']


@admin.register(TicketComment)
class TicketCommentAdmin(admin.ModelAdmin):
    list_display = ['ticket', 'author', 'is_status_change', 'created_at']
    list_filter = ['is_status_change']
    search_fields = ['ticket__ticket_number', 'author__username']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['-created_at']
