"""
Attachment serializer with file type/size validation.
FIX-10: Validates allowed extensions and maximum file size.
FIX-11: Uses explicit field list; excludes raw file_path; exposes download_url instead.
"""

import logging
import os
import magic  # python-magic for content-type sniffing
from django.conf import settings
from rest_framework import serializers
from apps.rq.models import Attachment

logger = logging.getLogger(__name__)


# FIX-10: Allowed file extensions (lowercase, with leading dot)
ALLOWED_EXTENSIONS = {'.pdf', '.xlsx', '.xls', '.jpg', '.jpeg', '.png', '.doc', '.docx'}

# FIX-10: Maximum file size — 10 MB
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

# Mapping of extension to acceptable MIME type prefixes / exact types
ALLOWED_MIME_TYPES = {
    '.pdf': ['application/pdf'],
    '.xlsx': [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',  # some tools report OOXML as zip
    ],
    '.xls': ['application/vnd.ms-excel'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.png': ['image/png'],
    '.doc': ['application/msword'],
    '.docx': [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
    ],
}


class AttachmentSerializer(serializers.ModelSerializer):
    """
    Serializer for Attachment objects.

    - Accepts an uploaded file via the 'file' field (FileField on the model is expected,
      or the upload is handled by the view and file_path / file_name populated manually).
    - Validates extension and real MIME type (content sniffing via python-magic).
    - Does NOT expose the raw file_path to API consumers.
    - Exposes a computed download_url instead.
    """

    uploaded_by_name = serializers.CharField(source='uploaded_by.get_full_name', read_only=True)

    # FIX-11: Computed download URL instead of exposing raw file_path
    download_url = serializers.SerializerMethodField()

    # Accept file uploads; write-only so the path is never echoed back
    file = serializers.FileField(write_only=True, required=False)

    class Meta:
        model = Attachment
        # FIX-11: Explicit field list — file_path intentionally excluded
        fields = [
            'id',
            'request',
            'uploaded_by',
            'uploaded_by_name',
            'file_name',
            'file_type',
            'file_size',
            'category',
            'description',
            'uploaded_at',
            'file',
            'download_url',
        ]
        read_only_fields = ['uploaded_at', 'uploaded_by', 'file_name', 'file_type', 'file_size']

    def get_download_url(self, obj) -> str | None:
        """Build a signed or relative URL for downloading the attachment."""
        if not obj.file_path:
            return None
        request = self.context.get('request')
        media_url = settings.MEDIA_URL.rstrip('/')
        relative = obj.file_path.lstrip('/')
        url = f'{media_url}/{relative}'
        if request is not None:
            return request.build_absolute_uri(url)
        return url

    def validate_file(self, value):
        """
        FIX-10: Validate file extension and actual MIME type (content sniffing).
        Also enforce maximum file size.
        """
        if value is None:
            return value

        # --- Size check ---
        if value.size > MAX_FILE_SIZE_BYTES:
            raise serializers.ValidationError(
                f'El archivo supera el tamaño máximo permitido de '
                f'{MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.'
            )

        # --- Extension check ---
        _, ext = os.path.splitext(value.name.lower())
        if ext not in ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                f'Extensión "{ext}" no permitida. '
                f'Extensiones válidas: {", ".join(sorted(ALLOWED_EXTENSIONS))}.'
            )

        # --- Content (MIME) sniffing ---
        # Read only the first 2 KB to determine real MIME type
        header = value.read(2048)
        value.seek(0)  # Reset for subsequent processing

        try:
            detected_mime = magic.from_buffer(header, mime=True)
        except Exception:
            raise serializers.ValidationError(
                'No se pudo determinar el tipo de contenido del archivo.'
            )

        allowed_mimes = ALLOWED_MIME_TYPES.get(ext, [])
        if detected_mime not in allowed_mimes:
            raise serializers.ValidationError(
                f'El contenido del archivo no coincide con la extensión "{ext}". '
                f'Tipo detectado: {detected_mime}.'
            )

        return value

    def create(self, validated_data):
        uploaded_file = validated_data.pop('file', None)
        saved_path = None

        if uploaded_file is not None:
            import os as _os
            validated_data['file_name'] = uploaded_file.name
            validated_data['file_size'] = uploaded_file.size
            _, ext = _os.path.splitext(uploaded_file.name.lower())
            # Store the MIME type derived from the extension map
            validated_data['file_type'] = ext.lstrip('.')

            # Persist the file to MEDIA_ROOT/attachments/
            from django.core.files.storage import default_storage
            from django.core.files.base import ContentFile
            save_path = f'attachments/{uploaded_file.name}'
            saved_path = default_storage.save(save_path, ContentFile(uploaded_file.read()))
            validated_data['file_path'] = saved_path

        try:
            return super().create(validated_data)
        except Exception:
            # SYSPCC-013 FIX 6: the file is already on disk/storage at this
            # point (saved above). If the Attachment row fails to create
            # (DB error, validation raised late, etc.) that file becomes an
            # orphan with nothing referencing it — delete it before
            # re-raising so the storage stays in sync with the DB.
            # Last barrier for this branch: log with stack, clean up, re-raise
            # (the caller/DRF exception handler is still responsible for the
            # HTTP-facing error response).
            logger.exception(
                'attachment.create.failed_after_file_saved',
                extra={'saved_path': saved_path},
            )
            if saved_path is not None:
                default_storage.delete(saved_path)
            raise
