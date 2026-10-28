"""SYSPCC-024: production/demo settings under a controlled environment.

Each case imports the settings module in a SUBPROCESS with a from-scratch env
and python-decouple pointed at an empty repository (so a developer's local
`.env` cannot leak in). That avoids reloading settings inside the pytest
process and contaminating other tests.
"""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[3]

BASE_ENV = {
    'SECRET_KEY': 'test-secret-key-not-for-production',
    'DJANGO_ENV': 'production',
    'DB_NAME': 'syspcc',
    'DB_USER': 'syspcc',
    'DB_PASSWORD': 'pw',
    'DB_HOST': 'db.internal',
    'ALLOWED_HOSTS': 'app.example.com',
    'CSRF_TRUSTED_ORIGINS': 'https://app.example.com',
}

HEADER = """
import importlib, json, os, ssl, sys
sys.path.insert(0, {backend!r})
import decouple
decouple.config = decouple.Config(decouple.RepositoryEmpty())
module = importlib.import_module(os.environ['DJANGO_SETTINGS_MODULE'])
out = {{}}
"""
FOOTER = "\nprint('@@RESULT@@' + json.dumps(out, default=str))\n"


def load(module, env=None, probe=''):
    """Import `module` with BASE_ENV + env; return the dict filled by `probe`."""
    full_env = {'PATH': os.environ.get('PATH', ''), **BASE_ENV, **(env or {})}
    full_env['DJANGO_SETTINGS_MODULE'] = module
    script = HEADER.format(backend=str(BACKEND_DIR)) + textwrap.dedent(probe) + FOOTER
    proc = subprocess.run(
        [sys.executable, '-I', '-c', script],
        env=full_env, capture_output=True, text=True, timeout=120, cwd=str(BACKEND_DIR),
    )
    assert proc.returncode == 0, proc.stderr
    line = next(ln for ln in proc.stdout.splitlines() if ln.startswith('@@RESULT@@'))
    return json.loads(line[len('@@RESULT@@'):])


def attrs(*names):
    return '\n'.join(f"out[{n!r}] = getattr(module, {n!r}, None)" for n in names)


PROD = 'config.settings.production'
DEMO = 'config.settings.demo'


class TestProxyAndHealth:
    def test_proxy_ssl_header_and_healthz_redirect_exemption(self):
        out = load(PROD, probe=attrs('SECURE_PROXY_SSL_HEADER', 'SECURE_REDIRECT_EXEMPT', 'SECURE_SSL_REDIRECT'))

        assert out['SECURE_PROXY_SSL_HEADER'] == ['HTTP_X_FORWARDED_PROTO', 'https']
        assert out['SECURE_REDIRECT_EXEMPT'] == [r'^healthz/?$']
        assert out['SECURE_SSL_REDIRECT'] is True

    def test_healthcheck_is_first_middleware(self):
        out = load(PROD, probe=attrs('MIDDLEWARE'))

        assert out['MIDDLEWARE'][0] == 'apps.core.middleware.HealthCheckMiddleware'


class TestWhiteNoise:
    def test_production_has_whitenoise_once_after_security(self):
        out = load(PROD, probe=attrs('MIDDLEWARE', 'STORAGES'))
        mw = out['MIDDLEWARE']

        assert mw.count('whitenoise.middleware.WhiteNoiseMiddleware') == 1
        assert mw.index('whitenoise.middleware.WhiteNoiseMiddleware') == (
            mw.index('django.middleware.security.SecurityMiddleware') + 1
        )
        assert out['STORAGES']['staticfiles']['BACKEND'] == 'whitenoise.storage.CompressedManifestStaticFilesStorage'

    def test_demo_loads_without_aws_vars_and_whitenoise_appears_once(self):
        out = load(DEMO, probe=attrs('MIDDLEWARE', 'STORAGES', 'REST_FRAMEWORK', 'EMAIL_BACKEND', 'ROOT_URLCONF', 'CACHES'))

        assert out['MIDDLEWARE'].count('whitenoise.middleware.WhiteNoiseMiddleware') == 1
        assert out['STORAGES']['default'] == {'BACKEND': 'django.core.files.storage.FileSystemStorage'}
        assert out['STORAGES']['staticfiles']['BACKEND'] == 'whitenoise.storage.CompressedManifestStaticFilesStorage'
        # Render keeps its own behaviour.
        assert out['REST_FRAMEWORK']['NUM_PROXIES'] == 1
        assert out['EMAIL_BACKEND'].endswith('console.EmailBackend')
        assert out['ROOT_URLCONF'] == 'config.urls_demo'
        assert out['CACHES']['default']['BACKEND'].endswith('LocMemCache')


class TestMediaStorageSelection:
    def test_filesystem_media_when_no_bucket(self):
        out = load(PROD, probe=attrs('STORAGES', 'AWS_STORAGE_BUCKET_NAME'))

        assert out['STORAGES']['default'] == {'BACKEND': 'django.core.files.storage.FileSystemStorage'}
        assert out['AWS_STORAGE_BUCKET_NAME'] == ''

    def test_spaces_when_bucket_is_set(self):
        env = {
            'AWS_STORAGE_BUCKET_NAME': 'syspcc-media',
            'AWS_ACCESS_KEY_ID': 'AKID',
            'AWS_SECRET_ACCESS_KEY': 'SECRET',
            'AWS_S3_ENDPOINT_URL': 'https://nyc3.digitaloceanspaces.com',
            'AWS_S3_REGION_NAME': 'nyc3',
        }
        out = load(PROD, env, probe=attrs(
            'STORAGES', 'AWS_S3_ENDPOINT_URL', 'AWS_S3_REGION_NAME', 'AWS_S3_SIGNATURE_VERSION',
        ))
        default = out['STORAGES']['default']

        assert default['BACKEND'] == 'storages.backends.s3.S3Storage'
        assert default['OPTIONS'] == {
            'bucket_name': 'syspcc-media',
            'location': 'media',
            'default_acl': 'private',
            'querystring_auth': True,
            'querystring_expire': 3600,
            'file_overwrite': False,
        }
        assert out['AWS_S3_ENDPOINT_URL'] == 'https://nyc3.digitaloceanspaces.com'
        assert out['AWS_S3_REGION_NAME'] == 'nyc3'
        assert out['AWS_S3_SIGNATURE_VERSION'] == 's3v4'

    def test_storages_instantiate_without_network(self):
        env = {
            'AWS_STORAGE_BUCKET_NAME': 'syspcc-media',
            'AWS_ACCESS_KEY_ID': 'AKID',
            'AWS_SECRET_ACCESS_KEY': 'SECRET',
            'AWS_S3_ENDPOINT_URL': 'https://nyc3.digitaloceanspaces.com',
            'HR_FILE_STORAGE': 'apps.hr.storage.PrivateS3Storage',
            'HR_PRIVATE_BUCKET_NAME': 'syspcc-hr-private',
        }
        probe = '''
            import django
            django.setup()
            from django.core.files.storage import storages
            from apps.hr.storage import get_private_storage
            media = storages['default']
            hr = get_private_storage()
            out['media'] = [type(media).__name__, media.bucket_name, media.location, media.default_acl, media.querystring_expire]
            out['hr'] = [type(hr).__name__, hr.bucket_name, hr.location, hr.default_acl, hr.querystring_auth, hr.querystring_expire, hr.file_overwrite]
        '''
        out = load(PROD, env, probe)

        assert out['media'] == ['S3Storage', 'syspcc-media', 'media', 'private', 3600]
        assert out['hr'] == ['PrivateS3Storage', 'syspcc-hr-private', 'hr-private', 'private', True, 60, False]


class TestRedisTls:
    def test_plain_redis_urls_add_no_ssl_options(self):
        out = load(PROD, probe=attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES'))

        assert out['CELERY_BROKER_USE_SSL'] is None
        assert out['CELERY_REDIS_BACKEND_USE_SSL'] is None
        assert 'ssl_cert_reqs' not in out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']

    def test_rediss_urls_configure_celery_and_cache(self):
        env = {
            'REDIS_URL': 'rediss://default:pw@valkey.example:25061/0',
            'CELERY_BROKER_URL': 'rediss://default:pw@valkey.example:25061/1',
            'CELERY_RESULT_BACKEND': 'rediss://default:pw@valkey.example:25061/2',
        }
        out = load(PROD, env, probe=attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES') + '''
out['required'] = int(ssl.CERT_REQUIRED)''')
        pool = out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']

        assert out['CELERY_BROKER_USE_SSL'] == {'ssl_cert_reqs': out['required']}
        assert out['CELERY_REDIS_BACKEND_USE_SSL'] == {'ssl_cert_reqs': out['required']}
        assert pool['ssl_cert_reqs'] == 'required'
        assert pool['max_connections'] == 50  # base options preserved

    def test_ca_certs_and_cert_policy_are_configurable(self):
        env = {
            'CELERY_BROKER_URL': 'rediss://default:pw@valkey.example:25061/1',
            'REDIS_URL': 'rediss://default:pw@valkey.example:25061/0',
            'REDIS_SSL_CERT_REQS': 'none',
            'REDIS_SSL_CA_CERTS': '/etc/ssl/do-ca.crt',
        }
        out = load(PROD, env, probe=attrs('CELERY_BROKER_USE_SSL', 'CACHES') + '''
out['none'] = int(ssl.CERT_NONE)''')
        pool = out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']

        assert out['CELERY_BROKER_USE_SSL'] == {'ssl_cert_reqs': out['none'], 'ssl_ca_certs': '/etc/ssl/do-ca.crt'}
        assert pool['ssl_cert_reqs'] == 'none'
        assert pool['ssl_ca_certs'] == '/etc/ssl/do-ca.crt'

    def test_invalid_cert_policy_fails_fast(self):
        with pytest.raises(AssertionError, match='REDIS_SSL_CERT_REQS'):
            load(PROD, {'REDIS_SSL_CERT_REQS': 'bogus'})

    def test_ignore_exceptions_is_configurable(self):
        default = load(PROD, probe=attrs('DJANGO_REDIS_IGNORE_EXCEPTIONS'))
        enabled = load(PROD, {'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True'}, probe=attrs(
            'DJANGO_REDIS_IGNORE_EXCEPTIONS', 'DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS'))

        assert default['DJANGO_REDIS_IGNORE_EXCEPTIONS'] is False
        assert enabled['DJANGO_REDIS_IGNORE_EXCEPTIONS'] is True
        assert enabled['DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS'] is True


class TestClientIpSettings:
    def test_default_keeps_historical_throttle_behaviour(self):
        out = load(PROD, probe=attrs('REST_FRAMEWORK', 'MIDDLEWARE'))

        assert 'NUM_PROXIES' not in out['REST_FRAMEWORK']
        assert 'apps.core.middleware.DOConnectingIPMiddleware' not in out['MIDDLEWARE']

    def test_trust_do_connecting_ip_enables_middleware_and_zero_proxies(self):
        out = load(PROD, {'TRUST_DO_CONNECTING_IP': 'True', 'NUM_PROXIES': '1'}, probe=attrs('REST_FRAMEWORK', 'MIDDLEWARE'))

        assert out['REST_FRAMEWORK']['NUM_PROXIES'] == 0  # DO wins over a stray NUM_PROXIES
        assert out['MIDDLEWARE'][:2] == [
            'apps.core.middleware.HealthCheckMiddleware',
            'apps.core.middleware.DOConnectingIPMiddleware',
        ]

    def test_num_proxies_from_env(self):
        out = load(PROD, {'NUM_PROXIES': '2'}, probe=attrs('REST_FRAMEWORK'))

        assert out['REST_FRAMEWORK']['NUM_PROXIES'] == 2


class TestEmailBackend:
    SMTP = 'django.core.mail.backends.smtp.EmailBackend'
    CONSOLE = 'django.core.mail.backends.console.EmailBackend'

    def test_smtp_when_password_is_set(self):
        out = load(PROD, {'EMAIL_HOST_PASSWORD': 'app-password'}, probe=attrs('EMAIL_BACKEND'))

        assert out['EMAIL_BACKEND'] == self.SMTP

    def test_console_when_no_password(self):
        out = load(PROD, probe=attrs('EMAIL_BACKEND'))

        assert out['EMAIL_BACKEND'] == self.CONSOLE

    def test_explicit_backend_wins(self):
        out = load(PROD, {'EMAIL_BACKEND': self.SMTP}, probe=attrs('EMAIL_BACKEND'))

        assert out['EMAIL_BACKEND'] == self.SMTP


class TestDatabase:
    def test_persistent_connections_are_opt_in(self):
        default = load(PROD, probe="out['db'] = module.DATABASES['default']")
        tuned = load(PROD, {'DB_CONN_MAX_AGE': '60'}, probe="out['db'] = module.DATABASES['default']")

        assert default['db']['CONN_MAX_AGE'] == 0
        assert tuned['db']['CONN_MAX_AGE'] == 60
        assert tuned['db']['CONN_HEALTH_CHECKS'] is True
        assert tuned['db']['OPTIONS']['sslmode'] == 'require'


class TestSettingsBootstrap:
    @pytest.mark.parametrize('module', [PROD, DEMO])
    def test_django_setup_succeeds_with_minimal_env(self, module):
        out = load(module, probe='''
            import django
            django.setup()
            from django.conf import settings
            out['ok'] = bool(settings.configured)
        ''')

        assert out['ok'] is True
