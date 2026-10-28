"""Private file storage for RR. HH. documents (SYSPCC-022).

Lives OUTSIDE MEDIA_ROOT and has no public URL: contracts hold PII (DNI,
salary, address) and must only leave the server through a permissioned view.
`HR_FILE_STORAGE` lets production swap this for a private bucket.
"""

import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.module_loading import import_string


class PrivateDocumentStorage(FileSystemStorage):
    """Filesystem storage rooted at settings.HR_PRIVATE_ROOT (read lazily so
    tests can override it) with owner-only permissions and no URL."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault('file_permissions_mode', 0o600)
        kwargs.setdefault('directory_permissions_mode', 0o700)
        super().__init__(*args, **kwargs)

    @property
    def base_location(self):
        return str(settings.HR_PRIVATE_ROOT)

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @property
    def base_url(self):
        return None

    def url(self, name):
        raise ValueError('Los documentos de RR. HH. no se sirven por URL.')


def get_private_storage():
    """Callable storage for FileFields (keeps migrations storage-agnostic)."""
    return import_string(settings.HR_FILE_STORAGE)()


def template_upload_to(instance, filename):
    # Never trust the uploaded name: a random one avoids traversal/collisions.
    return f'hr/templates/{uuid.uuid4().hex}.docx'


def document_docx_upload_to(instance, filename):
    return f'hr/documents/{uuid.uuid4().hex}.docx'


def document_pdf_upload_to(instance, filename):
    return f'hr/documents/{uuid.uuid4().hex}.pdf'


def cv_upload_to(instance, filename):
    """CV originals: random name, extension chosen by the service from the
    DETECTED mime (never from the uploaded name, which is also PII)."""
    ext = os.path.splitext(filename or '')[1].lower()
    if ext not in ('.pdf', '.docx', '.jpg', '.png'):
        ext = '.bin'
    return f'hr/cv/{uuid.uuid4().hex}{ext}'


def cv_report_upload_to(instance, filename):
    return f'hr/cv/reports/{uuid.uuid4().hex}.pdf'


def cv_posting_upload_to(instance, filename):
    """Job-posting originals (SYSPCC-023 iteration 2): random name, same extension
    rule as `cv_upload_to` (the real type is detected from the bytes)."""
    ext = os.path.splitext(filename or '')[1].lower()
    if ext not in ('.pdf', '.docx', '.jpg', '.png'):
        ext = '.bin'
    return f'hr/cv/postings/{uuid.uuid4().hex}{ext}'
