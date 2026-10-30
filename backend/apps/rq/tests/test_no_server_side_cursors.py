"""
SYSPCC-030 · ningún servicio usa `.iterator()`.

En PostgreSQL `QuerySet.iterator()` abre un cursor del lado del servidor, que no funciona detrás de
un pooler en modo transacción (el pool de conexiones de DigitalOcean). Se revisa el AST (no el
texto, para que un comentario que lo mencione no cuente).
"""
import ast
from pathlib import Path

import pytest

APPS = Path(__file__).resolve().parents[2]
SERVICE_DIRS = [APPS / 'rq' / 'services', APPS / 'warehouse' / 'services']


def _python_files():
    for directory in SERVICE_DIRS:
        yield from sorted(directory.rglob('*.py'))


def test_the_service_directories_exist_and_are_scanned():
    files = list(_python_files())
    assert all(d.is_dir() for d in SERVICE_DIRS)
    assert any(f.name == 'request_master.py' for f in files)
    assert any(f.name == 'rq_fulfillment.py' for f in files)


@pytest.mark.parametrize('path', list(_python_files()), ids=lambda p: f'{p.parent.parent.name}/{p.name}')
def test_no_queryset_iterator_call(path):
    tree = ast.parse(path.read_text(encoding='utf-8'))
    offenders = [
        node.lineno for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'iterator'
    ]
    assert offenders == [], f'{path} usa .iterator() en las líneas {offenders}'
