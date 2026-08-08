"""
SYSPCC-012 FIX 3: the three periodic Celery tasks in apps.rq.tasks must be
bound, retry-with-backoff on transient infra errors, and have a bounded
max_retries — no unbounded retry loops. This inspects the task attributes
Celery sets from the `@shared_task(...)` decorator kwargs, and exercises
`.apply()` (synchronous, no broker required) to prove `bind=True` actually
wires up `self.request` end-to-end rather than just checking a class flag.
"""
import pytest
from django.db import OperationalError

from apps.rq.tasks import (
    check_sla_deadlines,
    invalidate_dashboard_caches,
    send_pending_approval_reminders,
)

ALL_TASKS = [check_sla_deadlines, send_pending_approval_reminders, invalidate_dashboard_caches]


class TestTaskRetryConfiguration:
    def test_all_tasks_have_bounded_max_retries(self):
        for task in ALL_TASKS:
            assert isinstance(task.max_retries, int)
            assert 0 < task.max_retries <= 5, (
                f'{task.name}.max_retries={task.max_retries} — must be bounded, not unlimited'
            )

    def test_all_tasks_use_backoff_and_jitter(self):
        for task in ALL_TASKS:
            assert task.retry_backoff is True, f'{task.name} must use retry_backoff'
            assert task.retry_jitter is True, f'{task.name} must use retry_jitter'

    def test_db_tasks_autoretry_on_operational_error(self):
        for task in (check_sla_deadlines, send_pending_approval_reminders):
            assert OperationalError in task.autoretry_for

    def test_cache_task_autoretries_on_redis_transient_errors(self):
        import redis.exceptions
        assert redis.exceptions.ConnectionError in invalidate_dashboard_caches.autoretry_for
        assert redis.exceptions.TimeoutError in invalidate_dashboard_caches.autoretry_for


@pytest.mark.django_db
class TestTaskBindingEndToEnd:
    """
    `.apply()` runs the task synchronously through Celery's real Task.__call__
    machinery (no broker needed) — if `bind=True` weren't actually wired up,
    `self.request.id`/`self.request.retries` inside the task body would raise
    instead of the task completing successfully.
    """

    def test_check_sla_deadlines_apply_succeeds(self):
        result = check_sla_deadlines.apply()
        assert result.successful(), result.traceback

    def test_send_pending_approval_reminders_apply_succeeds(self):
        result = send_pending_approval_reminders.apply()
        assert result.successful(), result.traceback

    def test_invalidate_dashboard_caches_apply_succeeds(self):
        result = invalidate_dashboard_caches.apply()
        assert result.successful(), result.traceback
