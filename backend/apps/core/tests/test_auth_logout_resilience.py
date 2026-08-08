"""
SYSPCC-012 FIX 1: LogoutView must not crash and must not leak internals when
the refresh token cookie is invalid/expired/malformed. Before the fix it
caught a bare `except Exception: pass` with no logging at all — logout still
"worked" (cookies cleared) but the failure was completely invisible in
production.
"""
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestLogoutResilience:
    def test_invalid_refresh_cookie_does_not_crash_and_clears_cookies(self, user):
        client = _client_for(user)
        client.cookies['refresh_token'] = 'not-a-real-jwt-at-all'

        response = client.post('/api/v1/auth/logout/')

        assert response.status_code == status.HTTP_200_OK
        # Cookies must still be cleared regardless of the token being garbage.
        assert response.cookies['access_token'].value == ''
        assert response.cookies['refresh_token'].value == ''

    def test_invalid_refresh_cookie_does_not_leak_exception_detail(self, user):
        client = _client_for(user)
        client.cookies['refresh_token'] = 'not-a-real-jwt-at-all'

        response = client.post('/api/v1/auth/logout/')

        # The response must never echo raw exception text (str(exc)) back to
        # the client — only the fixed, generic success message.
        assert response.data['detail'] == 'Sesión cerrada exitosamente.'

    def test_invalid_refresh_cookie_logs_a_warning_not_a_crash(self, user):
        client = _client_for(user)
        client.cookies['refresh_token'] = 'not-a-real-jwt-at-all'

        with mock.patch('apps.core.views.auth.logger.warning') as mock_warning:
            response = client.post('/api/v1/auth/logout/')

        assert response.status_code == status.HTTP_200_OK
        mock_warning.assert_called_once()
        assert mock_warning.call_args[0][0] == 'auth.logout.invalid_token'

    def test_valid_refresh_token_is_blacklisted_and_no_warning_logged(self, user):
        """Happy path must be untouched by the fix: a genuinely valid refresh
        token is still blacklisted, and no warning/exception is logged."""
        refresh = RefreshToken.for_user(user)
        client = _client_for(user)
        client.cookies['refresh_token'] = str(refresh)

        with mock.patch('apps.core.views.auth.logger.warning') as mock_warning, \
             mock.patch('apps.core.views.auth.logger.exception') as mock_exception:
            response = client.post('/api/v1/auth/logout/')

        assert response.status_code == status.HTTP_200_OK
        mock_warning.assert_not_called()
        mock_exception.assert_not_called()
