"""Read-only admin. `data` (PII snapshot), files and void reasons are NOT
exposed here: the Django admin is not the place to read contracts."""

from django.contrib import admin

from apps.hr.models import DocumentEvent, DocumentTemplate, GeneratedDocument


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DocumentTemplate)
class DocumentTemplateAdmin(ReadOnlyAdmin):
    list_display = ['name', 'document_type', 'slug', 'version', 'is_active', 'created_at']
    list_filter = ['document_type', 'is_active']
    fields = ['name', 'document_type', 'slug', 'version', 'is_active', 'activated_at', 'file_sha256',
              'detected_variables', 'unknown_variables', 'uploaded_by', 'created_at']


@admin.register(GeneratedDocument)
class GeneratedDocumentAdmin(ReadOnlyAdmin):
    list_display = ['reference_number', 'document_type', 'status', 'template_version', 'created_by', 'created_at']
    list_filter = ['document_type', 'status']
    fields = ['reference_number', 'document_type', 'status', 'source', 'template', 'template_version',
              'created_by', 'created_at', 'issued_by', 'issued_at', 'voided_by', 'voided_at']


@admin.register(DocumentEvent)
class DocumentEventAdmin(ReadOnlyAdmin):
    list_display = ['document', 'action', 'actor', 'created_at']
    list_filter = ['action']
    fields = ['document', 'action', 'actor', 'metadata', 'created_at']
