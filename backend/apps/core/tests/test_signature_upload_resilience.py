"""
SYSPCC-012 FIX 2: UserViewSet.manage_signature must:
  - reject a non-image upload with a controlled 400 (not leak str(exc));
  - reject an oversized upload with a 400 BEFORE handing it to Pillow, so we
    never decode an arbitrarily large file into memory;
  - log unexpected failures via logger.exception, expected ones via
    logger.warning.
"""
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.views.user import MAX_SIGNATURE_FILE_SIZE_BYTES


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestSignatureUploadInvalidImage:
    def test_non_image_file_returns_400_not_500(self, user):
        client = _client_for(user)
        upload = SimpleUploadedFile('note.txt', b'this is definitely not an image', content_type='text/plain')

        response = client.post('/api/v1/users/me/signature/', {'file': upload}, format='multipart')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # Must not leak raw exception internals (str(exc)) to the client.
        assert 'Traceback' not in str(response.data)

    def test_non_image_file_logs_warning_not_exception(self, user):
        client = _client_for(user)
        upload = SimpleUploadedFile('note.txt', b'garbage', content_type='text/plain')

        with mock.patch('apps.core.views.user.logger.warning') as mock_warning, \
             mock.patch('apps.core.views.user.logger.exception') as mock_exception:
            client.post('/api/v1/users/me/signature/', {'file': upload}, format='multipart')

        mock_warning.assert_called_once()
        assert mock_warning.call_args[0][0] == 'signature.upload.invalid_image'
        mock_exception.assert_not_called()

    def test_invalid_base64_signature_data_returns_400(self, user):
        client = _client_for(user)

        response = client.post(
            '/api/v1/users/me/signature/',
            {'signature_data': 'data:image/png;base64,not-valid-base64!!!'},
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestSignatureUploadSizeLimit:
    def test_oversized_file_rejected_before_processing(self, user):
        """The size check must happen before process_signature_image() is
        ever called — patch it and assert it's never invoked."""
        client = _client_for(user)
        big_content = b'\x89PNG\r\n\x1a\n' + b'0' * (MAX_SIGNATURE_FILE_SIZE_BYTES + 1)
        upload = SimpleUploadedFile('huge.png', big_content, content_type='image/png')

        with mock.patch('apps.core.services.signature.process_signature_image') as mock_process:
            response = client.post('/api/v1/users/me/signature/', {'file': upload}, format='multipart')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert f'{MAX_SIGNATURE_FILE_SIZE_BYTES // (1024 * 1024)} MB' in response.data['detail']
        mock_process.assert_not_called()

    def test_file_within_limit_is_not_rejected_by_size_check(self, user):
        """A file just under the limit must reach the processing step (which
        may still reject it for not being a decodable image — that's the
        UnidentifiedImageError path, not the size path)."""
        client = _client_for(user)
        small_content = b'\x89PNG\r\n\x1a\n' + b'0' * 1000
        upload = SimpleUploadedFile('small.png', small_content, content_type='image/png')

        with mock.patch('apps.core.services.signature.process_signature_image') as mock_process:
            mock_process.side_effect = ValueError('boom - not a real PNG payload in this test')
            response = client.post('/api/v1/users/me/signature/', {'file': upload}, format='multipart')

        mock_process.assert_called_once()
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestSignatureUploadUnexpectedError:
    def test_unexpected_exception_returns_500_and_logs_exception(self, user):
        client = _client_for(user)
        upload = SimpleUploadedFile('small.png', b'\x89PNG\r\n\x1a\n' + b'0' * 100, content_type='image/png')

        with mock.patch('apps.core.services.signature.process_signature_image') as mock_process, \
             mock.patch('apps.core.views.user.logger.exception') as mock_exception:
            mock_process.side_effect = RuntimeError('unexpected infra failure')
            response = client.post('/api/v1/users/me/signature/', {'file': upload}, format='multipart')

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        mock_exception.assert_called_once()
        assert mock_exception.call_args[0][0] == 'signature.upload.unexpected'
        # Never echo the raw exception message to the client.
        assert 'unexpected infra failure' not in str(response.data)
