"""
Orchestration of the two-step inventory import (SYSPCC-025).

``create_preview``   upload -> validate -> parse -> plan (read-only) -> store a PREVIEWED import
``dry_run``          the same pipeline without storing anything (management command)
``confirm_import``   lock -> re-plan -> compare digest -> apply atomically -> CONFIRMED
``cancel_import``    PREVIEWED -> CANCELLED (the stored workbook is dropped)
``purge_stale_imports``  expire old previews and drop their workbook (beat task)

Privacy: the stored workbook may hold worker names. It is emptied as soon as the import
is confirmed, cancelled or expired, together with the destinations kept in the summary.
Logs carry ids and counters only, never names, destinations, rows or file names.
"""
import hashlib
import hmac
import io
import logging
from datetime import timedelta

from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.models import Personal, Project
from apps.warehouse.models import InventoryImport, InventoryImportStatus
from apps.warehouse.services.imports import applier, parser, planner
from apps.warehouse.services.imports.errors import ImportConflict, ImportFileError, ImportNotConfirmable

logger = logging.getLogger(__name__)

PREVIEW_TTL = timedelta(hours=24)
SUPPORTED_WAREHOUSES = ('CENTRAL',)
MAX_REPORTED_BLOCKERS = 50

_STATUS_LABELS = {
    InventoryImportStatus.CANCELLED: 'cancelada',
    InventoryImportStatus.EXPIRED: 'vencida',
    InventoryImportStatus.FAILED: 'fallida',
    InventoryImportStatus.PROCESSING: 'en proceso',
}


class BytesUpload:
    """Minimal uploaded-file wrapper so the CLI reuses ``parser.inspect_upload``."""

    def __init__(self, name: str, data: bytes, content_type: str = ''):
        self.name = name
        self.content_type = content_type
        self.size = len(data)
        self._buffer = io.BytesIO(data)

    def seek(self, offset):
        self._buffer.seek(offset)

    def read(self, size=-1):
        return self._buffer.read(size)


def ensure_supported_warehouse(warehouse: str) -> None:
    if warehouse not in SUPPORTED_WAREHOUSES:
        raise ImportFileError(
            'warehouse_not_supported', 'Por ahora solo se puede importar al Almacén Central.',
        )


def build_plan_from_bytes(data: bytes, *, warehouse, update_existing, file_sha256):
    """Parse + plan (pure with respect to writes)."""
    parsed = parser.parse_workbook(data)
    return planner.build_plan(
        parsed, warehouse=warehouse, update_existing=update_existing, file_sha256=file_sha256,
    )


def _counter_log(plan) -> dict:
    counts = plan.counts()
    return {
        'blockers': counts['blocker'], 'errors': counts['error'],
        'warnings': counts['warning'], 'infos': counts['info'],
    }


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def dry_run(uploaded_file, *, warehouse='CENTRAL', update_existing=False):
    """Validate + parse + plan an upload without storing anything. Returns ``(plan, sha256)``."""
    ensure_supported_warehouse(warehouse)
    data, _name = parser.inspect_upload(uploaded_file)
    sha = hashlib.sha256(data).hexdigest()
    return build_plan_from_bytes(data, warehouse=warehouse, update_existing=update_existing, file_sha256=sha), sha


def create_preview(*, uploaded_file, user, warehouse='CENTRAL', update_existing=False) -> InventoryImport:
    """Step 1: validate the upload, compute the plan and store a PREVIEWED import."""
    ensure_supported_warehouse(warehouse)
    purge_opportunistically()
    try:
        data, name = parser.inspect_upload(uploaded_file)
        sha = hashlib.sha256(data).hexdigest()
        previous = InventoryImport.objects.filter(
            file_sha256=sha, warehouse=warehouse, status=InventoryImportStatus.CONFIRMED,
        ).values_list('pk', flat=True).first()
        if previous is not None:
            raise ImportConflict(
                'file_already_imported',
                'Este libro ya fue importado. Si agregó filas nuevas, suba la versión actualizada.',
                import_id=str(previous),
            )
        plan = build_plan_from_bytes(
            data, warehouse=warehouse, update_existing=update_existing, file_sha256=sha,
        )
    except ImportConflict:
        raise
    except ImportFileError as exc:
        logger.warning('warehouse.import.rejected', extra={'user_id': user.id, 'reason': exc.code})
        raise

    imp = InventoryImport.objects.create(
        uploaded_by=user,
        warehouse=warehouse,
        file_name=name,
        file_sha256=sha,
        file_bytes=data,
        status=InventoryImportStatus.PREVIEWED,
        options={'update_existing': bool(update_existing)},
        summary=plan.summary(),
        problems=plan.problems_payload(),
        plan_digest=plan.digest(),
        expires_at=timezone.now() + PREVIEW_TTL,
    )
    logger.info(
        'warehouse.import.preview',
        extra={'import_id': str(imp.pk), 'user_id': user.id, 'can_confirm': plan.can_confirm, **_counter_log(plan)},
    )
    return imp


# ---------------------------------------------------------------------------
# Confirm / cancel / expire
# ---------------------------------------------------------------------------

def _scrub(imp: InventoryImport) -> None:
    """Drop the workbook and the destinations (names) kept in the summary."""
    imp.clear_file()
    if isinstance(imp.summary, dict):
        imp.summary.pop('unmatched_destinations', None)


def _expire(imp: InventoryImport) -> None:
    imp.status = InventoryImportStatus.EXPIRED
    _scrub(imp)
    imp.save(update_fields=['status', 'file_bytes', 'summary'])


def _resolve_project_map(plan, project_map: dict) -> dict:
    """Normalized label -> project id (None = leave the items without project)."""
    normalized = {parser.normalize_label(label): value for label, value in (project_map or {}).items()}
    missing = [info['label'] for key, info in plan.project_labels.items() if key not in normalized]
    if missing:
        raise ImportNotConfirmable(
            'project_map_required',
            'Indique el proyecto de destino para: ' + ', '.join(missing)
            + '. Si no existe, pida a un administrador crearlo en Sistema > Proyectos.',
            labels=missing,
        )
    resolved = {key: normalized[key] for key in plan.project_labels}
    ids = {value for value in resolved.values() if value is not None}
    if ids:
        valid = set(Project.objects.filter(pk__in=ids, is_active=True).values_list('pk', flat=True))
        if ids - valid:
            raise ImportNotConfirmable('project_not_found', 'Alguno de los proyectos indicados no existe o está inactivo.')
    return resolved


def _resolve_destination_map(plan, destination_map: dict) -> dict:
    if not destination_map:
        return {}
    known = {d['key'] for d in plan.unmatched_destinations}
    if any(key not in known for key in destination_map):
        raise ImportNotConfirmable(
            'destination_map_invalid', 'Alguno de los destinos indicados no pertenece a este libro.',
        )
    ids = set(destination_map.values())
    if ids - set(Personal.objects.filter(pk__in=ids).values_list('pk', flat=True)):
        raise ImportNotConfirmable('personal_not_found', 'Alguno de los trabajadores indicados no existe.')
    return dict(destination_map)


def confirm_import(
    import_id, user, *, expected_plan_digest, project_map=None, destination_map=None,
    accept_warnings=False, accept_skipped_rows=False,
):
    """
    Step 2. Returns ``(import, replay)``; ``replay`` is True when it was already confirmed
    (the stored result is returned, nothing is applied twice).
    Raises ``InventoryImport.DoesNotExist``, ``ImportConflict`` or ``ImportNotConfirmable``.
    """
    conflict = None
    with transaction.atomic():
        imp = InventoryImport.objects.select_for_update().get(pk=import_id)
        if imp.status == InventoryImportStatus.CONFIRMED:
            return imp, True
        if imp.status != InventoryImportStatus.PREVIEWED:
            label = _STATUS_LABELS.get(imp.status, imp.status.lower())
            conflict = ImportConflict('import_not_confirmable', f'La importación está {label}; suba el libro otra vez.')
        elif imp.is_expired:
            _expire(imp)
            conflict = ImportConflict('import_expired', 'La previsualización venció; suba el libro otra vez.')
        else:
            imp = _confirm_locked(
                imp, user, expected_plan_digest, project_map or {}, destination_map or {},
                accept_warnings, accept_skipped_rows,
            )
            return imp, False
    raise conflict


def _confirm_locked(imp, user, expected_digest, project_map, destination_map, accept_warnings, accept_skipped):
    data = bytes(imp.file_bytes or b'')
    if not data or hashlib.sha256(data).hexdigest() != imp.file_sha256:
        raise ImportConflict('import_file_missing', 'El libro de esta importación ya no está disponible; súbalo otra vez.')

    plan = build_plan_from_bytes(
        data, warehouse=imp.warehouse, update_existing=bool(imp.options.get('update_existing')),
        file_sha256=imp.file_sha256,
    )
    # Compare bytes: ``compare_digest`` raises TypeError on a non-ASCII ``str``.
    if not hmac.compare_digest(plan.digest().encode(), str(expected_digest or '').encode('utf-8', 'replace')):
        raise ImportConflict(
            'plan_changed',
            'Los datos cambiaron desde la previsualización. Vuelva a previsualizar el libro.',
        )
    if not plan.can_confirm:
        raise ImportNotConfirmable(
            'blockers', 'El libro tiene problemas bloqueantes; corríjalos y súbalo otra vez.',
            problems=[p.as_dict() for p in plan.blockers[:MAX_REPORTED_BLOCKERS]],
        )
    requires = plan.requires()
    missing = [
        name for name, given in (('accept_warnings', accept_warnings), ('accept_skipped_rows', accept_skipped))
        if requires[name] and not given
    ]
    if missing:
        raise ImportNotConfirmable(
            'acceptance_required', 'Debe aceptar las advertencias y las filas omitidas para confirmar.',
            required=missing,
        )
    projects = _resolve_project_map(plan, project_map)
    destinations = _resolve_destination_map(plan, destination_map)

    try:
        result = applier.apply_plan(plan, imp, user, project_map=projects, destination_map=destinations)
    except IntegrityError:
        logger.warning('warehouse.import.conflict', extra={'import_id': str(imp.pk), 'user_id': user.id})
        raise ImportConflict(
            'import_conflict', 'Otra importación modificó los mismos datos. Vuelva a previsualizar el libro.',
        ) from None
    except ValueError:
        logger.warning('warehouse.import.stock_changed', extra={'import_id': str(imp.pk), 'user_id': user.id})
        raise ImportConflict(
            'plan_changed', 'El stock cambió mientras se confirmaba. Vuelva a previsualizar el libro.',
        ) from None

    imp.status = InventoryImportStatus.CONFIRMED
    imp.confirmed_at = timezone.now()
    imp.result = {**result, 'confirmed_by': user.id}
    imp.options = {**imp.options, 'project_map': {key: value for key, value in projects.items()}}
    _scrub(imp)
    try:
        imp.save(update_fields=['status', 'confirmed_at', 'result', 'options', 'file_bytes', 'summary'])
    except IntegrityError:
        raise ImportConflict('file_already_imported', 'Este libro ya fue importado.') from None
    logger.info(
        'warehouse.import.confirm',
        extra={
            'import_id': str(imp.pk), 'user_id': user.id,
            'catalog_created': result['catalog']['created'], 'catalog_updated': result['catalog']['updated'],
            'entries': result['movements']['entries'], 'exits': result['movements']['exits'],
            'reconciled': result['reconciled'],
        },
    )
    return imp


def cancel_import(import_id) -> InventoryImport:
    """DELETE: PREVIEWED -> CANCELLED (idempotent); anything else is a conflict."""
    with transaction.atomic():
        imp = InventoryImport.objects.select_for_update().get(pk=import_id)
        if imp.status == InventoryImportStatus.CANCELLED:
            return imp
        if imp.status != InventoryImportStatus.PREVIEWED:
            raise ImportConflict('import_not_cancellable', 'Solo se puede cancelar una importación previsualizada.')
        imp.status = InventoryImportStatus.CANCELLED
        _scrub(imp)
        imp.save(update_fields=['status', 'file_bytes', 'summary'])
    return imp


def purge_opportunistically() -> None:
    """
    Run the purge on the request path (new preview, history, detail) so the workbooks and worker
    names of expired previews do not wait for the daily beat task, which may not be running
    (demo deployments run Celery eagerly, without beat). Best effort: it never fails the request.
    """
    try:
        with transaction.atomic():
            purge_stale_imports()
    except DatabaseError:
        logger.exception('warehouse.import.opportunistic_purge_failed')


def purge_stale_imports(now=None) -> dict:
    """Expire overdue previews and make sure no finished import keeps its workbook."""
    now = now or timezone.now()
    expired = 0
    stale = InventoryImport.objects.filter(
        status=InventoryImportStatus.PREVIEWED, expires_at__lte=now,
    ).defer('problems', 'file_bytes')
    for imp in stale:
        _expire(imp)
        expired += 1

    leftovers = 0
    finished = InventoryImport.objects.filter(
        status__in=[
            InventoryImportStatus.CONFIRMED, InventoryImportStatus.CANCELLED,
            InventoryImportStatus.EXPIRED, InventoryImportStatus.FAILED,
        ],
    ).exclude(Q(file_bytes__isnull=True) | Q(file_bytes=b'')).defer('problems', 'file_bytes')
    for imp in finished:
        _scrub(imp)
        imp.save(update_fields=['file_bytes', 'summary'])
        leftovers += 1
    return {'expired': expired, 'cleared': leftovers}
