"""Pipeline for ONE CV (SYSPCC-023): claim -> read file -> agent -> score -> persist.

Guarantees:
- Idempotent claim: `UPDATE ... WHERE status=QUEUED` (0 rows -> return). A
  duplicated task or a retry after a crash never calls the model twice.
- Persist under `select_for_update`, only if the item still exists and is
  still PROCESSING (cancelled / deleted mid-flight -> nothing is written).
- Never logs file names, CV text or extracted data (PII): only ids, sizes,
  tokens, latency and an outcome code.
"""

import base64
import logging
import random
import time
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.hr.enums import CVFileKind, CVItemStatus
from apps.hr.models import CVAnalysisItem
from apps.hr.services import cv_scoring
from apps.hr.services.cv_agent import AgentPermanent, AgentTransient, CVAgent
from apps.hr.services.cv_dispatch import RetryLater
from apps.hr.services.cv_prompts import PROMPT_VERSION, user_text
from apps.hr.services.cv_text import MAX_DOCX_CHARS, MAX_IMAGE_SIDE  # noqa: F401 - re-exported
from apps.hr.services.cv_text import docx_text as _docx_text  # noqa: F401 - alias kept for callers/tests
from apps.hr.services.cv_text import image_b64 as _image_b64

logger = logging.getLogger(__name__)

MIN_DOCX_CHARS = 50

ERROR_MESSAGES = {
    'cv_unreadable': 'No se pudo leer el contenido del archivo.',
    'file_missing': 'No se encontró el archivo en el servidor. Vuelve a subirlo.',
    'ai_unavailable': 'La IA no está disponible por un problema de configuración. Avisa al administrador.',
    'ai_rate_limited': 'La IA está saturada. Reintenta en unos minutos.',
    'ai_failed': 'No se pudo analizar el CV por un problema temporal. Reintenta.',
    'ai_refusal': 'La IA no pudo procesar este CV. Revísalo manualmente.',
    'ai_unparseable': 'No se pudo interpretar la respuesta de la IA para este CV. Reintenta.',
    'cv_rejected_by_ai': 'La IA rechazó el archivo (formato o tamaño no procesable).',
    'internal_error': 'Ocurrió un error interno al analizar este CV. Reintenta.',
}
DOCX_UNREADABLE = 'El Word parece no tener texto (¿es una imagen?). Guárdalo como PDF.'


class _Unreadable(Exception):
    def __init__(self, code='cv_unreadable', message=None):
        super().__init__(code)
        self.code, self.message = code, message


# ------------------------------------------------------------------ helpers

def _touch(pk: int, **fields) -> int:
    return CVAnalysisItem.objects.filter(pk=pk).update(updated_at=timezone.now(), **fields)


def _claim(item_id: int) -> bool:
    now = timezone.now()
    return bool(CVAnalysisItem.objects.filter(pk=item_id, status=CVItemStatus.QUEUED).update(
        status=CVItemStatus.PROCESSING, locked_at=now,
        started_at=Coalesce('started_at', Value(now)), attempts=F('attempts') + 1, updated_at=now,
    ))


def _cost(tokens_in: int, tokens_out: int) -> Decimal:
    price_in, price_out = Decimal(str(settings.HR_CV_PRICE_IN_PER_MTOK)), Decimal(str(settings.HR_CV_PRICE_OUT_PER_MTOK))
    return ((Decimal(tokens_in) * price_in + Decimal(tokens_out) * price_out) / Decimal(1_000_000)).quantize(
        Decimal('0.0001'))


cost_for_tokens = _cost  # public alias (used by the job-posting service)


def _add_usage(item_id: int, usage: tuple[int, int]):
    if not any(usage):
        return
    CVAnalysisItem.objects.filter(pk=item_id).update(
        tokens_in=F('tokens_in') + usage[0], tokens_out=F('tokens_out') + usage[1],
        cost_usd=F('cost_usd') + _cost(*usage),
    )


def _fail(item_id: int, code: str, message: str | None = None) -> bool:
    return bool(CVAnalysisItem.objects.filter(pk=item_id, status=CVItemStatus.PROCESSING).update(
        status=CVItemStatus.FAILED, error_code=code, error_message=(message or ERROR_MESSAGES.get(code, ''))[:200],
        finished_at=timezone.now(), locked_at=None, updated_at=timezone.now(),
    ))


def _requeue(item_id: int) -> bool:
    now = timezone.now()
    return bool(CVAnalysisItem.objects.filter(pk=item_id, status=CVItemStatus.PROCESSING).update(
        status=CVItemStatus.QUEUED, locked_at=None, enqueued_at=now, updated_at=now,
    ))


def _backoff(attempts: int, retry_after: float | None) -> float:
    delay = min(20 * (2 ** max(attempts - 1, 0)) + random.uniform(0, 5), 600)
    return max(delay, retry_after or 0)


def _log(item, outcome, started, tokens=(0, 0)):
    logger.info(
        'hr.cv item_id=%s analysis_id=%s kind=%s size=%s tokens_in=%s tokens_out=%s latency_ms=%d outcome=%s',
        item.pk, item.analysis_id, item.kind, item.size_bytes, tokens[0], tokens[1],
        int((time.monotonic() - started) * 1000), outcome,
    )


# ----------------------------------------------------------- content blocks

def build_content(item: CVAnalysisItem, requirements: list[dict]) -> list[dict]:
    try:
        with item.file.open('rb') as fh:
            data = fh.read()
    except (FileNotFoundError, OSError, ValueError):
        raise _Unreadable('file_missing')
    if item.kind == CVFileKind.PDF:
        b64 = base64.standard_b64encode(data).decode('ascii')
        return [
            {'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': b64}},
            {'type': 'text', 'text': user_text(requirements)},
        ]
    if item.kind == CVFileKind.IMAGE:
        try:
            b64 = _image_b64(data)
        except Exception:  # noqa: BLE001 - hostile image
            raise _Unreadable()
        return [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': b64}},
            {'type': 'text', 'text': user_text(requirements)},
        ]
    try:
        text = _docx_text(data)
    except Exception:  # noqa: BLE001
        raise _Unreadable()
    if len(text.strip()) < MIN_DOCX_CHARS:
        raise _Unreadable('cv_unreadable', DOCX_UNREADABLE)
    return [{'type': 'text', 'text': user_text(requirements, cv_text=text)}]


# ------------------------------------------------------------------ main

def run_item(item_id: int, client=None) -> None:
    """Process one CV. Raises RetryLater for transient errors (the dispatcher
    schedules the delayed retry)."""
    if not _claim(item_id):
        return  # already processed / cancelled / deleted / running elsewhere
    started = time.monotonic()
    item = CVAnalysisItem.objects.select_related('analysis').filter(pk=item_id).first()
    if item is None:
        return
    outcome, usage = 'internal_error', (0, 0)
    try:
        requirements = item.analysis.requirements or []
        try:
            content = build_content(item, requirements)
        except _Unreadable as exc:
            outcome = exc.code
            _fail(item_id, exc.code, exc.message)
            return
        result = CVAgent(client).analyze(
            content, bool(requirements), seed=item.sha256, requirements=requirements)
        usage = (result.tokens_in, result.tokens_out)
        _persist(item, result.report, requirements, usage, model=result.model or settings.HR_CV_MODEL,
                 simulated=result.simulated)
        outcome = 'ok'
    except AgentTransient as exc:
        usage = exc.usage
        _add_usage(item_id, usage)
        limit = exc.max_attempts or settings.HR_CV_MAX_ATTEMPTS
        item.refresh_from_db(fields=['attempts', 'status'])
        if item.attempts >= limit:
            outcome = exc.code
            _fail(item_id, exc.code)
            return
        outcome = f'retry:{exc.code}'
        if _requeue(item_id):
            raise RetryLater(_backoff(item.attempts, exc.retry_after))
    except AgentPermanent as exc:
        usage = exc.usage
        _add_usage(item_id, usage)
        outcome = exc.code
        if exc.code == 'ai_unavailable':
            logger.error('hr.cv ai_unavailable item_id=%s (revisar ANTHROPIC_API_KEY)', item_id)
        _fail(item_id, exc.code)
    except RetryLater:
        raise
    except Exception as exc:  # noqa: BLE001 - last barrier. Type only: messages can echo PII
        from celery.exceptions import SoftTimeLimitExceeded

        if isinstance(exc, SoftTimeLimitExceeded):
            outcome = 'soft_timeout'
            item.refresh_from_db(fields=['attempts'])
            if item.attempts < settings.HR_CV_MAX_ATTEMPTS and _requeue(item_id):
                raise RetryLater(_backoff(item.attempts, None))
            _fail(item_id, 'ai_failed')
        else:
            outcome = f'internal_error:{type(exc).__name__}'
            _fail(item_id, 'internal_error')
    finally:
        _log(item, outcome, started, usage)


def _persist(item, report, requirements: list[dict], usage: tuple[int, int], *, model: str | None = None,
             simulated: bool = False) -> None:
    model = model or settings.HR_CV_MODEL
    dump = report.model_dump(mode='json')
    computed = cv_scoring.compute(dump, requirements, timezone.localdate())
    candidate = dump.get('candidate') or {}
    years = computed['experience_years']
    with transaction.atomic():
        locked = CVAnalysisItem.objects.select_for_update().filter(pk=item.pk).first()
        if locked is None or locked.status != CVItemStatus.PROCESSING:
            return  # deleted or cancelled mid-flight: write nothing
        meta = {'model': model, 'prompt_version': PROMPT_VERSION}
        if simulated:
            meta['simulated'] = True
        locked.result = {'report': dump, 'computed': computed, 'meta': meta}
        locked.candidate_name = (candidate.get('full_name') or '')[:150]
        locked.headline = (dump.get('headline') or '')[:150]
        locked.experience_years = Decimal(str(years)) if years is not None else None
        locked.score = computed['score']
        locked.recommendation = computed['recommendation'] or ''
        locked.injection_suspected = bool(dump.get('injection_suspected'))
        locked.model_name = model[:60]
        locked.prompt_version = PROMPT_VERSION
        locked.tokens_in = F('tokens_in') + usage[0]
        locked.tokens_out = F('tokens_out') + usage[1]
        locked.cost_usd = F('cost_usd') + _cost(*usage)
        locked.status = CVItemStatus.DONE
        locked.error_code, locked.error_message = '', ''
        locked.finished_at, locked.locked_at = timezone.now(), None
        locked.save()
    store_report(item.pk)


def store_report(item_id: int) -> bool:
    """Best-effort: render the report PDF and attach it. If it fails the item
    stays DONE and the PDF is generated on demand at download time."""
    from apps.hr.services import cv_report_pdf

    try:
        item = CVAnalysisItem.objects.select_related('analysis').get(pk=item_id)
        if item.status != CVItemStatus.DONE or not item.result:
            return False
        pdf = cv_report_pdf.build(item)
        name = f'{item_id}.pdf'
        stored = item.report_pdf.storage.save(
            item.report_pdf.field.generate_filename(item, name), ContentFile(pdf))
    except Exception as exc:  # noqa: BLE001
        logger.warning('hr.cv report_failed item_id=%s error_type=%s', item_id, type(exc).__name__)
        return False
    updated = CVAnalysisItem.objects.filter(pk=item_id, status=CVItemStatus.DONE).update(
        report_pdf=stored, report_generated_at=timezone.now())
    if not updated:  # deleted meanwhile: do not leave an orphan
        try:
            item.report_pdf.storage.delete(stored)
        except OSError:
            pass
        return False
    return True
