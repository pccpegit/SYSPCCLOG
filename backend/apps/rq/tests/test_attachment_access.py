"""
IDOR regression tests for AttachmentViewSet — SYSPCC-006 FIX 2.

Before the fix, `AttachmentViewSet` used an unscoped
`queryset = Attachment.objects.all()`, so any authenticated user could GET or
DELETE an attachment belonging to a request they had no access to just by
guessing the pk.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.rq.models import Attachment


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_attachment(request_obj, uploaded_by, file_name='cotizacion.pdf'):
    return Attachment.objects.create(
        request=request_obj,
        uploaded_by=uploaded_by,
        file_name=file_name,
        file_path=f'attachments/{file_name}',
        file_type='pdf',
        category='cotizacion',
    )


@pytest.mark.django_db
class TestAttachmentRetrieveAccessControl:
    def test_requester_can_retrieve_own_attachment(self, requester, ops_request):
        attachment = _make_attachment(ops_request, requester)
        client = _client_for(requester)
        response = client.get(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == attachment.pk

    def test_requester_cannot_retrieve_foreign_attachment(
        self, requester, foreign_request, other_requester
    ):
        attachment = _make_attachment(foreign_request, other_requester)
        client = _client_for(requester)
        response = client.get(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_requester_own_attachment_not_hidden_by_list_scoping(
        self, requester, ops_request, foreign_request, other_requester
    ):
        own = _make_attachment(ops_request, requester, file_name='propia.pdf')
        _make_attachment(foreign_request, other_requester, file_name='ajena.pdf')
        client = _client_for(requester)
        response = client.get('/api/v1/attachments/')
        ids = [item['id'] for item in response.data['results']]
        assert own.pk in ids
        assert len(ids) == 1

    def test_logistics_coordinator_can_retrieve_any_attachment(
        self, logistics_coordinator, foreign_request, other_requester
    ):
        attachment = _make_attachment(foreign_request, other_requester)
        client = _client_for(logistics_coordinator)
        response = client.get(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_200_OK

    def test_unauthenticated_gets_401(self, api_client, ops_request, requester):
        attachment = _make_attachment(ops_request, requester)
        response = api_client.get(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestAttachmentDestroyAccessControl:
    def test_requester_can_delete_own_attachment(self, requester, ops_request):
        attachment = _make_attachment(ops_request, requester)
        client = _client_for(requester)
        response = client.delete(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Attachment.objects.filter(pk=attachment.pk).exists()

    def test_requester_cannot_delete_foreign_attachment(
        self, requester, foreign_request, other_requester
    ):
        attachment = _make_attachment(foreign_request, other_requester)
        client = _client_for(requester)
        response = client.delete(f'/api/v1/attachments/{attachment.pk}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert Attachment.objects.filter(pk=attachment.pk).exists()
