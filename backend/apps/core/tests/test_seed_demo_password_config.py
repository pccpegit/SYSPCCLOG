"""
SYSPCC-017: `DEMO_PASSWORD` (shared login password for demo accounts created
by `seed_demo` / `seed_demo_extra`) must never be a version-controlled
literal. It now comes from the SEED_DEMO_PASSWORD environment variable when
set; otherwise a random per-process password is generated and printed once
via `warn_if_password_generated()`.

DEMO_PASSWORD is resolved once at module import time (both commands import
it directly), so these tests reload the module under a patched environment
to exercise both branches.
"""
import importlib
from unittest import mock

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.core.management.commands import seed_demo as seed_demo_module

OLD_HARDCODED_LITERAL = 'Demo2026Pcc!'


def _reload_seed_demo():
    return importlib.reload(seed_demo_module)


@pytest.fixture(autouse=True)
def _restore_seed_demo_module_after_test():
    """Reload seed_demo once more after each test, once monkeypatch has
    undone its env changes, so DEMO_PASSWORD reflects the real ambient
    environment again for any other test that imports this module."""
    yield
    importlib.reload(seed_demo_module)


class TestDemoPasswordFromEnv:
    def test_uses_env_value_when_set(self, monkeypatch):
        monkeypatch.setenv('SEED_DEMO_PASSWORD', 'CustomDemoPass123!')

        mod = _reload_seed_demo()

        assert mod.DEMO_PASSWORD == 'CustomDemoPass123!'
        assert mod.DEMO_PASSWORD_WAS_GENERATED is False

    def test_generates_random_password_when_env_unset(self, monkeypatch):
        monkeypatch.delenv('SEED_DEMO_PASSWORD', raising=False)

        mod = _reload_seed_demo()

        assert mod.DEMO_PASSWORD_WAS_GENERATED is True
        assert mod.DEMO_PASSWORD != OLD_HARDCODED_LITERAL
        assert len(mod.DEMO_PASSWORD) == 16

    def test_generated_password_is_not_a_fixed_literal_across_runs(self, monkeypatch):
        """Regression guard: must not silently collapse to a fixed default —
        two independent 'runs' (module reloads) with no env var set must
        produce different passwords."""
        monkeypatch.delenv('SEED_DEMO_PASSWORD', raising=False)

        pw1 = _reload_seed_demo().DEMO_PASSWORD
        pw2 = _reload_seed_demo().DEMO_PASSWORD

        assert pw1 != pw2
        assert OLD_HARDCODED_LITERAL not in (pw1, pw2)


class TestWarnIfPasswordGenerated:
    def test_prints_generated_password_once(self, monkeypatch):
        monkeypatch.delenv('SEED_DEMO_PASSWORD', raising=False)
        mod = _reload_seed_demo()

        fake_command = mock.Mock()
        fake_command.style.WARNING = lambda msg: msg

        mod.warn_if_password_generated(fake_command)

        fake_command.stdout.write.assert_called_once()
        printed = fake_command.stdout.write.call_args[0][0]
        assert mod.DEMO_PASSWORD in printed
        assert 'SEED_DEMO_PASSWORD' in printed

    def test_stays_silent_when_password_comes_from_env(self, monkeypatch):
        monkeypatch.setenv('SEED_DEMO_PASSWORD', 'CustomDemoPass123!')
        mod = _reload_seed_demo()

        fake_command = mock.Mock()
        mod.warn_if_password_generated(fake_command)

        fake_command.stdout.write.assert_not_called()


@pytest.mark.django_db
class TestSeedDemoCommandUsesConfiguredPassword:
    """End-to-end: the actual `seed_demo` command run must hash whatever
    DEMO_PASSWORD resolved to — not the old hardcoded literal."""

    @override_settings(DEBUG=True)
    def test_seed_demo_user_password_matches_env_value(self, monkeypatch):
        monkeypatch.setenv('SEED_DEMO_PASSWORD', 'EnvDemoPass123!')
        monkeypatch.setenv('DJANGO_ENV', 'development')
        _reload_seed_demo()

        call_command('seed_demo')

        from apps.core.models import User
        user = User.objects.get(username='jrodriguez')
        assert user.check_password('EnvDemoPass123!')
        assert not user.check_password(OLD_HARDCODED_LITERAL)

    @override_settings(DEBUG=True)
    def test_seed_demo_user_password_is_random_when_env_unset(self, monkeypatch):
        monkeypatch.delenv('SEED_DEMO_PASSWORD', raising=False)
        monkeypatch.setenv('DJANGO_ENV', 'development')
        mod = _reload_seed_demo()

        call_command('seed_demo')

        from apps.core.models import User
        user = User.objects.get(username='jrodriguez')
        assert user.check_password(mod.DEMO_PASSWORD)
        assert not user.check_password(OLD_HARDCODED_LITERAL)
