"""
SYSPCC-012 FIX 2: OneDriveViewSet.connect/poll must not leak raw exception
text (str(exc)) to the client, and must log the failure with logger.exception
for production traceability instead of disappearing after a generic 500.
"""
from unittest import mock

import pytest
import requests
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture
def admin_user(db):
    return User.objects.create_superuser(
        username='onedrive_admin',
        email='onedrive_admin@test.com',
        password='TestPass2026!',
    )


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestOneDriveConnectErrorHandling:
    def test_connect_failure_returns_generic_message_and_logs_exception(self, admin_user):
        client = _client_for(admin_user)

        with mock.patch(
            'apps.warehouse.views.OneDriveService.initiate_device_code',
            side_effect=requests.RequestException('connection refused to login.microsoftonline.com'),
        ), mock.patch('apps.warehouse.views.logger.exception') as mock_exception:
            response = client.post('/api/v1/warehouse/onedrive/connect/')

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert 'connection refused' not in str(response.data)
        mock_exception.assert_called_once()
        assert mock_exception.call_args[0][0] == 'onedrive.connect.failed'


@pytest.mark.django_db
class TestOneDrivePollErrorHandling:
    def test_poll_failure_returns_generic_message_and_logs_exception(self, admin_user):
        client = _client_for(admin_user)

        # `poll` does `import requests as http_requests` locally, then calls
        # `http_requests.post(...)` — that's just an alias for the real
        # `requests` module, so patching `requests.post` intercepts it.
        with mock.patch(
            'requests.post', side_effect=requests.RequestException('timeout'),
        ), mock.patch('apps.warehouse.views.logger.exception') as mock_exception:
            response = client.post(
                '/api/v1/warehouse/onedrive/poll/', {'device_code': 'abc123'}, format='json'
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert 'timeout' not in str(response.data)
        mock_exception.assert_called_once()
        assert mock_exception.call_args[0][0] == 'onedrive.poll.failed'

    def test_poll_missing_device_code_returns_400(self, admin_user):
        client = _client_for(admin_user)
        response = client.post('/api/v1/warehouse/onedrive/poll/', {}, format='json')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
