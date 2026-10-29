"""
SYSPCC-026 (Fase 1, QA ronda 1): gaps left by test_update_items_catalog_link.py for
PATCH /api/v1/requests/{id}/update-items/.

  * the rest of the role matrix (the 13 roles of the project, on both flows) and the
    fact that the permission is checked BEFORE the RQ lookup (no existence oracle);
  * the 409 guard: precedence between its two reasons, the administrative flow, the
    exact response body and "a 409 changes nothing";
  * the two defensive branches of the view that no other test reaches: the RQ
    disappearing before the lock (404) and a database IntegrityError (409).

The guard lives only in this auxiliary endpoint: none of these tests may ever
see a workflow transition blocked or a status changed.
"""
from decimal import Decimal

import pytest
from django.db import IntegrityError
from rest_framework import status

from apps.core.enums import WarehouseOriginChoices
from apps.core.exceptions import RequestItemConflict
from apps.rq.models import ActivityLog, Approval, Request, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    capture_logs,
    central_warehouse,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    ops_rq,
    rq_in_editable_state,
)
from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

# Every test here runs on an RQ in an editable state (the shared fixtures are SUBMITTED).
pytestmark = pytest.mark.usefixtures('rq_in_editable_state')

TERMINAL_STATES = ['CLOSED', 'CANCELLED', 'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED',
                   'GM_REJECTED', 'COST_OVERRUN_REJECTED']


def _url(rq):
    return f'/api/v1/requests/{rq.pk}/update-items/'


def _patch(user, rq, items):
    return client_for(user).patch(_url(rq), {'items': items}, format='json')


def _dispatch(rq, item, quantity, by):
    dispatch = WarehouseDispatch.objects.create(
        request=rq, dispatched_by=by, origin=WarehouseOriginChoices.CENTRAL,
    )
    return WarehouseDispatchItem.objects.create(
        dispatch=dispatch, request_item=item, quantity_dispatched=Decimal(str(quantity)),
    )


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')


@pytest.fixture
def gloves(db):
    return make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')


@pytest.fixture
def item(ops_rq):
    return make_item(ops_rq, 1, description='Casco', quantity=10)


@pytest.fixture
def adm_item(adm_rq):
    return make_item(adm_rq, 1, description='Papel bond A4', quantity=10, unit='MLL')


def _unchanged(line):
    line.refresh_from_db()
    return (line.inventory_item_id, line.is_off_catalog, line.item_source, line.supply_source) == (
        None, False, '', '',
    )


# ──────────────────────────── role matrix ────────────────────────────

@pytest.mark.django_db
class TestRoleMatrix:
    @pytest.mark.parametrize('fixture_name', [
        'direct_supervisor', 'admin_manager', 'hr_manager', 'pasajes_manager',
        'department_requester', 'user',
    ])
    def test_the_other_roles_cannot_edit_an_operations_request(
        self, request, fixture_name, ops_rq, item, helmet,
    ):
        """Complements the 6 roles of test_update_items_catalog_link.py: together, all 13 + roleless."""
        user = request.getfixturevalue(fixture_name)

        response = _patch(user, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _unchanged(item)

    @pytest.mark.parametrize('fixture_name', [
        'requester', 'project_resident', 'project_control', 'general_manager', 'site_warehouse',
        'central_warehouse', 'direct_supervisor', 'admin_manager', 'hr_manager', 'pasajes_manager',
        'department_requester', 'user',
    ])
    def test_no_non_logistics_role_can_edit_an_administrative_request(
        self, request, fixture_name, adm_rq, adm_item, helmet,
    ):
        user = request.getfixturevalue(fixture_name)

        response = _patch(user, adm_rq, [{'item_id': adm_item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _unchanged(adm_item)

    def test_the_owner_of_an_administrative_request_cannot_edit_it_either(
        self, department_requester, adm_rq, adm_item,
    ):
        assert adm_rq.requested_by_id == department_requester.pk

        response = _patch(department_requester, adm_rq, [{'item_id': adm_item.pk, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _unchanged(adm_item)

    def test_permission_is_checked_before_the_lookup_so_existence_is_not_revealed(
        self, other_requester, ops_rq, item, helmet,
    ):
        """A stranger gets the same 403 for an RQ they cannot see and for one that does not exist."""
        foreign = _patch(other_requester, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])
        missing = client_for(other_requester).patch(
            '/api/v1/requests/999999/update-items/',
            {'items': [{'item_id': 1, 'inventory_item': helmet.pk}]}, format='json',
        )

        assert foreign.status_code == missing.status_code == status.HTTP_403_FORBIDDEN
        assert foreign.data == missing.data

    @pytest.mark.parametrize('fixture_name', ['logistics_coordinator', 'logistics_supervisor', 'logistics_chief'])
    def test_logistics_sees_every_project_so_it_can_edit_a_foreign_one(
        self, request, fixture_name, foreign_request, helmet,
    ):
        user = request.getfixturevalue(fixture_name)
        line = make_item(foreign_request, 1)
        foreign_request.status = 'VALIDATED'  # inside the editable window
        foreign_request.save(update_fields=['status'])

        response = _patch(user, foreign_request, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK
        line.refresh_from_db()
        assert line.inventory_item_id == helmet.pk

    def test_a_logistics_role_does_not_leak_into_other_methods(self, logistics_coordinator, ops_rq):
        """The endpoint accepts PATCH only; the logistics permission does not open GET/PUT/POST."""
        client = client_for(logistics_coordinator)
        for method in ('get', 'put', 'post', 'delete'):
            response = getattr(client, method)(_url(ops_rq), {}, format='json')
            assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED, method


# ──────────────────────────── 409 guard ────────────────────────────

@pytest.mark.django_db
class TestConflictGuardEdges:
    def test_a_terminal_request_wins_over_the_dispatch_guard(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        line = make_item(ops_rq, 1, inventory_item=helmet)
        _dispatch(ops_rq, line, 3, central_warehouse)
        ops_rq.status = 'CLOSED'
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'item_source': 'EPP'}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'
        assert response.data['item_ids'] == []

    @pytest.mark.parametrize('state', TERMINAL_STATES)
    def test_terminal_guard_applies_on_the_administrative_flow_too(
        self, logistics_supervisor, adm_rq, adm_item, helmet, state,
    ):
        adm_rq.status = state
        adm_rq.save(update_fields=['status'])

        response = _patch(logistics_supervisor, adm_rq, [{'item_id': adm_item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'
        assert _unchanged(adm_item)
        adm_rq.refresh_from_db()
        assert adm_rq.status == state

    def test_a_terminal_request_answers_409_even_with_an_empty_items_list(self, logistics_coordinator, ops_rq):
        ops_rq.status = 'CANCELLED'
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'REQUEST_TERMINAL'

    def test_dispatch_guard_applies_on_the_administrative_flow_too(
        self, logistics_supervisor, central_warehouse, adm_rq, helmet, gloves,
    ):
        dispatched = make_item(adm_rq, 1, inventory_item=helmet)
        free = make_item(adm_rq, 2)
        _dispatch(adm_rq, dispatched, 2, central_warehouse)

        blocked = _patch(logistics_supervisor, adm_rq, [{'item_id': dispatched.pk, 'inventory_item': gloves.pk}])
        allowed = _patch(logistics_supervisor, adm_rq, [{'item_id': free.pk, 'inventory_item': gloves.pk}])

        assert blocked.status_code == status.HTTP_409_CONFLICT
        assert blocked.data['code'] == 'ITEMS_ALREADY_DISPATCHED'
        assert blocked.data['item_ids'] == [dispatched.pk]
        assert allowed.status_code == status.HTTP_200_OK
        dispatched.refresh_from_db()
        assert dispatched.inventory_item_id == helmet.pk

    def test_even_a_small_partial_dispatch_locks_the_line(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet, gloves,
    ):
        line = make_item(ops_rq, 1, quantity=100, inventory_item=helmet)
        _dispatch(ops_rq, line, '0.001', central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': gloves.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        line.refresh_from_db()
        assert line.inventory_item_id == helmet.pk

    def test_several_dispatch_rows_of_one_line_report_its_id_once(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        line = make_item(ops_rq, 1, inventory_item=helmet)
        _dispatch(ops_rq, line, 1, central_warehouse)
        _dispatch(ops_rq, line, 2, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['item_ids'] == [line.pk]

    def test_every_dispatched_line_in_the_payload_is_reported_in_ascending_order(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        lines = [make_item(ops_rq, n, inventory_item=helmet) for n in (1, 2, 3)]
        clean = make_item(ops_rq, 4)
        for line in lines:
            _dispatch(ops_rq, line, 1, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [
            {'item_id': lines[2].pk, 'item_source': 'EPP'},
            {'item_id': clean.pk, 'item_source': 'EPP'},
            {'item_id': lines[0].pk, 'item_source': 'EPP'},
        ])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['item_ids'] == sorted([lines[0].pk, lines[2].pk])
        clean.refresh_from_db()
        assert clean.item_source == ''          # all-or-nothing: the clean line was not written either

    def test_the_conflict_body_has_exactly_detail_code_and_item_ids_in_spanish(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        line = make_item(ops_rq, 1, inventory_item=helmet)
        _dispatch(ops_rq, line, 1, central_warehouse)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'item_source': 'EPP'}])

        assert set(response.data) == {'detail', 'code', 'item_ids'}
        assert response.data['detail'] == 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.'

    def test_a_409_creates_no_audit_entry_no_approval_and_keeps_the_status(
        self, logistics_coordinator, central_warehouse, ops_rq, helmet,
    ):
        ops_rq.status = 'IN_STOCK'
        ops_rq.save(update_fields=['status'])
        line = make_item(ops_rq, 1, inventory_item=helmet)
        _dispatch(ops_rq, line, 1, central_warehouse)
        approvals_before = Approval.objects.filter(request=ops_rq).count()

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert not ActivityLog.objects.filter(request=ops_rq).exists()
        assert Approval.objects.filter(request=ops_rq).count() == approvals_before
        ops_rq.refresh_from_db()
        assert ops_rq.status == 'IN_STOCK'

    def test_the_guard_never_blocks_reading_a_terminal_request(self, logistics_coordinator, ops_rq, item):
        """Only writing is guarded: the RQ and its availability stay readable once it is closed."""
        ops_rq.status = 'CLOSED'
        ops_rq.save(update_fields=['status'])
        client = client_for(logistics_coordinator)

        assert client.get(f'/api/v1/requests/{ops_rq.pk}/').status_code == status.HTTP_200_OK
        assert client.get(f'/api/v1/requests/{ops_rq.pk}/stock-availability/').status_code == status.HTTP_200_OK

    def test_a_blocked_attempt_can_be_retried_after_the_cause_is_gone(
        self, logistics_coordinator, ops_rq, item, helmet,
    ):
        """409 is not sticky: nothing is remembered once the cause is gone."""
        ops_rq.status = 'CLOSED'
        ops_rq.save(update_fields=['status'])
        payload = [{'item_id': item.pk, 'inventory_item': helmet.pk}]
        assert _patch(logistics_coordinator, ops_rq, payload).status_code == status.HTTP_409_CONFLICT

        ops_rq.status = 'VALIDATED'
        ops_rq.save(update_fields=['status'])

        assert _patch(logistics_coordinator, ops_rq, payload).status_code == status.HTTP_200_OK


# ──────────────────── defensive branches of the view ────────────────────

@pytest.mark.django_db
class TestRaceMappings:
    def test_a_request_deleted_before_the_lock_answers_404_and_writes_nothing(
        self, logistics_coordinator, ops_rq, item, helmet, monkeypatch, caplog,
    ):
        from apps.rq.services import request_items as service

        real = service.update_request_items

        def delete_then_update(request_obj, items_data, user):
            Request.objects.filter(pk=request_obj.pk).delete()      # someone else removed it meanwhile
            return real(request_obj, items_data, user)

        monkeypatch.setattr('apps.rq.views.request.update_request_items', delete_then_update)

        with capture_logs(caplog, 'apps.rq.views.request'):
            response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data == {'detail': 'El requerimiento ya no existe.'}
        assert not ActivityLog.objects.exists()
        assert any(r.getMessage() == 'rq.update_items.not_found' and r.rq_id == ops_rq.pk for r in caplog.records)

    def test_a_database_integrity_error_answers_409_and_rolls_every_line_back(
        self, logistics_coordinator, ops_rq, helmet, gloves, monkeypatch, caplog,
    ):
        first = make_item(ops_rq, 1)
        second = make_item(ops_rq, 2)
        original_save = RequestItem.save
        calls = {'n': 0}

        def second_save_violates_a_constraint(self, *args, **kwargs):
            calls['n'] += 1
            if calls['n'] == 2:
                raise IntegrityError('request_item_not_linked_and_off_catalog')
            return original_save(self, *args, **kwargs)

        monkeypatch.setattr(RequestItem, 'save', second_save_violates_a_constraint)

        with capture_logs(caplog, 'apps.rq.views.request'):
            response = _patch(logistics_coordinator, ops_rq, [
                {'item_id': first.pk, 'inventory_item': helmet.pk},
                {'item_id': second.pk, 'inventory_item': gloves.pk},
            ])
        monkeypatch.undo()

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data['code'] == 'INTEGRITY_ERROR'
        assert 'Actualice la página' in response.data['detail']
        assert _unchanged(first) and _unchanged(second)
        assert not ActivityLog.objects.filter(request=ops_rq).exists()
        assert any(r.getMessage() == 'rq.update_items.integrity_error' for r in caplog.records)


# ──────────────────── hostile identifiers ────────────────────

@pytest.mark.django_db
class TestHostileIdentifiers:
    @pytest.mark.parametrize('item_id', [0, -1, -(2 ** 31), 2 ** 31, 2 ** 62])
    def test_ids_that_are_valid_integers_but_not_lines_of_this_rq_are_reported_as_ignored(
        self, logistics_coordinator, ops_rq, item_id,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item_id, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK
        assert response.data['ignored_item_ids'] == [item_id]
        assert response.data['updated_item_ids'] == []

    @pytest.mark.parametrize('item_id', [2 ** 63, 10 ** 30, -(10 ** 30)])
    def test_an_item_id_beyond_the_database_integer_range_is_a_400_not_a_500(
        self, logistics_coordinator, ops_rq, item_id,
    ):
        """
        BUG (SYSPCC-026, found by QA): `UpdateItemPayloadSerializer.item_id` is an unbounded
        IntegerField, so `pk__in=[10**30]` reaches the database driver and raises
        OverflowError -> HTTP 500 (SQLite; on PostgreSQL it depends on the driver's int8 handling).
        A malformed id must be answered with a 400 like every other malformed value
        (see test_malformed_bodies_are_400_not_500). Fix: give `item_id` a min_value/max_value.
        """
        client = client_for(logistics_coordinator)
        client.raise_request_exception = False

        response = client.patch(_url(ops_rq), {'items': [{'item_id': item_id, 'is_off_catalog': True}]},
                                format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.status_code

    @pytest.mark.parametrize('product_id', [0, -1, 2 ** 63, 10 ** 30])
    def test_a_catalog_product_id_out_of_range_is_a_400_with_the_field_named(
        self, logistics_coordinator, ops_rq, item, product_id,
    ):
        response = _patch(logistics_coordinator, ops_rq, [{'item_id': item.pk, 'inventory_item': product_id}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'inventory_item' in response.data['detail']['items'][0]
        assert _unchanged(item)

    def test_an_empty_string_product_is_treated_as_null_and_drops_the_link(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        """DRF turns '' into None for a nullable relation: documented so nobody relies on it by mistake."""
        line = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': ''}])

        assert response.status_code == status.HTTP_200_OK
        line.refresh_from_db()
        assert line.inventory_item_id is None

    @pytest.mark.parametrize('body', ['{"items": [', '', 'null', '"text"', '12'])
    def test_unparseable_or_non_object_bodies_are_400(self, logistics_coordinator, ops_rq, body):
        response = client_for(logistics_coordinator).generic(
            'PATCH', _url(ops_rq), body, content_type='application/json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_a_form_encoded_body_is_not_accepted_as_a_payload(self, logistics_coordinator, ops_rq, item):
        response = client_for(logistics_coordinator).generic(
            'PATCH', _url(ops_rq), f'items={item.pk}', content_type='application/x-www-form-urlencoded',
        )

        assert response.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
        assert _unchanged(item)


# ──────────────────── the exception that carries the 409 ────────────────────

class TestRequestItemConflictException:
    def test_it_exposes_message_code_and_offending_ids(self):
        exc = RequestItemConflict('mensaje', code=RequestItemConflict.ITEMS_ALREADY_DISPATCHED, item_ids=[3, 5])

        assert exc.message == 'mensaje'
        assert str(exc) == 'mensaje'
        assert exc.code == 'ITEMS_ALREADY_DISPATCHED'
        assert exc.item_ids == [3, 5]

    def test_the_reasons_are_stable_machine_readable_strings(self):
        assert RequestItemConflict.REQUEST_TERMINAL == 'REQUEST_TERMINAL'
        assert RequestItemConflict.ITEMS_ALREADY_DISPATCHED == 'ITEMS_ALREADY_DISPATCHED'

    def test_defaults_are_independent_per_instance(self):
        first = RequestItemConflict('a')
        second = RequestItemConflict('b')
        first.item_ids.append(99)

        assert second.item_ids == []
        assert first.code is None
