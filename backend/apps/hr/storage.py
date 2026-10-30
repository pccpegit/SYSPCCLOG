"""Private file storage for RR. HH. documents (SYSPCC-022).

Lives OUTSIDE MEDIA_ROOT and has no public URL: contracts hold PII (DNI,
salary, address) and must only leave the server through a permissioned view.
`HR_FILE_STORAGE` lets production swap this for a private bucket
(`PrivateS3Storage`, SYSPCC-024).
"""

import functools
import os
import uuid

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
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


@functools.lru_cache(maxsize=1)
def _build_private_s3_storage():
    """Build `PrivateS3Storage` on first use.

    django-storages pulls in boto3/botocore (~34 MB of RSS). Importing it at
    module level would tax every process that merely imports the HR models
    (local Docker) even though they never touch S3, so the class is
    created lazily and exposed through the module-level ``__getattr__``.
    """
    try:
        from storages.backends.s3 import S3Storage
    except ImportError as exc:  # pragma: no cover - requirements.txt pins it
        # Clear error for HR_FILE_STORAGE=...PrivateS3Storage on a stale image
        # (instead of an opaque "module has no attribute").
        raise ImproperlyConfigured(
            'PrivateS3Storage requires django-storages[s3] and boto3 (see requirements.txt).'
        ) from exc

    class PrivateS3Storage(S3Storage):
        """Private S3-compatible bucket (DigitalOcean Spaces) for HR files.

        Select with ``HR_FILE_STORAGE=apps.hr.storage.PrivateS3Storage``. The
        bucket comes from ``settings.HR_PRIVATE_BUCKET_NAME`` (a bucket
        separate from general media); endpoint and region are the shared AWS_*
        settings. Credentials default to the shared AWS_* pair too, but
        ``HR_AWS_ACCESS_KEY_ID`` / ``HR_AWS_SECRET_ACCESS_KEY`` (both or
        neither) give the PII bucket its own Spaces key, so a leak of the media
        key does not expose HR documents (least privilege). Objects are never public (ACL private) and the
        rare signed URL lives 60 s; the views stream through ``.open()``.
        Overwriting is disabled: the upload_to callables already generate
        random names, so a collision means a bug, not an update.
        """

        location = 'hr-private'
        default_acl = 'private'
        querystring_auth = True
        querystring_expire = 60
        file_overwrite = False

        def __init__(self, **kwargs):
            bucket = kwargs.get('bucket_name') or getattr(settings, 'HR_PRIVATE_BUCKET_NAME', '')
            if not bucket:
                raise ImproperlyConfigured(
                    'HR_PRIVATE_BUCKET_NAME is required when HR_FILE_STORAGE is PrivateS3Storage.'
                )
            kwargs['bucket_name'] = bucket

            access = getattr(settings, 'HR_AWS_ACCESS_KEY_ID', '')
            secret = getattr(settings, 'HR_AWS_SECRET_ACCESS_KEY', '')
            if bool(access) != bool(secret):
                raise ImproperlyConfigured(
                    'HR_AWS_ACCESS_KEY_ID and HR_AWS_SECRET_ACCESS_KEY must be set together.'
                )
            if access:
                kwargs.setdefault('access_key', access)
                kwargs.setdefault('secret_key', secret)
            super().__init__(**kwargs)

    PrivateS3Storage.__module__ = __name__
    return PrivateS3Storage


def __getattr__(name):
    # PEP 562: `from apps.hr.storage import PrivateS3Storage` and
    # `import_string('apps.hr.storage.PrivateS3Storage')` resolve here.
    if name == 'PrivateS3Storage':
        return _build_private_s3_storage()
    raise AttributeError(f'module {__name__!r} has no attribute {name!r}')


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
