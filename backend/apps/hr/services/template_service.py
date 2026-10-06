"""Template upload validation, versioning and activation."""

import hashlib
import io
import logging
import os
import re
import unicodedata
import zipfile

from lxml import etree

import magic
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status

from apps.hr.documents.registry import get_spec
from apps.hr.exceptions import HRDomainError
from apps.hr.models import DocumentTemplate
from apps.hr.services import docx_renderer

logger = logging.getLogger(__name__)

DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
ALLOWED_MIMES = {DOCX_MIME, 'application/zip'}

MAX_ZIP_ENTRIES = 1000
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_RELS_BYTES = 1024 * 1024


def _sanitize_filename(name: str) -> str:
    name = os.path.basename(name or '')
    name = unicodedata.normalize('NFC', name)
    name = re.sub(r'[\x00-\x1f\x7f/\\]', '', name).strip()
    return name[:255]


_SAFE_XML = etree.XMLParser(
    resolve_entities=False, no_network=True, load_dtd=False, dtd_validation=False,
    huge_tree=False, remove_comments=True, remove_pis=True,
)
_FIELD_RE = re.compile(
    r'(?<![A-Za-z])(DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK|IMPORT|AUTOTEXT)(?![A-Za-z])',
    re.IGNORECASE,
)
_ACTIVE_TAGS = {'altchunk', 'oleobject', 'object'}
_ACTIVE_REL_TYPES = ('oleobject', 'package', 'attachedtemplate', 'vbaproject', 'activexcontrol')
MAX_XML_PART_BYTES = 10 * 1024 * 1024


def _local(tag) -> str:
    return tag.rsplit('}', 1)[-1].lower() if isinstance(tag, str) else ''


def _parse_xml(zf, name: str, limit: int):
    raw = zf.open(name).read(limit + 1)
    if len(raw) > limit:
        raise HRDomainError('invalid_docx', 'El archivo Word tiene componentes internos demasiado grandes.')
    try:
        return etree.fromstring(raw, parser=_SAFE_XML)
    except etree.XMLSyntaxError:
        raise HRDomainError('invalid_docx', 'El archivo Word contiene XML inválido.')


def _check_relationships(zf, name: str) -> None:
    root = _parse_xml(zf, name, MAX_RELS_BYTES)
    for rel in root.iter():
        if _local(rel.tag) != 'relationship':
            continue
        # Normalized comparison: spaces/case/entities cannot hide "External".
        if (rel.get('TargetMode') or '').strip().lower() == 'external':
            raise HRDomainError(
                'external_links_not_allowed',
                'La plantilla no puede contener vínculos externos ni plantillas remotas.',
            )
        rel_type = (rel.get('Type') or '').rsplit('/', 1)[-1].lower()
        if rel_type in _ACTIVE_REL_TYPES:
            raise HRDomainError(
                'macros_not_allowed',
                'La plantilla no puede contener objetos incrustados, macros ni plantillas adjuntas.',
            )


def _check_content_part(zf, name: str) -> None:
    root = _parse_xml(zf, name, MAX_XML_PART_BYTES)
    for el in root.iter():
        local = _local(el.tag)
        if local in _ACTIVE_TAGS:
            raise HRDomainError(
                'macros_not_allowed',
                'La plantilla no puede contener objetos incrustados ni contenido insertado (OLE/altChunk).',
            )
        if local == 'fldsimple' and _FIELD_RE.search(
            next((v for k, v in el.attrib.items() if _local(k) == 'instr'), '')
        ):
            raise HRDomainError('macros_not_allowed', 'La plantilla contiene campos activos no permitidos (DDE/INCLUDE/LINK).')
    for para in root.iter():
        if _local(para.tag) != 'p':
            continue
        # Join instrText runs: Word may split "DDEAUTO" across several runs.
        instr = ''.join(
            (n.text or '') for n in para.iter() if _local(n.tag) == 'instrtext'
        )
        if instr and _FIELD_RE.search(instr):
            raise HRDomainError('macros_not_allowed', 'La plantilla contiene campos activos no permitidos (DDE/INCLUDE/LINK).')


def inspect_zip(data: bytes) -> None:
    """Structural checks of the .docx container. Raises HRDomainError."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HRDomainError('invalid_docx', 'El archivo no es un documento Word (.docx) válido.')

    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise HRDomainError('invalid_docx', 'El archivo Word tiene demasiados componentes internos.')
        total = sum(i.file_size for i in infos)
        if total > MAX_UNCOMPRESSED_BYTES or total > max(len(data), 1) * MAX_COMPRESSION_RATIO:
            raise HRDomainError('invalid_docx', 'El archivo Word es sospechosamente grande al descomprimirse.')

        names = [i.filename for i in infos]
        # Duplicate entries: Python reads the LAST one, Word/LibreOffice may read the first.
        if len(set(names)) != len(names):
            raise HRDomainError('invalid_docx', 'El archivo Word tiene componentes internos duplicados.')
        for name in names:
            if name.startswith('/') or '\\' in name or '..' in name.split('/'):
                raise HRDomainError('invalid_docx', 'El archivo Word contiene rutas internas no permitidas.')
        if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
            raise HRDomainError('invalid_docx', 'El archivo no es un documento Word (.docx) válido.')

        lowered = [n.lower() for n in names]
        if any(
            n.endswith('vbaproject.bin') or n.startswith('word/embeddings/') or n.startswith('word/activex/')
            for n in lowered
        ):
            raise HRDomainError(
                'macros_not_allowed',
                'La plantilla no puede contener macros, objetos incrustados ni controles ActiveX.',
            )

        content_types = zf.open('[Content_Types].xml').read(MAX_RELS_BYTES + 1).decode('utf-8', 'ignore')
        if 'macroEnabled' in content_types or 'vbaProject' in content_types:
            raise HRDomainError('macros_not_allowed', 'La plantilla no puede contener macros.')

        for name in names:
            if name.endswith('.rels'):
                _check_relationships(zf, name)
        for name in names:
            if re.fullmatch(r'word/[^/]+\.xml', name):
                _check_content_part(zf, name)


def inspect_upload(uploaded_file) -> dict:
    """Validate the uploaded file and return its facts (bytes, sha, name, variables)."""
    original = _sanitize_filename(getattr(uploaded_file, 'name', ''))
    if not original.lower().endswith('.docx'):
        raise HRDomainError('invalid_docx', 'Solo se aceptan archivos Word con extensión .docx.')

    max_bytes = settings.HR_TEMPLATE_MAX_BYTES
    if getattr(uploaded_file, 'size', 0) and uploaded_file.size > max_bytes:
        raise HRDomainError(
            'file_too_large', f'El archivo supera el máximo de {max_bytes // (1024 * 1024)} MB.'
        )
    uploaded_file.seek(0)
    data = uploaded_file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HRDomainError(
            'file_too_large', f'El archivo supera el máximo de {max_bytes // (1024 * 1024)} MB.'
        )
    if not data:
        raise HRDomainError('invalid_docx', 'El archivo está vacío.')

    detected_mime = magic.from_buffer(data[:4096], mime=True)
    if detected_mime not in ALLOWED_MIMES:
        raise HRDomainError('invalid_docx', 'El contenido del archivo no corresponde a un Word (.docx).')

    inspect_zip(data)
    variables = docx_renderer.detect_variables(data)
    return {
        'bytes': data,
        'original_filename': original,
        'sha256': hashlib.sha256(data).hexdigest(),
        'variables': variables,
    }


def _trial_render(spec, data: bytes, variables: list) -> None:
    """Render with sample data; unknown variables are blanked (they only block
    ACTIVATION, not upload) so only real syntax problems surface here."""
    clean, _ = spec.normalize(spec.sample_data())
    ctx = spec.build_context(clean, {}, None)
    for name in variables:
        ctx.setdefault(name, '')
    try:
        docx_renderer.render(data, ctx)
    except HRDomainError as exc:
        if exc.code == 'template_render_error':
            raise HRDomainError('template_syntax_error', str(exc.detail), status.HTTP_400_BAD_REQUEST)
        raise


@transaction.atomic
def create_template(*, user, document_type: str, name: str, slug: str | None, notes: str, uploaded_file):
    spec = get_spec(document_type)
    info = inspect_upload(uploaded_file)
    _trial_render(spec, info['bytes'], info['variables'])

    slug = slugify(slug or '') or spec.default_slug
    detected = info['variables']
    unknown = sorted(set(detected) - spec.variable_names)
    missing_required = sorted(spec.required_variable_names - set(detected))

    # Serialize version numbering per series (no-op on SQLite, row lock on PG).
    series = DocumentTemplate.objects.select_for_update().filter(document_type=document_type, slug=slug)
    list(series.values_list('pk', flat=True))
    version = (series.aggregate(m=Max('version'))['m'] or 0) + 1

    template = DocumentTemplate(
        document_type=document_type, slug=slug, name=name.strip(), version=version,
        original_filename=info['original_filename'], file_sha256=info['sha256'],
        detected_variables=detected, unknown_variables=unknown,
        missing_required_variables=missing_required, notes=notes or '', uploaded_by=user,
    )
    template.file.save('plantilla.docx', ContentFile(info['bytes']), save=False)
    try:
        with transaction.atomic():
            template.save()
    except IntegrityError:
        template.file.storage.delete(template.file.name)
        raise HRDomainError(
            'template_version_conflict',
            'Otra persona subió una versión al mismo tiempo. Inténtalo de nuevo.',
            status.HTTP_409_CONFLICT,
        )
    except Exception:
        template.file.storage.delete(template.file.name)
        raise
    logger.info(
        'hr.template_created user_id=%s template_id=%s version=%s unknown=%d',
        getattr(user, 'id', None), template.pk, version, len(unknown),
    )
    return template


@transaction.atomic
def activate_template(template_id: int, *, user) -> DocumentTemplate:
    template = get_object_or_404(DocumentTemplate.objects.select_for_update(), pk=template_id)
    if template.is_active:
        return template  # idempotent
    if template.unknown_variables:
        raise HRDomainError(
            'template_has_unknown_variables',
            'La plantilla usa variables que no existen: ' + ', '.join(template.unknown_variables)
            + '. Corrígelas en el Word y sube una nueva versión.',
            status.HTTP_409_CONFLICT,
        )
    DocumentTemplate.objects.filter(
        document_type=template.document_type, slug=template.slug, is_active=True
    ).update(is_active=False)
    template.is_active = True
    template.activated_at = timezone.now()
    template.save(update_fields=['is_active', 'activated_at', 'updated_at'])
    logger.info('hr.template_activated user_id=%s template_id=%s', getattr(user, 'id', None), template.pk)
    return template


@transaction.atomic
def deactivate_template(template_id: int, *, user) -> DocumentTemplate:
    template = get_object_or_404(DocumentTemplate.objects.select_for_update(), pk=template_id)
    if template.is_active:
        template.is_active = False
        template.save(update_fields=['is_active', 'updated_at'])
        logger.info('hr.template_deactivated user_id=%s template_id=%s', getattr(user, 'id', None), template.pk)
    return template


@transaction.atomic
def delete_template(template_id: int, *, user) -> None:
    template = get_object_or_404(DocumentTemplate.objects.select_for_update(), pk=template_id)
    if template.is_active:
        raise HRDomainError(
            'template_active', 'Desactiva la plantilla antes de eliminarla.', status.HTTP_409_CONFLICT
        )
    if template.documents.exists():
        raise HRDomainError(
            'template_in_use',
            'La plantilla ya se usó en documentos y no puede eliminarse.',
            status.HTTP_409_CONFLICT,
        )
    storage, name = template.file.storage, template.file.name
    template.delete()
    transaction.on_commit(lambda: storage.delete(name))
    logger.info('hr.template_deleted user_id=%s', getattr(user, 'id', None))
