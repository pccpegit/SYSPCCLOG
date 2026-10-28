"""SYSPCC-024: attachment download_url is resolved by the storage backend."""

from types import SimpleNamespace
from unittest import mock

import pytest
from rest_framework.test import APIRequestFactory

from apps.rq.serializers.attachment import AttachmentSerializer


def _url(file_path, request=None):
    serializer = AttachmentSerializer(context={'request': request} if request else {})
    return serializer.get_download_url(SimpleNamespace(pk=1, file_path=file_path))


class TestDownloadUrl:
    def test_uses_presigned_url_from_storage(self):
        signed = 'https://syspcc-media.nyc3.digitaloceanspaces.com/media/attachments/a.pdf?X-Amz-Signature=abc'
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            storage.url.return_value = signed

            result = _url('attachments/a.pdf', APIRequestFactory().get('/api/v1/attachments/'))

        storage.url.assert_called_once_with('attachments/a.pdf')
        assert result == signed  # absolute storage URLs are never rewritten

    def test_relative_storage_url_is_made_absolute_with_the_request(self):
        request = APIRequestFactory().get('/api/v1/attachments/', HTTP_HOST='testserver')
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            storage.url.return_value = '/media/attachments/a.pdf'

            result = _url('/attachments/a.pdf', request)

        storage.url.assert_called_once_with('attachments/a.pdf')  # leading slash stripped
        assert result == 'http://testserver/media/attachments/a.pdf'

    def test_filesystem_storage_keeps_previous_behaviour(self):
        request = APIRequestFactory().get('/', HTTP_HOST='testserver')

        assert _url('attachments/a.pdf', request) == 'http://testserver/media/attachments/a.pdf'
        assert _url('attachments/a.pdf') == '/media/attachments/a.pdf'

    def test_external_url_is_returned_untouched(self):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            assert _url('https://example.com/f.pdf') == 'https://example.com/f.pdf'
        storage.url.assert_not_called()

    def test_empty_path_returns_none(self):
        assert _url('') is None

    def test_storage_failure_does_not_break_the_listing(self):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            storage.url.side_effect = RuntimeError('spaces unreachable')

            assert _url('attachments/a.pdf') is None


class TestDownloadUrlEdgeCases:
    """SYSPCC-024 (QA ronda 1)."""

    @pytest.mark.parametrize('path', ['HTTP://example.com/f.pdf', 'https://example.com/f.pdf'])
    def test_external_urls_are_case_insensitive_and_untouched(self, path):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            assert _url(path) == path
        storage.url.assert_not_called()

    def test_none_path_returns_none(self):
        assert _url(None) is None

    def test_failure_is_logged_with_the_attachment_id(self):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage, \
                mock.patch('apps.rq.serializers.attachment.logger') as logger:
            storage.url.side_effect = RuntimeError('boom')
            _url('attachments/a.pdf')

        logger.exception.assert_called_once()
        assert logger.exception.call_args.args[-1] == 1

    def test_signed_relative_style_url_without_request_is_returned_as_is(self):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            storage.url.return_value = '/media/attachments/a.pdf?sig=1'

            assert _url('attachments/a.pdf') == '/media/attachments/a.pdf?sig=1'

    def test_nested_path_is_passed_verbatim_to_the_storage(self):
        with mock.patch('apps.rq.serializers.attachment.default_storage') as storage:
            storage.url.return_value = 'https://x/y'
            _url('attachments/2026/10/rq 12 cotización.pdf')

        storage.url.assert_called_once_with('attachments/2026/10/rq 12 cotización.pdf')
