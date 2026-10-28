"""Lifecycle of generated documents: DRAFT -> ISSUED -> VOIDED.

This state machine belongs to the RR. HH. module and is independent from the
RQ WorkflowEngine. Every mutation runs in a transaction with the row locked
(`select_for_update`), so a double click on "Emitir" cannot issue twice.
"""

import hashlib
import logging
import re
import unicodedata

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status

from apps.hr.documents.registry import get_spec
from apps.hr.enums import DocumentEventAction, DocumentStatus
from apps.hr.exceptions import HRDomainError, invalid_state
from apps.hr.models import DocumentEvent, DocumentTemplate, GeneratedDocument
from apps.hr.services import docx_renderer, pdf_converter
from apps.hr.services.company_profile import (
    get_company_context,
    is_demo_template,
    missing_company_data,
)

logger = logging.getLogger(__name__)

MIN_VOID_REASON_CHARS = 10
_NUMBER_RETRIES = 3


# ------------------------------------------------------------------ helpers

def record_event(document, action, actor, **metadata) -> DocumentEvent:
    """Audit entry. metadata must never contain PII."""
    return DocumentEvent.objects.create(
        document=document, action=action, actor=actor if getattr(actor, 'pk', None) else None,
        metadata=metadata,
    )


def _get_template_for(document_type: str, template_id) -> DocumentTemplate:
    try:
        template = DocumentTemplate.objects.get(pk=template_id, document_type=document_type)
    except (DocumentTemplate.DoesNotExist, ValueError, TypeError):
        raise serializers.ValidationError({'template_id': ['La plantilla seleccionada no existe.']})
    return template


def _get_personal(personal_id):
    if personal_id in (None, ''):
        return None
    from apps.core.models import Personal

    try:
        return Personal.objects.get(pk=personal_id)
    except (Personal.DoesNotExist, ValueError, TypeError):
        raise serializers.ValidationError({'personal_id': ['El trabajador seleccionado no existe.']})


def _split_data(data: dict) -> tuple:
    fields = {k: v for k, v in (data or {}).items() if k != 'company'}
    return fields, (data or {}).get('company') or {}


def _render_docx(template: DocumentTemplate, spec, clean: dict, company: dict, reference: str | None) -> bytes:
    context = spec.build_context(clean, company, reference)
    try:
        template.file.open('rb')
        try:
            source = template.file.read()
        finally:
            template.file.close()
    except (FileNotFoundError, OSError):
        logger.error('hr.template_file_missing template_id=%s', template.pk)
        raise HRDomainError(
            'template_file_missing',
            'No se encontró el archivo de la plantilla en el servidor. Sube la plantilla otra vez.',
            status.HTTP_409_CONFLICT,
        )
    return docx_renderer.render(source, context)


def _drop_pdf(document: GeneratedDocument) -> None:
    """Forget the PDF (stale once the Word changes); file removed after commit."""
    if document.pdf_file:
        storage, name = document.pdf_file.storage, document.pdf_file.name
        transaction.on_commit(lambda: storage.delete(name))
    document.pdf_file = ''
    document.pdf_docx_sha256 = ''


def _store(field_file, content: bytes, name: str):
    field_file.save(name, ContentFile(content), save=False)


def _safe_filename(spec, document: GeneratedDocument, ext: str) -> str:
    surname = (document.subject_name or '').split(',')[0].split(' ')[0]
    surname = unicodedata.normalize('NFKD', surname).encode('ascii', 'ignore').decode()
    surname = re.sub(r'[^A-Za-z0-9]+', '', surname) or 'Trabajador'
    ref = re.sub(r'[^A-Za-z0-9-]+', '', document.reference_number or '') or 'borrador'
    return f'{spec.filename_prefix}_{surname}_{ref}.{ext}'


def download_filename(document: GeneratedDocument, ext: str) -> str:
    return _safe_filename(get_spec(document.document_type), document, ext)


def compute_warnings(document: GeneratedDocument) -> list:
    """Warnings recomputed on read (never persisted): minimum wage + overlap
    with an already ISSUED contract of the same worker."""
    if document.status != DocumentStatus.DRAFT:
        return []
    from apps.hr.documents.contract import contract_warnings

    fields, _ = _split_data(document.data)
    warnings = contract_warnings(fields)
    missing = [label for _k, label, _b in missing_company_data(document.template)]
    if missing:
        warnings.append(
            'Faltan datos de la empresa que la plantilla imprime: ' + ', '.join(missing)
            + '. Configúralos (variables HR_COMPANY_*) antes de emitir.'
        )
    if is_demo_template(document.template):
        warnings.append('La plantilla es un MODELO DEMO sin valor legal; reemplázala por la plantilla aprobada.')
    dni = fields.get('worker_dni')
    start = fields.get('start_date')
    if dni and start:
        end = fields.get('end_date') or '9999-12-31'
        others = GeneratedDocument.objects.filter(
            document_type=document.document_type, status=DocumentStatus.ISSUED, data__worker_dni=dni,
        ).exclude(pk=document.pk)
        for other in others:
            o_start = other.data.get('start_date') or '0001-01-01'
            o_end = other.data.get('end_date') or '9999-12-31'
            if o_start <= end and start <= o_end:  # ISO strings compare chronologically
                warnings.append(
                    f'El trabajador ya tiene un contrato emitido ({other.reference_number}) '
                    'cuyas fechas se traslapan con este.'
                )
                break
    return warnings


# ------------------------------------------------------------------- create

@transaction.atomic
def create_draft(*, user, document_type, template_id, personal_id, source, data) -> GeneratedDocument:
    spec = get_spec(document_type)
    template = _get_template_for(document_type, template_id)
    if not template.is_active:
        raise HRDomainError(
            'template_inactive', 'La plantilla seleccionada no está activa.', status.HTTP_409_CONFLICT
        )
    personal = _get_personal(personal_id)
    clean, _warnings = spec.normalize(data or {})
    company = get_company_context()
    docx_bytes = _render_docx(template, spec, clean, company, None)

    document = GeneratedDocument(
        document_type=document_type, template=template, template_version=template.version,
        template_sha256=template.file_sha256, personal=personal,
        subject_name=clean['worker_full_name'], data={**clean, 'company': company},
        source=source, created_by=user, docx_sha256=hashlib.sha256(docx_bytes).hexdigest(),
    )
    _store(document.docx_file, docx_bytes, 'documento.docx')
    try:
        document.save()
    except Exception:
        document.docx_file.storage.delete(document.docx_file.name)
        raise
    record_event(
        document, DocumentEventAction.CREATED, user,
        template_version=template.version, source=source,
    )
    logger.info('hr.document_created user_id=%s document_id=%s type=%s', user.pk, document.pk, document_type)
    return document


# ------------------------------------------------------------------- update

@transaction.atomic
def update_draft(*, user, document_id, data=None, template_id=None) -> GeneratedDocument:
    document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
    if document.status != DocumentStatus.DRAFT:
        raise invalid_state('Solo se pueden editar documentos en borrador.')
    spec = get_spec(document.document_type)

    template = document.template
    if template_id is not None and int(template_id) != template.pk:
        template = _get_template_for(document.document_type, template_id)
        if not template.is_active:
            raise HRDomainError(
                'template_inactive', 'La plantilla seleccionada no está activa.', status.HTTP_409_CONFLICT
            )

    fields, company = _split_data(document.data)
    merged = {**fields, **(data or {})}
    clean, _warnings = spec.normalize(merged)
    company = get_company_context()
    docx_bytes = _render_docx(template, spec, clean, company, None)

    old_name = document.docx_file.name
    storage = document.docx_file.storage
    document.template = template
    document.template_version = template.version
    document.template_sha256 = template.file_sha256
    document.subject_name = clean['worker_full_name']
    document.data = {**clean, 'company': company}
    document.docx_sha256 = hashlib.sha256(docx_bytes).hexdigest()
    _drop_pdf(document)
    _store(document.docx_file, docx_bytes, 'documento.docx')
    new_name = document.docx_file.name
    try:
        document.save()
    except Exception:
        storage.delete(new_name)
        raise
    if old_name and old_name != new_name:
        transaction.on_commit(lambda: storage.delete(old_name))
    record_event(document, DocumentEventAction.UPDATED, user, template_version=template.version)
    return document


@transaction.atomic
def delete_draft(*, user, document_id) -> None:
    document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
    if document.status != DocumentStatus.DRAFT:
        raise invalid_state('Solo se pueden eliminar documentos en borrador.')
    storage = document.docx_file.storage
    names = [n for n in (document.docx_file.name, document.pdf_file.name) if n]
    document.delete()

    def _cleanup():
        for name in names:
            storage.delete(name)

    transaction.on_commit(_cleanup)
    logger.info('hr.document_deleted user_id=%s', user.pk)


# -------------------------------------------------------------------- issue

def _next_reference(spec) -> str:
    year = timezone.localdate().year
    prefix = f'{spec.prefix}-{year}-'
    latest = (
        GeneratedDocument.objects.select_for_update()
        .filter(reference_number__startswith=prefix)
        .order_by('-reference_number').first()
    )
    last = int(latest.reference_number.rsplit('-', 1)[1]) if latest else 0
    return f'{prefix}{last + 1:04d}'


def issue(*, user, document_id) -> GeneratedDocument:
    """DRAFT -> ISSUED. Re-validates and re-renders with the final data,
    assigns the number and freezes the document. PDF (if enabled) is rendered
    AFTER the transaction commits so a slow conversion never holds the lock."""
    last_error = None
    for _attempt in range(_NUMBER_RETRIES):
        try:
            document = _issue_atomic(user=user, document_id=document_id)
            break
        except IntegrityError as exc:  # reference_number collision under concurrency
            last_error = exc
            logger.warning('hr.issue_number_collision document_id=%s', document_id)
    else:
        logger.error('hr.issue_failed_after_retries document_id=%s error_type=%s',
                     document_id, type(last_error).__name__)
        raise HRDomainError(
            'issue_conflict', 'No se pudo asignar el número. Inténtalo de nuevo.', status.HTTP_409_CONFLICT
        )

    if pdf_converter.is_enabled():
        try:
            render_pdf(user=user, document_id=document.pk)
            document.refresh_from_db()
        except HRDomainError as exc:
            logger.warning('hr.issue_pdf_skipped document_id=%s code=%s', document.pk, exc.code)
        except Exception as exc:  # noqa: BLE001 - PDF is best-effort once the document is issued
            logger.error('hr.issue_pdf_failed document_id=%s error_type=%s', document.pk, type(exc).__name__)
    return document


@transaction.atomic
def _issue_atomic(*, user, document_id) -> GeneratedDocument:
    document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
    if document.status != DocumentStatus.DRAFT:
        raise invalid_state('El documento ya fue emitido o anulado.')
    spec = get_spec(document.document_type)

    blocking = [label for _k, label, block in missing_company_data(document.template) if block]
    if blocking:
        raise HRDomainError(
            'company_data_missing',
            'No se puede emitir: faltan datos de la empresa que la plantilla imprime ('
            + ', '.join(blocking) + '). Configúralos (variables HR_COMPANY_*) y vuelve a intentarlo.',
            status.HTTP_400_BAD_REQUEST,
        )

    fields, _old_company = _split_data(document.data)
    clean, _warnings = spec.normalize(fields)  # ValidationError -> 400 if data no longer valid
    company = get_company_context()
    reference = _next_reference(spec)
    docx_bytes = _render_docx(document.template, spec, clean, company, reference)

    old_name = document.docx_file.name
    storage = document.docx_file.storage
    document.data = {**clean, 'company': company}
    document.subject_name = clean['worker_full_name']
    document.reference_number = reference
    document.status = DocumentStatus.ISSUED
    document.issued_by = user
    document.issued_at = timezone.now()
    document.docx_sha256 = hashlib.sha256(docx_bytes).hexdigest()
    _drop_pdf(document)
    _store(document.docx_file, docx_bytes, 'documento.docx')
    new_name = document.docx_file.name
    try:
        with transaction.atomic():
            document.save()
            record_event(
                document, DocumentEventAction.ISSUED, user,
                reference_number=reference, template_version=document.template_version,
                docx_sha256=document.docx_sha256,
            )
    except Exception:
        storage.delete(new_name)
        raise
    if old_name and old_name != new_name:
        transaction.on_commit(lambda: storage.delete(old_name))
    logger.info('hr.document_issued user_id=%s document_id=%s reference=%s', user.pk, document.pk, reference)
    return document


@transaction.atomic
def void(*, user, document_id, reason: str) -> GeneratedDocument:
    reason = (reason or '').strip()
    if len(reason) < MIN_VOID_REASON_CHARS:
        raise serializers.ValidationError(
            {'reason': [f'Indica el motivo de la anulación (mínimo {MIN_VOID_REASON_CHARS} caracteres).']}
        )
    document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
    if document.status != DocumentStatus.ISSUED:
        raise invalid_state('Solo se pueden anular documentos emitidos.')
    document.status = DocumentStatus.VOIDED
    document.voided_by = user
    document.voided_at = timezone.now()
    document.void_reason = reason
    document.save(update_fields=['status', 'voided_by', 'voided_at', 'void_reason', 'updated_at'])
    record_event(document, DocumentEventAction.VOIDED, user)  # the reason lives on the document, not in the log
    logger.info('hr.document_voided user_id=%s document_id=%s', user.pk, document.pk)
    return document


# ---------------------------------------------------------------------- pdf

def render_pdf(*, user, document_id) -> GeneratedDocument:
    """Convert the CURRENT Word to PDF. Allowed for DRAFT and ISSUED (not
    VOIDED). The slow conversion runs outside any lock; the result is saved
    only if the Word did not change meanwhile (PDF bound to docx_sha256)."""
    if not pdf_converter.is_enabled():
        raise HRDomainError('pdf_disabled', 'La conversión a PDF no está habilitada en este entorno.', 501)

    with transaction.atomic():
        document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
        if document.status == DocumentStatus.VOIDED:
            raise invalid_state('No se puede generar el PDF de un documento anulado.')
        if not document.docx_file:
            raise HRDomainError('docx_missing', 'El documento no tiene archivo Word.', status.HTTP_409_CONFLICT)
        source_sha = document.docx_sha256
        try:
            document.docx_file.open('rb')
            try:
                docx_bytes = document.docx_file.read()
            finally:
                document.docx_file.close()
        except OSError:
            logger.error('hr.docx_unreadable document_id=%s', document.pk)
            raise HRDomainError(
                'docx_missing', 'No se encontró el archivo Word en el servidor.', status.HTTP_409_CONFLICT
            )

    pdf_bytes = pdf_converter.convert(docx_bytes)

    with transaction.atomic():
        document = get_object_or_404(GeneratedDocument.objects.select_for_update(), pk=document_id)
        if document.status == DocumentStatus.VOIDED or document.docx_sha256 != source_sha:
            raise invalid_state('El documento cambió mientras se generaba el PDF. Inténtalo de nuevo.')
        storage = document.pdf_file.storage
        old_name = document.pdf_file.name
        _store(document.pdf_file, pdf_bytes, 'documento.pdf')
        new_name = document.pdf_file.name
        try:
            document.pdf_docx_sha256 = source_sha
            document.save(update_fields=['pdf_file', 'pdf_docx_sha256', 'updated_at'])
            record_event(document, DocumentEventAction.PDF_RENDERED, user)
        except Exception:
            storage.delete(new_name)
            raise
        if old_name and old_name != new_name:
            transaction.on_commit(lambda: storage.delete(old_name))
    return document
