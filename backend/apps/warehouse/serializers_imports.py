"""Serializers of the inventory importer endpoints (SYSPCC-025)."""
from rest_framework import serializers

from apps.core.enums import WarehouseOriginChoices
from apps.warehouse.models import InventoryImport, InventoryImportStatus
from apps.warehouse.serializers import MAX_BIGINT

MAX_PROJECT_MAP = 50
MAX_DESTINATION_MAP = 1000


class ImportUploadSerializer(serializers.Serializer):
    """POST imports/ (multipart)."""

    file = serializers.FileField(
        error_messages={
            'required': 'Adjunte el libro de Excel (.xlsx).',
            'invalid': 'Adjunte el libro de Excel (.xlsx).',
            'empty': 'El archivo está vacío.',
            'no_name': 'El archivo no tiene nombre.',
        },
    )
    warehouse = serializers.ChoiceField(
        choices=WarehouseOriginChoices.choices, default=WarehouseOriginChoices.CENTRAL, required=False,
        error_messages={'invalid_choice': 'Almacén inválido.'},
    )
    update_existing = serializers.BooleanField(default=False, required=False)


class ImportConfirmSerializer(serializers.Serializer):
    """POST imports/{id}/confirm/."""

    # Any text is accepted here (an unknown import must still be a 404); the service compares it as
    # bytes, so a digest that is not the plan's is a 409 ``plan_changed`` and never a crash.
    expected_plan_digest = serializers.CharField(max_length=64)
    # Ids are bounded to the database range: a larger one overflows the query parameter (500).
    project_map = serializers.DictField(
        child=serializers.IntegerField(allow_null=True, min_value=1, max_value=MAX_BIGINT),
        required=False, default=dict,
    )
    destination_map = serializers.DictField(
        child=serializers.IntegerField(min_value=1, max_value=MAX_BIGINT), required=False, default=dict,
    )
    accept_warnings = serializers.BooleanField(default=False, required=False)
    accept_skipped_rows = serializers.BooleanField(default=False, required=False)

    def validate_project_map(self, value):
        if len(value) > MAX_PROJECT_MAP:
            raise serializers.ValidationError('Demasiados proyectos en el mapeo.')
        return value

    def validate_destination_map(self, value):
        if len(value) > MAX_DESTINATION_MAP:
            raise serializers.ValidationError('Demasiados destinos en el mapeo.')
        return value


def _uploader_name(obj) -> str:
    user = obj.uploaded_by
    return user.get_full_name() or user.get_username()


class InventoryImportSerializer(serializers.ModelSerializer):
    """Detail of one import. Problems are served by ``problems/`` (they can be thousands)."""

    uploaded_by_name = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    projects = serializers.SerializerMethodField()
    unmatched_destinations = serializers.SerializerMethodField()
    requires = serializers.SerializerMethodField()
    can_confirm = serializers.SerializerMethodField()

    class Meta:
        model = InventoryImport
        fields = [
            'id', 'status', 'warehouse', 'file_name', 'file_sha256', 'options', 'plan_digest',
            'summary', 'projects', 'unmatched_destinations', 'requires', 'can_confirm', 'result',
            'uploaded_by', 'uploaded_by_name', 'created_at', 'confirmed_at', 'expires_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj) -> str:
        return _uploader_name(obj)

    def _summary(self, obj) -> dict:
        return obj.summary if isinstance(obj.summary, dict) else {}

    def get_summary(self, obj) -> dict:
        summary = dict(self._summary(obj))
        for heavy in ('projects', 'unmatched_destinations', 'requires'):
            summary.pop(heavy, None)
        return summary

    def get_projects(self, obj) -> list:
        return self._summary(obj).get('projects', [])

    def get_unmatched_destinations(self, obj) -> list:
        # Worker names. Only the roles that link destinations to workers (the ones that import)
        # see them; the history stays readable for the other warehouse roles without names.
        # An expired preview no longer shows them even if the purge has not reached it yet.
        if not self.context.get('show_destinations') or obj.is_expired:
            return []
        return self._summary(obj).get('unmatched_destinations', [])

    def get_requires(self, obj) -> dict:
        return self._summary(obj).get('requires', {})

    def get_can_confirm(self, obj) -> bool:
        blockers = self._summary(obj).get('counts', {}).get('blocker', 0)
        return obj.status == InventoryImportStatus.PREVIEWED and not obj.is_expired and blockers == 0


class InventoryImportListSerializer(serializers.ModelSerializer):
    """Row of the history list: no destinations, no problems."""

    uploaded_by_name = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    class Meta:
        model = InventoryImport
        fields = [
            'id', 'status', 'warehouse', 'file_name', 'summary', 'result', 'uploaded_by_name',
            'created_at', 'confirmed_at', 'expires_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj) -> str:
        return _uploader_name(obj)

    def get_summary(self, obj) -> dict:
        summary = obj.summary if isinstance(obj.summary, dict) else {}
        return {key: summary.get(key) for key in ('counts', 'catalog', 'entries', 'exits', 'stock')}
