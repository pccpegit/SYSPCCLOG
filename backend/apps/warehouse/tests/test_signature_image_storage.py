"""SYSPCC-024: the PDF signature is read through the storage API (S3-safe)."""

import io
from contextlib import contextmanager
from types import SimpleNamespace
from unittest import mock

from PIL import Image as PILImage
from reportlab.platypus import Image

from apps.warehouse.services.pdf_generator import _get_signature_image


def _png_bytes():
    buf = io.BytesIO()
    PILImage.new('RGBA', (20, 10), (0, 0, 0, 255)).save(buf, format='PNG')
    return buf.getvalue()


def _user_with_signature(open_side_effect=None):
    """Signature field whose `.path` raises, like S3 storages."""
    field = mock.MagicMock()
    field.__bool__.return_value = True
    type(field).path = mock.PropertyMock(side_effect=NotImplementedError('S3 has no path'))

    @contextmanager
    def _open(mode='rb'):
        if open_side_effect:
            raise open_side_effect
        yield io.BytesIO(_png_bytes())

    field.open.side_effect = _open
    return SimpleNamespace(signature=field), field


class TestGetSignatureImage:
    def test_reads_via_storage_open_without_touching_path(self):
        user, field = _user_with_signature()

        result = _get_signature_image(user)

        assert isinstance(result, Image)
        field.open.assert_called_once_with('rb')

    def test_no_user_or_no_signature_returns_empty(self):
        assert _get_signature_image(None) == ''
        assert _get_signature_image(SimpleNamespace(signature=None)) == ''

    def test_missing_file_returns_empty_without_error_log(self):
        user, _ = _user_with_signature(open_side_effect=FileNotFoundError())

        with mock.patch('apps.warehouse.services.pdf_generator.logger') as logger:
            assert _get_signature_image(user) == ''

        logger.warning.assert_not_called()

    def test_storage_errors_degrade_to_no_signature_and_log(self):
        user, _ = _user_with_signature(open_side_effect=OSError('spaces down'))

        with mock.patch('apps.warehouse.services.pdf_generator.logger') as logger:
            assert _get_signature_image(user) == ''

        logger.warning.assert_called_once()


class TestGetSignatureImageEdgeCases:
    """SYSPCC-024 (QA ronda 1)."""

    def test_empty_file_content_degrades_to_no_signature(self):
        user, field = _user_with_signature()

        @contextmanager
        def _empty(mode='rb'):
            yield io.BytesIO(b'')

        field.open.side_effect = _empty

        with mock.patch('apps.warehouse.services.pdf_generator.logger') as logger:
            assert _get_signature_image(user) == ''

        logger.warning.assert_called_once()

    def test_corrupt_image_degrades_to_no_signature(self):
        user, field = _user_with_signature()

        @contextmanager
        def _garbage(mode='rb'):
            yield io.BytesIO(b'not an image')

        field.open.side_effect = _garbage

        assert _get_signature_image(user) == ''

    def test_permission_error_from_storage_degrades_to_no_signature(self):
        user, _ = _user_with_signature(open_side_effect=PermissionError('403 from spaces'))

        with mock.patch('apps.warehouse.services.pdf_generator.logger') as logger:
            assert _get_signature_image(user) == ''

        logger.warning.assert_called_once()

    def test_returned_image_keeps_the_expected_box(self):
        user, _ = _user_with_signature()

        image = _get_signature_image(user)

        assert image.drawWidth <= 40 * 2.834645669 + 0.01
        assert image.drawHeight <= 15 * 2.834645669 + 0.01
