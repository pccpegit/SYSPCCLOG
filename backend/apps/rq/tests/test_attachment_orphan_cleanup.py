"""
SYSPCC-013 FIX 6: AttachmentSerializer.create() must not leave an orphaned
file in storage if the Attachment row fails to create.

Before the fix, `default_storage.save(...)` ran first, then `super().create()`
(the DB insert) ran after — if the DB insert raised for any reason
(IntegrityError, an unexpected DB failure, ...), the file was already
persisted to storage with nothing in the DB referencing it: a permanent
orphan with no cleanup path.
"""
from unittest import mock

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError

from apps.rq.models import Attachment
from apps.rq.serializers.attachment import AttachmentSerializer


@pytest.mark.django_db
class TestAttachmentOrphanCleanup:
    def test_file_is_deleted_when_create_fails(self, ops_request, requester, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        upload = SimpleUploadedFile(
            'nota.pdf', b'%PDF-1.4 minimal test content', content_type='application/pdf',
        )
        serializer = AttachmentSerializer()
        validated_data = {
            'request': ops_request,
            'uploaded_by': requester,
            'category': 'otros',
            'file': upload,
        }

        original_save = default_storage.save
        saved_paths = []

        def spy_save(name, content, *args, **kwargs):
            path = original_save(name, content, *args, **kwargs)
            saved_paths.append(path)
            return path

        with mock.patch.object(default_storage, 'save', side_effect=spy_save):
            with mock.patch.object(Attachment.objects, 'create', side_effect=IntegrityError('simulated')):
                with pytest.raises(IntegrityError):
                    serializer.create(validated_data)

        assert len(saved_paths) == 1, 'the file must have been written to storage before the DB failure'
        assert not default_storage.exists(saved_paths[0]), (
            'the orphaned file must be deleted after create() fails'
        )
        assert Attachment.objects.count() == 0

    def test_file_persists_when_create_succeeds(self, ops_request, requester, settings, tmp_path):
        """Sanity check: the happy path must NOT delete the file it just saved."""
        settings.MEDIA_ROOT = str(tmp_path)
        upload = SimpleUploadedFile(
            'nota.pdf', b'%PDF-1.4 minimal test content', content_type='application/pdf',
        )
        serializer = AttachmentSerializer()
        validated_data = {
            'request': ops_request,
            'uploaded_by': requester,
            'category': 'otros',
            'file': upload,
        }

        attachment = serializer.create(validated_data)

        assert Attachment.objects.filter(pk=attachment.pk).exists()
        assert default_storage.exists(attachment.file_path)
