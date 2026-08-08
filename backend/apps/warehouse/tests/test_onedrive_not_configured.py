"""
SYSPCC-017: ONEDRIVE_CLIENT_ID no longer has a version-controlled default —
it is '' unless an operator sets it. The OneDrive integration is optional, so
`connect`/`poll` must fail with a clear, specific "no configurado" error
instead of crashing or letting an empty client_id reach Microsoft Graph.
`status` must stay usable (read-only) and report whether it's configured.
"""
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status as http_status
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture
def admin_user(db):
    return User.objects.create_superuser(
        username='onedrive_not_configured_admin',
        email='onedrive_not_configured_admin@test.com',
        password='TestPass2026!',
    )


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestConnectNotConfigured:
    @override_settings(ONEDRIVE_CLIENT_ID='')
    def test_connect_returns_503_with_clear_message(self, admin_user):
        client = _client_for(admin_user)

        with mock.patch(
            'apps.warehouse.views.OneDriveService.initiate_device_code'
        ) as mock_initiate:
            response = client.post('/api/v1/warehouse/onedrive/connect/')

        assert response.status_code == http_status.HTTP_503_SERVICE_UNAVAILABLE
        assert 'no está configurado' in response.data['detail']
        # Must fail fast — never reach out to Microsoft with an empty client_id.
        mock_initiate.assert_not_called()


@pytest.mark.django_db
class TestPollNotConfigured:
    @override_settings(ONEDRIVE_CLIENT_ID='')
    def test_poll_returns_503_with_clear_message(self, admin_user):
        client = _client_for(admin_user)

        with mock.patch('requests.post') as mock_post:
            response = client.post(
                '/api/v1/warehouse/onedrive/poll/', {'device_code': 'abc123'}, format='json'
            )

        assert response.status_code == http_status.HTTP_503_SERVICE_UNAVAILABLE
        assert 'no está configurado' in response.data['detail']
        mock_post.assert_not_called()

    @override_settings(ONEDRIVE_CLIENT_ID='')
    def test_poll_checks_configuration_before_device_code(self, admin_user):
        """Even with no device_code in the payload, the config check must be
        what's reported — a clearer, more actionable error for an
        unconfigured integration than a generic 400."""
        client = _client_for(admin_user)
        response = client.post('/api/v1/warehouse/onedrive/poll/', {}, format='json')
        assert response.status_code == http_status.HTTP_503_SERVICE_UNAVAILABLE


@pytest.mark.django_db
class TestStatusReportsConfiguredFlag:
    @override_settings(ONEDRIVE_CLIENT_ID='')
    def test_status_reports_not_configured(self, admin_user):
        client = _client_for(admin_user)
        response = client.get('/api/v1/warehouse/onedrive/status/')
        assert response.status_code == http_status.HTTP_200_OK
        assert response.data['configured'] is False

    @override_settings(ONEDRIVE_CLIENT_ID='some-client-id')
    def test_status_reports_configured(self, admin_user):
        client = _client_for(admin_user)
        response = client.get('/api/v1/warehouse/onedrive/status/')
        assert response.status_code == http_status.HTTP_200_OK
        assert response.data['configured'] is True

    @override_settings(ONEDRIVE_CLIENT_ID='')
    def test_status_still_works_when_not_configured(self, admin_user):
        """status is read-only and must never require the integration to be
        configured — it's how the frontend discovers that it isn't."""
        client = _client_for(admin_user)
        response = client.get('/api/v1/warehouse/onedrive/status/')
        assert response.status_code == http_status.HTTP_200_OK
        assert response.data['connected'] is False
