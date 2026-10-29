"""
SYSPCC-026 (Fase 1, QA ronda 2): update-items against a stale view of the request.

The view loads the Request (`get_object()`), validates the payload and only then calls
`update_request_items`. In between, another user (or the engine) may have moved the RQ.
The service therefore re-reads the row under `select_for_update` and decides on THAT
status, never on the in-memory copy the view handed in. SQLite cannot reproduce two
concurrent transactions, so these tests build the race the way test_workflow_engine_locking
does: two independent reads, one of them stale.

Also pins the documented lock order (the Request first, then its lines) and that the
line lock leaves the nullable `inventory_item` join alone (`of=('self',)`), because
PostgreSQL refuses FOR UPDATE on the nullable side of an outer join.
"""
import pytest
from django.db.models.query import QuerySet

from apps.core.exceptions import RequestItemConflict
from apps.rq.models import Request, RequestItem
from apps.rq.services.request_items import update_request_items
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    logistics_supervisor,
    make_inventory,
    make_item,
    ops_rq,
)


def _set_status(rq, new_status):
    """Move the row behind the back of every in-memory copy (what a concurrent request does)."""
    Request.objects.filter(pk=rq.pk).update(status=new_status)


def _entry(item, **fields):
    return {'item_id': item.pk, **fields}


@pytest.mark.django_db
class TestTheServiceDecidesOnTheLockedRow:
    @pytest.fixture
    def line(self, ops_rq):
        Request.objects.filter(pk=ops_rq.pk).update(status='VALIDATED')
        ops_rq.refresh_from_db()
        return make_item(ops_rq, 1)

    @pytest.mark.parametrize('status_in_db, code', [
        ('CANCELLED', RequestItemConflict.REQUEST_TERMINAL),
        ('GM_REJECTED', RequestItemConflict.REQUEST_TERMINAL),
        ('CLOSED', RequestItemConflict.REQUEST_TERMINAL),
        ('DISPATCHED_TO_SITE', RequestItemConflict.REQUEST_STATE_NOT_EDITABLE),
        ('DELIVERED', RequestItemConflict.REQUEST_STATE_NOT_EDITABLE),
        ('SUBMITTED', RequestItemConflict.REQUEST_STATE_NOT_EDITABLE),
    ])
    def test_a_stale_validated_copy_does_not_let_a_moved_request_be_edited(
        self, ops_rq, line, logistics_coordinator, status_in_db, code,
    ):
        stale = Request.objects.get(pk=ops_rq.pk)
        assert stale.status == 'VALIDATED'
        _set_status(ops_rq, status_in_db)

        with pytest.raises(RequestItemConflict) as excinfo:
            update_request_items(stale, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        assert excinfo.value.code == code
        line.refresh_from_db()
        assert line.supply_source == ''

    def test_a_stale_terminal_copy_does_not_block_a_request_that_is_in_the_window(
        self, ops_rq, line, logistics_coordinator,
    ):
        """The opposite staleness: the copy says SUBMITTED but the RQ was validated meanwhile."""
        _set_status(ops_rq, 'SUBMITTED')
        stale = Request.objects.get(pk=ops_rq.pk)
        _set_status(ops_rq, 'VALIDATED')

        result = update_request_items(stale, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        assert [item.pk for item in result.updated] == [line.pk]
        line.refresh_from_db()
        assert line.supply_source == 'STOCK'

    def test_a_conflict_writes_nothing_and_logs_nothing(self, ops_rq, line, logistics_coordinator):
        from apps.rq.models import ActivityLog

        stale = Request.objects.get(pk=ops_rq.pk)
        _set_status(ops_rq, 'DISPATCHED_TO_SITE')

        with pytest.raises(RequestItemConflict):
            update_request_items(stale, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_the_in_memory_copy_is_left_untouched(self, ops_rq, line, logistics_coordinator):
        """The service locks its own fresh row; it never mutates the instance the view passed."""
        stale = Request.objects.get(pk=ops_rq.pk)

        update_request_items(stale, [_entry(line, supply_source='PURCHASE')], logistics_coordinator)

        assert stale.status == 'VALIDATED'


@pytest.mark.django_db
class TestLockDiscipline:
    @pytest.fixture
    def recorded_locks(self, monkeypatch):
        calls = []
        original = QuerySet.select_for_update

        def spy(self, *args, **kwargs):
            calls.append((self.model, kwargs))
            return original(self, *args, **kwargs)

        monkeypatch.setattr(QuerySet, 'select_for_update', spy)
        return calls

    def test_the_request_is_locked_before_its_lines(self, ops_rq, logistics_coordinator, recorded_locks):
        Request.objects.filter(pk=ops_rq.pk).update(status='VALIDATED')
        ops_rq.refresh_from_db()
        line = make_item(ops_rq, 1)

        update_request_items(ops_rq, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        assert [model for model, _ in recorded_locks] == [Request, RequestItem]

    def test_the_lines_lock_skips_the_nullable_catalog_join(self, ops_rq, logistics_coordinator, recorded_locks):
        Request.objects.filter(pk=ops_rq.pk).update(status='VALIDATED')
        ops_rq.refresh_from_db()
        line = make_item(ops_rq, 1, inventory_item=make_inventory())

        update_request_items(ops_rq, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        (_, request_kwargs), (_, items_kwargs) = recorded_locks
        assert request_kwargs == {}
        assert items_kwargs == {'of': ('self',)}

    def test_a_blocked_call_still_locked_only_the_request(self, ops_rq, logistics_coordinator, recorded_locks):
        """The guard fires before the lines are touched, so no line lock is taken for nothing."""
        Request.objects.filter(pk=ops_rq.pk).update(status='CANCELLED')
        ops_rq.refresh_from_db()
        line = make_item(ops_rq, 1)

        with pytest.raises(RequestItemConflict):
            update_request_items(ops_rq, [_entry(line, supply_source='STOCK')], logistics_coordinator)

        assert [model for model, _ in recorded_locks] == [Request]

    def test_an_administrative_request_follows_the_same_order(self, adm_rq, logistics_supervisor, recorded_locks):
        Request.objects.filter(pk=adm_rq.pk).update(status='IN_STOCK')
        adm_rq.refresh_from_db()
        line = make_item(adm_rq, 1)

        update_request_items(adm_rq, [_entry(line, supply_source='STOCK')], logistics_supervisor)

        assert [model for model, _ in recorded_locks] == [Request, RequestItem]
