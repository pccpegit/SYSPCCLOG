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
