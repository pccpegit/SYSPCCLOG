"""
SYSPCC-016 FOLLOW-UP 2: OneDriveToken.access_token/refresh_token must be
encrypted at rest via apps.core.fields.EncryptedTextField (Fernet), not
stored as plaintext.

Covers:
  - A saved token round-trips: the model attribute reads back the original
    plaintext, but the raw DB value is NOT the plaintext (it's ciphertext).
  - A legacy row written as plaintext (before this field existed / bypassing
    the ORM) is still readable without crashing — decrypt fails, falls back
    to the raw value.
"""
from django.db import connection
from django.test import override_settings
from django.utils import timezone

import pytest
from cryptography.fernet import Fernet

from apps.core.fields import get_encryption_key
from apps.warehouse.models import OneDriveToken


def _raw_db_value(token_id, column):
    with connection.cursor() as cursor:
        cursor.execute(
            f'SELECT {column} FROM onedrive_token WHERE id = %s',  # noqa: S608 (column is a fixed literal, not user input)
            [token_id],
        )
        return cursor.fetchone()[0]


@pytest.mark.django_db
class TestOneDriveTokenEncryptionRoundTrip:
    def test_saved_token_is_encrypted_in_db_but_readable_via_model(self):
        plaintext_access = 'super-secret-access-token-value'
        plaintext_refresh = 'super-secret-refresh-token-value'

        token = OneDriveToken.save_token(
            access_token=plaintext_access,
            refresh_token=plaintext_refresh,
            expires_at=timezone.now(),
            account_name='warehouse@pcc.com.pe',
        )

        raw_access = _raw_db_value(token.id, 'access_token')
        raw_refresh = _raw_db_value(token.id, 'refresh_token')

        # Ciphertext in the DB must not equal (or contain) the plaintext.
        assert raw_access != plaintext_access
        assert plaintext_access not in raw_access
        assert raw_refresh != plaintext_refresh
        assert plaintext_refresh not in raw_refresh

        # Round-trip through the ORM decrypts transparently.
        reloaded = OneDriveToken.objects.get(pk=token.id)
        assert reloaded.access_token == plaintext_access
        assert reloaded.refresh_token == plaintext_refresh

    def test_update_via_save_token_re_encrypts_with_new_value(self):
        token = OneDriveToken.save_token(
            access_token='first-token',
            refresh_token='first-refresh',
            expires_at=timezone.now(),
        )
        OneDriveToken.save_token(
            access_token='second-token',
            refresh_token='second-refresh',
            expires_at=timezone.now(),
        )

        reloaded = OneDriveToken.objects.get(pk=token.id)
        assert reloaded.access_token == 'second-token'
        assert reloaded.refresh_token == 'second-refresh'
        raw_access = _raw_db_value(token.id, 'access_token')
        assert 'second-token' not in raw_access


@pytest.mark.django_db
class TestOneDriveTokenLegacyPlaintextFallback:
    def test_legacy_plaintext_row_reads_back_without_crashing(self):
        """Simulates a row written before EncryptedTextField existed (or by
        raw SQL) — value is plaintext, not a Fernet token."""
        token = OneDriveToken.objects.create(
            access_token='placeholder',
            refresh_token='placeholder',
            expires_at=timezone.now(),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE onedrive_token SET access_token = %s, refresh_token = %s WHERE id = %s',
                ['legacy-plaintext-access', 'legacy-plaintext-refresh', token.id],
            )

        reloaded = OneDriveToken.objects.get(pk=token.id)

        # Must not raise, and must fall back to the raw (plaintext) value.
        assert reloaded.access_token == 'legacy-plaintext-access'
        assert reloaded.refresh_token == 'legacy-plaintext-refresh'

    def test_legacy_row_gets_re_encrypted_on_next_save(self):
        token = OneDriveToken.objects.create(
            access_token='placeholder',
            refresh_token='placeholder',
            expires_at=timezone.now(),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE onedrive_token SET access_token = %s WHERE id = %s',
                ['legacy-plaintext-access', token.id],
            )

        reloaded = OneDriveToken.objects.get(pk=token.id)
        reloaded.save()  # re-save should re-encrypt via get_prep_value

        raw_access = _raw_db_value(token.id, 'access_token')
        assert raw_access != 'legacy-plaintext-access'
        assert 'legacy-plaintext-access' not in raw_access

        reloaded_again = OneDriveToken.objects.get(pk=token.id)
        assert reloaded_again.access_token == 'legacy-plaintext-access'


class TestEncryptionKeyDerivation:
    def test_derives_deterministic_key_from_secret_key_when_unset(self):
        with override_settings(ONEDRIVE_TOKEN_ENCRYPTION_KEY=''):
            key1 = get_encryption_key()
            key2 = get_encryption_key()
        assert key1 == key2
        # Must be a valid Fernet key (does not raise).
        Fernet(key1)

    def test_uses_configured_key_when_set(self):
        dedicated_key = Fernet.generate_key().decode()
        with override_settings(ONEDRIVE_TOKEN_ENCRYPTION_KEY=dedicated_key):
            key = get_encryption_key()
        assert key == dedicated_key.encode()

    @pytest.mark.django_db
    def test_round_trip_with_explicit_dedicated_key(self):
        dedicated_key = Fernet.generate_key().decode()
        with override_settings(ONEDRIVE_TOKEN_ENCRYPTION_KEY=dedicated_key):
            token = OneDriveToken.save_token(
                access_token='dedicated-key-token',
                refresh_token='dedicated-key-refresh',
                expires_at=timezone.now(),
            )
            reloaded = OneDriveToken.objects.get(pk=token.id)
            assert reloaded.access_token == 'dedicated-key-token'
