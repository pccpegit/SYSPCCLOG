"""Per-file validation of CV uploads (SYSPCC-023).

One file never aborts the batch: `validate_cv_upload` raises `CVFileRejected`
and the caller records it in `rejected[]`. The real type comes from libmagic
(the extension and the client content-type are ignored). Messages are fixed
es-PE strings: they never echo file content.
"""

import hashlib
import io
import os
import re
import unicodedata
from dataclasses import dataclass

import magic
from django.conf import settings

from apps.hr.enums import CVFileKind
from apps.hr.exceptions import HRDomainError
from apps.hr.services.template_service import inspect_zip

CHUNK = 64 * 1024
ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png']
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
_ZIPISH = {'application/zip', 'application/octet-stream', 'application/x-zip-compressed', DOCX_MIME}
_STORED_EXT = {'application/pdf': '.pdf', DOCX_MIME: '.docx', 'image/jpeg': '.jpg', 'image/png': '.png'}
_KIND = {'application/pdf': CVFileKind.PDF, DOCX_MIME: CVFileKind.DOCX,
         'image/jpeg': CVFileKind.IMAGE, 'image/png': CVFileKind.IMAGE}


class CVFileRejected(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(code)
        self.code, self.detail = code, detail


@dataclass
class ValidatedCV:
    data: bytes
    kind: str
    mime: str
    ext: str
    sha256: str
    size: int
    page_count: int | None


def sanitize_original_name(name: str) -> str:
    """Label only (shown in the UI). Never used as a path."""
    name = os.path.basename((name or '').replace('\\', '/'))
    name = unicodedata.normalize('NFC', name)
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip()
    return (name or 'cv')[:255]


def _mb(max_bytes: int) -> int:
    return max(max_bytes // (1024 * 1024), 1)


def _read_limited(uploaded_file, max_bytes: int) -> tuple[bytes, str]:
    """Read in chunks up to max_bytes+1, hashing as we go."""
    h = hashlib.sha256()
    parts, total = [], 0
    uploaded_file.seek(0)
    while True:
        chunk = uploaded_file.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise CVFileRejected(
                'file_too_large', f'El archivo supera el máximo de {_mb(max_bytes)} MB.'
            )
        h.update(chunk)
        parts.append(chunk)
    if total == 0:
        raise CVFileRejected('file_empty', 'El archivo está vacío.')
    return b''.join(parts), h.hexdigest()


def _check_pdf(data: bytes, max_pages: int | None = None) -> int:
    max_pages = settings.HR_CV_MAX_PAGES if max_pages is None else max_pages
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise CVFileRejected('pdf_encrypted', 'El PDF tiene contraseña. Quítala y vuelve a subirlo.')
        pages = len(reader.pages)
    except CVFileRejected:
        raise
    except BaseException as exc:  # noqa: BLE001 - hostile PDFs raise anything (incl. RecursionError)
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise CVFileRejected('pdf_corrupt', 'El PDF está dañado o no se puede abrir.')
    if pages < 1:
        raise CVFileRejected('pdf_corrupt', 'El PDF está dañado o no se puede abrir.')
    if pages > max_pages:
        raise CVFileRejected('pdf_too_many_pages', f'El PDF tiene más de {max_pages} páginas.')
    return pages


def _check_image(data: bytes, max_pixels: int | None = None) -> None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size
            if width * height > (settings.HR_CV_MAX_IMAGE_PIXELS if max_pixels is None else max_pixels):
                raise CVFileRejected('image_invalid', 'La imagen es demasiado grande en píxeles.')
            img.verify()
    except CVFileRejected:
        raise
    except Exception:  # noqa: BLE001 - Pillow raises many types on hostile images
        raise CVFileRejected('image_invalid', 'La imagen está dañada o no se puede abrir.')


def _check_docx(data: bytes) -> None:
    try:
        inspect_zip(data)
    except HRDomainError as exc:
        if exc.code == 'macros_not_allowed':
            raise CVFileRejected(
                'invalid_docx', 'El Word contiene macros u objetos incrustados. Guárdalo como PDF.'
            )
        raise CVFileRejected('invalid_docx', 'El archivo no es un documento Word (.docx) válido.')


def validate_cv_upload(uploaded_file, *, max_bytes: int | None = None, max_pages: int | None = None,
                       max_pixels: int | None = None) -> ValidatedCV:
    """`max_bytes` / `max_pages` default to HR_CV_MAX_FILE_BYTES / HR_CV_MAX_PAGES
    (CVs); the job posting passes its own, lower limits (`max_pixels`: images are decoded in the
    request thread when the posting is read by the AI)."""
    max_bytes = settings.HR_CV_MAX_FILE_BYTES if max_bytes is None else max_bytes
    declared = getattr(uploaded_file, 'size', None)
    if declared is not None and declared > max_bytes:
        raise CVFileRejected(
            'file_too_large', f'El archivo supera el máximo de {_mb(max_bytes)} MB.'
        )
    data, sha = _read_limited(uploaded_file, max_bytes)
    detected = magic.from_buffer(data[:8192], mime=True)

    page_count = None
    if detected == 'application/pdf':
        mime = detected
        page_count = _check_pdf(data, max_pages)
    elif detected in ('image/jpeg', 'image/png'):
        mime = detected
        _check_image(data, max_pixels)
    elif detected in _ZIPISH and data[:2] == b'PK':
        mime = DOCX_MIME
        _check_docx(data)
    else:
        raise CVFileRejected(
            'unsupported_type', 'Formato no admitido. Usa PDF, Word (.docx) o imagen (JPG/PNG).'
        )
    return ValidatedCV(
        data=data, kind=_KIND[mime].value, mime=mime, ext=_STORED_EXT[mime], sha256=sha,
        size=len(data), page_count=page_count,
    )
