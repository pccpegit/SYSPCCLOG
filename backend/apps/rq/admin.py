"""
Django admin registration for the rq app.
"""

from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from django.utils.html import format_html

from apps.rq.models import (
    AcquisitionTypeConfig,
    WorkflowStep,
    Request,
    RequestItem,
    Approval,
    Supplier,
    Quotation,
    QuotationItem,
    PurchaseOrder,
    PurchaseOrderItem,
    Claim,
    Attachment,
    Notification,
    ActivityLog,
)


@admin.register(AcquisitionTypeConfig)
class AcquisitionTypeConfigAdmin(admin.ModelAdmin):
    list_display = ['type', 'min_days', 'max_days', 'max_extended_days', 'requires_gm_approval']
    list_filter = ['requires_gm_approval', 'requires_admin_approval']


@admin.register(WorkflowStep)
class WorkflowStepAdmin(admin.ModelAdmin):
    list_display = ['flow', 'step_order', 'step_code', 'responsible_role', 'from_status', 'to_status_approve', 'phase']
    list_filter = ['flow', 'responsible_role', 'phase']
    ordering = ['flow', 'step_order']


class RequestItemInline(admin.TabularInline):
    model = RequestItem
    extra = 0
    fields = ['line_number', 'description', 'quantity', 'unit', 'unit_price', 'total_price']
    readonly_fields = ['total_price']


class ApprovalInline(admin.TabularInline):
    model = Approval
    extra = 0
    fields = ['action', 'performed_by', 'role', 'previous_status', 'new_status', 'comments', 'performed_at']
    readonly_fields = ['action', 'performed_by', 'role', 'previous_status', 'new_status', 'performed_at']
    can_delete = False


@admin.register(Request)
class RequestAdmin(admin.ModelAdmin):
    inlines = [RequestItemInline, ApprovalInline]
    list_display = [
        'rq_number', 'flow', 'status_badge', 'priority', 'acquisition_type',
        'requested_by', 'project', 'department', 'estimated_cost', 'fecha_necesidad', 'created_at',
    ]
    list_filter = ['flow', 'status', 'priority', 'acquisition_type', 'budget_classification']
    search_fields = ['rq_number', 'description', 'requested_by__username']
    readonly_fields = ['rq_number', 'status', 'current_step', 'created_at', 'updated_at']
    ordering = ['-created_at']
    autocomplete_fields = ['requested_by', 'project', 'department', 'budget_line', 'annual_plan_line']
    date_hierarchy = 'created_at'

    def status_badge(self, obj):
        colors = {
            'DRAFT': 'gray',
            'SUBMITTED': 'blue',
            'VALIDATED': 'green',
            'CLOSED': 'darkgreen',
            'CANCELLED': 'red',
            'TECHNICAL_REJECTED': 'red',
            'SUPERVISOR_REJECTED': 'red',
            'GM_REJECTED': 'red',
        }
        color = colors.get(obj.status, 'black')
        return format_html(
            '<span style="color: {}; font-weight: bold;">{}</span>',
            color,
            obj.get_status_display(),
        )
    status_badge.short_description = _('Estado')


@admin.register(Approval)
class ApprovalAdmin(admin.ModelAdmin):
    list_display = ['request', 'action', 'performed_by', 'role', 'previous_status', 'new_status', 'performed_at']
    list_filter = ['action', 'role']
    search_fields = ['request__rq_number', 'performed_by__username']
    readonly_fields = list_display


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ['ruc', 'business_name', 'trade_name', 'category', 'city', 'is_active']
    list_filter = ['is_active', 'category', 'city']
    search_fields = ['ruc', 'business_name', 'trade_name']


class QuotationItemInline(admin.TabularInline):
    model = QuotationItem
    extra = 0


@admin.register(Quotation)
class QuotationAdmin(admin.ModelAdmin):
    inlines = [QuotationItemInline]
    list_display = ['request', 'supplier', 'total_amount', 'currency', 'delivery_days', 'is_selected', 'quoted_at']
    list_filter = ['is_selected', 'currency']
    search_fields = ['request__rq_number', 'supplier__business_name', 'quotation_number']


class POItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0
    readonly_fields = ['total_price']


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    inlines = [POItemInline]
    list_display = ['po_number', 'request', 'supplier', 'total_amount', 'status', 'created_at']
    list_filter = ['status', 'currency']
    search_fields = ['po_number', 'supplier__business_name', 'request__rq_number']
    readonly_fields = ['po_number', 'created_at', 'updated_at']


@admin.register(Claim)
class ClaimAdmin(admin.ModelAdmin):
    list_display = ['request', 'claim_type', 'status', 'raised_by', 'managed_by', 'created_at']
    list_filter = ['claim_type', 'status']
    search_fields = ['request__rq_number', 'description']


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ['request', 'file_name', 'category', 'uploaded_by', 'file_size', 'uploaded_at']
    list_filter = ['category']
    search_fields = ['request__rq_number', 'file_name']


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['user', 'title', 'request', 'is_read', 'created_at']
    list_filter = ['is_read']
    search_fields = ['user__username', 'title']


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ['request', 'user', 'action', 'ip_address', 'created_at']
    list_filter = ['action']
    search_fields = ['request__rq_number', 'user__username', 'action']
    readonly_fields = ['request', 'user', 'action', 'detail', 'ip_address', 'created_at']
