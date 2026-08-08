"""
Custom Django model fields shared across apps.
"""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)

_fernet_cache = {}
_warned_legacy_plaintext_fields = set()


def get_encryption_key():
    """
    Return the Fernet key used by EncryptedTextField.

    Preferred: ``ONEDRIVE_TOKEN_ENCRYPTION_KEY`` from settings/env — a
    dedicated, randomly generated Fernet key (32 url-safe-base64-encoded
    bytes). Generate one with:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    Fallback (dev convenience only): derive a deterministic key from
    ``SECRET_KEY`` via SHA-256, so the app works out of the box with no
    extra config. This fallback is NOT a substitute for a dedicated key in
    production:
      - SECRET_KEY also signs JWTs/sessions; rotating it would silently
        break decryption of every already-stored encrypted value.
      - A SECRET_KEY leak would also compromise everything encrypted here.
    Production MUST set ONEDRIVE_TOKEN_ENCRYPTION_KEY explicitly.
    """
    configured = getattr(settings, 'ONEDRIVE_TOKEN_ENCRYPTION_KEY', '') or ''
    if configured:
        return configured.encode() if isinstance(configured, str) else configured
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet():
    # Cached by key bytes rather than as a single module-level singleton, so
    # that `override_settings(ONEDRIVE_TOKEN_ENCRYPTION_KEY=...)` in tests
    # (or a key rotation) is picked up correctly instead of reusing a stale
    # Fernet instance built from a previous key.
    key = get_encryption_key()
    fernet = _fernet_cache.get(key)
    if fernet is None:
        fernet = Fernet(key)
        _fernet_cache[key] = fernet
    return fernet


class EncryptedTextField(models.TextField):
    """
    A TextField that transparently encrypts values at rest using Fernet
    (symmetric, authenticated encryption from the `cryptography` package).
    Reusable anywhere a text value needs encryption at rest, not just
    OneDrive tokens.

    - Encryption key: see `get_encryption_key()`.
    - Legacy / mixed-content compatibility: rows written before this field
      existed (or written directly to the DB) may contain plaintext, not a
      Fernet token. `from_db_value` tries to decrypt; if that fails
      (`InvalidToken`, malformed base64, wrong token structure — i.e. the
      stored value isn't a Fernet token at all), it logs a one-time warning
      per field and returns the raw stored value as-is instead of raising.
      This means legacy plaintext rows keep working transparently, and get
      re-encrypted automatically the next time the row is saved. Do not
      remove this fallback without first running a data migration that
      re-encrypts every existing row.
    - Never logs the field's value (plaintext or ciphertext), only the
      field name, to avoid leaking secrets into logs.
    """

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None or value == '':
            return value
        return _get_fernet().encrypt(value.encode()).decode()

    def from_db_value(self, value, expression, connection):
        if value is None or value == '':
            return value
        try:
            return _get_fernet().decrypt(value.encode()).decode()
        except (InvalidToken, ValueError, TypeError):
            if self.name not in _warned_legacy_plaintext_fields:
                logger.warning(
                    'EncryptedTextField: value failed to decrypt for field '
                    '%r — treating as legacy plaintext and returning as-is. '
                    'It will be re-encrypted on next save. (Value itself is '
                    'never logged.)',
                    self.name,
                )
                _warned_legacy_plaintext_fields.add(self.name)
            return value
