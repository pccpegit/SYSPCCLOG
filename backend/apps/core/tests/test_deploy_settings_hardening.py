"""SYSPCC-024 (hardening round): TLS verification, throttle cache, CA bundles.

Same approach as test_deploy_settings_failures.py: every case imports the
settings in a SUBPROCESS with a controlled environment (no network).
"""

import pytest

from apps.core.tests.test_deploy_settings_failures import result_of, run
from apps.core.tests.test_deploy_settings import PROD, attrs

PEM = (
    '-----BEGIN CERTIFICATE-----\n'
    'MIIBszCCAVmgAwIBAgIUXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXwCgYIKoZIzj0EAwIw\n'
    '-----END CERTIFICATE-----'
)


class TestDatabaseTls:
    def test_default_is_require_without_root_cert(self):
        out = result_of(run(PROD, {}, probe=attrs('DATABASES')))
        options = out['DATABASES']['default']['OPTIONS']

        assert options['sslmode'] == 'require'
        assert 'sslrootcert' not in options

    @pytest.mark.parametrize('mode', ['verify-ca', 'verify-full'])
    def test_verify_modes_need_a_ca(self, mode):
        proc = run(PROD, {'DB_SSLMODE': mode})

        assert proc.returncode != 0
        assert 'DB_SSLROOTCERT' in proc.stderr

    def test_invalid_mode_fails_fast(self):
        proc = run(PROD, {'DB_SSLMODE': 'disable'})

        assert proc.returncode != 0
        assert 'DB_SSLMODE' in proc.stderr

    def test_verify_ca_with_a_ca_file_path(self):
        out = result_of(run(PROD, {'DB_SSLMODE': 'verify-ca', 'DB_SSLROOTCERT': '/etc/ca.pem'},
                            probe=attrs('DATABASES')))
        options = out['DATABASES']['default']['OPTIONS']

        assert options['sslmode'] == 'verify-ca'
        assert options['sslrootcert'] == '/etc/ca.pem'

    def test_verify_ca_with_pem_text_writes_a_private_file(self):
        probe = attrs('DATABASES') + '''
path = module.DATABASES['default']['OPTIONS']['sslrootcert']
out['content'] = open(path).read()
import os, stat
out['mode'] = stat.S_IMODE(os.stat(path).st_mode)
'''
        out = result_of(run(PROD, {'DB_SSLMODE': 'verify-ca', 'DB_CA_CERT': PEM}, probe=probe))

        assert out['DATABASES']['default']['OPTIONS']['sslrootcert'].endswith('syspcc-db-ca.pem')
        assert out['content'].strip() == PEM
        assert out['mode'] == 0o600

    def test_pem_with_escaped_newlines_is_normalised(self):
        probe = attrs('DATABASES') + "\nout['content'] = open(module.DATABASES['default']['OPTIONS']['sslrootcert']).read()"
        escaped = PEM.replace('\n', '\\n')

        out = result_of(run(PROD, {'DB_SSLMODE': 'verify-ca', 'DB_CA_CERT': escaped}, probe=probe))

        assert out['content'].strip() == PEM

    def test_unresolved_placeholder_is_not_silently_accepted(self):
        proc = run(PROD, {'DB_SSLMODE': 'verify-ca', 'DB_CA_CERT': '${db.CA_CERT}'})

        assert proc.returncode != 0
        assert 'DB_CA_CERT' in proc.stderr

    def test_path_wins_over_pem_text(self):
        out = result_of(run(PROD, {'DB_SSLMODE': 'verify-ca', 'DB_SSLROOTCERT': '/etc/ca.pem', 'DB_CA_CERT': PEM},
                            probe=attrs('DATABASES')))

        assert out['DATABASES']['default']['OPTIONS']['sslrootcert'] == '/etc/ca.pem'


class TestRedisCaBundle:
    URLS = {
        'REDIS_URL': 'rediss://default:pw@cache.example:25061/0',
        'CELERY_BROKER_URL': 'rediss://default:pw@cache.example:25061/1',
        'CELERY_RESULT_BACKEND': 'rediss://default:pw@cache.example:25061/2',
    }

    def test_pem_text_reaches_broker_backend_and_cache(self):
        probe = attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES', 'REDIS_SSL_CERT_REQS') + '''
out['exists'] = os.path.isfile(module.CELERY_BROKER_USE_SSL['ssl_ca_certs'])
'''
        out = result_of(run(PROD, {**self.URLS, 'REDIS_CA_CERT': PEM}, probe=probe))

        ca = out['CELERY_BROKER_USE_SSL']['ssl_ca_certs']
        assert ca.endswith('syspcc-redis-ca.pem') and out['exists']
        assert out['CELERY_REDIS_BACKEND_USE_SSL']['ssl_ca_certs'] == ca
        assert out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']['ssl_ca_certs'] == ca
        assert out['REDIS_SSL_CERT_REQS'] == 'required'  # the recommended default stays

    def test_invalid_pem_aborts_the_boot(self):
        proc = run(PROD, {**self.URLS, 'REDIS_CA_CERT': 'not a certificate'})

        assert proc.returncode != 0
        assert 'REDIS_CA_CERT' in proc.stderr


class TestThrottleCacheFailsClosedWhenRedisIsDown:
    # Port 1 is closed: Redis calls fail immediately, no external network.
    DOWN = {'REDIS_URL': 'redis://127.0.0.1:1/0'}
    PROBE = '''
        import django
        django.setup()
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        from apps.core.views.auth import LoginRateThrottle
        results = []
        try:
            for _ in range(7):
                request = Request(APIRequestFactory().post('/x/', REMOTE_ADDR='203.0.113.9'))
                results.append(LoginRateThrottle().allow_request(request, None))
            out['results'] = results
            out['raised'] = False
        except Exception:
            out['raised'] = True
    '''

    def test_default_alias_without_ignore_exceptions(self):
        out = result_of(run(PROD, {}, probe=attrs('THROTTLE_CACHE_ALIAS', 'CACHES')))

        assert out['THROTTLE_CACHE_ALIAS'] == 'default'
        assert 'throttle' not in out['CACHES']

    def test_ignore_exceptions_moves_throttles_to_a_local_cache(self):
        out = result_of(run(PROD, {'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True'}, probe=attrs('THROTTLE_CACHE_ALIAS', 'CACHES')))

        assert out['THROTTLE_CACHE_ALIAS'] == 'throttle'
        assert out['CACHES']['throttle']['BACKEND'].endswith('locmem.LocMemCache')
        assert out['CACHES']['default']['BACKEND'] == 'django_redis.cache.RedisCache'  # sessions/cache stay on Redis

    def test_login_limit_still_enforced_during_a_redis_outage(self):
        out = result_of(run(PROD, {**self.DOWN, 'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True'}, probe=self.PROBE))

        assert out['raised'] is False
        # 5/min: the first five pass, the rest are rejected (fail CLOSED).
        assert out['results'] == [True] * 5 + [False] * 2

    def test_without_ignore_exceptions_an_outage_is_a_hard_error_not_a_bypass(self):
        out = result_of(run(PROD, self.DOWN, probe=self.PROBE))

        assert out['raised'] is True


class TestDigitalOceanOptimizedEnvironment:
    """SYSPCC-033: the environment the Optimizada spec (.do/app.yaml) gives to backend/workers.

    Pool de PgBouncer (modo transaction) con TLS verificado + Valkey gestionado por
    rediss:// con el CA verificado. Mismos nombres de variable que el spec.
    """

    ENV = {
        'DJANGO_ENV': 'production',
        'TRUST_DO_CONNECTING_IP': 'True',
        'DB_NAME': 'syspccpool',
        'DB_USER': 'syspcc',
        'DB_PASSWORD': 'pw',
        'DB_HOST': 'syspcc-pg-pool-do-user-1-0.g.db.ondigitalocean.com',
        'DB_PORT': '25061',
        'DB_SSLMODE': 'verify-ca',
        'DB_CA_CERT': PEM,
        'DB_CONN_MAX_AGE': '60',
        'DB_DISABLE_SERVER_SIDE_CURSORS': 'True',
        'REDIS_URL': 'rediss://default:pw@syspcc-valkey-do-user-1-0.g.db.ondigitalocean.com:25061/0',
        'CELERY_BROKER_URL': 'rediss://default:pw@syspcc-valkey-do-user-1-0.g.db.ondigitalocean.com:25061/1',
        'CELERY_RESULT_BACKEND': 'rediss://default:pw@syspcc-valkey-do-user-1-0.g.db.ondigitalocean.com:25061/2',
        'REDIS_SSL_CERT_REQS': 'required',
        'REDIS_CA_CERT': PEM,
        'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'False',
        'HR_CV_PROVIDER': 'anthropic',
        'HR_CV_DISPATCH': 'celery',
    }

    def test_database_is_the_pool_with_verified_tls_and_no_server_side_cursors(self):
        out = result_of(run(PROD, self.ENV, probe=attrs('DATABASES')))
        db = out['DATABASES']['default']

        assert db['HOST'].startswith('syspcc-pg-pool') and db['PORT'] == '25061' and db['NAME'] == 'syspccpool'
        assert db['OPTIONS']['sslmode'] == 'verify-ca'
        assert db['OPTIONS']['sslrootcert'].endswith('syspcc-db-ca.pem')
        assert db['DISABLE_SERVER_SIDE_CURSORS'] is True
        assert db['CONN_MAX_AGE'] == 60

    def test_server_side_cursors_stay_enabled_for_a_direct_connection(self):
        out = result_of(run(PROD, {}, probe=attrs('DATABASES')))

        assert out['DATABASES']['default']['DISABLE_SERVER_SIDE_CURSORS'] is False

    def test_valkey_over_tls_with_verified_certificate_everywhere(self):
        probe = attrs('CELERY_BROKER_USE_SSL', 'CELERY_REDIS_BACKEND_USE_SSL', 'CACHES', 'REDIS_SSL_CERT_REQS',
                      'THROTTLE_CACHE_ALIAS', 'DJANGO_REDIS_IGNORE_EXCEPTIONS')
        out = result_of(run(PROD, self.ENV, probe=probe))
        pool = out['CACHES']['default']['OPTIONS']['CONNECTION_POOL_KWARGS']

        assert out['REDIS_SSL_CERT_REQS'] == 'required'
        assert out['CELERY_BROKER_USE_SSL']['ssl_ca_certs'].endswith('syspcc-redis-ca.pem')
        assert out['CELERY_REDIS_BACKEND_USE_SSL']['ssl_ca_certs'] == out['CELERY_BROKER_USE_SSL']['ssl_ca_certs']
        assert pool['ssl_cert_reqs'] == 'required' and pool['ssl_ca_certs'].endswith('syspcc-redis-ca.pem')
        # Valkey estable: los throttles viven en el cache compartido (exactos entre workers).
        assert out['DJANGO_REDIS_IGNORE_EXCEPTIONS'] is False
        assert out['THROTTLE_CACHE_ALIAS'] == 'default'

    def test_simulated_cv_provider_aborts_the_boot_in_this_environment(self):
        proc = run(PROD, {**self.ENV, 'HR_CV_PROVIDER': 'fake'})

        assert proc.returncode != 0
        assert 'HR_CV_PROVIDER' in proc.stderr

    def test_the_whole_environment_boots_with_django_setup(self):
        out = result_of(run(PROD, self.ENV, probe='''
            import django
            django.setup()
            from django.conf import settings
            out['provider'] = settings.HR_CV_PROVIDER
            out['dispatch'] = settings.HR_CV_DISPATCH
            out['num_proxies'] = settings.REST_FRAMEWORK['NUM_PROXIES']
        '''))

        assert out == {'provider': 'anthropic', 'dispatch': 'celery', 'num_proxies': 0}
