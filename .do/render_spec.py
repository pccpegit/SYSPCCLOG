#!/usr/bin/env python3
"""Render .do/app.yaml into .do/app.rendered.yaml injecting secrets (SYSPCC-024, SYSPCC-033).

The committed template keeps every secret as ``value: ""``. This script fills
them from a local, gitignored ``.env.do`` file and writes
``.do/app.rendered.yaml`` (also gitignored, mode 0600), which is the file you
pass to ``doctl apps create --spec``.

The .env.do syntax is KEY=value, one per line. Full-line comments (#) and
inline comments (`KEY=value # note`, whitespace before the #) are ignored;
quote a value that itself contains " #".

Rules:
  * Only env vars whose template value is the empty string are touched.
  * Empty in the template AND present (non-empty) in .env.do -> filled in.
  * Empty in the template and missing/empty in .env.do:
      - key in REQUIRED -> error, nothing is written.
      - otherwise       -> the entry is dropped (the backend has a default).
  * Keys in KEEP_EMPTY (VITE_BACKEND_URL) keep their empty value untouched.
  * Placeholders such as ${APP_URL} / ${db.HOSTNAME} / ${db.syspccpool.HOSTNAME} /
    ${cache.CA_CERT} are left untouched: the platform resolves them at deploy time.
  * Optional keys with no value are dropped on purpose (ANTHROPIC_API_KEY, the
    ONEDRIVE_* settings, HR_COMPANY_*...). The script lists them so a forgotten
    ANTHROPIC_API_KEY (CV analysis and the HR assistant need it) is not a surprise.

Never use the rendered file to UPDATE an existing app: start from
``doctl apps spec get <APP_ID>`` (it carries the encrypted EV[...] secrets).

--direct-db (first deployment only): the template points backend and the workers
at the PgBouncer pool ``syspccpool``, which can only be created AFTER the first
deployment (the database and user it needs do not exist before). This flag rewrites
those ``${db.syspccpool.X}`` bindables to the cluster's own ``${db.X}`` and turns
``DB_DISABLE_SERVER_SIDE_CURSORS`` off. After the pool exists, move the live app to
the pool (guide, step 5.2).

Usage (PyYAML is already installed in the backend virtualenv):
    backend/.venv/bin/python .do/render_spec.py [--env .env.do] [--out PATH] [--direct-db]
"""

import argparse
import os
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / '.do' / 'app.yaml'

# Without these the app cannot work: fail loudly instead of deploying broken.
REQUIRED = {
    'SECRET_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'ONEDRIVE_TOKEN_ENCRYPTION_KEY',
}

# Empty on purpose: the value must reach the platform as "" (not be dropped as
# an unfilled optional). VITE_BACKEND_URL="" makes the SPA use same-origin
# relative URLs (frontend/src/api/config.js uses `??`, so an unset var would
# fall back to http://localhost:8000).
KEEP_EMPTY = {'VITE_BACKEND_URL'}

COMPONENT_SECTIONS = ('services', 'workers', 'jobs', 'static_sites')

# Name of the PgBouncer pool the template references (see docs/08, step 5.2).
POOL_PREFIX = '${db.syspccpool.'
DIRECT_PREFIX = '${db.'


def _clean_value(raw):
    """Unquote a .env value and drop an inline `# comment`.

    * Quoted ("..." or '...'): the text up to the closing quote; anything after
      it (such as a trailing comment) is ignored. An unterminated quote is
      kept literally.
    * Unquoted: a `#` preceded by whitespace starts a comment. A secret that
      contains " #" MUST be quoted.
    """
    value = raw.strip()
    if value and value[0] in ('"', "'"):
        end = value.find(value[0], 1)
        if end != -1:
            return value[1:end]
        return value
    return re.split(r'\s+#', value, maxsplit=1)[0].rstrip()


def parse_env_file(path):
    values = {}
    for number, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[len('export '):]
        if '=' not in line:
            raise SystemExit(f'{path}:{number}: línea inválida (se esperaba CLAVE=valor)')
        key, _, value = line.partition('=')
        values[key.strip()] = _clean_value(value)
    return values


def fill_envs(envs, secrets, missing_required, dropped=None):
    """Return a new env list with the empty entries filled or dropped."""
    result = []
    for env in envs or []:
        if env.get('value') != '' or env['key'] in KEEP_EMPTY:
            result.append(env)
            continue
        value = secrets.get(env['key'], '')
        if value:
            result.append({**env, 'value': value})
        elif env['key'] in REQUIRED:
            missing_required.append(env['key'])
        elif dropped is not None:
            dropped.append(env['key'])  # optional and not provided -> dropped on purpose
    return result


def render(spec, secrets, dropped=None):
    """Fill the template; ``dropped`` (optional list) receives the optional keys left out."""
    missing = []
    spec['envs'] = fill_envs(spec.get('envs'), secrets, missing, dropped)
    for section in COMPONENT_SECTIONS:
        for component in spec.get(section, []) or []:
            if 'envs' in component:
                component['envs'] = fill_envs(component['envs'], secrets, missing, dropped)
    if missing:
        raise SystemExit(
            'Faltan secretos obligatorios en .env.do: ' + ', '.join(sorted(set(missing)))
        )
    return spec


def use_direct_db(spec):
    """Point every component at the cluster instead of the pool (first deployment).

    Rewrites ``${db.syspccpool.X}`` to ``${db.X}`` and sets
    DB_DISABLE_SERVER_SIDE_CURSORS to "False" (a direct connection supports
    server-side cursors). Returns the spec.
    """
    for section in COMPONENT_SECTIONS:
        for component in spec.get(section, []) or []:
            for env in component.get('envs', []) or []:
                value = env.get('value')
                if isinstance(value, str) and value.startswith(POOL_PREFIX):
                    env['value'] = DIRECT_PREFIX + value[len(POOL_PREFIX):]
    for env in spec.get('envs', []) or []:
        if env['key'] == 'DB_DISABLE_SERVER_SIDE_CURSORS':
            env['value'] = 'False'
    return spec


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--env', default=str(ROOT / '.env.do'), help='archivo de secretos (default: .env.do)')
    parser.add_argument('--out', default=str(ROOT / '.do' / 'app.rendered.yaml'))
    parser.add_argument('--direct-db', action='store_true',
                        help='primer despliegue: conectar al cluster directo, sin el pool syspccpool')
    args = parser.parse_args()

    env_path = Path(args.env)
    if not env_path.is_file():
        raise SystemExit(f'No existe {env_path}. Créalo a partir de la guía (docs/08, Paso 7).')

    spec = yaml.safe_load(TEMPLATE.read_text(encoding='utf-8'))
    dropped = []
    rendered = render(spec, parse_env_file(env_path), dropped)
    if args.direct_db:
        use_direct_db(rendered)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        yaml.safe_dump(rendered, handle, sort_keys=False, allow_unicode=True)
    print(f'Spec renderizado en {out} (no lo subas a git).')
    if args.direct_db:
        print('Modo --direct-db: backend y workers van al cluster, sin pool (solo para el primer despliegue).')
    if dropped:
        print('Opcionales sin valor (se omitieron; rige el default del backend): '
              + ', '.join(sorted(set(dropped))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
