"""SYSPCC-024 (QA ronda 2): huecos que quedaban tras la ronda 1.

Pruebas con comportamiento REAL en lugar de mocks:

* /healthz/ contra un PostgreSQL inalcanzable (psycopg de verdad, settings de
  produccion en subproceso), no solo con `connections` mockeado.
* `collectstatic` real + WhiteNoise sirviendo el CSS del admin con el manifiesto
  (do-start.sh lo ejecuta en cada arranque: si falla, el servicio no levanta).
* `makemigrations --check` con el storage S3 de RR. HH. activo (las migraciones
  no deben depender del storage elegido por entorno).
* Un broker REAL inalcanzable produce la excepcion que la vista captura.
* Cadena completa del login con `do-connecting-ip` (buckets de throttle).
* Documentacion: `.env.example` cubre las variables que lee production.py y el
  spec de DO no tiene variables huerfanas (typos silenciosos).
* Defectos de demo.py (fugas de toggles de produccion): corregidos en SYSPCC-024,
  los tests quedan como regresion.

Sin red: todo apunta a 127.0.0.1:1 (conexion rechazada al instante).
"""

import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
import yaml
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.tests.test_deploy_settings import (
    BACKEND_DIR, BASE_ENV, DEMO, PROD, attrs,
)
from apps.core.tests.test_deploy_settings_failures import RENDER_ENV, result_of, run

REPO_ROOT = BACKEND_DIR.parent
SPEC_PATH = REPO_ROOT / '.do' / 'app.yaml'

DECOUPLE_EMPTY = (
    "import decouple; decouple.config = decouple.Config(decouple.RepositoryEmpty())\n"
)


def _run_python(script, env, *, pythonpath=()):
    """Run `script` with a from-scratch env (no developer .env, no inherited vars)."""
    full_env = {'PATH': os.environ.get('PATH', ''), **env}
    code = (
        'import sys\n'
        f'sys.path[:0] = {[str(p) for p in (*pythonpath, BACKEND_DIR)]!r}\n'
        + DECOUPLE_EMPTY
        + textwrap.dedent(script)
    )
    return subprocess.run(
        [sys.executable, '-I', '-c', code],
        env=full_env, capture_output=True, text=True, timeout=180, cwd=str(BACKEND_DIR),
    )


# ---------------------------------------------------------------------------
# /healthz/ with a really unreachable PostgreSQL
# ---------------------------------------------------------------------------


class TestHealthzWithRealDatabaseOutage:
    ENV = {
        **BASE_ENV,
        'DJANGO_SETTINGS_MODULE': PROD,
        'DB_HOST': '127.0.0.1',
        'DB_PORT': '1',  # connection refused immediately
    }

    def test_unreachable_postgres_gives_503_not_an_unhandled_exception(self):
        proc = _run_python('''
            import django; django.setup()
            from django.test import Client
            client = Client(raise_request_exception=True)  # an unhandled error would raise here
            first = client.get('/healthz/', HTTP_HOST='10.244.1.7')  # Host NOT in ALLOWED_HOSTS
            second = client.head('/healthz', HTTP_HOST='10.244.1.7')
            print('RESULT', first.status_code, first.content.decode(), second.status_code,
                  first['Cache-Control'])
        ''', self.ENV)

        assert proc.returncode == 0, proc.stderr
        line = next(ln for ln in proc.stdout.splitlines() if ln.startswith('RESULT'))
        assert line == 'RESULT 503 {"status": "error"} 503 no-store'
        # Operators get the cause in the logs, the caller gets no internals.
        assert 'healthz.database_unavailable' in proc.stderr or 'Service Unavailable' in proc.stderr

    def test_other_routes_do_not_answer_as_healthy_when_the_database_is_down(self):
        proc = _run_python('''
            import django; django.setup()
            from django.test import Client
            r = Client(raise_request_exception=False).get('/api/v1/auth/csrf/', HTTP_HOST='app.example.com',
                                                           HTTP_X_FORWARDED_PROTO='https')
            h = Client().get('/healthz/', HTTP_HOST='app.example.com')
            print('RESULT', h.status_code)
        ''', self.ENV)

        assert proc.returncode == 0, proc.stderr
        assert 'RESULT 503' in proc.stdout


# ---------------------------------------------------------------------------
# collectstatic + WhiteNoise (what do-start.sh does on every boot)
# ---------------------------------------------------------------------------


class TestCollectstaticAndWhiteNoise:
    def test_collectstatic_builds_the_manifest_and_whitenoise_serves_it(self, tmp_path):
        static_root = tmp_path / 'static_out'
        (tmp_path / 'qa_static_settings.py').write_text(
            'from config.settings.production import *\n'
            f'STATIC_ROOT = {str(static_root)!r}\n'
        )
        env = {**BASE_ENV, 'DJANGO_SETTINGS_MODULE': 'qa_static_settings'}

        proc = _run_python('''
            import django; django.setup()
            from django.core.management import call_command
            call_command('collectstatic', interactive=False, verbosity=0)
            from django.contrib.staticfiles.storage import staticfiles_storage
            from django.test import Client
            client = Client()
            plain = client.get('/static/admin/css/base.css', HTTP_HOST='app.example.com',
                               HTTP_X_FORWARDED_PROTO='https')
            hashed_url = staticfiles_storage.url('admin/css/base.css')
            hashed = client.get(hashed_url, HTTP_HOST='app.example.com', HTTP_X_FORWARDED_PROTO='https')
            missing = client.get('/static/does-not-exist.css', HTTP_HOST='app.example.com',
                                 HTTP_X_FORWARDED_PROTO='https')
            print('RESULT', plain.status_code, plain['Content-Type'].split(';')[0], hashed_url,
                  hashed.status_code, hashed['Cache-Control'], missing.status_code)
        ''', env, pythonpath=[tmp_path])

        assert proc.returncode == 0, proc.stderr
        line = next(ln for ln in proc.stdout.splitlines() if ln.startswith('RESULT'))
        parts = line.split(' ')
        assert parts[1] == '200' and parts[2] == 'text/css'
        assert re.fullmatch(r'/static/admin/css/base\.[0-9a-f]{12}\.css', parts[3])
        assert parts[4] == '200'
        assert 'immutable' in line  # hashed assets are cached for good
        assert parts[-1] == '404'
        assert (static_root / 'staticfiles.json').is_file()
        assert (static_root / 'admin' / 'css' / 'base.css').is_file()
        assert (static_root / 'rest_framework').is_dir()


# ---------------------------------------------------------------------------
# Migrations must not depend on the storage selected per environment
# ---------------------------------------------------------------------------


class TestMigrationsAreStorageAgnostic:
    def test_no_pending_migrations_with_s3_storage_enabled(self):
        env = {
            **BASE_ENV,
            'DJANGO_SETTINGS_MODULE': PROD,
            'AWS_STORAGE_BUCKET_NAME': 'syspcc-media',
            'HR_PRIVATE_BUCKET_NAME': 'syspcc-hr-private',
            'HR_FILE_STORAGE': 'apps.hr.storage.PrivateS3Storage',
            'AWS_ACCESS_KEY_ID': 'AKID',
            'AWS_SECRET_ACCESS_KEY': 'SECRET',
            'AWS_S3_ENDPOINT_URL': 'https://nyc3.digitaloceanspaces.com',
            'AWS_S3_REGION_NAME': 'nyc3',
            'DB_HOST': '127.0.0.1',
            'DB_PORT': '1',
        }
        proc = _run_python('''
            import django; django.setup()
            import warnings; warnings.simplefilter('ignore')
            from django.core.management import call_command
            call_command('makemigrations', check=True, dry_run=True, verbosity=0)
            print('RESULT no-changes')
        ''', env)

        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert 'RESULT no-changes' in proc.stdout


# ---------------------------------------------------------------------------
# Real broker outage: the exception raised by Celery is the one the view catches
# ---------------------------------------------------------------------------


class TestRealBrokerOutage:
    def test_unreachable_broker_does_not_break_the_enqueue_helper(self, monkeypatch):
        from celery import Celery

        from apps.warehouse import tasks as warehouse_tasks
        from apps.warehouse.views import _enqueue_group_pdf_upload

        dead_app = Celery('qa-dead-broker', broker='redis://127.0.0.1:1/0')
        dead_app.conf.broker_connection_timeout = 1
        dead_app.conf.task_publish_retry_policy = {
            'max_retries': 1, 'interval_start': 0, 'interval_step': 0.05, 'interval_max': 0.05,
        }

        @dead_app.task(name='qa.dead_broker_task')
        def dead_task(group_id):  # pragma: no cover - never executed
            return group_id

        # Control: Celery really raises (so the test would fail without the guard).
        with pytest.raises(Exception) as raised:
            dead_task.delay(1)
        from kombu.exceptions import OperationalError
        assert isinstance(raised.value, (OperationalError, ConnectionError))

        monkeypatch.setattr(warehouse_tasks, 'upload_group_pdf_task', dead_task)
        with mock.patch('apps.warehouse.views.logger') as view_logger:
            _enqueue_group_pdf_upload(SimpleNamespace(pk=77))  # must not raise

        view_logger.exception.assert_called_once()
        assert view_logger.exception.call_args[0][0] == 'warehouse.group_pdf.enqueue_failed'
        assert view_logger.exception.call_args[1]['extra'] == {'group_id': 77}


# ---------------------------------------------------------------------------
# Full-stack login throttling behind DigitalOcean's ingress
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestLoginThrottleBehindDigitalOceanIngress:
    URL = '/api/v1/auth/login/'

    @pytest.fixture(autouse=True)
    def _isolate(self, monkeypatch):
        from apps.core.throttling import LoginUsernameThrottle
        from apps.core.views.auth import LoginRateThrottle

        cache.clear()
        monkeypatch.setitem(LoginRateThrottle.THROTTLE_RATES, 'login', '2/min')
        monkeypatch.setitem(LoginUsernameThrottle.THROTTLE_RATES, 'login_user', '1000/min')
        yield
        cache.clear()

    @staticmethod
    def _do_settings():
        middleware = list(settings.MIDDLEWARE)
        if 'apps.core.middleware.DOConnectingIPMiddleware' not in middleware:
            middleware.insert(1, 'apps.core.middleware.DOConnectingIPMiddleware')
        return override_settings(
            MIDDLEWARE=middleware,
            REST_FRAMEWORK={**settings.REST_FRAMEWORK, 'NUM_PROXIES': 0},
        )

    def _attempt(self, n, **headers):
        return APIClient().post(
            self.URL, {'username': f'user-{n}', 'password': 'bad'}, format='json', **headers,
        ).status_code

    def test_each_real_client_ip_has_its_own_bucket(self):
        with self._do_settings():
            # Every request carries the SAME ingress address in X-Forwarded-For
            # (DO writes its own IP there); only do-connecting-ip differs.
            ingress = {'HTTP_X_FORWARDED_FOR': '10.244.0.9'}
            a = [self._attempt(n, HTTP_DO_CONNECTING_IP='203.0.113.10', **ingress) for n in range(3)]
            b = [self._attempt(n, HTTP_DO_CONNECTING_IP='203.0.113.11', **ingress) for n in range(2)]

        assert a == [status.HTTP_401_UNAUTHORIZED] * 2 + [status.HTTP_429_TOO_MANY_REQUESTS]
        assert b == [status.HTTP_401_UNAUTHORIZED] * 2  # another company user is not penalised

    def test_rotating_x_forwarded_for_does_not_reset_the_limit(self):
        with self._do_settings():
            codes = [
                self._attempt(n, HTTP_DO_CONNECTING_IP='203.0.113.20', HTTP_X_FORWARDED_FOR=f'198.51.100.{n}')
                for n in range(4)
            ]

        assert codes == [401, 401, 429, 429]

    def test_without_the_header_requests_share_the_peer_bucket(self):
        with self._do_settings():
            codes = [self._attempt(n) for n in range(3)]

        assert codes == [401, 401, 429]


# ---------------------------------------------------------------------------
# Documentation drift
# ---------------------------------------------------------------------------


class TestEnvExampleDocumentsProductionSettings:
    def test_every_variable_read_by_production_py_is_documented(self):
        source = (BACKEND_DIR / 'config' / 'settings' / 'production.py').read_text(encoding='utf-8')
        names = set(re.findall(r"config\(\s*'([A-Z][A-Z0-9_]+)'", source))
        for pair in re.findall(r"_ca_bundle_path\(\s*'([A-Z_]+)',\s*'([A-Z_]+)'", source):
            names |= set(pair)
        block = re.search(r"for _name in \((.*?)\):", source, re.S)
        names |= set(re.findall(r"'([A-Z][A-Z0-9_]+)'", block.group(1)))
        example = (BACKEND_DIR / '.env.example').read_text(encoding='utf-8')

        undocumented = sorted(
            n for n in names if not re.search(rf'^\s*#?\s*{n}\s*=', example, re.M)
        )

        assert names, 'the regexes found nothing: update the test'
        assert undocumented == []


@pytest.mark.skipif(not SPEC_PATH.is_file(), reason='.do/ no esta montado en este entorno')
class TestSpecHasNoOrphanVariables:
    PLATFORM_ONLY = {'INSTALL_LIBREOFFICE', 'GUNICORN_WORKERS', 'GUNICORN_THREADS'}

    def test_every_env_key_in_the_spec_is_consumed_somewhere(self):
        spec = yaml.safe_load(SPEC_PATH.read_text(encoding='utf-8'))
        keys = {e['key'] for e in spec.get('envs', [])}
        for section in ('services', 'workers', 'jobs', 'static_sites'):
            for component in spec.get(section, []):
                keys |= {e['key'] for e in component.get('envs', [])}

        corpus = ''
        for path in list(BACKEND_DIR.rglob('*.py')) + list(BACKEND_DIR.rglob('*.sh')) + [BACKEND_DIR / 'Dockerfile']:
            if '.venv' in path.parts or 'tests' in path.parts or not path.is_file():
                continue
            corpus += path.read_text(encoding='utf-8', errors='ignore')
        for path in (REPO_ROOT / 'frontend' / 'src').rglob('*.js*'):
            corpus += path.read_text(encoding='utf-8', errors='ignore')
        corpus += (REPO_ROOT / 'frontend' / 'vite.config.js').read_text(encoding='utf-8', errors='ignore')

        orphans = sorted(k for k in keys if k not in corpus)

        assert keys
        assert orphans == [], f'variables del spec que ningun codigo lee (typo?): {orphans}'


# ---------------------------------------------------------------------------
# demo.py: production toggles leaked into the Render env must not reach the demo (regression)
# ---------------------------------------------------------------------------


class TestRenderDemoWithLeakedProductionToggles:
    """demo.py replaces CACHES/REST_FRAMEWORK AFTER production.py reacted to env toggles."""

    def test_throttle_cache_alias_exists_in_demo_caches(self):
        out = result_of(run(DEMO, {**RENDER_ENV, 'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True'}, probe=attrs(
            'THROTTLE_CACHE_ALIAS', 'CACHES',
        )))

        assert out['THROTTLE_CACHE_ALIAS'] in out['CACHES']

    def test_demo_never_trusts_do_connecting_ip_header(self):
        out = result_of(run(DEMO, {**RENDER_ENV, 'TRUST_DO_CONNECTING_IP': 'True'}, probe=attrs('MIDDLEWARE')))

        assert 'apps.core.middleware.DOConnectingIPMiddleware' not in out['MIDDLEWARE']

    def test_demo_still_loads_with_both_toggles_leaked(self):
        # Control: the leak does not abort the boot (only misbehaves at request time).
        proc = run(DEMO, {
            **RENDER_ENV,
            'DJANGO_REDIS_IGNORE_EXCEPTIONS': 'True',
            'TRUST_DO_CONNECTING_IP': 'True',
        }, probe='import django; django.setup()')

        assert proc.returncode == 0, proc.stderr
