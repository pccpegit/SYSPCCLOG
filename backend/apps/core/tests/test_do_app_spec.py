"""SYSPCC-024 (QA ronda 1): spec de App Platform, renderizado de secretos y scripts.

Pruebas estaticas: no llaman a DigitalOcean ni a doctl. Si el repo se monta
sin `.do/` (p. ej. el contenedor de desarrollo solo ve ./backend) se omiten.
"""

import importlib.util
import os
import stat
import sys
import subprocess
from pathlib import Path

import pytest
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parent
DO_DIR = REPO_ROOT / '.do'
SPEC_PATH = DO_DIR / 'app.yaml'
RENDER_SCRIPT = DO_DIR / 'render_spec.py'

pytestmark = pytest.mark.skipif(not SPEC_PATH.is_file(), reason='.do/ no esta montado en este entorno')

COMPONENT_SECTIONS = ('services', 'workers', 'jobs', 'static_sites')
SECRET_KEYS = {
    'SECRET_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
    'ONEDRIVE_TOKEN_ENCRYPTION_KEY', 'ANTHROPIC_API_KEY', 'RUC_API_TOKEN', 'EMAIL_HOST_PASSWORD',
    'HR_AWS_ACCESS_KEY_ID', 'HR_AWS_SECRET_ACCESS_KEY',
}
DB_KEYS = {'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'}


@pytest.fixture(scope='module')
def spec():
    return yaml.safe_load(SPEC_PATH.read_text(encoding='utf-8'))


@pytest.fixture(scope='module')
def render_spec():
    loader = importlib.util.spec_from_file_location('do_render_spec', RENDER_SCRIPT)
    module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(module)
    return module


def _envs(component):
    return {e['key']: e for e in component.get('envs', [])}


def _component(spec, section, name):
    return next(c for c in spec[section] if c['name'] == name)


class TestSpecStructure:
    def test_all_components_exist(self, spec):
        assert {s['name'] for s in spec['services']} == {'backend', 'redis'}
        assert [w['name'] for w in spec['workers']] == ['worker']
        assert [j['name'] for j in spec['jobs']] == ['migrate']
        assert [s['name'] for s in spec['static_sites']] == ['frontend']

    def test_region_and_branch_are_the_agreed_ones(self, spec):
        assert spec['region'] == 'nyc'
        for section in ('services', 'workers', 'jobs', 'static_sites'):
            for component in spec[section]:
                if 'github' in component:
                    assert component['github']['branch'] == 'develop'
                    assert component['github']['repo'] == 'pccpegit/SYSPCCLOG'

    def test_referenced_source_files_exist(self, spec):
        for section in ('services', 'workers', 'jobs'):
            for component in spec[section]:
                if 'dockerfile_path' not in component:
                    continue
                assert (REPO_ROOT / component['dockerfile_path']).is_file(), component['name']
                assert (REPO_ROOT / component['source_dir']).is_dir(), component['name']
        assert (REPO_ROOT / 'frontend' / 'package.json').is_file()

    def test_backend_runs_start_script_and_healthz(self, spec):
        backend = _component(spec, 'services', 'backend')

        assert backend['run_command'] == 'sh scripts/do-start.sh'
        assert backend['http_port'] == 8080
        assert backend['health_check']['http_path'] == '/healthz/'
        assert (BACKEND_DIR / 'scripts' / 'do-start.sh').is_file()

    def test_job_is_pre_deploy_and_runs_predeploy_script(self, spec):
        job = _component(spec, 'jobs', 'migrate')

        assert job['kind'] == 'PRE_DEPLOY'
        assert job['run_command'] == 'sh scripts/do-predeploy.sh'
        assert (BACKEND_DIR / 'scripts' / 'do-predeploy.sh').is_file()

    def test_managed_postgres_not_dev_database(self, spec):
        db = spec['databases'][0]

        assert db['engine'] == 'PG'
        assert db['production'] is True  # Dev DB: sin CREATE en schema public (PG15+)
        assert db['cluster_name']

    def test_worker_consumes_default_and_hr_cv_queues_with_single_beat(self, spec):
        worker = _component(spec, 'workers', 'worker')

        assert '-B' in worker['run_command'].split()
        assert '-Q celery,hr_cv' in worker['run_command']
        assert '-c 2' in worker['run_command']
        assert 'django_celery_beat.schedulers:DatabaseScheduler' in worker['run_command']
        assert worker['instance_count'] == 1  # beat embebido: nunca escalar

    def test_redis_is_internal_only(self, spec):
        redis = _component(spec, 'services', 'redis')

        assert redis['internal_ports'] == [6379]
        assert 'http_port' not in redis
        assert '--save ""' not in redis['run_command']  # comillas vacias: sin shell se rompen

    def test_frontend_build_does_not_reinstall_dependencies(self, spec):
        frontend = _component(spec, 'static_sites', 'frontend')

        assert frontend['build_command'] == 'npm run build'
        assert frontend['output_dir'] == 'dist'
        assert frontend['catchall_document'] == 'index.html'
        assert _envs(frontend)['VITE_API_URL']['value'] == '/api/v1/'
        # Same-origin: sin dependencia de que ${APP_URL} se resuelva en el build.
        assert _envs(frontend)['VITE_BACKEND_URL']['value'] == ''
        assert all(e['scope'] == 'BUILD_TIME' for e in frontend['envs'])

    def test_node_engine_is_pinned(self):
        import json
        package = json.loads((REPO_ROOT / 'frontend' / 'package.json').read_text())

        assert package['engines']['node'] == '22.x'


class TestIngress:
    def test_api_routes_preserve_the_path_prefix(self, spec):
        rules = {r['match']['path']['prefix']: r['component'] for r in spec['ingress']['rules']}

        for prefix in ('/api', '/mgmt-panel', '/static'):
            assert rules[prefix]['name'] == 'backend'
            assert rules[prefix]['preserve_path_prefix'] is True, prefix

    def test_healthz_and_media_are_not_published_on_the_internet(self, spec):
        # The platform health_check reaches the component directly, and
        # production does not serve /media: exposing them only adds attack surface.
        prefixes = {r['match']['path']['prefix'] for r in spec['ingress']['rules']}

        assert prefixes == {'/api', '/mgmt-panel', '/static', '/'}
        assert _component(spec, 'services', 'backend')['health_check']['http_path'] == '/healthz/'

    def test_catch_all_goes_to_the_spa_and_is_last(self, spec):
        rules = spec['ingress']['rules']

        assert rules[-1]['match']['path']['prefix'] == '/'
        assert rules[-1]['component']['name'] == 'frontend'

    def test_every_ingress_component_exists(self, spec):
        names = {c['name'] for s in COMPONENT_SECTIONS for c in spec[s]}

        for rule in spec['ingress']['rules']:
            assert rule['component']['name'] in names


class TestSpecSecrets:
    def _all_envs(self, spec):
        yield from spec['envs']
        for section in COMPONENT_SECTIONS:
            for component in spec[section]:
                yield from component.get('envs', [])

    def test_template_contains_no_secret_values(self, spec):
        for env in self._all_envs(spec):
            if env['key'] in SECRET_KEYS:
                assert env.get('type') == 'SECRET', env['key']
                assert env['value'] == '', env['key']

    def test_template_has_no_credentials_like_literals(self):
        text = SPEC_PATH.read_text(encoding='utf-8')

        for needle in ('sk-ant-', 'AKIA', 'BEGIN PRIVATE KEY', 'dop_v1_'):
            assert needle not in text

    def test_db_bindables_are_general_and_per_component(self, spec):
        app_level = {e['key'] for e in spec['envs']}
        assert not (app_level & DB_KEYS)  # nunca a nivel app

        for section, name in (('services', 'backend'), ('workers', 'worker'), ('jobs', 'migrate')):
            envs = _envs(_component(spec, section, name))
            assert DB_KEYS <= set(envs), name
            for key in DB_KEYS:
                assert 'type' not in envs[key], f'{name}.{key} no debe ser SECRET (el bindable no se interpola)'
                assert envs[key]['value'].startswith('${db.'), f'{name}.{key}'

    def test_integration_secrets_are_component_scoped_for_least_privilege(self, spec):
        app_secrets = {e['key'] for e in spec['envs'] if e.get('type') == 'SECRET'}
        assert app_secrets == {'SECRET_KEY'}  # the only one every component needs

        job_secrets = {
            e['key'] for e in _component(spec, 'jobs', 'migrate').get('envs', []) if e.get('type') == 'SECRET'
        }
        assert job_secrets == set()  # migrate gets SECRET_KEY (app) + DB_* only

        backend = {k for k, e in _envs(_component(spec, 'services', 'backend')).items() if e.get('type') == 'SECRET'}
        worker = {k for k, e in _envs(_component(spec, 'workers', 'worker')).items() if e.get('type') == 'SECRET'}
        assert {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY', 'RUC_API_TOKEN',
                'ONEDRIVE_TOKEN_ENCRYPTION_KEY', 'EMAIL_HOST_PASSWORD'} <= backend
        assert {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY',
                'ONEDRIVE_TOKEN_ENCRYPTION_KEY', 'EMAIL_HOST_PASSWORD'} <= worker
        assert 'RUC_API_TOKEN' not in worker  # only the web API calls apisperu

    def test_hr_bucket_can_use_its_own_spaces_key(self, spec):
        for section, name in (('services', 'backend'), ('workers', 'worker')):
            envs = _envs(_component(spec, section, name))
            assert envs['HR_AWS_ACCESS_KEY_ID']['value'] == ''
            assert envs['HR_AWS_SECRET_ACCESS_KEY']['value'] == ''

    def test_redis_errors_are_swallowed_only_because_throttles_have_their_own_cache(self, spec):
        envs = {e['key']: e for e in spec['envs']}

        assert envs['DJANGO_REDIS_IGNORE_EXCEPTIONS']['value'] == 'True'
        text = SPEC_PATH.read_text(encoding='utf-8')
        assert 'THROTTLE_CACHE_ALIAS' in text  # documented next to the toggle

    def test_do_specific_toggles_and_no_num_proxies(self, spec):
        envs = {e['key']: e for e in spec['envs']}

        assert envs['TRUST_DO_CONNECTING_IP']['value'] == 'True'
        assert 'NUM_PROXIES' not in envs  # TRUST_DO_* fija 0; NUM_PROXIES rompe el throttling
        assert envs['DB_CONN_MAX_AGE']['value'] == '60'
        assert envs['DJANGO_SETTINGS_MODULE']['value'] == 'config.settings.production'
        assert envs['DJANGO_ENV']['value'] == 'production'  # seed_guard bloquea seed_demo
        assert envs['HR_FILE_STORAGE']['value'] == 'apps.hr.storage.PrivateS3Storage'
        assert envs['AWS_STORAGE_BUCKET_NAME']['value'] != envs['HR_PRIVATE_BUCKET_NAME']['value']

    def test_app_does_not_depend_on_a_dev_database_bindable_in_secrets(self, spec):
        assert not any(e.get('type') == 'SECRET' and '${db.' in str(e.get('value')) for e in self._all_envs(spec))

    def test_gitignore_covers_secret_files(self):
        gitignore = (REPO_ROOT / '.gitignore').read_text()

        assert '.env.do' in gitignore
        assert '.do/*.rendered.yaml' in gitignore


class TestRenderSpec:
    ENV_TEXT = (
        '# comentario\n'
        'SECRET_KEY=abc=def==\n'
        'export AWS_ACCESS_KEY_ID="AKID"\n'
        "AWS_SECRET_ACCESS_KEY='shh'\n"
        'ONEDRIVE_TOKEN_ENCRYPTION_KEY=fernet-key\n'
        '\n'
        'HR_COMPANY_NAME=PCC S.A.C.\n'
    )

    def test_parse_env_file_handles_quotes_export_comments_and_equals(self, render_spec, tmp_path):
        path = tmp_path / '.env.do'
        path.write_text(self.ENV_TEXT)

        values = render_spec.parse_env_file(path)

        assert values == {
            'SECRET_KEY': 'abc=def==',
            'AWS_ACCESS_KEY_ID': 'AKID',
            'AWS_SECRET_ACCESS_KEY': 'shh',
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY': 'fernet-key',
            'HR_COMPANY_NAME': 'PCC S.A.C.',
        }

    def test_parse_env_file_strips_inline_comments_but_keeps_quoted_hashes(self, render_spec, tmp_path):
        path = tmp_path / '.env.do'
        path.write_text(
            'SECRET_KEY=abc123   # nota\n'
            'AWS_ACCESS_KEY_ID="AK # ID"  # comentario\n'
            "AWS_SECRET_ACCESS_KEY='s#h'\n"
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY=key#sin-espacio\n'
            'HR_COMPANY_NAME=PCC   #\n'
        )

        values = render_spec.parse_env_file(path)

        assert values == {
            'SECRET_KEY': 'abc123',
            'AWS_ACCESS_KEY_ID': 'AK # ID',
            'AWS_SECRET_ACCESS_KEY': 's#h',
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY': 'key#sin-espacio',  # `#` without leading space is data
            'HR_COMPANY_NAME': 'PCC',
        }

    def test_parse_env_file_rejects_malformed_line(self, render_spec, tmp_path):
        path = tmp_path / '.env.do'
        path.write_text('SECRET_KEY\n')

        with pytest.raises(SystemExit, match='línea inválida'):
            render_spec.parse_env_file(path)

    def test_render_fills_secrets_drops_optionals_and_keeps_placeholders(self, render_spec, spec):
        secrets = {
            'SECRET_KEY': 's', 'AWS_ACCESS_KEY_ID': 'a', 'AWS_SECRET_ACCESS_KEY': 'b',
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY': 'f', 'HR_COMPANY_NAME': 'PCC',
        }
        rendered = render_spec.render(yaml.safe_load(SPEC_PATH.read_text()), secrets)
        envs = {e['key']: e['value'] for e in rendered['envs']}

        assert envs['SECRET_KEY'] == 's'
        assert envs['HR_COMPANY_NAME'] == 'PCC'
        # Opcionales sin valor: se eliminan (el backend usa su default)
        for key in ('ANTHROPIC_API_KEY', 'RUC_API_TOKEN', 'EMAIL_HOST_PASSWORD', 'HR_COMPANY_RUC', 'HR_MIN_WAGE'):
            assert key not in envs
        # Placeholders de DO y valores fijos intactos
        assert envs['ALLOWED_HOSTS'] == '${APP_DOMAIN}'
        assert envs['TRUST_DO_CONNECTING_IP'] == 'True'
        backend_envs = {e['key']: e['value'] for e in _component(rendered, 'services', 'backend')['envs']}
        assert backend_envs['DB_HOST'] == '${db.HOSTNAME}'
        # Ningun valor vacio queda en el spec renderizado, salvo VITE_BACKEND_URL
        # (vacio a proposito: SPA y API comparten origin).
        every = list(rendered['envs'])
        for section in COMPONENT_SECTIONS:
            for component in rendered[section]:
                every += component.get('envs', [])
        assert [e['key'] for e in every if e['value'] == ''] == ['VITE_BACKEND_URL']
        frontend = _component(rendered, 'static_sites', 'frontend')
        assert _envs(frontend)['VITE_BACKEND_URL']['value'] == ''
        assert _envs(frontend)['VITE_BACKEND_URL']['scope'] == 'BUILD_TIME'

    @pytest.mark.parametrize('missing', sorted({
        'SECRET_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ONEDRIVE_TOKEN_ENCRYPTION_KEY',
    }))
    def test_render_aborts_when_a_required_secret_is_missing(self, render_spec, missing):
        secrets = {
            'SECRET_KEY': 's', 'AWS_ACCESS_KEY_ID': 'a', 'AWS_SECRET_ACCESS_KEY': 'b',
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY': 'f',
        }
        del secrets[missing]

        with pytest.raises(SystemExit, match=missing):
            render_spec.render(yaml.safe_load(SPEC_PATH.read_text()), secrets)

    def test_empty_required_secret_counts_as_missing(self, render_spec):
        secrets = {
            'SECRET_KEY': '', 'AWS_ACCESS_KEY_ID': 'a', 'AWS_SECRET_ACCESS_KEY': 'b',
            'ONEDRIVE_TOKEN_ENCRYPTION_KEY': 'f',
        }

        with pytest.raises(SystemExit, match='SECRET_KEY'):
            render_spec.render(yaml.safe_load(SPEC_PATH.read_text()), secrets)

    def test_cli_writes_private_file_and_never_touches_the_template(self, tmp_path):
        env_file = tmp_path / '.env.do'
        env_file.write_text(self.ENV_TEXT)
        out = tmp_path / 'rendered.yaml'
        before = SPEC_PATH.read_text()

        proc = subprocess.run(
            [sys.executable, str(RENDER_SCRIPT), '--env', str(env_file), '--out', str(out)],
            capture_output=True, text=True, timeout=60,
        )

        assert proc.returncode == 0, proc.stderr
        assert stat.S_IMODE(out.stat().st_mode) == 0o600
        assert SPEC_PATH.read_text() == before
        assert yaml.safe_load(out.read_text())['envs'][0]['key'] == 'DJANGO_SETTINGS_MODULE'

    def test_cli_fails_without_env_file(self, tmp_path):
        proc = subprocess.run(
            [sys.executable, str(RENDER_SCRIPT), '--env', str(tmp_path / 'nope'), '--out', str(tmp_path / 'o.yaml')],
            capture_output=True, text=True, timeout=60,
        )

        assert proc.returncode != 0
        assert not (tmp_path / 'o.yaml').exists()


class TestShellScripts:
    START = BACKEND_DIR / 'scripts' / 'do-start.sh'
    PREDEPLOY = BACKEND_DIR / 'scripts' / 'do-predeploy.sh'

    @pytest.mark.parametrize('script', [START, PREDEPLOY], ids=['start', 'predeploy'])
    def test_posix_syntax_and_fail_fast(self, script):
        proc = subprocess.run(['sh', '-n', str(script)], capture_output=True, text=True)

        assert proc.returncode == 0, proc.stderr
        assert script.read_text().startswith('#!/bin/sh')
        assert 'set -e' in script.read_text()

    @pytest.mark.parametrize('script', [START, PREDEPLOY], ids=['start', 'predeploy'])
    def test_scripts_are_executable(self, script):
        assert os.access(script, os.X_OK)

    def test_start_collects_static_then_execs_gunicorn_without_migrating(self):
        text = self.START.read_text()
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith('#')]

        assert 'migrate' not in '\n'.join(lines)  # lo hace el job PRE_DEPLOY
        assert lines.index('python manage.py collectstatic --noinput') < next(
            i for i, ln in enumerate(lines) if ln.startswith('exec gunicorn')
        )
        assert '${PORT:-8080}' in text  # App Platform inyecta PORT; 8080 = http_port del spec
        assert 'config.wsgi:application' in text

    def test_predeploy_migrates_before_seeding_and_never_seeds_demo(self):
        lines = [ln.strip() for ln in self.PREDEPLOY.read_text().splitlines()
                 if ln.strip() and not ln.strip().startswith('#')]

        assert lines.index('python manage.py migrate --noinput') < lines.index('python manage.py seed_data')
        assert not any('seed_demo' in ln for ln in lines)

    def test_start_aborts_on_failing_collectstatic(self, tmp_path):
        # Con `set -e`, si collectstatic falla gunicorn NO debe arrancar.
        fake_bin = tmp_path / 'bin'
        fake_bin.mkdir()
        for name, code in (('python', 1), ('gunicorn', 0)):
            tool = fake_bin / name
            tool.write_text(f'#!/bin/sh\necho "{name} $@" >> "{tmp_path}/calls"\nexit {code}\n')
            tool.chmod(0o755)
        env = {'PATH': f'{fake_bin}:/usr/bin:/bin', 'PORT': '9090'}

        proc = subprocess.run(['sh', str(self.START)], env=env, capture_output=True, text=True, timeout=30)
        calls = (tmp_path / 'calls').read_text()

        assert proc.returncode == 1
        assert 'python manage.py collectstatic --noinput' in calls
        assert 'gunicorn' not in calls

    def test_start_passes_port_and_defaults_to_gunicorn(self, tmp_path):
        fake_bin = tmp_path / 'bin'
        fake_bin.mkdir()
        for name in ('python', 'gunicorn'):
            tool = fake_bin / name
            tool.write_text(f'#!/bin/sh\necho "{name} $@" >> "{tmp_path}/calls"\nexit 0\n')
            tool.chmod(0o755)

        subprocess.run(['sh', str(self.START)], env={'PATH': f'{fake_bin}:/usr/bin:/bin', 'PORT': '9090'},
                       capture_output=True, text=True, timeout=30, check=True)
        subprocess.run(['sh', str(self.START)], env={'PATH': f'{fake_bin}:/usr/bin:/bin'},
                       capture_output=True, text=True, timeout=30, check=True)
        gunicorn_calls = [ln for ln in (tmp_path / 'calls').read_text().splitlines() if ln.startswith('gunicorn')]

        assert '--bind 0.0.0.0:9090' in gunicorn_calls[0]
        assert '--bind 0.0.0.0:8080' in gunicorn_calls[1]
        assert '--workers 1 --threads 4' in gunicorn_calls[1]

    def test_predeploy_stops_if_migrate_fails_and_does_not_seed(self, tmp_path):
        fake_bin = tmp_path / 'bin'
        fake_bin.mkdir()
        tool = fake_bin / 'python'
        tool.write_text(f'#!/bin/sh\necho "$@" >> "{tmp_path}/calls"\nexit 1\n')
        tool.chmod(0o755)

        proc = subprocess.run(['sh', str(self.PREDEPLOY)], env={'PATH': f'{fake_bin}:/usr/bin:/bin'},
                              capture_output=True, text=True, timeout=30)

        assert proc.returncode == 1
        assert (tmp_path / 'calls').read_text().strip() == 'manage.py migrate --noinput'
