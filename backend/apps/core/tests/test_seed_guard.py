"""
SYSPCC-011 FIX 4: seed_demo / seed_demo_extra / seed_screenshots must refuse to
run outside development. They create demo accounts sharing a single password
(SYSPCC-017: seed_demo/seed_demo_extra read it from SEED_DEMO_PASSWORD or
generate one per run; seed_screenshots still uses a hardcoded literal) —
running them against a production database would create real,
internet-reachable accounts with a widely-known password.
"""
import os
from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from apps.core.models import User


def _run(command_name, **kwargs):
    call_command(command_name, **kwargs)


@pytest.mark.django_db
class TestSeedDemoProductionGuard:
    # NOTE: pytest-django forces settings.DEBUG = False for the whole test run
    # by default (mirroring Django's own test runner), independent of
    # DJANGO_SETTINGS_MODULE=config.settings.development where DEBUG is
    # normally True. So `DEBUG=False` is already pytest's baseline here — tests
    # that need to prove the *DEBUG=True* path use `override_settings(DEBUG=True)`
    # explicitly rather than relying on the ambient pytest value.

    @override_settings(DEBUG=False)
    def test_seed_demo_aborts_when_debug_false(self):
        with pytest.raises(CommandError):
            _run('seed_demo')
        assert not User.objects.filter(username='jrodriguez').exists()

    @override_settings(DEBUG=True)
    def test_seed_demo_aborts_when_django_env_production_even_if_debug_true(self):
        """Isolates the DJANGO_ENV signal: even if DEBUG were misconfigured to
        True in something that looks like production, DJANGO_ENV=production
        alone must still abort the command."""
        with mock.patch.dict(os.environ, {'DJANGO_ENV': 'production'}):
            with pytest.raises(CommandError):
                _run('seed_demo')
        assert not User.objects.filter(username='jrodriguez').exists()

    @override_settings(DEBUG=True)
    def test_seed_demo_runs_when_debug_true_and_env_not_production(self):
        """Sanity check: with the guard's actual pass condition
        (DEBUG=True, DJANGO_ENV != 'production' — i.e. what a real `python
        manage.py seed_demo` run looks like in development), the command must
        still complete — otherwise every seed-dependent dev workflow would break."""
        with mock.patch.dict(os.environ, {'DJANGO_ENV': 'development'}):
            _run('seed_demo')
        assert User.objects.filter(username='jrodriguez').exists()


@pytest.mark.django_db
class TestSeedDemoExtraProductionGuard:
    @override_settings(DEBUG=False)
    def test_seed_demo_extra_aborts_when_debug_false(self):
        with pytest.raises(CommandError):
            _run('seed_demo_extra')


@pytest.mark.django_db
class TestSeedScreenshotsProductionGuard:
    @override_settings(DEBUG=False)
    def test_seed_screenshots_aborts_when_debug_false(self):
        with pytest.raises(CommandError):
            _run('seed_screenshots')
