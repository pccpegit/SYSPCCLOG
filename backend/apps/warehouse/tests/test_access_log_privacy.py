"""
SYSPCC-025 (seguridad, ronda 1) — el log de acceso de gunicorn no imprime la query string.

La UI busca trabajadores por GET (``personal-lookup/?search=<nombre>``, ``movements/?destination=<nombre>``).
El formato por defecto de gunicorn imprime ``%(r)s`` (la línea de petición, con la query) y ``%(f)s`` (el
referer, que también la lleva): los nombres acabarían en los logs de la plataforma. ``%(U)s`` es la ruta sola.

Vive en ``apps/warehouse`` y no en ``test_do_app_spec`` porque ese módulo se omite entero cuando ``.do/``
no está montado (el contenedor local), y esta comprobación sí debe correr siempre.
"""
import subprocess
from pathlib import Path

import pytest

START = Path(__file__).resolve().parents[3] / 'scripts' / 'do-start.sh'

LEAKY_PLACEHOLDERS = ('%(r)s', '%(q)s', '%(f)s', '%(R)s', '%({referer}i)s')


@pytest.fixture
def gunicorn_args(tmp_path):
    """Run do-start.sh with fake ``python`` / ``gunicorn`` and return the arguments gunicorn got."""
    fake_bin = tmp_path / 'bin'
    fake_bin.mkdir()
    for name in ('python', 'gunicorn'):
        tool = fake_bin / name
        tool.write_text(f'#!/bin/sh\nfor a in "$@"; do echo "ARG:$a" >> "{tmp_path}/{name}.args"; done\nexit 0\n')
        tool.chmod(0o755)
    subprocess.run(
        ['sh', str(START)], env={'PATH': f'{fake_bin}:/usr/bin:/bin'},
        capture_output=True, text=True, timeout=30, check=True,
    )
    return [line[4:] for line in (tmp_path / 'gunicorn.args').read_text().splitlines()]


def test_the_access_log_is_enabled_with_an_explicit_format(gunicorn_args):
    assert '--access-logfile' in gunicorn_args
    assert '--access-logformat' in gunicorn_args


def test_the_format_prints_the_path_only(gunicorn_args):
    log_format = gunicorn_args[gunicorn_args.index('--access-logformat') + 1]
    assert '%(U)s' in log_format
    for leaky in LEAKY_PLACEHOLDERS:
        assert leaky not in log_format, leaky


def test_the_format_is_a_valid_gunicorn_format():
    """Rendered with gunicorn's own logger against a request that carries a worker name in the query."""
    gunicorn_glogging = pytest.importorskip('gunicorn.glogging')
    from gunicorn.config import Config

    text = START.read_text()
    log_format = text.split("--access-logformat '", 1)[1].split("'", 1)[0]
    cfg = Config()
    cfg.set('accesslog', '-')
    cfg.set('access_log_format', log_format)
    logger = gunicorn_glogging.Logger(cfg)

    class Req:
        method, uri, path, query, version = 'GET', '/x/personal-lookup/?search=NOMBRE+SECRETO', '/x/personal-lookup/', 'search=NOMBRE+SECRETO', (1, 1)
        headers = [('REFERER', 'http://app/almacen?destination=NOMBRE+SECRETO'), ('USER-AGENT', 'ua')]
        scheme = 'https'

    class Resp:
        status = '200 OK'
        status_code = 200
        sent = 2
        headers = []

    environ = {
        'REMOTE_ADDR': '10.0.0.1', 'REQUEST_METHOD': 'GET', 'RAW_URI': Req.uri, 'PATH_INFO': Req.path,
        'QUERY_STRING': Req.query, 'SERVER_PROTOCOL': 'HTTP/1.1',
        'HTTP_REFERER': 'http://app/almacen?destination=NOMBRE+SECRETO', 'HTTP_USER_AGENT': 'ua',
    }
    from datetime import timedelta

    rendered = logger.atoms(Resp, Req, environ, timedelta(milliseconds=3))
    line = log_format % rendered
    assert '/x/personal-lookup/' in line
    assert 'NOMBRE' not in line and 'SECRETO' not in line and 'search=' not in line
