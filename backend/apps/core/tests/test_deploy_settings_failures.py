"""SYSPCC-024 (QA ronda 1): ramas de error y compatibilidad de los settings de despliegue.

Complementa test_deploy_settings.py. Cada caso corre en un SUBPROCESO con un
entorno controlado y python-decouple sin `.env` (no contamina el proceso de
pytest). Sin red: los clientes de Redis/S3 se construyen pero nunca conectan
a un servicio real.
"""

import json
import os
import subprocess
import sys
import textwrap

import pytest

from apps.core.tests.test_deploy_settings import (
    BACKEND_DIR, BASE_ENV, FOOTER, HEADER, PROD, attrs, load,
)

def run(module, env, probe='', *, base=None):
    """Like test_deploy_settings.load but returns the CompletedProcess (no assert)."""
    full_env = {'PATH': os.environ.get('PATH', ''), **(BASE_ENV if base is None else base), **env}
    full_env['DJANGO_SETTINGS_MODULE'] = module
    script = HEADER.format(backend=str(BACKEND_DIR)) + textwrap.dedent(probe) + FOOTER
    return subprocess.run(
        [sys.executable, '-I', '-c', script],
        env=full_env, capture_output=True, text=True, timeout=120, cwd=str(BACKEND_DIR),
    )


def result_of(proc):
    assert proc.returncode == 0, proc.stderr
    line = next(ln for ln in proc.stdout.splitlines() if ln.startswith('@@RESULT@@'))
    return json.loads(line[len('@@RESULT@@'):])


class TestMissingEnvironment:
    """Sin variables obligatorias el arranque debe fallar de forma explicita."""

    @pytest.mark.parametrize('missing', ['SECRET_KEY', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST'])
    def test_production_fails_fast_without_required_variable(self, missing):
        base = {k: v for k, v in BASE_ENV.items() if k != missing}

        proc = run(PROD, {}, base=base)

        assert proc.returncode != 0
        assert missing in proc.stderr

    def test_optional_variables_absent_does_not_break_production(self):
        # Solo el minimo obligatorio: ningun AWS_*, REDIS_*, EMAIL_*, HR_*, TRUST_DO_*.
        out = result_of(run(PROD, {}, probe=attrs('DEBUG', 'ALLOWED_HOSTS')))

        assert out['DEBUG'] is False
        assert out['ALLOWED_HOSTS'] == ['app.example.com']

    def test_empty_aws_credentials_are_not_exported(self):
        # Spec renderizado con valores vacios no debe fijar credenciales vacias
        # (boto3 las trataria como "explicitas" y no usaria su cadena por defecto).
        env = {'AWS_ACCESS_KEY_ID': '', 'AWS_SECRET_ACCESS_KEY': '', 'AWS_S3_ENDPOINT_URL': ''}
        out = result_of(run(PROD, env, probe=attrs('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_ENDPOINT_URL')))

        assert out == {'AWS_ACCESS_KEY_ID': None, 'AWS_SECRET_ACCESS_KEY': None, 'AWS_S3_ENDPOINT_URL': None}


class TestRedisTlsEdgeCases:
    def test_only_broker_is_tls(self):
        env = {'CELERY_BROKER_URL': 'rediss://default:pw@valkey.example:25061/1'}
        out = result_of(run(PROD, env, probe=attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES')))

        assert out['CELERY_BROKER_USE_SSL'] is not None
        assert out['CELERY_REDIS_BACKEND_USE_SSL'] is None
        assert 'ssl_cert_reqs' not in out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']

    def test_only_cache_is_tls(self):
        env = {'REDIS_URL': 'rediss://default:pw@valkey.example:25061/0'}
        out = result_of(run(PROD, env, probe=attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES')))

        assert out['CELERY_BROKER_USE_SSL'] is None
        assert out['CELERY_REDIS_BACKEND_USE_SSL'] is None
        assert out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']['ssl_cert_reqs'] == 'required'

    def test_uppercase_scheme_is_detected(self):
        env = {'CELERY_BROKER_URL': 'REDISS://default:pw@valkey.example:25061/1'}
        out = result_of(run(PROD, env, probe=attrs('CELERY_BROKER_USE_SSL')))

        assert out['CELERY_BROKER_USE_SSL'] is not None

    @pytest.mark.parametrize('raw', ['REQUIRED', ' Optional ', 'None'])
    def test_cert_policy_is_case_and_whitespace_insensitive(self, raw):
        out = result_of(run(PROD, {'REDIS_SSL_CERT_REQS': raw}, probe=attrs('REDIS_SSL_CERT_REQS')))

        assert out['REDIS_SSL_CERT_REQS'] == raw.strip().lower()

    def test_base_cache_dict_is_not_mutated(self):
        # production.py hace deepcopy: base.CACHES no debe contaminarse.
        env = {'REDIS_URL': 'rediss://default:pw@valkey.example:25061/0'}
        out = result_of(run(PROD, env, probe='''
            from config.settings import base
            out['base_pool'] = base.CACHES['default']['OPTIONS']['CONNECTION_POOL_KWARGS']
            out['prod_pool'] = module.CACHES['default']['OPTIONS']['CONNECTION_POOL_KWARGS']
        '''))

        assert 'ssl_cert_reqs' not in out['base_pool']
        assert out['prod_pool']['ssl_cert_reqs'] == 'required'

    def test_celery_app_receives_the_ssl_options(self):
        # Verifica el nombre de los settings (namespace CELERY_): si estuvieran mal
        # escritos, kombu rechazaria rediss:// en produccion y esto no lo veria.
        env = {
            'CELERY_BROKER_URL': 'rediss://default:pw@valkey.example:25061/1',
            'CELERY_RESULT_BACKEND': 'rediss://default:pw@valkey.example:25061/2',
        }
        out = result_of(run(PROD, env, probe='''
            import django
            django.setup()
            from config.celery import app
            out['broker_ssl'] = {k: int(v) for k, v in app.conf.broker_use_ssl.items()}
            out['backend_ssl'] = {k: int(v) for k, v in app.conf.redis_backend_use_ssl.items()}
            out['required'] = int(ssl.CERT_REQUIRED)
        '''))

        assert out['broker_ssl'] == {'ssl_cert_reqs': out['required']}
        assert out['backend_ssl'] == {'ssl_cert_reqs': out['required']}

    def test_django_redis_builds_an_ssl_client_without_connecting(self):
        env = {'REDIS_URL': 'rediss://default:pw@valkey.example:25061/0', 'REDIS_SSL_CERT_REQS': 'none'}
        out = result_of(run(PROD, env, probe='''
            import django
            django.setup()
            from django.core.cache import caches
            client = caches['default'].client.get_client(write=True)
            pool = client.connection_pool
            out['conn_class'] = pool.connection_class.__name__
            out['cert_reqs'] = str(pool.connection_kwargs.get('ssl_cert_reqs'))
        '''))

        assert out['conn_class'] == 'SSLConnection'
        assert out['cert_reqs'] in ('none', 'CERT_NONE', 'VerifyMode.CERT_NONE')

    def test_cache_errors_raise_by_default_and_degrade_when_enabled(self):
        # Puerto 1 cerrado: falla al instante, sin red externa.
        probe = '''
            import django
            django.setup()
            from django.core.cache import caches
            try:
                out['value'] = caches['default'].get('k')
                out['raised'] = False
            except Exception as exc:
                out['raised'] = True
        '''
        env = {'REDIS_URL': 'redis://127.0.0.1:1/0'}
        default = result_of(run(PROD, env, probe=probe))
        enabled = result_of(run(PROD, {**env, 'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True'}, probe=probe))

        assert default['raised'] is True
        assert enabled['raised'] is False
        assert enabled['value'] is None


class TestClientIpEdgeCases:
    def test_blank_num_proxies_is_treated_as_unset(self):
        out = result_of(run(PROD, {'NUM_PROXIES': '  '}, probe=attrs('REST_FRAMEWORK')))

        assert 'NUM_PROXIES' not in out['REST_FRAMEWORK']

    def test_non_numeric_num_proxies_fails_fast(self):
        proc = run(PROD, {'NUM_PROXIES': 'abc'})

        assert proc.returncode != 0
        assert 'abc' in proc.stderr

    def test_do_middleware_not_duplicated_and_other_throttle_config_preserved(self):
        out = result_of(run(PROD, {'TRUST_DO_CONNECTING_IP': 'True'}, probe=attrs('MIDDLEWARE', 'REST_FRAMEWORK')))

        assert out['MIDDLEWARE'].count('apps.core.middleware.DOConnectingIPMiddleware') == 1
        assert out['REST_FRAMEWORK']['DEFAULT_THROTTLE_RATES']['login'] == '5/min'
        assert out['REST_FRAMEWORK']['DEFAULT_THROTTLE_RATES']['login_user'] == '10/min'
        assert 'apps.core.throttling.AnonThrottle' in out['REST_FRAMEWORK']['DEFAULT_THROTTLE_CLASSES']

    def test_trust_flag_false_string_disables_it(self):
        out = result_of(run(PROD, {'TRUST_DO_CONNECTING_IP': 'False'}, probe=attrs('MIDDLEWARE', 'TRUST_DO_CONNECTING_IP')))

        assert out['TRUST_DO_CONNECTING_IP'] is False
        assert 'apps.core.middleware.DOConnectingIPMiddleware' not in out['MIDDLEWARE']


class TestStorageSelectionEdgeCases:
    def test_empty_bucket_string_means_filesystem(self):
        out = result_of(run(PROD, {'AWS_STORAGE_BUCKET_NAME': ''}, probe=attrs('STORAGES')))

        assert out['STORAGES']['default'] == {'BACKEND': 'django.core.files.storage.FileSystemStorage'}

    def test_querystring_expire_is_configurable(self):
        env = {'AWS_STORAGE_BUCKET_NAME': 'b', 'AWS_QUERYSTRING_EXPIRE': '900'}
        out = result_of(run(PROD, env, probe=attrs('STORAGES')))

        assert out['STORAGES']['default']['OPTIONS']['querystring_expire'] == 900

    def test_hr_private_bucket_is_independent_from_media_bucket(self):
        env = {'AWS_STORAGE_BUCKET_NAME': 'media-bucket', 'HR_PRIVATE_BUCKET_NAME': 'hr-bucket'}
        out = result_of(run(PROD, env, probe=attrs('AWS_STORAGE_BUCKET_NAME', 'HR_PRIVATE_BUCKET_NAME')))

        assert out['AWS_STORAGE_BUCKET_NAME'] == 'media-bucket'
        assert out['HR_PRIVATE_BUCKET_NAME'] == 'hr-bucket'

    def test_hr_s3_storage_without_bucket_fails_with_clear_error(self):
        env = {'HR_FILE_STORAGE': 'apps.hr.storage.PrivateS3Storage'}
        proc = run(PROD, env, probe='''
            import django
            django.setup()
            from apps.hr.storage import get_private_storage
            get_private_storage()
        ''')

        assert proc.returncode != 0
        assert 'HR_PRIVATE_BUCKET_NAME' in proc.stderr

    def test_hr_models_do_not_import_boto3_unless_s3_is_selected(self):
        # django-storages/boto3 cost ~34 MB RSS; filesystem deployments (local
        # Docker) must not pay for them.
        proc = run(PROD, {}, probe='''
            import django
            django.setup()
            import apps.hr.models  # noqa: F401
            out['boto3_loaded'] = 'boto3' in sys.modules or 'storages.backends.s3' in sys.modules
        ''')

        assert result_of(proc)['boto3_loaded'] is False

    def test_missing_django_storages_gives_clear_error_not_import_crash(self):
        # Imagen sin django-storages: HR (filesystem) sigue arrancando y PrivateS3Storage
        # explica el problema en vez de "module has no attribute".
        proc = run(PROD, {}, probe='''
            import django
            django.setup()
            sys.modules['storages'] = None
            sys.modules['storages.backends'] = None
            sys.modules['storages.backends.s3'] = None
            sys.modules.pop('apps.hr.storage', None)  # already imported by django.setup()
            import apps.hr.storage as hr_storage
            out['filesystem_ok'] = hr_storage.get_private_storage().__class__.__name__
            try:
                hr_storage.PrivateS3Storage
            except Exception as exc:
                out['error'] = type(exc).__name__ + ': ' + str(exc)
        ''')
        out = result_of(proc)

        assert out['filesystem_ok'] == 'PrivateDocumentStorage'
        assert out['error'].startswith('ImproperlyConfigured')
        assert 'django-storages' in out['error']
