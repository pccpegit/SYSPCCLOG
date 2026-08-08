"""
OneDriveToken — stores OAuth2 refresh token for Microsoft Graph API.
Only one active token is kept (singleton pattern via get_token / save_token).
"""
from django.db import models
from django.utils.translation import gettext_lazy as _


class OneDriveToken(models.Model):
    """
    Stores the OneDrive OAuth2 credentials (single row).

    # TODO(security) SYSPCC-011: access_token/refresh_token are stored in
    # plaintext TextField columns. Anyone with DB read access (a leaked backup,
    # a compromised read replica, an over-privileged internal tool) gets a
    # live credential for the connected Microsoft account, not just a hash.
    # Mitigation deferred: encrypting these at rest (e.g. cryptography.fernet
    # with a key from settings/env, encrypt in save_token()/decrypt in
    # get_token()) needs the `cryptography` package, which is not currently
    # in requirements.txt / installed in the runtime image — adding a new
    # dependency and a migration for this was judged out of scope for this
    # ticket. Until then: restrict DB/backup access tightly, and treat this
    # table as equivalent in sensitivity to a plaintext credential store.
    """

    access_token = models.TextField(_('access token'))
    refresh_token = models.TextField(_('refresh token'))
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
