"""
SYSPCC-011 FIX 4: shared safety guard for demo/seed data management commands.

`seed_demo`, `seed_demo_extra` and `seed_screenshots` all create demo user
accounts sharing a single hardcoded, version-controlled password
(`Demo2026Pcc!`). That is acceptable for local development and staging demo
environments, but running any of these commands against a production database
would create real, internet-reachable accounts with a publicly known
password. `abort_if_production()` is called as the very first thing each
command's `handle()` does, so no seed data is written before the check runs.

NOTE: this file intentionally does NOT live in `management/commands/` — files
in that directory are auto-discovered as management commands by name, and this
module isn't one.
"""

import os

from django.conf import settings
from django.core.management.base import CommandError


def abort_if_production():
    """
    Raise CommandError if this process looks like it is running in production.

    Two independent signals are checked so a single misconfiguration can't let
    a demo seed slip into a real deployment:
      - settings.DEBUG must be True. `config/settings/production.py`
        hardcodes DEBUG = False, so a real prod deployment always fails this.
      - DJANGO_ENV must not be 'production', as an explicit extra signal for
        ops tooling/CI that may not flip DEBUG for a given run.
    """
    django_env = os.environ.get('DJANGO_ENV', '')
    if not settings.DEBUG or django_env == 'production':
        raise CommandError(
            'Este comando siembra datos DEMO con una contraseña COMPARTIDA y '
            'versionada en el repositorio (Demo2026Pcc!). Nunca debe '
            'ejecutarse en producción. '
            f'Abortando (settings.DEBUG={settings.DEBUG!r}, '
            f'DJANGO_ENV={django_env or None!r}).'
        )
