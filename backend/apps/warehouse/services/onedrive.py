"""
OneDrive integration via Microsoft Graph API.
Uses the device code flow for personal Microsoft accounts.
No Azure AD app registration required — uses Microsoft's public client ID.
"""
import logging
import time
from datetime import timedelta

import requests
from django.utils import timezone

from apps.warehouse.models import OneDriveToken

logger = logging.getLogger(__name__)

# Microsoft's "Microsoft Office" public client ID — works with personal accounts,
# no app registration required.
CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e'
SCOPES = 'Files.ReadWrite offline_access'
AUTHORITY = 'https://login.microsoftonline.com/consumers'
GRAPH_URL = 'https://graph.microsoft.com/v1.0'


class OneDriveService:
    """Handles OAuth2 device code flow and file uploads to OneDrive."""

    # ── Authentication ─────────────────────────────────────────────────────

    @staticmethod
    def initiate_device_code():
        """
        Start the device code flow.
        Returns dict with 'user_code', 'verification_uri', 'device_code', 'interval'.
        """
        resp = requests.post(
            f'{AUTHORITY}/oauth2/v2.0/devicecode',
            data={
                'client_id': CLIENT_ID,
                'scope': SCOPES,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def poll_for_token(device_code, interval=5, timeout=300):
        """
        Poll Microsoft until the user completes the device login.
        Returns token dict on success, or None on timeout/decline.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(interval)
            resp = requests.post(
                f'{AUTHORITY}/oauth2/v2.0/token',
                data={
                    'client_id': CLIENT_ID,
                    'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
                    'device_code': device_code,
                },
                timeout=15,
            )
            data = resp.json()

            if 'access_token' in data:
                # Get account info
                account_name = ''
                try:
                    me = requests.get(
                        f'{GRAPH_URL}/me',
                        headers={'Authorization': f'Bearer {data["access_token"]}'},
                        timeout=10,
                    ).json()
                    account_name = me.get('userPrincipalName') or me.get('displayName', '')
                except (requests.RequestException, ValueError):
                    # ValueError covers resp.json() failing on a non-JSON body.
                    # Non-fatal: the token is already valid, we just miss the
                    # display name — log for observability, don't lose the token.
                    logger.warning('OneDrive: failed to fetch account info after token grant', exc_info=True)

                expires_at = timezone.now() + timedelta(seconds=data.get('expires_in', 3600))
                OneDriveToken.save_token(
                    access_token=data['access_token'],
                    refresh_token=data.get('refresh_token', ''),
                    expires_at=expires_at,
                    account_name=account_name,
                )
                return data

            error = data.get('error', '')
            if error == 'authorization_pending':
                continue
            if error in ('authorization_declined', 'bad_verification_code', 'expired_token'):
                logger.warning('Device code flow failed: %s', error)
                return None

        return None

    @staticmethod
    def _refresh_access_token():
        """Refresh the access token using the stored refresh token."""
        token = OneDriveToken.get_token()
        if not token or not token.refresh_token:
            return None

        resp = requests.post(
            f'{AUTHORITY}/oauth2/v2.0/token',
            data={
                'client_id': CLIENT_ID,
                'grant_type': 'refresh_token',
                'refresh_token': token.refresh_token,
                'scope': SCOPES,
            },
            timeout=15,
        )

        if resp.status_code != 200:
            logger.error('Token refresh failed: %s', resp.text)
            return None

        data = resp.json()
        expires_at = timezone.now() + timedelta(seconds=data.get('expires_in', 3600))
        OneDriveToken.save_token(
            access_token=data['access_token'],
            refresh_token=data.get('refresh_token', token.refresh_token),
            expires_at=expires_at,
        )
        return data['access_token']

    @classmethod
    def get_access_token(cls):
        """Return a valid access token, refreshing if needed."""
        token = OneDriveToken.get_token()
        if not token:
            return None

        # Refresh if expired or about to expire (5 min buffer)
        if timezone.now() >= token.expires_at - timedelta(minutes=5):
            return cls._refresh_access_token()

        return token.access_token

    @classmethod
    def is_connected(cls):
        """Check if OneDrive is connected and the token is valid."""
        token = OneDriveToken.get_token()
        return token is not None

    @classmethod
    def disconnect(cls):
        """Remove stored tokens."""
        OneDriveToken.objects.all().delete()

    # ── File operations ────────────────────────────────────────────────────

    @classmethod
    def upload_file(cls, file_bytes, remote_path):
        """
        Upload a file to OneDrive.
        remote_path: e.g. "SYSPCC-Almacen/2026-04 Abril/ENT-0001_Cemento.pdf"
        Returns the sharing URL or None on failure.
        """
        access_token = cls.get_access_token()
        if not access_token:
            logger.warning('OneDrive not connected — skipping upload for %s', remote_path)
            return None

        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/octet-stream',
        }

        # Use simple upload for files < 4MB (our PDFs are tiny)
        upload_url = f'{GRAPH_URL}/me/drive/root:/{remote_path}:/content'

        try:
            resp = requests.put(
                upload_url,
                headers=headers,
                data=file_bytes,
                timeout=30,
            )

            if resp.status_code in (200, 201):
                item = resp.json()
                # Create a sharing link
                share_url = cls._create_share_link(access_token, item['id'])
                return share_url or item.get('webUrl', '')

            logger.error('OneDrive upload failed (%s): %s', resp.status_code, resp.text)
            return None

        except requests.RequestException as exc:
            logger.error('OneDrive upload error: %s', exc)
            return None

    @staticmethod
    def _create_share_link(access_token, item_id):
        """
        Create a view-only sharing link for the uploaded file.

        SYSPCC-011 FIX 3: previously requested `scope: 'anonymous'`, which makes
        Microsoft Graph mint a link that anyone on the internet can open with no
        authentication at all — every warehouse receipt/dispatch PDF (RQ number,
        supplier, pricing) was effectively public if the URL ever leaked (chat,
        logs, browser history). Switched to `scope: 'organization'` so the link
        only works for someone signed into the same Microsoft tenant.

        KNOWN TRADE-OFF (documented per SYSPCC-011): this integration
        authenticates via the device-code flow against the `consumers`
        authority (see AUTHORITY above) — i.e. it connects a *personal*
        Microsoft account, not an Azure AD / OneDrive-for-Business tenant.
        Microsoft Graph's `organization` share-link scope is only supported for
        OneDrive for Business / SharePoint drives; it does not apply to
        personal accounts. In practice this call will likely fail (non-2xx) for
        the current architecture, and `upload_file` falls back to the item's
        own `webUrl`, which requires signing into the connected account —
        so document links may stop being openable by warehouse staff.
        We accept that regression here: prioritizing "no public link" over
        "link works without further changes" per SYSPCC-011. Follow-up
        (needs a real ticket, out of scope here): either migrate this
        integration to an OneDrive for Business / SharePoint app registration
        (where `organization` scope actually works), or stop relying on
        OneDrive's own sharing entirely and proxy downloads through a
        Django view that enforces our own RBAC.
        """
        try:
            resp = requests.post(
                f'{GRAPH_URL}/me/drive/items/{item_id}/createLink',
                headers={
                    'Authorization': f'Bearer {access_token}',
                    'Content-Type': 'application/json',
                },
                json={'type': 'view', 'scope': 'organization'},
                timeout=15,
            )
            if resp.status_code in (200, 201):
                return resp.json().get('link', {}).get('webUrl', '')
            logger.warning(
                'OneDrive createLink (scope=organization) failed (%s): %s. '
                'See SYSPCC-011 note above — expected for personal MS accounts.',
                resp.status_code, resp.text,
            )
        except (requests.RequestException, ValueError) as exc:
            # ValueError covers resp.json() failing on a non-JSON response body.
            logger.warning('OneDrive createLink error: %s', exc)
        return None

    @classmethod
    def get_connection_info(cls):
        """Return info about the current OneDrive connection."""
        token = OneDriveToken.get_token()
        if not token:
            return {'connected': False}
        return {
            'connected': True,
            'account_name': token.account_name,
            'connected_at': token.connected_at.isoformat(),
        }
