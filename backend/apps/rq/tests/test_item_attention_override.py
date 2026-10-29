"""
SYSPCC-030 · POST|PATCH /api/v1/requests/{id}/items/{item_id}/attention-override/

El único dato editable del Master: STAND BY / DESESTIMADO con motivo obligatorio. Solo roles de
logística; 409 con el RQ terminal; auditado en el ActivityLog; nunca toca el estado del RQ ni el
flujo de trabajo.
"""
from unittest import mock

import pytest
from django.db import IntegrityError, transaction

from apps.core.enums import RoleChoices
from apps.rq.models import ActivityLog, Approval, RequestItem
from apps.rq.tests.catalog_fixtures import capture_logs
from apps.rq.tests.master_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse, client_for, logistics_chief, logistics_supervisor, make_item, make_user, world,
)

TERMINAL = ['CLOSED', 'CANCELLED', 'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED', 'GM_REJECTED',
            'COST_OVERRUN_REJECTED']
LOGISTICS = [RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.LOGISTICS_SUPERVISOR, RoleChoices.LOGISTICS_CHIEF]


def url(rq, item):
    return f'/api/v1/requests/{rq.pk}/items/{item.pk}/attention-override/'


def send(user, rq, item, payload, method='post'):
    return getattr(client_for(user), method)(url(rq, item), payload, format='json')


@pytest.fixture
def rq_item(world):
    """B1: línea PENDIENTE de un RQ en IN_STOCK (abierto)."""
    return world.b, world.b1


# ═══════════════════════════════ quién puede ═══════════════════════════════

class TestRoles:
    @pytest.mark.parametrize('role', LOGISTICS)
    @pytest.mark.parametrize('method', ['post', 'patch'])
    def test_logistics_roles_can_set_it(self, rq_item, project, role, method):
        user = make_user(f'user_{role.lower()}_{method}', role, project=project)
        rq, item = rq_item
        response = send(user, rq, item, {'override': 'STAND_BY', 'note': 'Pausa de obra'}, method)
        assert response.status_code == 200, response.content
        item.refresh_from_db()
        assert (item.attention_override, item.attention_note) == ('STAND_BY', 'Pausa de obra')

    @pytest.mark.parametrize('role', [r for r in RoleChoices.values if r not in LOGISTICS])
    def test_every_other_role_is_denied_and_nothing_changes(self, rq_item, project, role):
        user = make_user(f'user_{role.lower()}', role, project=project)
        rq, item = rq_item
        response = send(user, rq, item, {'override': 'STAND_BY', 'note': 'x'})
        assert response.status_code == 403, role
        item.refresh_from_db()
        assert item.attention_override == '' and item.attention_note == ''

    def test_there_are_13_roles_and_exactly_3_may_decide(self):
        assert len(RoleChoices.values) == 13 and len(LOGISTICS) == 3

    def test_superuser_and_staff_without_a_logistics_role_are_denied(self, rq_item, superuser, staff_user):
        rq, item = rq_item
        for user in (superuser, staff_user):
            assert send(user, rq, item, {'override': 'STAND_BY', 'note': 'x'}).status_code == 403

    def test_requester_owner_cannot_decide_on_their_own_line(self, world, other_requester):
        assert send(other_requester, world.b, world.b1, {'override': 'DESESTIMADO', 'note': 'x'}).status_code == 403

    def test_anonymous_is_unauthorized(self, rq_item, api_client):
        rq, item = rq_item
        assert api_client.post(url(rq, item), {'override': 'STAND_BY', 'note': 'x'}, format='json').status_code == 401

    def test_get_and_delete_are_not_allowed(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        client = client_for(logistics_coordinator)
        assert client.get(url(rq, item)).status_code == 405
        assert client.delete(url(rq, item)).status_code == 405

    def test_permission_is_checked_before_the_object_lookup(self, world, requester):
        # Un RQ inexistente responde igual (403) a quien no es de logística: sin oráculo de ids.
        response = client_for(requester).post('/api/v1/requests/999999/items/1/attention-override/',
                                              {'override': 'STAND_BY', 'note': 'x'}, format='json')
        assert response.status_code == 403


# ═══════════════════════════════ validación ═══════════════════════════════

class TestValidation:
    @pytest.mark.parametrize('payload', [
        {'override': 'STAND_BY'},
        {'override': 'STAND_BY', 'note': ''},
        {'override': 'STAND_BY', 'note': '   '},
        {'override': 'DESESTIMADO', 'note': ''},
    ])
    def test_the_note_is_mandatory_when_setting(self, rq_item, logistics_coordinator, payload):
        rq, item = rq_item
        response = send(logistics_coordinator, rq, item, payload)
        assert response.status_code == 400
        assert 'note' in response.json()['detail']
        item.refresh_from_db()
        assert item.attention_override == ''

    @pytest.mark.parametrize('payload', [
        {'override': 'ATENDIDO', 'note': 'x'}, {'override': 'stand_by', 'note': 'x'},
        {'override': 'PENDIENTE', 'note': 'x'}, {'note': 'sin override'}, {},
        {'override': 'STAND_BY', 'note': 'x' * 301},
    ])
    def test_invalid_payloads_are_a_400(self, rq_item, logistics_coordinator, payload):
        rq, item = rq_item
        assert send(logistics_coordinator, rq, item, payload).status_code == 400

    def test_the_note_is_trimmed_and_may_be_exactly_300_chars(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        assert send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': '  ' + 'a' * 300 + '  '}
                    ).status_code == 200
        item.refresh_from_db()
        assert item.attention_note == 'a' * 300

    def test_a_nul_byte_in_the_note_is_rejected(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        assert send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'a\x00b'}).status_code == 400

    def test_unrelated_fields_in_the_body_are_ignored(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        response = send(logistics_coordinator, rq, item, {
            'override': 'STAND_BY', 'note': 'ok', 'quantity': 999, 'status': 'CLOSED',
            'inventory_item': 1, 'unit_price': '5',
        })
        assert response.status_code == 200
        item.refresh_from_db()
        rq.refresh_from_db()
        assert (item.quantity, item.unit_price, rq.status) == (5, None, 'IN_STOCK')


# ═══════════════════════════════ fijar, cambiar y quitar ═══════════════════════════════

class TestSetAndClear:
    def test_response_carries_the_refreshed_master_row(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        data = send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'}).json()
        assert data['changed'] is True and data['detail']
        row = data['item']
        assert row['id'] == item.pk
        assert (row['status'], row['attention_override'], row['attention_override_label'],
                row['attention_note']) == ('STAND_BY', 'STAND_BY', 'Stand by', 'Pausa')
        assert row['can_set_override'] is True

    def test_the_master_reflects_it_and_the_percentage_changes(self, world, logistics_coordinator):
        send(logistics_coordinator, world.a, world.a2, {'override': 'DESESTIMADO', 'note': 'Ya no se necesita'})
        listing = client_for(logistics_coordinator).get('/api/v1/request-master/', {'request': world.a.pk}).json()
        by_line = {r['line_number']: r for r in listing['results']}
        assert by_line[2]['status'] == 'DESESTIMADO' and by_line[2]['quantity_missing'] == '0.000'
        assert by_line[1]['rq_progress']['percent'] == 100.0          # A2 deja de contar
        assert by_line[1]['rq_progress']['items_discarded'] == 1

    def test_discarded_can_be_changed_to_stand_by_and_back(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        send(logistics_coordinator, rq, item, {'override': 'DESESTIMADO', 'note': 'uno'})
        send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'dos'})
        item.refresh_from_db()
        assert (item.attention_override, item.attention_note) == ('STAND_BY', 'dos')
        logs = list(ActivityLog.objects.filter(request=rq, action='ITEM_ATTENTION_OVERRIDE').order_by('pk'))
        assert len(logs) == 2 and 'antes: Desestimado' in logs[1].detail

    @pytest.mark.parametrize('clear', [{'override': ''}, {'override': None}, {'override': '', 'note': ''}])
    def test_clearing_removes_the_override_and_its_note(self, rq_item, logistics_coordinator, clear):
        rq, item = rq_item
        send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'})
        response = send(logistics_coordinator, rq, item, clear, 'patch')
        assert response.status_code == 200 and response.json()['changed'] is True
        item.refresh_from_db()
        assert (item.attention_override, item.attention_note) == ('', '')
        assert response.json()['item']['status'] == 'PENDIENTE'

    def test_clearing_may_carry_an_explanatory_note_only_in_the_log(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'})
        send(logistics_coordinator, rq, item, {'override': '', 'note': 'Se reanuda la obra'})
        item.refresh_from_db()
        assert item.attention_note == ''
        last = ActivityLog.objects.filter(request=rq, action='ITEM_ATTENTION_OVERRIDE').latest('pk')
        assert 'se quitó' in last.detail and 'Se reanuda la obra' in last.detail

    def test_clearing_when_there_is_nothing_is_a_no_op(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        data = send(logistics_coordinator, rq, item, {'override': ''}).json()
        assert data['changed'] is False and data['detail'] == 'Sin cambios.'
        assert not ActivityLog.objects.filter(request=rq, action='ITEM_ATTENTION_OVERRIDE').exists()

    def test_repeating_the_same_request_is_idempotent(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        first = send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'}).json()
        second = send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'}).json()
        assert (first['changed'], second['changed']) == (True, False)
        assert ActivityLog.objects.filter(request=rq, action='ITEM_ATTENTION_OVERRIDE').count() == 1

    def test_changing_only_the_note_is_a_change(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Pausa'})
        assert send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Otra razón'}
                    ).json()['changed'] is True

    def test_only_the_targeted_line_changes(self, world, logistics_coordinator):
        send(logistics_coordinator, world.a, world.a2, {'override': 'STAND_BY', 'note': 'x'})
        for other in (world.a1, world.a3, world.a4, world.b1, world.c1):
            other.refresh_from_db()
            assert other.attention_override == ''


# ═══════════════════════════════ auditoría y flujo intacto ═══════════════════════════════

class TestAuditAndWorkflowUntouched:
    def test_who_when_and_why_go_to_the_activity_log(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'Esperando al cliente'})
        log = ActivityLog.objects.get(request=rq, action='ITEM_ATTENTION_OVERRIDE')
        assert log.user == logistics_coordinator and log.created_at
        assert 'Línea 1' in log.detail and 'Stand by' in log.detail and 'Esperando al cliente' in log.detail

    def test_the_request_status_approvals_and_other_logs_do_not_change(self, rq_item, logistics_coordinator):
        rq, item = rq_item
        approvals_before = Approval.objects.count()
        send(logistics_coordinator, rq, item, {'override': 'DESESTIMADO', 'note': 'x'})
        send(logistics_coordinator, rq, item, {'override': ''})
        rq.refresh_from_db()
        assert rq.status == 'IN_STOCK' and Approval.objects.count() == approvals_before

    def test_a_logging_event_records_the_ids_without_the_note(self, rq_item, logistics_coordinator, caplog):
        rq, item = rq_item
        with capture_logs(caplog, 'apps.rq.services.item_attention', level=10):
            send(logistics_coordinator, rq, item, {'override': 'STAND_BY', 'note': 'dato interno'})
        record = next(r for r in caplog.records if r.message == 'rq.item_attention.updated')
        assert (record.rq_id, record.item_id, record.user_id) == (rq.pk, item.pk, logistics_coordinator.pk)
        assert 'dato interno' not in caplog.text


# ═══════════════════════════════ conflictos y 404 ═══════════════════════════════

class TestConflictsAndNotFound:
    @pytest.mark.parametrize('status', TERMINAL)
    def test_a_terminal_request_answers_409_and_changes_nothing(self, world, logistics_coordinator, status):
        world.b.status = status
        world.b.save(update_fields=['status'])
        response = send(logistics_coordinator, world.b, world.b1, {'override': 'STAND_BY', 'note': 'x'})
        assert response.status_code == 409
        body = response.json()
        assert body['code'] == 'REQUEST_TERMINAL'
        assert body['error'] is True and body['status_code'] == 409 and body['detail']
        world.b1.refresh_from_db()
        assert world.b1.attention_override == ''
        assert not ActivityLog.objects.filter(request=world.b, action='ITEM_ATTENTION_OVERRIDE').exists()

    def test_a_terminal_request_cannot_have_its_override_cleared_either(self, world, logistics_coordinator):
        world.b1.attention_override, world.b1.attention_note = 'STAND_BY', 'Pausa'
        world.b1.save()
        world.b.status = 'CANCELLED'
        world.b.save(update_fields=['status'])
        assert send(logistics_coordinator, world.b, world.b1, {'override': ''}).status_code == 409

    @pytest.mark.parametrize('status', ['SUBMITTED', 'VALIDATED', 'IN_STOCK', 'PO_GENERATED',
                                         'DELIVERED', 'CLAIM_IN_REVIEW'])
    def test_open_requests_in_any_phase_accept_it(self, world, logistics_coordinator, status):
        world.b.status = status
        world.b.save(update_fields=['status'])
        assert send(logistics_coordinator, world.b, world.b1, {'override': 'STAND_BY', 'note': 'x'}).status_code == 200

    def test_a_draft_is_not_a_requirement_yet_so_logistics_does_not_even_see_it(self, world, logistics_coordinator):
        """SYSPCC-031: a draft is private to its requester; there is nothing to track in it."""
        world.b.status = 'DRAFT'
        world.b.save(update_fields=['status'])
        assert send(logistics_coordinator, world.b, world.b1, {'override': 'STAND_BY', 'note': 'x'}).status_code == 404
        world.b1.refresh_from_db()
        assert world.b1.attention_override == ''

    def test_unknown_request_item_and_cross_request_item_are_404(self, world, logistics_coordinator):
        cross = send(logistics_coordinator, world.b, world.a1, {'override': 'STAND_BY', 'note': 'x'})
        assert cross.status_code == 404
        assert cross.json() == {'error': True, 'status_code': 404,
                                'detail': 'La línea no existe en este requerimiento.', 'code': 'ITEM_NOT_FOUND'}
        response = client_for(logistics_coordinator).post(
            f'/api/v1/requests/{world.b.pk}/items/999999/attention-override/',
            {'override': 'STAND_BY', 'note': 'x'}, format='json')
        assert response.status_code == 404
        response = client_for(logistics_coordinator).post(
            '/api/v1/requests/999999/items/1/attention-override/',
            {'override': 'STAND_BY', 'note': 'x'}, format='json')
        assert response.status_code == 404
        world.a1.refresh_from_db()
        assert world.a1.attention_override == ''

    def test_the_request_disappearing_before_the_lock_is_a_404(self, world, logistics_coordinator):
        from apps.rq.models import Request
        with mock.patch('apps.rq.views.request.set_attention_override', side_effect=Request.DoesNotExist):
            response = send(logistics_coordinator, world.b, world.b1, {'override': 'STAND_BY', 'note': 'x'})
        assert response.status_code == 404
        assert response.json() == {'error': True, 'status_code': 404,
                                   'detail': 'El requerimiento ya no existe.', 'code': 'REQUEST_NOT_FOUND'}

    def test_an_unexpected_error_is_logged_and_not_swallowed(self, world, logistics_coordinator, caplog):
        client = client_for(logistics_coordinator)
        client.raise_request_exception = False
        with capture_logs(caplog, 'apps.rq.views.request', level=40), \
                mock.patch('apps.rq.views.request.set_attention_override', side_effect=RuntimeError('boom')):
            response = client.post(url(world.b, world.b1), {'override': 'STAND_BY', 'note': 'x'}, format='json')
        assert response.status_code == 500
        assert any(r.message == 'rq.item_attention.unexpected' for r in caplog.records)


# ═══════════════════════════════ restricciones de base de datos ═══════════════════════════════

class TestDatabaseConstraints:
    def test_an_override_without_note_cannot_be_stored(self, world):
        with pytest.raises(IntegrityError), transaction.atomic():
            RequestItem.objects.filter(pk=world.b1.pk).update(attention_override='STAND_BY', attention_note='')

    def test_an_unknown_override_value_cannot_be_stored(self, world):
        with pytest.raises(IntegrityError), transaction.atomic():
            RequestItem.objects.filter(pk=world.b1.pk).update(attention_override='LO_QUE_SEA', attention_note='x')

    def test_a_note_alone_is_allowed(self, world):
        RequestItem.objects.filter(pk=world.b1.pk).update(attention_note='x')

    def test_existing_lines_default_to_no_override(self, world):
        assert RequestItem.objects.exclude(attention_override='').count() == 0

    def test_override_sticks_to_the_item_not_to_the_request(self, world, logistics_coordinator):
        send(logistics_coordinator, world.a, world.a1, {'override': 'STAND_BY', 'note': 'x'})
        assert RequestItem.objects.exclude(attention_override='').count() == 1
