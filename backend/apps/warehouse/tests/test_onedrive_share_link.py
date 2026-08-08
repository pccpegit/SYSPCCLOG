"""
SYSPCC-011 FIX 3: OneDriveService._create_share_link must request an
organization-scoped link, never an anonymous/public one — the previous
`scope: 'anonymous'` meant every uploaded warehouse document (receipts,
dispatch PDFs — RQ numbers, suppliers, pricing) was reachable by anyone with
the URL, no authentication at all, completely bypassing RBAC.

Also verifies that a failed link creation (expected today, since this
integration authenticates a *personal* Microsoft account via the `consumers`
authority — see the docstring in onedrive.py) does not fall back to a public
link; it degrades to None/webUrl instead.
"""
from unittest import mock

import pytest

from apps.warehouse.services.onedrive import OneDriveService


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class TestCreateShareLinkScope:
    def test_requests_organization_scope_not_anonymous(self):
        with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
            mock_post.return_value = _FakeResponse(
                200, {'link': {'webUrl': 'https://example.sharepoint.com/x'}}
            )
            OneDriveService._create_share_link('fake-token', 'item-123')

        assert mock_post.called
        _, kwargs = mock_post.call_args
        assert kwargs['json']['scope'] == 'organization'
        assert kwargs['json']['scope'] != 'anonymous'

    def test_returns_link_on_success(self):
        with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
            mock_post.return_value = _FakeResponse(
                200, {'link': {'webUrl': 'https://example.sharepoint.com/shared-link'}}
            )
            result = OneDriveService._create_share_link('fake-token', 'item-123')

        assert result == 'https://example.sharepoint.com/shared-link'

    def test_does_not_fall_back_to_anonymous_on_failure(self):
        """If organization-scoped link creation fails (expected for the
        personal-account architecture this integration currently uses), the
        method must return None rather than silently retrying with a public
        anonymous link — that would reintroduce the vulnerability being fixed."""
        with mock.patch('apps.warehouse.services.onedrive.requests.post') as mock_post:
            mock_post.return_value = _FakeResponse(400, text='Invalid scope for personal account')
            result = OneDriveService._create_share_link('fake-token', 'item-123')

        assert result is None
        # Only one call was made — no retry with a different (anonymous) scope.
        assert mock_post.call_count == 1
