"""PDF conversion through LibreOffice headless (optional).

Available only when the `soffice` binary exists (local Docker image built with
INSTALL_LIBREOFFICE=true). Otherwise callers get `pdf_not_available`/`pdf_disabled`
and the .docx remains the deliverable.
"""

import logging
import os
import shutil
import signal
import subprocess
import tempfile
import uuid

from django.conf import settings

from apps.hr.exceptions import HRDomainError

logger = logging.getLogger(__name__)


def _soffice_path():
    return shutil.which('soffice') or shutil.which('libreoffice')


def _kill_group(proc) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:  # pragma: no cover
        pass


def is_enabled() -> bool:
    flag = settings.HR_PDF_ENABLED
    if flag is None:  # auto
        return _soffice_path() is not None
    return bool(flag) and _soffice_path() is not None


def convert(docx_bytes: bytes) -> bytes:
    """docx -> pdf bytes. Raises HRDomainError('pdf_disabled', 501) or
    ('pdf_conversion_failed', 502). Unique profile dir per call so concurrent
    conversions do not clash; temp dir always cleaned."""
    binary = _soffice_path()
    if not is_enabled() or not binary:
        raise HRDomainError('pdf_disabled', 'La conversión a PDF no está habilitada en este entorno.', 501)

    workdir = tempfile.mkdtemp(prefix='hr-pdf-')
    try:
        src = os.path.join(workdir, 'documento.docx')
        with open(src, 'wb') as fh:
            fh.write(docx_bytes)
        profile = f'file://{workdir}/lo-{uuid.uuid4().hex}'
        argv = [binary, '--headless', '--norestore', '--nolockcheck', f'-env:UserInstallation={profile}',
                '--convert-to', 'pdf', '--outdir', workdir, src]
        # Minimal environment: the child must NOT inherit SECRET_KEY, DB
        # credentials or ANTHROPIC_API_KEY.
        env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': workdir, 'LANG': 'C.UTF-8'}
        try:
            # New session => its own process group, so a timeout can kill soffice.bin too.
            proc = subprocess.Popen(  # noqa: S603 - fixed argv, shell=False, no user input in args
                argv, shell=False, env=env, start_new_session=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            logger.error('hr.pdf_failed error_type=%s', type(exc).__name__)
            raise HRDomainError('pdf_conversion_failed', 'No se pudo convertir el documento a PDF.', 502)
        try:
            returncode = proc.wait(timeout=settings.HR_PDF_TIMEOUT)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            logger.error('hr.pdf_timeout')
            raise HRDomainError('pdf_conversion_failed', 'La conversión a PDF tardó demasiado.', 502)
        finally:
            _kill_group(proc)  # reap any orphan soffice.bin left in the group
        if returncode != 0:
            logger.error('hr.pdf_failed returncode=%s', returncode)
            raise HRDomainError('pdf_conversion_failed', 'No se pudo convertir el documento a PDF.', 502)
        out = os.path.join(workdir, 'documento.pdf')
        if not os.path.exists(out):
            raise HRDomainError('pdf_conversion_failed', 'No se pudo convertir el documento a PDF.', 502)
        with open(out, 'rb') as fh:
            return fh.read()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
