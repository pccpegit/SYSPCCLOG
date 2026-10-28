"""Job posting ("convocatoria") of a CV analysis (SYSPCC-023, iteration 2).

The posting file lives in the analysis (1 analysis = 1 posting). Extraction only
PROPOSES requirements: nothing here writes `requirements`; the user confirms
them through the existing `PATCH {requirements_text}`. The CV evaluator never
sees the posting document.

Decision order of `extract` (see the handoff, ITERACION 2 / FASE 0):
  text (pasted or extracted) -> fake provider -> AI -> heuristic fallback.
Logs carry ids and counts only: never file names, text or requirements.
"""

import base64
import logging
import re
import time
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status

from apps.hr.enums import CVFileKind, CVItemStatus
from apps.hr.exceptions import HRDomainError
from apps.hr.models import CVAnalysis
from apps.hr.services import cv_agent, cv_fake, cv_posting_heuristics as heuristics, cv_scoring, cv_text
from apps.hr.services.cv_agent import AgentError, CVAgent
from apps.hr.services.cv_file_validation import CVFileRejected, sanitize_original_name, validate_cv_upload
from apps.hr.services.cv_posting_heuristics import RawPosting
from apps.hr.services.cv_prompts import posting_user_text
from apps.hr.services.cv_service import cost_for_tokens
from apps.hr.storage import get_private_storage

logger = logging.getLogger(__name__)

MIN_TEXT_CHARS = 40      # below this a heuristic reading is not worth trusting
AI_TEXT_MIN_CHARS = 200  # from here the posting goes to the AI as TEXT (cheaper than a document block)
MAX_REQUIREMENT_CHARS = 200
EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png']
POSTING_ESTIMATE_USD = {'min': 0.01, 'max': 0.03}

WARNINGS = {
    'ai_fallback': 'La IA no respondió; mostramos una lectura básica del texto. Revísala con calma.',
    'no_requirements_found': 'No encontramos requisitos claros. Escríbelos o pégalos abajo.',
    'truncated_requirements': 'Había más de {n} requisitos; mostramos los {n} principales.',
    'truncated_text': 'La convocatoria es muy larga; leímos solo el inicio.',
    'protected_attribute_omitted': (
        'Omitimos condiciones sobre edad, sexo, estado civil u otros datos personales: no se usan para evaluar.'),
    'simulated': 'Modo de prueba: requisitos simulados.',
    'instruction_like_omitted': (
        'Omitimos requisitos que parecían instrucciones para una IA, no condiciones del candidato. Revisa la lista.'),
    # Non-blocking notices about requirements typed by hand (PATCH).
    'protected_requirement_detected': (
        'Alguna línea parece pedir edad, sexo, estado civil, hijos u otros datos personales. '
        'Esas condiciones no deberían usarse para evaluar: recomendamos quitarlas.'),
    'instruction_like_detected': (
        'Alguna línea parece una instrucción para una IA y no un requisito del candidato. Revísala o quítala.'),
}

# Conservative filter of conditions that must never drive an evaluation (Ley 30709 and
# Ley 26772: no discrimination in job offers). It works on accent-folded text.
# "años de experiencia" must NOT match.
_NOT_WORK = r'(?!\s+(?:de\s+)?(?:experiencia|servicio|trayectoria|antiguedad|en\s+(?:el\s+)?(?:rubro|sector|obras?|cargos?|puestos?)))'
PROTECTED_RE = re.compile(
    r'\b(?:sexo|genero|masculino|femenino|varon|varones|estado civil|soltero|soltera|casado|casada|nacionalidad|'
    r'religion|foto|buena presencia|presencia agradable|apariencia|embarazo|gestante|edad|'
    r'mujer|mujeres|damas|caballeros|hijos?|hijas?|discapacidad|discapacitad[oa]s?|minusvali\w*|'
    r'joven|jovenes|juvenil(?:es)?|recien\s+(?:egresad|graduad|titulad)[oa]s?|'
    r'nacid[oa]s?\s+en|nacimiento|extranjer[oa]s?|raza|etnia|orientacion sexual)\b'
    # "hombre(s)" is also a unit in construction ("horas hombre", "hombre-hora"); other uses are protected.
    r'|(?<!hora\s)(?<!horas\s)(?<!hora-)(?<!horas-)\bhombres?\b(?![\s-]*horas?\b)'
    # Age caps: "hasta 35 años", "máximo 40 años", "35 años como máximo".
    r'|\b(?:hasta|maximo|max|tope|limite|menor(?:es)?|mayor(?:es)?|no\s+mayor)\s+(?:de\s+|a\s+)?\d{2}\s+anos\b' + _NOT_WORK +
    r'|\b\d{2}\s+anos\s+(?:como\s+)?(?:maximo|de\s+edad)\b'
)
# "peruano/a" is protected unless it qualifies a norm or a market ("normativa peruana").
PERUVIAN_RE = re.compile(r'\bperuan[oa]s?\b')
NORM_CONTEXT_RE = re.compile(
    r'normativ|legislacion|\bley(?:es)?\b|\bnormas?\b|reglament|codigo|mercado|contratacion|tributari|derecho')
# "25 a 35 años" is an age range unless the text talks about experience/work.
AGE_RANGE_RE = re.compile(r'\b\d{2}\s*(?:a|-|y)\s*\d{2}\s*anos\b')
WORK_CONTEXT_RE = re.compile(r'experiencia|laboral|trayectoria|obras?\b|servicio|antiguedad|proyectos?\b')
# Text addressed to an AI, not a requirement of a candidate. Indirect prompt injection:
# a poisoned requirement would be copied into the prompt of EVERY CV. Folded text.
# Deliberately narrow: "sistema", "asistente", "instrucciones" or "calificado" alone are
# ordinary words in construction postings ("sistema de gestión", "instrucciones de trabajo").
INSTRUCTION_RE = re.compile(
    r'\bignor(?:a|e)\w*'
    r'|\b(?:olvida|omite|desobedece|desestima)\w*\s+(?:\w+\s+){0,3}(?:instruccion|requisito|regla|anterior|demas|todo)'
    r'|\bno\s+(?:sigas|obedezcas|evalues)\b'
    r'|\b(?:nuevas?|anteriores|previas)\s+instrucciones\b|\binstrucciones\s+(?:anteriores|previas|nuevas)\b'
    r'|\beres\s+(?:un|una)\b|\bactua\s+como\b|\bcomo\s+(?:una?\s+)?ia\b|\bpretend\w*\s+(?:que|ser)\b'
    r'|\bsystem\s+prompt\b|\bprompt\b|\b(?:mensaje|prompt)\s+del\s+sistema\b|\basistente\s+(?:de\s+)?ia\b'
    r'|\bnot_met\b|\bmet\b'
    r'|\b(?:califica|calificalo|calificame|puntua|puntuame|marca|marcalo|marcalos|otorga|asigna|evalua)\b[^.]{0,60}'
    r'\b(?:met|cumpl\w*|100|maximo|perfect\w*|todos|todas|aprobad\w*|excelente|mejor)\b'
)
TRAILING_MANDATORY = re.compile(r'\s*\(\s*(?:obligatorio|indispensable)\s*\)\s*$', re.IGNORECASE)
LEADING_MARKS = re.compile(r'^[\s\-*•·▪●–—]+')
TRAILING_MARKS = re.compile(r'[\s;,.]+$')


def _warn(code: str, **fmt) -> dict:
    return {'code': code, 'detail': WARNINGS[code].format(**fmt)}


IN_FLIGHT = (CVItemStatus.QUEUED, CVItemStatus.PROCESSING)


def lock_reason(analysis: CVAnalysis) -> str | None:
    """Why the requirements/posting cannot change: 'done' (CVs already analyzed with them),
    'in_flight' (CVs still queued/being read: they would be scored with a mix of requirements)
    or None."""
    found = set(analysis.items.filter(status__in=[CVItemStatus.DONE, *IN_FLIGHT]).values_list('status', flat=True).distinct())
    if CVItemStatus.DONE in found:
        return 'done'
    return 'in_flight' if found else None


def locked_error(reason: str, *, subject: str = 'posting') -> HRDomainError:
    if reason == 'in_flight':
        what = 'la convocatoria' if subject == 'posting' else 'los requisitos'
        detail = f'Espera a que terminen los CVs en curso para cambiar {what}.'
    elif subject == 'posting':
        detail = 'Ya hay CVs analizados con estos requisitos; la convocatoria ya no se puede cambiar.'
    else:
        detail = 'No se pueden cambiar los requisitos: ya hay CVs analizados con los requisitos actuales.'
    return HRDomainError('requirements_locked', detail, status.HTTP_409_CONFLICT)


def _ensure_unlocked(analysis: CVAnalysis) -> None:
    reason = lock_reason(analysis)
    if reason:
        raise locked_error(reason)


def _delete_names(names) -> None:
    storage = get_private_storage()
    for name in names:
        if not name:
            continue
        try:
            storage.delete(name)
        except OSError as exc:
            logger.warning('hr.cv file_delete_failed error_type=%s', type(exc).__name__)


# --------------------------------------------------------- config / detail

def extraction_mode() -> str:
    if cv_agent.provider_name() == 'fake':
        return 'fake'
    return 'ai' if cv_agent.has_api_key() else 'text'


def public_config() -> dict:
    return {
        'max_file_mb': settings.HR_CV_POSTING_MAX_FILE_BYTES // (1024 * 1024) or 1,
        'max_file_bytes': settings.HR_CV_POSTING_MAX_FILE_BYTES,
        'extensions': EXTENSIONS,
        'max_text_chars': settings.HR_CV_POSTING_MAX_TEXT_CHARS,
        'max_requirements': settings.HR_CV_MAX_REQUIREMENTS,
        'extraction': extraction_mode(),
        'estimate_usd': POSTING_ESTIMATE_USD,
    }


# ------------------------------------------------------------ file storage

def attach_posting(analysis: CVAnalysis, uploaded_file) -> CVAnalysis:
    """Store (or REPLACE) the posting file. The old file is deleted on commit."""
    if uploaded_file is None:
        raise HRDomainError('no_file', 'Selecciona el archivo de la convocatoria.')
    _ensure_unlocked(analysis)
    label = sanitize_original_name(getattr(uploaded_file, 'name', ''))
    try:
        valid = validate_cv_upload(
            uploaded_file, max_bytes=settings.HR_CV_POSTING_MAX_FILE_BYTES,
            max_pages=settings.HR_CV_POSTING_MAX_PAGES, max_pixels=settings.HR_CV_POSTING_MAX_IMAGE_PIXELS)
    except CVFileRejected as exc:
        raise HRDomainError(exc.code, exc.detail, status.HTTP_400_BAD_REQUEST)

    field = CVAnalysis._meta.get_field('posting_file')
    new_name = field.storage.save(field.generate_filename(analysis, f'posting{valid.ext}'), ContentFile(valid.data))
    try:
        with transaction.atomic():
            locked = CVAnalysis.objects.select_for_update().get(pk=analysis.pk)
            reason = lock_reason(locked)
            if reason:
                raise locked_error(reason)
            old_name = locked.posting_file.name if locked.posting_file else ''
            CVAnalysis.objects.filter(pk=analysis.pk).update(
                posting_file=new_name, posting_original_name=label, posting_kind=valid.kind,
                posting_size_bytes=valid.size, posting_sha256=valid.sha256, posting_uploaded_at=timezone.now(),
                updated_at=timezone.now())
            if old_name:
                transaction.on_commit(lambda: _delete_names([old_name]))
    except BaseException:
        _delete_names([new_name])
        raise
    analysis.refresh_from_db()
    logger.info('hr.cv posting_uploaded analysis_id=%s kind=%s size=%s', analysis.pk, valid.kind, valid.size)
    return analysis


def remove_posting(analysis: CVAnalysis) -> None:
    """Delete file + metadata. Idempotent. Does NOT touch `requirements`."""
    _ensure_unlocked(analysis)
    with transaction.atomic():
        locked = CVAnalysis.objects.select_for_update().get(pk=analysis.pk)
        old_name = locked.posting_file.name if locked.posting_file else ''
        CVAnalysis.objects.filter(pk=analysis.pk).update(
            posting_file='', posting_original_name='', posting_kind='', posting_size_bytes=0, posting_sha256='',
            posting_uploaded_at=None, updated_at=timezone.now())
        if old_name:
            transaction.on_commit(lambda: _delete_names([old_name]))
    logger.info('hr.cv posting_removed analysis_id=%s had_file=%s', analysis.pk, bool(old_name))


# ---------------------------------------------------------------- reading

def _read_file(analysis: CVAnalysis) -> bytes:
    try:
        with analysis.posting_file.open('rb') as fh:
            return fh.read()
    except (FileNotFoundError, OSError, ValueError):
        raise HRDomainError('file_missing', 'No se encontró la convocatoria en el servidor. Vuelve a subirla.',
                            status.HTTP_404_NOT_FOUND)


def _file_text(analysis: CVAnalysis, data: bytes, limit: int) -> str:
    """Text layer of the stored file ('' for images / scanned PDFs / unreadable)."""
    try:
        if analysis.posting_kind == CVFileKind.DOCX:
            return cv_text.docx_text(data, max_chars=limit)
        if analysis.posting_kind == CVFileKind.PDF:
            return cv_text.pdf_text(data, settings.HR_CV_POSTING_MAX_PAGES, limit)
    except Exception:  # noqa: BLE001 - hostile files raise anything; type is not logged (may echo content)
        return ''
    return ''


def _ai_blocks(analysis: CVAnalysis, data: bytes | None, text: str) -> list[dict] | None:
    """Content blocks for the AI, or None if there is nothing to send."""
    if len(text) >= AI_TEXT_MIN_CHARS or data is None:
        return [{'type': 'text', 'text': posting_user_text(text)}] if text.strip() else None
    if analysis.posting_kind == CVFileKind.PDF:
        b64 = base64.standard_b64encode(data).decode('ascii')
        return [{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': b64}},
                {'type': 'text', 'text': posting_user_text(None)}]
    if analysis.posting_kind == CVFileKind.IMAGE:
        try:
            b64 = cv_text.image_b64(data)
        except Exception:  # noqa: BLE001 - hostile image
            return None
        return [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': b64}},
                {'type': 'text', 'text': posting_user_text(None)}]
    return [{'type': 'text', 'text': posting_user_text(text)}] if text.strip() else None


# ----------------------------------------------------------- post-process

def _normalize(text: str) -> str:
    text = re.sub(r'\s+', ' ', text or '').strip()
    text = LEADING_MARKS.sub('', text)
    text = TRAILING_MANDATORY.sub('', text)
    text = TRAILING_MARKS.sub('', text)
    return text[:MAX_REQUIREMENT_CHARS].rstrip()


def _dedupe_key(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', heuristics.fold(text)).strip()


def is_protected(text: str) -> bool:
    folded = heuristics.fold(text)
    if PROTECTED_RE.search(folded):
        return True
    if PERUVIAN_RE.search(folded) and not NORM_CONTEXT_RE.search(folded):
        return True
    return bool(AGE_RANGE_RE.search(folded)) and not WORK_CONTEXT_RE.search(folded)


def is_instruction_like(text: str) -> bool:
    """True when the line reads as an order to an AI instead of a candidate requirement."""
    return bool(INSTRUCTION_RE.search(heuristics.fold(text)))


def requirements_warnings(requirements: list[dict]) -> list[dict]:
    """Non-blocking notices for requirements typed by hand (PATCH). Never echoes the text."""
    warnings = []
    if any(is_protected(r['text']) for r in requirements):
        warnings.append(_warn('protected_requirement_detected'))
    if any(is_instruction_like(r['text']) for r in requirements):
        warnings.append(_warn('instruction_like_detected'))
    return warnings


def render_requirements_text(requirements: list[dict]) -> str:
    return '\n'.join(r['text'] + (' (obligatorio)' if r['weight'] == cv_scoring.WEIGHT_MANDATORY else '')
                     for r in requirements)


def finalize(raw: RawPosting) -> tuple[list[dict], list[dict], str | None]:
    """Normalize, drop protected attributes, dedupe, cap and number the requirements.
    Returns (requirements, warnings, position_title)."""
    warnings: list[dict] = []
    protected = raw.omitted_protected
    instruction_like = False
    seen: set[str] = set()
    cleaned: list[tuple[str, int]] = []
    for text, weight in raw.requirements:
        mandatory = weight >= cv_scoring.WEIGHT_MANDATORY or bool(TRAILING_MANDATORY.search(text or ''))
        clean = _normalize(text)
        if len(clean) < 3:
            continue
        if is_instruction_like(clean):
            instruction_like = True
            continue
        if is_protected(clean):
            protected = True
            continue
        key = _dedupe_key(clean)
        if not key or key in seen:
            continue
        seen.add(key)
        cleaned.append((clean, cv_scoring.WEIGHT_MANDATORY if mandatory else cv_scoring.WEIGHT_NORMAL))
    limit = settings.HR_CV_MAX_REQUIREMENTS
    if len(cleaned) > limit:
        order = sorted(range(len(cleaned)), key=lambda i: (cleaned[i][1] != cv_scoring.WEIGHT_MANDATORY, i))
        keep = sorted(order[:limit])
        cleaned = [cleaned[i] for i in keep]
        warnings.append(_warn('truncated_requirements', n=limit))
    if protected:
        warnings.append(_warn('protected_attribute_omitted'))
    if instruction_like:
        warnings.append(_warn('instruction_like_omitted'))
    requirements = [{'id': i, 'text': t, 'weight': w} for i, (t, w) in enumerate(cleaned, start=1)]
    title = _normalize(raw.position_title or '')[:100] or None
    return requirements, warnings, title


# ------------------------------------------------------------ extraction

def _record_usage(analysis: CVAnalysis, tokens_in: int, tokens_out: int) -> Decimal:
    cost = cost_for_tokens(tokens_in, tokens_out) if (tokens_in or tokens_out) else Decimal('0')
    if tokens_in or tokens_out:
        CVAnalysis.objects.filter(pk=analysis.pk).update(
            posting_tokens_in=F('posting_tokens_in') + tokens_in,
            posting_tokens_out=F('posting_tokens_out') + tokens_out,
            posting_cost_usd=F('posting_cost_usd') + cost)
    return cost


EXTRACT_LOCK_TTL = 90  # seconds; > worst case of one read (2 x HR_CV_POSTING_TIMEOUT), frees itself if the worker dies


def _acquire_extract_lock(user) -> str | None:
    """One extraction at a time per user: it is synchronous and holds a server thread for up
    to ~80 s. Fail-open if the cache is down (the 20/min throttle still applies)."""
    if user is None:
        return None
    key = f'hr:cv:posting_extract:{user.pk}'
    try:
        acquired = cache.add(key, 1, EXTRACT_LOCK_TTL)
    except Exception as exc:  # noqa: BLE001 - cache backend errors vary; never block HR on them
        logger.warning('hr.cv extract_lock_unavailable error_type=%s', type(exc).__name__)
        return None
    if not acquired:
        raise HRDomainError('extraction_in_progress', 'Ya estamos leyendo una convocatoria. Espera a que termine.',
                            status.HTTP_429_TOO_MANY_REQUESTS)
    return key


def _release_extract_lock(key: str | None) -> None:
    if key is None:
        return
    try:
        cache.delete(key)
    except Exception as exc:  # noqa: BLE001 - the TTL frees it anyway
        logger.warning('hr.cv extract_unlock_failed error_type=%s', type(exc).__name__)


def _limit_error() -> HRDomainError:
    return HRDomainError(
        'posting_limit_reached',
        'Llegaste al límite de lecturas con IA de la convocatoria. Escribe o pega los requisitos a mano.',
        status.HTTP_429_TOO_MANY_REQUESTS)


def _check_ai_budget(analysis: CVAnalysis, user) -> None:
    """Cost ceilings of the AI read: per analysis (accumulated cost) and per user per day."""
    if analysis.posting_cost_usd >= Decimal(str(settings.HR_CV_POSTING_MAX_COST_USD)):
        raise _limit_error()
    if user is None or settings.HR_CV_POSTING_DAILY_LIMIT_PER_USER <= 0:
        return
    key = f'hr:cv:posting_ai_day:{user.pk}:{timezone.localdate().isoformat()}'
    try:
        cache.add(key, 0, 26 * 3600)
        used = cache.incr(key)
    except Exception as exc:  # noqa: BLE001 - fail-open; the per-analysis ceiling still applies
        logger.warning('hr.cv extract_quota_unavailable error_type=%s', type(exc).__name__)
        return
    if used > settings.HR_CV_POSTING_DAILY_LIMIT_PER_USER:
        raise _limit_error()


def extract(analysis: CVAnalysis, *, text: str | None = None, client=None, user=None) -> dict:
    """Propose requirements from the pasted `text` or the stored file. Persists
    nothing except the accumulated usage. `user` enables the per-user lock and daily ceiling."""
    _ensure_unlocked(analysis)
    lock = _acquire_extract_lock(user)
    try:
        return _extract(analysis, text=text, client=client, user=user)
    finally:
        _release_extract_lock(lock)


def _extract(analysis: CVAnalysis, *, text: str | None, client, user) -> dict:
    started = time.monotonic()
    limit = settings.HR_CV_POSTING_MAX_TEXT_CHARS
    pasted = (text or '').strip()
    data: bytes | None = None
    lead_warnings: list[dict] = []   # about the input text
    extra_warnings: list[dict] = []  # about how it was read
    if pasted:
        body = pasted
    elif analysis.has_posting:
        data = _read_file(analysis)
        body = _file_text(analysis, data, limit + 1).strip()
    else:
        raise HRDomainError('no_posting', 'Sube la convocatoria o pega su texto primero.')
    if len(body) > limit:
        body = body[:limit]
        lead_warnings.append(_warn('truncated_text'))

    kind = 'text' if pasted else (analysis.posting_kind or '').lower()
    source, tokens_in, tokens_out = 'text', 0, 0
    raw: RawPosting | None = None

    if cv_agent.provider_name() == 'fake':
        cv_fake.simulate_delay(analysis.posting_sha256 or body or analysis.pk)
        raw = cv_fake.fake_posting(analysis.posting_sha256 or body or analysis.pk, body)
        source = 'fake'
        extra_warnings.append(_warn('simulated'))
    elif cv_agent.has_api_key():
        blocks = _ai_blocks(analysis, data, body)
        ai_error = None
        if blocks is not None:
            _check_ai_budget(analysis, user)
            try:
                result = CVAgent(client).extract_posting(blocks)
                raw, source = result.proposal, 'ai'
                tokens_in, tokens_out = result.tokens_in, result.tokens_out
            except AgentError as exc:
                ai_error = exc
                tokens_in, tokens_out = exc.usage
                logger.warning('hr.cv posting_ai_failed analysis_id=%s code=%s', analysis.pk, exc.code)
        if raw is None:
            if len(body) >= MIN_TEXT_CHARS:
                raw = heuristics_to_raw(body)
                if ai_error is not None:
                    extra_warnings.append(_warn('ai_fallback'))
            elif ai_error is not None:
                _record_usage(analysis, tokens_in, tokens_out)
                raise HRDomainError(
                    'posting_ai_failed',
                    'No pudimos leer la convocatoria con la IA. Reintenta o pega los requisitos a mano.',
                    status.HTTP_502_BAD_GATEWAY)
            else:
                raise _unreadable()
    else:
        if len(body) < MIN_TEXT_CHARS:
            raise _unreadable()
        raw = heuristics_to_raw(body)

    cost = _record_usage(analysis, tokens_in, tokens_out)
    requirements, warnings, title = finalize(raw)
    warnings = lead_warnings + extra_warnings + warnings
    if not requirements:
        warnings.append(_warn('no_requirements_found'))
    logger.info(
        'hr.cv posting_extracted analysis_id=%s source=%s kind=%s reqs=%d tokens_in=%d tokens_out=%d latency_ms=%d',
        analysis.pk, source, kind or 'none', len(requirements), tokens_in, tokens_out,
        int((time.monotonic() - started) * 1000))
    return {
        'source': source,
        'position_title': title,
        'requirements': requirements,
        'requirements_text': render_requirements_text(requirements),
        'warnings': warnings,
        'usage': {'tokens_in': tokens_in, 'tokens_out': tokens_out, 'cost_usd': float(cost)},
    }


def heuristics_to_raw(body: str) -> RawPosting:
    result = heuristics.extract(body)
    return RawPosting(position_title=result.position_title,
                      requirements=[(c.text, c.weight) for c in result.requirements])


def _unreadable() -> HRDomainError:
    return HRDomainError(
        'posting_unreadable',
        'No pudimos leer texto de la convocatoria (parece una imagen o está vacía). Pega los requisitos a mano.',
        status.HTTP_422_UNPROCESSABLE_ENTITY)
