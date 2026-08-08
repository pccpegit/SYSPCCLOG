"""
SYSPCC-016 FOLLOW-UP 3: CLIENT_ID, the auth tenant/authority, and the share
link scope must come from settings (ONEDRIVE_CLIENT_ID, ONEDRIVE_TENANT,
ONEDRIVE_SHARE_SCOPE), not be hardcoded/duplicated across
apps/warehouse/services/onedrive.py and apps/warehouse/views.py.
"""
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import override_settings

import pytest
from rest_framework.test import APIClient

from apps.warehouse.services.onedrive import OneDriveService, _authority, _client_id

User = get_user_model()


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


class TestClientIdAndAuthorityFromSettings:
    def test_client_id_reads_from_settings(self):
        with override_settings(ONEDRIVE_CLIENT_ID='custom-client-id'):
            assert _client_id() == 'custom-client-id'

    def test_authority_built_from_tenant_setting(self):
        with override_settings(ONEDRIVE_TENANT='organizations'):
            assert _authority() == 'https://login.microsoftonline.com/organizations'

        with override_settings(ONEDRIVE_TENANT='my-company-tenant-id'):
            assert _authority() == 'https://login.microsoftonline.com/my-company-tenant-id'

    def test_default_tenant_is_consumers(self):
        # No override — should match the documented default (personal MS accounts).
        assert _authority() == 'https://login.microsoftonline.com/consumers'

    def test_initiate_device_code_uses_settings_client_id_and_authority(self):
        with override_settings(ONEDRIVE_CLIENT_ID='custom-id', ONEDRIVE_TENANT='organizations'):
            with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
                mock_post.return_value = _FakeResponse(200, {'device_code': 'abc'})
                OneDriveService.initiate_device_code()

        args, kwargs = mock_post.call_args
        assert args[0] == 'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode'
        assert kwargs['data']['client_id'] == 'custom-id'


class TestShareScopeFromSettings:
    def test_uses_organization_scope_when_configured(self):
        with override_settings(ONEDRIVE_SHARE_SCOPE='organization'):
            with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
                mock_post.return_value = _FakeResponse(
                    200, {'link': {'webUrl': 'https://example.sharepoint.com/x'}}
                )
                OneDriveService._create_share_link('fake-token', 'item-123')

        _, kwargs = mock_post.call_args
        assert kwargs['json']['scope'] == 'organization'

    def test_uses_anonymous_scope_when_explicitly_configured(self):
        """Anonymous is opt-in via config, never a silent default — but once
        an operator sets it, _create_share_link must honor it."""
        with override_settings(ONEDRIVE_SHARE_SCOPE='anonymous'):
            with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
                mock_post.return_value = _FakeResponse(
                    200, {'link': {'webUrl': 'https://1drv.ms/x'}}
                )
                OneDriveService._create_share_link('fake-token', 'item-123')

        _, kwargs = mock_post.call_args
        assert kwargs['json']['scope'] == 'anonymous'

    def test_default_scope_is_organization_not_anonymous(self):
        """Regression guard: the default must stay the safer 'organization'
        value — 'anonymous' must always be an explicit config choice."""
        with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
            mock_post.return_value = _FakeResponse(
                200, {'link': {'webUrl': 'https://example.sharepoint.com/x'}}
            )
            OneDriveService._create_share_link('fake-token', 'item-123')

        _, kwargs = mock_post.call_args
        assert kwargs['json']['scope'] == 'organization'


@pytest.fixture
def admin_user(db):
    return User.objects.create_superuser(
        username='onedrive_settings_admin',
        email='onedrive_settings_admin@test.com',
        password='TestPass2026!',
    )


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestViewsPollUsesSettingsNotHardcodedLiterals:
    def test_poll_endpoint_uses_settings_client_id_and_tenant(self, admin_user):
        """apps/warehouse/views.py::poll() used to hardcode the same
        client_id/authority literals as services/onedrive.py — now both read
        from the same settings, so overriding settings changes both."""
        client = _client_for(admin_user)

        with override_settings(ONEDRIVE_CLIENT_ID='view-custom-id', ONEDRIVE_TENANT='organizations'):
            with mock.patch('requests.post') as mock_post:
                mock_post.return_value = _FakeResponse(200, {'error': 'authorization_pending'})
                response = client.post(
                    '/api/v1/warehouse/onedrive/poll/', {'device_code': 'abc123'}, format='json'
                )

        assert response.status_code == 200
        args, kwargs = mock_post.call_args
        assert args[0] == 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token'
        assert kwargs['data']['client_id'] == 'view-custom-id'
