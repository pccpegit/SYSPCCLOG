"""
SYSPCC-031: "Guardar borrador" really saves a draft (DRAFT).

Covers POST /api/v1/requests/ with `save_as_draft`, the edit / delete of a draft (only its
requester), the send (`POST /requests/{id}/submit/` and the generic action endpoint, both
ending in the EXISTING DRAFT -> SUBMITTED transition), the numbering, the privacy of the
draft, and that the direct creation (no `save_as_draft`) behaves as before.
"""
import re

import pytest
from rest_framework import status

from apps.rq.models import ActivityLog, Approval, Notification, Request, RequestItem
from apps.rq.services.request_items import PROPOSED_LINKS_ACTIVITY_ACTION
from apps.rq.services.request_submission import PROVISIONAL_PREFIX
from apps.rq.tests.catalog_fixtures import client_for, logistics_supervisor, make_inventory  # noqa: F401

URL = '/api/v1/requests/'
OFFICIAL_NUMBER = re.compile(r'^RQ-\d{4}-\d{4}$')


def _line(**overrides):
    line = {
        'line_number': 1, 'description': 'Casco de seguridad', 'quantity': '10.000', 'unit': 'UND', 'item_source': 'EPP',
    }
    line.update(overrides)
    return line


def _full_payload(project, **overrides):
    """Everything a full send demands."""
    payload = {
        'flow': 'OPERATIONS',
        'project': project.pk,
        'requesting_area': 'OP',
        'front_area': 'Frente 1',
        'service': 'PRY-TEST - Proyecto de Prueba',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'items': [_line(is_off_catalog=True)],
    }
    payload.update(overrides)
    return payload


def _minimal_draft(**overrides):
    payload = {'save_as_draft': True, 'flow': 'ADMINISTRATIVE', 'items': [_line(quantity='0', item_source='')]}
    payload.update(overrides)
    return payload


def _create_draft(user, payload):
    response = client_for(user).post(URL, payload, format='json')
    assert response.status_code == status.HTTP_201_CREATED, response.data
    return Request.objects.get(pk=response.data['id'])


def _detail(response):
    return response.data['detail']


@pytest.mark.django_db
class TestCreateDraft:
    def test_draft_is_stored_as_draft_without_workflow_side_effects(self, requester, project):
        response = client_for(requester).post(
            URL, _full_payload(project, save_as_draft=True), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data['status'] == 'DRAFT'
        rq = Request.objects.get(pk=response.data['id'])
        assert rq.status == 'DRAFT'
        assert rq.requested_by == requester
        assert rq.items.count() == 1
        assert Approval.objects.filter(request=rq).count() == 0
        assert ActivityLog.objects.filter(request=rq).count() == 0
        assert Notification.objects.filter(request=rq).count() == 0
        assert rq.current_step_id is None

    def test_minimal_validation_accepts_an_almost_empty_draft(self, requester):
        """No area, frente, service, date, origin; the line has no quantity or source yet."""
        rq = _create_draft(requester, _minimal_draft())

        assert rq.status == 'DRAFT'
        assert rq.requesting_area == ''
        assert rq.fecha_necesidad is None
        assert rq.project_id is None and rq.department_id is None
        line = rq.items.get()
        assert line.quantity == 0
        assert line.item_source == ''

    def test_draft_still_requires_at_least_one_line(self, requester):
        response = client_for(requester).post(URL, _minimal_draft(items=[]), format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'items' in _detail(response)
        assert Request.objects.count() == 0

    def test_draft_rejects_a_negative_quantity(self, requester):
        response = client_for(requester).post(
            URL, _minimal_draft(items=[_line(quantity='-1')]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.count() == 0

    def test_draft_keeps_the_oficina_central_rule(self, requester, project):
        response = client_for(requester).post(
            URL, _full_payload(project, save_as_draft=True, front_area='Oficina Central'), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'flow' in _detail(response)

    def test_non_boolean_flag_is_a_400_never_a_submitted_rq(self, requester, project):
        response = client_for(requester).post(
            URL, _full_payload(project, save_as_draft='quizas'), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.count() == 0

    def test_client_cannot_choose_status_or_number_of_a_draft(self, requester, project):
        response = client_for(requester).post(
            URL,
            _full_payload(project, save_as_draft=True, status='VALIDATED', rq_number='RQ-2026-0001'),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED
        rq = Request.objects.get(pk=response.data['id'])
        assert rq.status == 'DRAFT'
        assert rq.rq_number.startswith(PROVISIONAL_PREFIX)

    def test_draft_keeps_the_catalog_link_area_and_source(self, requester, project):
        product = make_inventory()
        rq = _create_draft(requester, _full_payload(
            project, save_as_draft=True,
            items=[_line(inventory_item=product.pk, item_source='EPP')],
        ))

        line = rq.items.get()
        assert line.inventory_item_id == product.pk
        assert line.item_source == 'EPP'
        assert rq.requesting_area == 'OP'
        assert line.inventory_item_confirmed_at is None  # only a proposal, like a direct creation

    def test_each_draft_gets_its_own_provisional_number(self, requester):
        first = _create_draft(requester, _minimal_draft())
        second = _create_draft(requester, _minimal_draft())

        assert first.rq_number != second.rq_number
        assert len(first.rq_number) <= 20


@pytest.mark.django_db
class TestNumbering:
    def test_draft_does_not_consume_the_official_sequence(self, requester, project):
        _create_draft(requester, _full_payload(project, save_as_draft=True))
        _create_draft(requester, _full_payload(project, save_as_draft=True))

        direct = client_for(requester).post(URL, _full_payload(project), format='json')

        assert direct.status_code == status.HTTP_201_CREATED
        assert direct.data['rq_number'].endswith('-0001')

    def test_deleting_a_draft_leaves_no_gap(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        client_for(requester).delete(f'{URL}{draft.pk}/')

        first = client_for(requester).post(URL, _full_payload(project), format='json')
        second = client_for(requester).post(URL, _full_payload(project), format='json')

        assert first.data['rq_number'].endswith('-0001')
        assert second.data['rq_number'].endswith('-0002')

    def test_official_number_is_assigned_when_the_draft_is_sent(self, requester, project):
        direct = client_for(requester).post(URL, _full_payload(project), format='json')
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_200_OK, response.data
        assert OFFICIAL_NUMBER.match(response.data['rq_number'])
        assert int(response.data['rq_number'][-4:]) == int(direct.data['rq_number'][-4:]) + 1
        draft.refresh_from_db()
        assert draft.rq_number == response.data['rq_number']


@pytest.mark.django_db
class TestEditAndDeleteDraft:
    def test_patch_header_and_replace_lines(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        product = make_inventory()

        response = client_for(requester).patch(f'{URL}{draft.pk}/', {
            'front_area': 'Frente 2',
            'items': [
                _line(inventory_item=product.pk, item_source='EPP'),
                _line(description='Guantes', is_off_catalog=True),
            ],
        }, format='json')

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data['status'] == 'DRAFT'
        assert response.data['front_area'] == 'Frente 2'
        assert [i['line_number'] for i in response.data['items']] == [1, 2]
        draft.refresh_from_db()
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)
        assert RequestItem.objects.filter(request=draft).count() == 2
        assert RequestItem.objects.get(request=draft, line_number=1).inventory_item_id == product.pk

    def test_patch_without_items_keeps_the_lines(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))

        response = client_for(requester).patch(f'{URL}{draft.pk}/', {'service': 'Otro'}, format='json')

        assert response.status_code == status.HTTP_200_OK, response.data
        assert draft.items.count() == 1

    def test_put_updates_a_draft(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))

        response = client_for(requester).put(
            f'{URL}{draft.pk}/', _full_payload(project, service='Nuevo servicio'), format='json',
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        draft.refresh_from_db()
        assert draft.service == 'Nuevo servicio'
        assert draft.status == 'DRAFT'

    def test_status_cannot_be_changed_through_the_update(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))

        client_for(requester).patch(f'{URL}{draft.pk}/', {'status': 'VALIDATED'}, format='json')

        draft.refresh_from_db()
        assert draft.status == 'DRAFT'

    def test_update_is_rejected_once_sent(self, requester, project):
        direct = client_for(requester).post(URL, _full_payload(project), format='json')

        response = client_for(requester).patch(
            f'{URL}{direct.data["id"]}/', {'service': 'x'}, format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_draft_removes_it_and_its_lines(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))

        response = client_for(requester).delete(f'{URL}{draft.pk}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Request.objects.filter(pk=draft.pk).exists()
        assert not RequestItem.objects.filter(request_id=draft.pk).exists()

    def test_delete_is_rejected_once_sent(self, requester, project):
        direct = client_for(requester).post(URL, _full_payload(project), format='json')

        response = client_for(requester).delete(f'{URL}{direct.data["id"]}/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Request.objects.filter(pk=direct.data['id']).exists()


@pytest.mark.django_db
class TestDraftIsPrivate:
    @pytest.fixture
    def draft(self, requester, project):
        return _create_draft(requester, _full_payload(project, save_as_draft=True))

    def test_other_requester_cannot_see_edit_delete_or_send_it(self, draft, other_requester):
        client = client_for(other_requester)

        assert client.get(f'{URL}{draft.pk}/').status_code == status.HTTP_404_NOT_FOUND
        assert client.patch(f'{URL}{draft.pk}/', {'service': 'x'}, format='json').status_code == 404
        assert client.delete(f'{URL}{draft.pk}/').status_code == status.HTTP_404_NOT_FOUND
        assert client.post(f'{URL}{draft.pk}/submit/').status_code == status.HTTP_404_NOT_FOUND
        assert Request.objects.filter(pk=draft.pk, status='DRAFT').exists()

    @pytest.mark.parametrize('fixture_name', ['project_resident', 'general_manager', 'logistics_supervisor'])
    def test_roles_with_wide_or_project_scope_do_not_see_it(self, request, draft, fixture_name):
        user = request.getfixturevalue(fixture_name)
        client = client_for(user)

        assert client.get(f'{URL}{draft.pk}/').status_code == status.HTTP_404_NOT_FOUND
        listed = client.get(URL).data['results']
        assert draft.pk not in [row['id'] for row in listed]
        assert client.delete(f'{URL}{draft.pk}/').status_code == status.HTTP_404_NOT_FOUND

    def test_owner_sees_it_in_the_list_with_status_draft(self, draft, requester):
        rows = client_for(requester).get(URL, {'status': 'DRAFT'}).data['results']

        assert [row['id'] for row in rows] == [draft.pk]
        assert rows[0]['status'] == 'DRAFT'

    def test_master_does_not_track_drafts(self, draft, logistics_supervisor, requester):
        for user in (requester, logistics_supervisor):
            response = client_for(user).get('/api/v1/request-master/')
            assert response.status_code == status.HTTP_200_OK, response.data
            assert response.data['count'] == 0

    def test_visible_non_owner_gets_403_not_a_silent_edit(self, draft, requester, general_manager, monkeypatch):
        """Defence in depth: even if the scoping let it through, only the requester edits."""
        from apps.rq.views import request as view_module

        monkeypatch.setattr(
            view_module, 'get_accessible_requests_queryset', lambda user: Request.objects.all(),
        )
        client = client_for(general_manager)

        assert client.patch(f'{URL}{draft.pk}/', {'service': 'x'}, format='json').status_code == 403
        assert client.delete(f'{URL}{draft.pk}/').status_code == 403
        assert client.post(f'{URL}{draft.pk}/submit/').status_code == 403
        draft.refresh_from_db()
        assert draft.service != 'x'


@pytest.mark.django_db
class TestSubmitDraft:
    def test_valid_draft_is_sent_through_the_existing_transition(self, requester, project, project_resident):
        product = make_inventory()
        draft = _create_draft(requester, _full_payload(
            project, save_as_draft=True, items=[_line(inventory_item=product.pk)],
        ))

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data['status'] == 'SUBMITTED'
        draft.refresh_from_db()
        assert draft.status == 'SUBMITTED'
        approval = Approval.objects.get(request=draft)
        assert (approval.action, approval.role) == ('SUBMITTED', 'REQUESTER')
        assert (approval.previous_status, approval.new_status) == ('DRAFT', 'SUBMITTED')
        assert approval.performed_by == requester
        # Same trail as a direct creation: the proposed catalog links are logged.
        assert ActivityLog.objects.filter(
            request=draft, action=PROPOSED_LINKS_ACTIVITY_ACTION,
        ).count() == 1
        # The engine notifies the next actor (it does for every transition).
        assert Notification.objects.filter(request=draft).exists()

    def test_sent_draft_continues_the_workflow_like_any_rq(self, requester, project, project_resident):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        client_for(requester).post(f'{URL}{draft.pk}/submit/')

        response = client_for(project_resident).post(f'{URL}{draft.pk}/action/', {
            'action': 'TECHNICAL_APPROVED', 'acting_role': 'PROJECT_RESIDENT',
        }, format='json')

        assert response.status_code == status.HTTP_200_OK, response.data
        draft.refresh_from_db()
        assert draft.status == 'TECHNICAL_APPROVED'

    def test_incomplete_draft_is_a_400_with_every_missing_piece_and_nothing_changes(self, requester):
        draft = _create_draft(requester, _minimal_draft())
        number = draft.rq_number

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        errors = _detail(response)
        assert set(errors) >= {
            'requesting_area', 'front_area', 'service', 'fecha_necesidad', 'department', 'items',
        }
        assert any('Ítem 1' in message for message in errors['items'])
        draft.refresh_from_db()
        assert draft.status == 'DRAFT'
        assert draft.rq_number == number
        assert Approval.objects.filter(request=draft).count() == 0
        assert Notification.objects.filter(request=draft).count() == 0

    @pytest.mark.parametrize('field, value, error_field', [
        ('requesting_area', '', 'requesting_area'),
        ('front_area', '  ', 'front_area'),
        ('service', '', 'service'),
        ('fecha_necesidad', None, 'fecha_necesidad'),
        ('project', None, 'project'),
    ])
    def test_each_header_rule_of_the_full_creation_is_enforced(
        self, requester, project, field, value, error_field,
    ):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        Request.objects.filter(pk=draft.pk).update(**{field: value})

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert error_field in _detail(response)

    @pytest.mark.parametrize('changes, fragment', [
        ({'inventory_item': None, 'is_off_catalog': False}, 'catálogo'),
        ({'inventory_item': None, 'is_off_catalog': True, 'description': '   '}, 'Describa'),
        ({'quantity': 0}, 'cantidad'),
        ({'item_source': ''}, 'fuente'),
    ])
    def test_each_line_rule_of_the_full_creation_is_enforced(self, requester, project, changes, fragment):
        product = make_inventory()
        draft = _create_draft(requester, _full_payload(
            project, save_as_draft=True, items=[_line(inventory_item=product.pk)],
        ))
        RequestItem.objects.filter(request=draft).update(**changes)

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert any(fragment in message for message in _detail(response)['items'])
        draft.refresh_from_db()
        assert draft.status == 'DRAFT'

    def test_oficina_central_must_use_the_administrative_flow(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        Request.objects.filter(pk=draft.pk).update(front_area='Oficina Central')

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'flow' in _detail(response)

    def test_sending_twice_is_a_clean_400_and_a_single_approval(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        client = client_for(requester)
        assert client.post(f'{URL}{draft.pk}/submit/').status_code == 200
        number = Request.objects.get(pk=draft.pk).rq_number

        again = client.post(f'{URL}{draft.pk}/submit/')

        assert again.status_code == status.HTTP_400_BAD_REQUEST
        assert Approval.objects.filter(request=draft, action='SUBMITTED').count() == 1
        assert Request.objects.get(pk=draft.pk).rq_number == number

    def test_non_owner_cannot_send_it(self, requester, project, project_resident):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        # The resident is not the owner: the scoping hides the draft.
        assert client_for(project_resident).post(f'{URL}{draft.pk}/submit/').status_code == 404

    def test_owner_who_lost_the_requester_role_gets_403_and_nothing_changes(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        requester.user_roles.all().delete()
        requester.user_roles.create(role='PROJECT_RESIDENT', project=project)

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/', {'acting_role': 'PROJECT_RESIDENT'}, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        draft.refresh_from_db()
        assert draft.status == 'DRAFT'
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)

    def test_generic_action_endpoint_uses_the_same_validation_and_numbering(self, requester, project):
        incomplete = _create_draft(requester, _minimal_draft())
        complete = _create_draft(requester, _full_payload(project, save_as_draft=True))
        payload = {'action': 'SUBMITTED', 'acting_role': 'REQUESTER'}

        bad = client_for(requester).post(f'{URL}{incomplete.pk}/action/', payload, format='json')
        good = client_for(requester).post(f'{URL}{complete.pk}/action/', payload, format='json')

        assert bad.status_code == status.HTTP_400_BAD_REQUEST
        assert 'items' in _detail(bad)
        assert good.status_code == status.HTTP_200_OK, good.data
        assert good.data['new_status'] == 'SUBMITTED'
        complete.refresh_from_db()
        assert OFFICIAL_NUMBER.match(complete.rq_number)

    def test_failed_engine_rolls_back_the_official_number(self, requester, project, monkeypatch):
        from apps.rq.services import request_submission
        from apps.core.exceptions import WorkflowError

        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        provisional = draft.rq_number

        def boom(self, *args, **kwargs):
            raise WorkflowError('no')

        monkeypatch.setattr(request_submission.WorkflowEngine, 'execute', boom)
        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        draft.refresh_from_db()
        assert draft.rq_number == provisional
        assert draft.status == 'DRAFT'


@pytest.mark.django_db
class TestDirectSubmissionUnchanged:
    def test_without_the_flag_the_rq_is_created_submitted_as_before(self, requester, project):
        response = client_for(requester).post(URL, _full_payload(project), format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['status'] == 'SUBMITTED'
        assert OFFICIAL_NUMBER.match(response.data['rq_number'])
        rq = Request.objects.get(pk=response.data['id'])
        approval = Approval.objects.get(request=rq)
        assert (approval.action, approval.previous_status, approval.new_status) == (
            'SUBMITTED', 'DRAFT', 'SUBMITTED',
        )

    def test_explicit_false_flag_is_a_direct_creation(self, requester, project):
        response = client_for(requester).post(
            URL, _full_payload(project, save_as_draft=False), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['status'] == 'SUBMITTED'

    def test_direct_creation_still_demands_area_and_date_and_a_line(self, requester, project):
        for overrides in ({'requesting_area': ''}, {'fecha_necesidad': None}, {'items': []}):
            response = client_for(requester).post(URL, _full_payload(project, **overrides), format='json')
            assert response.status_code == status.HTTP_400_BAD_REQUEST, overrides
        missing_date = _full_payload(project)
        del missing_date['fecha_necesidad']
        assert client_for(requester).post(URL, missing_date, format='json').status_code == 400
        assert Request.objects.count() == 0


@pytest.mark.django_db
class TestCancelledDraftStaysPrivate:
    """
    The universal CANCELLED transition leaves DRAFT, but the RQ was never sent: it must
    stay private to its requester (it still carries the provisional BOR- number).
    """

    @pytest.fixture
    def cancelled(self, requester, project):
        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        response = client_for(requester).post(
            f'{URL}{draft.pk}/action/', {'action': 'CANCELLED', 'acting_role': 'REQUESTER'}, format='json',
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        draft.refresh_from_db()
        assert draft.status == 'CANCELLED'
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)
        return draft

    @pytest.mark.parametrize('fixture_name', ['project_resident', 'general_manager', 'logistics_supervisor'])
    def test_others_do_not_see_it_after_cancelling(self, request, cancelled, fixture_name):
        client = client_for(request.getfixturevalue(fixture_name))

        assert client.get(f'{URL}{cancelled.pk}/').status_code == status.HTTP_404_NOT_FOUND
        assert cancelled.pk not in [row['id'] for row in client.get(URL).data['results']]
        assert client.get(f'{URL}{cancelled.pk}/approvals/').status_code == status.HTTP_404_NOT_FOUND

    def test_master_does_not_track_it_for_anyone(self, cancelled, requester, logistics_supervisor):
        for user in (requester, logistics_supervisor):
            response = client_for(user).get('/api/v1/request-master/')
            assert response.status_code == status.HTTP_200_OK
            assert response.data['count'] == 0

    def test_the_owner_still_sees_it(self, cancelled, requester):
        client = client_for(requester)

        assert client.get(f'{URL}{cancelled.pk}/').status_code == status.HTTP_200_OK
        assert cancelled.pk in [row['id'] for row in client.get(URL).data['results']]

    def test_a_sent_and_then_cancelled_rq_is_still_visible_to_everyone_who_should(
        self, requester, project, logistics_supervisor,
    ):
        sent = client_for(requester).post(URL, _full_payload(project), format='json')
        client_for(requester).post(
            f'{URL}{sent.data["id"]}/action/', {'action': 'CANCELLED', 'acting_role': 'REQUESTER'}, format='json',
        )

        assert client_for(logistics_supervisor).get(f'{URL}{sent.data["id"]}/').status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestSaveDraftRequiresRequesterRole:
    def test_user_without_the_requester_role_gets_403_and_nothing_is_saved(self, project, project_resident):
        response = client_for(project_resident).post(
            URL, _full_payload(project, save_as_draft=True), format='json',
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert 'Solicitante' in response.data['detail']
        assert Request.objects.count() == 0

    def test_direct_creation_is_not_restricted_by_this_rule(self, project, project_resident):
        response = client_for(project_resident).post(URL, _full_payload(project), format='json')

        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
class TestSubmitIntegrityErrors:
    def test_collision_on_the_official_number_is_reported_as_a_numbering_problem(
        self, requester, project, monkeypatch,
    ):
        from django.db import IntegrityError
        from apps.rq.services import request_submission

        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))
        monkeypatch.setattr(
            request_submission.RQNumberGenerator, 'generate',
            classmethod(lambda cls: (_ for _ in ()).throw(IntegrityError('duplicate key'))),
        )

        response = client_for(requester).post(f'{URL}{draft.pk}/submit/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'rq_number' in _detail(response)
        draft.refresh_from_db()
        assert draft.status == 'DRAFT'
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)

    def test_an_integrity_error_elsewhere_is_not_disguised_as_a_numbering_problem(
        self, requester, project, monkeypatch,
    ):
        from django.db import IntegrityError
        from apps.rq.services import request_submission

        draft = _create_draft(requester, _full_payload(project, save_as_draft=True))

        def boom(self, *args, **kwargs):
            raise IntegrityError('some other constraint')

        monkeypatch.setattr(request_submission.WorkflowEngine, 'execute', boom)

        with pytest.raises(IntegrityError):
            client_for(requester).post(f'{URL}{draft.pk}/submit/')
        draft.refresh_from_db()
        assert draft.status == 'DRAFT'
        assert draft.rq_number.startswith(PROVISIONAL_PREFIX)
