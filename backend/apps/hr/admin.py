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


# SYSPCC-023: CV metadata only. No candidate name, no `result`, no files.
from apps.hr.models import CVAnalysis, CVAnalysisItem  # noqa: E402


@admin.register(CVAnalysis)
class CVAnalysisAdmin(ReadOnlyAdmin):
    list_display = ['id', 'name', 'created_by', 'created_at']
    fields = ['name', 'created_by', 'created_at', 'model_name', 'prompt_version']


@admin.register(CVAnalysisItem)
class CVAnalysisItemAdmin(ReadOnlyAdmin):
    list_display = ['id', 'analysis', 'kind', 'status', 'size_bytes', 'error_code', 'created_at']
    list_filter = ['status', 'kind']
    fields = ['analysis', 'kind', 'status', 'size_bytes', 'attempts', 'error_code', 'tokens_in',
              'tokens_out', 'cost_usd', 'created_at', 'finished_at']
