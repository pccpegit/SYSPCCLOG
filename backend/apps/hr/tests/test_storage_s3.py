"""SYSPCC-024: PrivateS3Storage (RR. HH. files in a private Spaces bucket)."""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.hr import storage as hr_storage
from apps.hr.storage import PrivateDocumentStorage, PrivateS3Storage, get_private_storage


@pytest.fixture
def s3_settings(settings):
    settings.HR_PRIVATE_BUCKET_NAME = 'syspcc-hr-private'
    settings.AWS_S3_ENDPOINT_URL = 'https://nyc3.digitaloceanspaces.com'
    settings.AWS_S3_REGION_NAME = 'nyc3'
    settings.AWS_ACCESS_KEY_ID = 'AKID'
    settings.AWS_SECRET_ACCESS_KEY = 'SECRET'
    return settings


class TestPrivateS3Storage:
    def test_is_private_and_short_lived(self, s3_settings):
        storage = PrivateS3Storage()

        assert storage.bucket_name == 'syspcc-hr-private'
        assert storage.location == 'hr-private'
        assert storage.default_acl == 'private'
        assert storage.querystring_auth is True
        assert storage.querystring_expire == 60
        assert storage.file_overwrite is False

    def test_not_affected_by_media_bucket_settings(self, s3_settings):
        s3_settings.AWS_STORAGE_BUCKET_NAME = 'syspcc-media'
        s3_settings.AWS_QUERYSTRING_EXPIRE = 3600
        s3_settings.AWS_DEFAULT_ACL = 'public-read'

        storage = PrivateS3Storage()

        assert storage.bucket_name == 'syspcc-hr-private'
        assert storage.querystring_expire == 60
        assert storage.default_acl == 'private'

    def test_requires_a_bucket(self, settings):
        settings.HR_PRIVATE_BUCKET_NAME = ''

        with pytest.raises(ImproperlyConfigured, match='HR_PRIVATE_BUCKET_NAME'):
            PrivateS3Storage()

    def test_signed_url_is_generated_offline_with_expiry(self, s3_settings):
        url = PrivateS3Storage().url('hr/templates/abc.docx')

        assert url.startswith('https://')
        assert 'hr-private/hr/templates/abc.docx' in url
        assert 'X-Amz-Signature' in url
        assert 'X-Amz-Expires=60' in url


class TestStorageSelection:
    def test_default_is_filesystem(self, settings):
        assert settings.HR_FILE_STORAGE == 'apps.hr.storage.PrivateDocumentStorage'
        assert isinstance(get_private_storage(), PrivateDocumentStorage)

    def test_hr_file_storage_setting_selects_s3(self, s3_settings):
        s3_settings.HR_FILE_STORAGE = 'apps.hr.storage.PrivateS3Storage'

        assert isinstance(get_private_storage(), PrivateS3Storage)

    def test_filesystem_storage_still_has_no_url(self):
        with pytest.raises(ValueError):
            PrivateDocumentStorage().url('hr/x.docx')

    def test_module_exposes_the_class(self):
        assert hr_storage.PrivateS3Storage is PrivateS3Storage


class TestPrivateS3StorageEdgeCases:
    """SYSPCC-024 (QA ronda 1)."""

    def test_explicit_bucket_kwarg_wins_over_settings(self, s3_settings):
        assert PrivateS3Storage(bucket_name='other').bucket_name == 'other'

    def test_bucket_missing_in_settings_attribute_raises(self, settings):
        del settings.HR_PRIVATE_BUCKET_NAME

        with pytest.raises(ImproperlyConfigured):
            PrivateS3Storage()

    def test_signed_url_never_embeds_the_secret_key(self, s3_settings):
        url = PrivateS3Storage().url('hr/cv/a.pdf')

        assert 'SECRET' not in url
        assert 'AKID' in url  # only the public access key id is part of the credential scope

    def test_get_private_storage_is_resolved_lazily_per_call(self, s3_settings):
        s3_settings.HR_FILE_STORAGE = 'apps.hr.storage.PrivateDocumentStorage'
        first = get_private_storage()
        s3_settings.HR_FILE_STORAGE = 'apps.hr.storage.PrivateS3Storage'
        second = get_private_storage()

        assert isinstance(first, PrivateDocumentStorage)
        assert isinstance(second, PrivateS3Storage)

    def test_unknown_storage_path_fails_with_import_error(self, settings):
        settings.HR_FILE_STORAGE = 'apps.hr.storage.DoesNotExist'

        with pytest.raises(ImportError):
            get_private_storage()

    def test_save_goes_to_the_hr_bucket_with_private_acl_and_random_name(self, s3_settings):
        from unittest import mock
        from django.core.files.base import ContentFile

        storage = PrivateS3Storage()
        fake_object = mock.MagicMock()
        fake_bucket = mock.MagicMock()
        fake_bucket.Object.return_value = fake_object
        fake_bucket.name = 'syspcc-hr-private'
        with mock.patch.object(PrivateS3Storage, 'bucket', fake_bucket, create=True), \
                mock.patch.object(PrivateS3Storage, 'exists', return_value=False):
            name = storage.save('hr/contracts/c1.docx', ContentFile(b'data'))

        assert name == 'hr/contracts/c1.docx'
        fake_bucket.Object.assert_called_with('hr-private/hr/contracts/c1.docx')
        extra = fake_object.upload_fileobj.call_args.kwargs['ExtraArgs']
        assert extra.get('ACL') == 'private'


class TestPrivateS3StorageDedicatedKey:
    """SYSPCC-024 (least privilege): the PII bucket may use its own key pair."""

    def test_defaults_to_the_shared_aws_key(self, s3_settings):
        storage = PrivateS3Storage()

        assert storage.access_key == 'AKID'
        assert storage.secret_key == 'SECRET'

    def test_dedicated_hr_key_pair_wins(self, s3_settings):
        s3_settings.HR_AWS_ACCESS_KEY_ID = 'HR-AKID'
        s3_settings.HR_AWS_SECRET_ACCESS_KEY = 'HR-SECRET'

        storage = PrivateS3Storage()

        assert storage.access_key == 'HR-AKID'
        assert storage.secret_key == 'HR-SECRET'
        assert 'X-Amz-Credential=HR-AKID' in storage.url('hr/x.docx')

    @pytest.mark.parametrize('only', ['HR_AWS_ACCESS_KEY_ID', 'HR_AWS_SECRET_ACCESS_KEY'])
    def test_half_a_pair_is_rejected(self, s3_settings, only):
        setattr(s3_settings, only, 'x')

        with pytest.raises(ImproperlyConfigured, match='HR_AWS_ACCESS_KEY_ID'):
            PrivateS3Storage()
