"""SYSPCC-024: /healthz/ answers before host validation and the HTTPS redirect."""

from unittest import mock

import pytest
from django.db import OperationalError
from django.test import Client, override_settings


@pytest.mark.django_db
class TestHealthz:
    def test_returns_200_json_when_database_is_up(self):
        response = Client().get('/healthz/')

        assert response.status_code == 200
        assert response.json() == {'status': 'ok'}
        assert response['Cache-Control'] == 'no-store'

    def test_head_is_supported(self):
        assert Client().head('/healthz/').status_code == 200

    def test_exempt_from_allowed_hosts(self):
        # A Host that is not in ALLOWED_HOSTS gets 400 from any other route.
        with override_settings(ALLOWED_HOSTS=['app.example.com']):
            health = Client().get('/healthz/', HTTP_HOST='10.244.1.7:8080')
            other = Client().get('/api/v1/auth/csrf/', HTTP_HOST='10.244.1.7:8080')

        assert health.status_code == 200
        assert other.status_code == 400

    def test_exempt_from_https_redirect(self):
        with override_settings(SECURE_SSL_REDIRECT=True, SECURE_REDIRECT_EXEMPT=[]):
            health = Client().get('/healthz/')
            other = Client().get('/api/v1/auth/csrf/')

        assert health.status_code == 200
        assert other.status_code == 301  # control: the redirect IS active

    def test_returns_503_when_database_is_down(self):
        with mock.patch('apps.core.middleware.connections') as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError('db down')
            response = Client().get('/healthz/')

        assert response.status_code == 503
        assert response.json() == {'status': 'error'}
        assert 'db down' not in response.content.decode()  # no internals leaked

    def test_non_get_methods_fall_through_to_normal_routing(self):
        assert Client().post('/healthz/').status_code == 404

    def test_is_first_middleware(self):
        from django.conf import settings

        assert settings.MIDDLEWARE[0] == 'apps.core.middleware.HealthCheckMiddleware'


@pytest.mark.django_db
class TestHealthzEdgeCases:
    """SYSPCC-024 (QA ronda 1): ramas adicionales del health check."""

    def test_without_trailing_slash_also_answers(self):
        response = Client().get('/healthz')

        assert response.status_code == 200
        assert response.json() == {'status': 'ok'}

    def test_head_returns_503_when_database_is_down(self):
        with mock.patch('apps.core.middleware.connections') as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError('db down')
            response = Client().head('/healthz/')

        assert response.status_code == 503

    def test_503_response_is_not_cacheable(self):
        with mock.patch('apps.core.middleware.connections') as connections:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError('db down')
            response = Client().get('/healthz/')

        assert response['Cache-Control'] == 'no-store'

    def test_database_failure_is_logged_for_operators(self):
        with mock.patch('apps.core.middleware.connections') as connections, \
                mock.patch('apps.core.middleware.logger') as logger:
            connections.__getitem__.return_value.cursor.side_effect = OperationalError('db down')
            Client().get('/healthz/')

        logger.exception.assert_called_once_with('healthz.database_unavailable')

    def test_probes_the_database_with_select_1(self):
        with mock.patch('apps.core.middleware.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            Client().get('/healthz/')

        connections.__getitem__.assert_called_with('default')
        cursor.execute.assert_called_once_with('SELECT 1')

    def test_not_subject_to_anonymous_throttling(self):
        # Platform probes hit it every few seconds; they must never get a 429
        # (the middleware answers before DRF throttling).
        statuses = {Client().get('/healthz/').status_code for _ in range(40)}

        assert statuses == {200}

    def test_requires_no_authentication_or_cookies(self):
        response = Client().get('/healthz/')

        assert response.status_code == 200
        assert not response.cookies  # no session/CSRF cookie issued

    def test_path_lookalikes_are_not_intercepted(self):
        for path in ('/healthz/extra/', '/healthzz/', '/api/healthz/'):
            assert Client().get(path).status_code == 404

    @pytest.mark.parametrize('method', ['post', 'put', 'patch', 'delete'])
    def test_unsafe_methods_are_not_answered_as_health(self, method):
        response = getattr(Client(), method)('/healthz/')

        assert response.status_code == 404


@pytest.mark.django_db
class TestProxyHeaderRedirectBehaviour:
    """SECURE_PROXY_SSL_HEADER: sin él, bucle 301; con él, la petición HTTPS pasa."""

    SETTINGS = dict(
        SECURE_SSL_REDIRECT=True,
        SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
        SECURE_REDIRECT_EXEMPT=[r'^healthz/?$'],
    )

    def test_https_forwarded_request_is_not_redirected(self):
        with override_settings(**self.SETTINGS):
            response = Client().get('/api/v1/auth/csrf/', HTTP_X_FORWARDED_PROTO='https')

        assert response.status_code != 301

    def test_plain_http_request_is_redirected_to_https(self):
        with override_settings(**self.SETTINGS):
            response = Client().get('/api/v1/auth/csrf/')

        assert response.status_code == 301
        assert response['Location'].startswith('https://')

    def test_forwarded_proto_http_is_redirected(self):
        with override_settings(**self.SETTINGS):
            response = Client().get('/api/v1/auth/csrf/', HTTP_X_FORWARDED_PROTO='http')

        assert response.status_code == 301

    def test_healthz_is_never_redirected_even_without_forwarded_proto(self):
        with override_settings(**self.SETTINGS):
            response = Client().get('/healthz/')

        assert response.status_code == 200
