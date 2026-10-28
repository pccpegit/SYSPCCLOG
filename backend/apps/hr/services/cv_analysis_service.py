"""Business logic for CV analyses (SYSPCC-023): create/update, batch upload,
progress, retry/cancel/resume, and complete deletion (rows + files).

Views stay thin; every rule lives here. Logs carry ids and counts only.
"""

import logging
from datetime import datetime, time as dtime, timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Max, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers, status

from apps.hr.enums import CVAnalysisStatus, CVItemStatus, CVRecommendation
from apps.hr.exceptions import HRDomainError, invalid_state
from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_agent, cv_posting_service, cv_scoring
from apps.hr.services.cv_dispatch import dispatch
from apps.hr.services.cv_file_validation import CVFileRejected, sanitize_original_name, validate_cv_upload
from apps.hr.services.cv_prompts import PROMPT_VERSION
from apps.hr.storage import get_private_storage

logger = logging.getLogger(__name__)

NAME_MIN, NAME_MAX, REQ_TEXT_MAX = 3, 150, 4000
ESTIMATE_USD = {'min': 0.03, 'max': 0.08}
DISCLAIMER = 'La IA ayuda a ordenar; la decisión final es de RR. HH.'
EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png']


# --------------------------------------------------------------- queries

_MONEY = DecimalField(max_digits=12, decimal_places=4)


def annotate_counts(qs):
    return qs.annotate(
        n_total=Count('items'),
        n_done=Count('items', filter=Q(items__status=CVItemStatus.DONE)),
        n_failed=Count('items', filter=Q(items__status=CVItemStatus.FAILED)),
        n_queued=Count('items', filter=Q(items__status=CVItemStatus.QUEUED)),
        n_processing=Count('items', filter=Q(items__status=CVItemStatus.PROCESSING)),
        n_cancelled=Count('items', filter=Q(items__status=CVItemStatus.CANCELLED)),
        # items + posting extraction (the posting has its own accumulated cost)
        total_cost=ExpressionWrapper(
            Coalesce(Sum('items__cost_usd'), Value(0), output_field=_MONEY) + F('posting_cost_usd'),
            output_field=_MONEY),
    )


def derived_status(total: int, queued: int, processing: int, failed: int) -> str:
    if total == 0:
        return CVAnalysisStatus.EMPTY.value
    if queued + processing:
        return CVAnalysisStatus.PROCESSING.value
    if failed:
        return CVAnalysisStatus.COMPLETED_WITH_ERRORS.value
    return CVAnalysisStatus.COMPLETED.value


def status_filter(value: str) -> Q | None:
    pending = Q(n_queued__gt=0) | Q(n_processing__gt=0)
    return {
        'EMPTY': Q(n_total=0),
        'PROCESSING': pending,
        'COMPLETED_WITH_ERRORS': Q(n_total__gt=0, n_queued=0, n_processing=0, n_failed__gt=0),
        'COMPLETED': Q(n_total__gt=0, n_queued=0, n_processing=0, n_failed=0),
    }.get(value)


def is_enabled() -> bool:
    return cv_agent.is_enabled()


def public_config(user) -> dict:
    return {
        'enabled': is_enabled(),
        'dispatch': settings.HR_CV_DISPATCH,
        'limits': {
            'max_file_mb': settings.HR_CV_MAX_FILE_BYTES // (1024 * 1024) or 1,
            'max_file_bytes': settings.HR_CV_MAX_FILE_BYTES,
            'max_files_per_request': settings.HR_CV_MAX_FILES_PER_REQUEST,
            'batch_size': min(settings.HR_CV_BATCH_SIZE, settings.HR_CV_MAX_FILES_PER_REQUEST),
            'max_items_per_analysis': settings.HR_CV_MAX_ITEMS_PER_ANALYSIS,
            'daily_remaining': daily_remaining(user),
            'extensions': EXTENSIONS,
        },
        'estimate_usd': ESTIMATE_USD,
        'disclaimer': DISCLAIMER,
        'provider': cv_agent.provider_name(),
        'simulated': cv_agent.provider_name() == 'fake',
        'posting': cv_posting_service.public_config(),
    }


# --------------------------------------------------- analysis create/update

def validate_requirements_text(text: str) -> list[dict]:
    if len(text) > REQ_TEXT_MAX:
        raise serializers.ValidationError({'requirements_text': [f'Máximo {REQ_TEXT_MAX} caracteres.']})
    requirements = cv_scoring.parse_requirements(text)
    if len(requirements) > settings.HR_CV_MAX_REQUIREMENTS:
        raise serializers.ValidationError(
            {'requirements_text': [f'Máximo {settings.HR_CV_MAX_REQUIREMENTS} requisitos (uno por línea).']})
    return requirements


def create_analysis(*, user, name: str, requirements_text: str = '') -> CVAnalysis:
    requirements = validate_requirements_text(requirements_text or '')
    analysis = CVAnalysis.objects.create(
        name=name, requirements_text=(requirements_text or '').strip(), requirements=requirements,
        model_name=cv_agent.model_label(), prompt_version=PROMPT_VERSION, created_by=user,
    )
    logger.info('hr.cv analysis_created analysis_id=%s user_id=%s requirements=%d',
                analysis.pk, user.pk, len(requirements))
    return analysis


def update_analysis(analysis: CVAnalysis, *, name=None, requirements_text=None) -> CVAnalysis:
    if requirements_text is not None and requirements_text.strip() != analysis.requirements_text.strip():
        requirements = validate_requirements_text(requirements_text)
        with transaction.atomic():
            locked = CVAnalysis.objects.select_for_update().get(pk=analysis.pk)
            # DONE: already scored with the current requirements. QUEUED/PROCESSING: the worker reads
            # `requirements` when it runs, so a change would mix criteria inside one ranking.
            reason = cv_posting_service.lock_reason(locked)
            if reason:
                raise cv_posting_service.locked_error(reason, subject='requirements')
            analysis.requirements = requirements
            analysis.requirements_text = requirements_text.strip()
            fields = ['requirements', 'requirements_text', 'updated_at']
            if name is not None:
                analysis.name = name
                fields.append('name')
            # Only the touched columns: a full save() would overwrite posting_* written in parallel.
            analysis.save(update_fields=fields)
        return analysis
    if name is not None:
        analysis.name = name
        analysis.save(update_fields=['name', 'updated_at'])
    return analysis


# ------------------------------------------------------------- upload

def lima_day_start():
    today = timezone.localdate()
    return timezone.make_aware(datetime.combine(today, dtime.min))


def daily_remaining(user) -> int:
    used = CVAnalysisItem.objects.filter(uploaded_by=user, created_at__gte=lima_day_start()).count()
    return max(settings.HR_CV_DAILY_LIMIT_PER_USER - used, 0)


def _delete_names(names):
    storage = get_private_storage()
    for name in names:
        if not name:
            continue
        try:
            storage.delete(name)
        except OSError as exc:
            logger.warning('hr.cv file_delete_failed error_type=%s', type(exc).__name__)


def upload_files(*, analysis: CVAnalysis, user, files: list) -> dict:
    if not is_enabled():
        raise HRDomainError(
            'analysis_unavailable',
            'Para analizar CVs falta configurar la clave del servicio de IA. Pídela al administrador.',
            status.HTTP_503_SERVICE_UNAVAILABLE)
    if not files:
        raise HRDomainError('no_files', 'Selecciona al menos un archivo.')
    if len(files) > settings.HR_CV_MAX_FILES_PER_REQUEST:
        raise HRDomainError(
            'too_many_files', f'Sube como máximo {settings.HR_CV_MAX_FILES_PER_REQUEST} archivos por envío.')

    existing = analysis.items.count()
    room = settings.HR_CV_MAX_ITEMS_PER_ANALYSIS - existing
    if room < len(files):
        raise HRDomainError(
            'analysis_limit_reached',
            f'Un análisis admite hasta {settings.HR_CV_MAX_ITEMS_PER_ANALYSIS} CVs '
            f'(te quedan {max(room, 0)}). Crea otro análisis.', status.HTTP_409_CONFLICT)
    remaining = daily_remaining(user)
    if remaining < len(files):
        raise HRDomainError(
            'daily_limit_reached',
            f'Alcanzaste el límite diario de {settings.HR_CV_DAILY_LIMIT_PER_USER} CVs (te quedan {remaining}). '
            'Continúa mañana.', status.HTTP_429_TOO_MANY_REQUESTS)

    accepted, duplicates, rejected = [], [], []
    seen: dict[str, int] = {}
    known = dict(analysis.items.values_list('sha256', 'id'))
    position = (analysis.items.aggregate(m=Max('position'))['m'] or 0)
    now = timezone.now()
    for upload in files:
        label = sanitize_original_name(getattr(upload, 'name', ''))
        try:
            valid = validate_cv_upload(upload)
        except CVFileRejected as exc:
            rejected.append({'original_name': label, 'code': exc.code, 'detail': exc.detail})
            continue
        dup_of = seen.get(valid.sha256) or known.get(valid.sha256)
        if dup_of:
            duplicates.append({'original_name': label, 'duplicate_of': dup_of})
            continue
        item = CVAnalysisItem(
            analysis=analysis, uploaded_by=user, position=position + 1, original_name=label,
            size_bytes=valid.size, sha256=valid.sha256, detected_mime=valid.mime, kind=valid.kind,
            page_count=valid.page_count, status=CVItemStatus.QUEUED, enqueued_at=now,
            model_name=cv_agent.model_label(), prompt_version=PROMPT_VERSION,
        )
        item.file.save(f'cv{valid.ext}', ContentFile(valid.data), save=False)
        try:
            with transaction.atomic():
                item.save()
        except IntegrityError:  # race: same sha256 inserted concurrently
            _delete_names([item.file.name])
            other = analysis.items.filter(sha256=valid.sha256).values_list('id', flat=True).first()
            duplicates.append({'original_name': label, 'duplicate_of': other})
            continue
        except Exception:
            _delete_names([item.file.name])
            raise
        position += 1
        seen[valid.sha256] = item.pk
        accepted.append({'id': item.pk, 'original_name': label})
        del valid

    ids = [a['id'] for a in accepted]
    if ids:
        transaction.on_commit(lambda: dispatch(ids))
    logger.info('hr.cv upload analysis_id=%s user_id=%s accepted=%d duplicates=%d rejected=%d',
                analysis.pk, user.pk, len(accepted), len(duplicates), len(rejected))
    return {
        'accepted': accepted, 'duplicates': duplicates, 'rejected': rejected,
        'counts': {'accepted': len(accepted), 'duplicates': len(duplicates), 'rejected': len(rejected)},
    }


# ----------------------------------------------------- progress / recovery

def stale_cutoff():
    return timezone.now() - timedelta(seconds=settings.HR_CV_STALE_SECONDS)


def stale_items(qs):
    cutoff = stale_cutoff()
    return qs.filter(
        Q(status=CVItemStatus.QUEUED, enqueued_at__lt=cutoff)
        | Q(status=CVItemStatus.PROCESSING, locked_at__lt=cutoff)
    )


def is_stalled(analysis) -> bool:
    return stale_items(analysis.items).exists()


def progress(analysis, since=None) -> dict:
    # Taken BEFORE the queries: a row updated while we read stays after the next ?since=.
    server_time = timezone.now()
    counts = analysis.items.aggregate(
        total=Count('id'),
        queued=Count('id', filter=Q(status=CVItemStatus.QUEUED)),
        processing=Count('id', filter=Q(status=CVItemStatus.PROCESSING)),
        done=Count('id', filter=Q(status=CVItemStatus.DONE)),
        failed=Count('id', filter=Q(status=CVItemStatus.FAILED)),
        cancelled=Count('id', filter=Q(status=CVItemStatus.CANCELLED)),
        cost=Coalesce(Sum('cost_usd'), Value(0), output_field=_MONEY),
        rec_advance=Count('id', filter=Q(status=CVItemStatus.DONE, recommendation=CVRecommendation.ADVANCE)),
        rec_review=Count('id', filter=Q(status=CVItemStatus.DONE, recommendation=CVRecommendation.REVIEW)),
        rec_no_advance=Count('id', filter=Q(status=CVItemStatus.DONE, recommendation=CVRecommendation.NO_ADVANCE)),
        flagged_injection=Count('id', filter=Q(status=CVItemStatus.DONE, injection_suspected=True)),
    )
    cost = counts.pop('cost') + analysis.posting_cost_usd
    recommendations = {
        'advance': counts.pop('rec_advance'), 'review': counts.pop('rec_review'),
        'no_advance': counts.pop('rec_no_advance'),
    }
    flagged = {'injection': counts.pop('flagged_injection')}
    finished = counts['done'] + counts['failed'] + counts['cancelled']
    items = analysis.items.all()
    if since is not None:
        items = items.filter(updated_at__gt=since)
    rows = items.order_by('updated_at', 'id').values(
        'id', 'status', 'error_code', 'error_message', 'candidate_name', 'score', 'recommendation', 'updated_at')
    return {
        'server_time': server_time,
        'status': derived_status(counts['total'], counts['queued'], counts['processing'], counts['failed']),
        'counts': counts,
        'percent': int(round(100 * finished / counts['total'])) if counts['total'] else 0,
        'cost_usd': cost,
        'recommendations': recommendations,
        'flagged': flagged,
        'stalled': is_stalled(analysis),
        'items': list(rows),
    }


def requeue_stale(analysis: CVAnalysis | None = None, limit: int = 500) -> int:
    """Re-enqueue stuck items (idempotent: the claim protects against doubles)."""
    base = CVAnalysisItem.objects.all() if analysis is None else analysis.items.all()
    cutoff = stale_cutoff()
    now = timezone.now()
    stuck = list(base.filter(status=CVItemStatus.PROCESSING, locked_at__lt=cutoff).values_list('pk', flat=True)[:limit])
    CVAnalysisItem.objects.filter(pk__in=stuck, status=CVItemStatus.PROCESSING, locked_at__lt=cutoff).update(
        status=CVItemStatus.QUEUED, locked_at=None, enqueued_at=now, updated_at=now)
    waiting = list(base.filter(status=CVItemStatus.QUEUED, enqueued_at__lt=cutoff).values_list('pk', flat=True)[:limit])
    ids = list(dict.fromkeys(stuck + waiting))
    if ids:
        CVAnalysisItem.objects.filter(pk__in=ids, status=CVItemStatus.QUEUED).update(enqueued_at=now, updated_at=now)
        transaction.on_commit(lambda: dispatch(ids))
    return len(ids)


def _requeue_qs(qs) -> list[int]:
    now = timezone.now()
    ids = list(qs.values_list('pk', flat=True))
    if ids:
        CVAnalysisItem.objects.filter(pk__in=ids, status__in=[CVItemStatus.FAILED, CVItemStatus.CANCELLED]).update(
            status=CVItemStatus.QUEUED, attempts=0, error_code='', error_message='', enqueued_at=now,
            locked_at=None, finished_at=None, updated_at=now)
        transaction.on_commit(lambda: dispatch(ids))
    return ids


def _require_ai():
    if not is_enabled():
        raise HRDomainError(
            'analysis_unavailable',
            'Para analizar CVs falta configurar la clave del servicio de IA. Pídela al administrador.',
            status.HTTP_503_SERVICE_UNAVAILABLE)


def retry_item(item: CVAnalysisItem) -> None:
    _require_ai()
    if item.status not in (CVItemStatus.FAILED, CVItemStatus.CANCELLED):
        raise invalid_state('Solo se pueden reintentar los CVs con error o cancelados.')
    _requeue_qs(CVAnalysisItem.objects.filter(
        pk=item.pk, status__in=[CVItemStatus.FAILED, CVItemStatus.CANCELLED]))


def retry_failed(analysis: CVAnalysis) -> int:
    _require_ai()
    return len(_requeue_qs(analysis.items.filter(status=CVItemStatus.FAILED)))


def cancel_pending(analysis: CVAnalysis) -> int:
    return analysis.items.filter(status=CVItemStatus.QUEUED).update(
        status=CVItemStatus.CANCELLED, finished_at=timezone.now(), updated_at=timezone.now())


def resume(analysis: CVAnalysis) -> int:
    _require_ai()
    return requeue_stale(analysis)


# ---------------------------------------------------------------- deletion

def _item_file_names(qs) -> list[str]:
    names = []
    for f, r in qs.values_list('file', 'report_pdf'):
        names.extend(n for n in (f, r) if n)
    return names


def delete_item(item: CVAnalysisItem) -> None:
    names = _item_file_names(CVAnalysisItem.objects.filter(pk=item.pk))
    with transaction.atomic():
        item.delete()
        transaction.on_commit(lambda: _delete_names(names))


def delete_analysis(analysis: CVAnalysis) -> int:
    names = _item_file_names(analysis.items.all())
    if analysis.posting_file:
        names.append(analysis.posting_file.name)
    with transaction.atomic():
        count = analysis.items.count()
        analysis.delete()
        transaction.on_commit(lambda: _delete_names(names))
    logger.info('hr.cv analysis_deleted items=%d files=%d', count, len(names))
    return count


def purge_expired(days: int) -> int:
    """Optional retention (HR_CV_RETENTION_DAYS > 0): delete analyses older than N days."""
    if days <= 0:
        return 0
    cutoff = timezone.now() - timedelta(days=days)
    total = 0
    for analysis in CVAnalysis.objects.filter(created_at__lt=cutoff):
        delete_analysis(analysis)
        total += 1
    return total


# --------------------------------------------------------------- ranking

def rank_map(analysis) -> dict[int, int]:
    """item id -> competition rank by score (ties share the rank)."""
    rows = list(analysis.items.filter(status=CVItemStatus.DONE, score__isnull=False)
                .order_by('-score').values_list('id', 'score'))
    ranks, prev, rank = {}, None, 0
    for pos, (pk, score) in enumerate(rows, start=1):
        if score != prev:
            rank, prev = pos, score
        ranks[pk] = rank
    return ranks
