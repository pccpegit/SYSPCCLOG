"""
SYSPCC-009 fix #2: Notification creation via Celery tasks must be idempotent.

Before the fix, `check_sla_deadlines` / `send_pending_approval_reminders` used
`Notification.objects.bulk_create(..., ignore_conflicts=True)` with no unique
constraint on `Notification` at all, so `ignore_conflicts` had nothing to
collide against — re-running the task (Celery Beat retry, manual re-run, or
simply the same day) produced unlimited duplicate notifications.

After the fix: a nullable `dedup_key` field + a partial unique index
(`notification_dedup_key_unique_when_set`, unique only when NOT NULL) gives
`ignore_conflicts=True` something real to collide against. Both tasks populate
a deterministic key of the form `{type}:{recipient_id}:{request_id}:{date}`.
"""
import datetime
from unittest import mock

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.enums import RoleChoices, RQFlowChoices, RQStatusChoices
from apps.rq.models import Notification, Request, WorkflowStep
from apps.rq.tasks import check_sla_deadlines, send_pending_approval_reminders


@pytest.mark.django_db
class TestCheckSlaDeadlinesIdempotency:
    def test_running_twice_produces_one_notification_per_recipient(self, ops_request, requester):
        ops_request.status = RQStatusChoices.VALIDATED
        ops_request.fecha_estimada_entrega = timezone.now().date() - datetime.timedelta(days=2)
        ops_request.save(update_fields=['status', 'fecha_estimada_entrega'])

        check_sla_deadlines()
        check_sla_deadlines()  # simulates a Celery Beat retry / manual re-run same day

        notifications = Notification.objects.filter(user=requester, request=ops_request)
        assert notifications.count() == 1
        assert notifications.first().dedup_key == (
            f'sla_overdue:{requester.id}:{ops_request.id}:{timezone.now().date().isoformat()}'
        )

    def test_approaching_deadline_running_twice_produces_one_notification(
        self, ops_request, requester
    ):
        ops_request.status = RQStatusChoices.VALIDATED
        ops_request.fecha_estimada_entrega = timezone.now().date() + datetime.timedelta(days=1)
        ops_request.save(update_fields=['status', 'fecha_estimada_entrega'])

        check_sla_deadlines()
        check_sla_deadlines()

        notifications = Notification.objects.filter(user=requester, request=ops_request)
        assert notifications.count() == 1

    def test_dedup_key_db_constraint_rejects_direct_duplicate_insert(self, ops_request, requester):
        """
        Belt-and-suspenders: prove the partial unique index itself rejects a
        duplicate dedup_key even if application code bypassed bulk_create's
        ignore_conflicts (e.g. a future direct .create() call).
        """
        key = f'sla_overdue:{requester.id}:{ops_request.id}:2026-01-01'
        Notification.objects.create(
            user=requester, request=ops_request, title='t', message='m', dedup_key=key
        )
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Notification.objects.create(
                    user=requester, request=ops_request, title='t2', message='m2', dedup_key=key
                )

    def test_null_dedup_key_does_not_collide(self, ops_request, requester):
        """
        Notifications with no dedup_key (e.g. NotificationService.notify_on_transition,
        which does not opt into dedup) must remain unrestricted by the constraint.
        """
        Notification.objects.create(user=requester, request=ops_request, title='a', message='m1')
        Notification.objects.create(user=requester, request=ops_request, title='b', message='m2')
        assert Notification.objects.filter(user=requester, request=ops_request).count() == 2


@pytest.mark.django_db
class TestSendPendingApprovalRemindersIdempotency:
    @pytest.fixture(autouse=True)
    def _workflow_step(self):
        return WorkflowStep.objects.create(
            flow=RQFlowChoices.OPERATIONS,
            step_order=99,
            step_code='TEST_GM_REVIEW',
            step_name='Revisión GM (test)',
            responsible_role=RoleChoices.GENERAL_MANAGER,
            from_status=RQStatusChoices.GM_REVIEW,
            to_status_approve=RQStatusChoices.GM_APPROVED,
            phase=2,
        )

    def test_running_twice_produces_one_reminder_per_recipient(
        self, ops_request, general_manager
    ):
        ops_request.status = RQStatusChoices.GM_REVIEW
        ops_request.save(update_fields=['status'])
        # Bypass auto_now so the request looks stale (>24h since last update).
        Request.objects.filter(pk=ops_request.pk).update(
            updated_at=timezone.now() - datetime.timedelta(hours=48)
        )

        send_pending_approval_reminders()
        send_pending_approval_reminders()  # same-day re-run must not duplicate

        notifications = Notification.objects.filter(user=general_manager, request=ops_request)
        assert notifications.count() == 1

    def test_from_status_lookup_actually_finds_the_step(self, ops_request, general_manager):
        """
        Regression guard for the `current_status` -> `from_status` fix: without it,
        WorkflowStep.objects.filter(current_status=...) raises FieldError and no
        reminder is ever created.
        """
        ops_request.status = RQStatusChoices.GM_REVIEW
        ops_request.save(update_fields=['status'])
        Request.objects.filter(pk=ops_request.pk).update(
            updated_at=timezone.now() - datetime.timedelta(hours=48)
        )

        send_pending_approval_reminders()

        assert Notification.objects.filter(user=general_manager, request=ops_request).exists()
