"""
OneDriveToken — stores OAuth2 refresh token for Microsoft Graph API.
Only one active token is kept (singleton pattern via get_token / save_token).
"""
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.fields import EncryptedTextField


class OneDriveToken(models.Model):
    """
    Stores the OneDrive OAuth2 credentials (single row).

    SYSPCC-016 FOLLOW-UP 2: access_token/refresh_token are encrypted at rest
    via EncryptedTextField (apps.core.fields), instead of a plaintext
    TextField. Anyone with DB read access (a leaked backup, a compromised
    read replica, an over-privileged internal tool) would otherwise get a
    live credential for the connected Microsoft account, not just a hash.

    Legacy rows written before this change contain plaintext — that is
    handled transparently by EncryptedTextField.from_db_value() (decrypt
    fails -> falls back to the raw value, logs a one-time warning). They get
    re-encrypted automatically the next time save_token() is called; no data
    migration was required for this change. See apps/core/fields.py.
    """

    access_token = EncryptedTextField(_('access token'))
    refresh_token = EncryptedTextField(_('refresh token'))
    expires_at = models.DateTimeField(_('token expiry'))
    account_name = models.CharField(
        _('cuenta'),
        max_length=200,
        blank=True,
        help_text=_('Email or display name of the connected OneDrive account'),
    )
    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'onedrive_token'
        verbose_name = 'OneDrive Token'

    def __str__(self):
        return f'OneDrive: {self.account_name or "connected"}'

    @classmethod
    def get_token(cls):
        """Return the singleton token row, or None."""
        return cls.objects.first()

    @classmethod
    def save_token(cls, access_token, refresh_token, expires_at, account_name=''):
        """Upsert the singleton token row."""
        token = cls.objects.first()
        if token:
            token.access_token = access_token
            token.refresh_token = refresh_token
            token.expires_at = expires_at
            token.account_name = account_name or token.account_name
            token.save()
        else:
            token = cls.objects.create(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
                account_name=account_name,
            )
        return token
