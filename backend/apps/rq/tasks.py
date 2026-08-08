"""
Celery tasks for the RQ app.

Registered tasks:
  - rq.check_sla_deadlines         : daily SLA health check (8 AM Lima)
  - rq.send_pending_approval_reminders : stale-approval reminders (9 AM & 2 PM)
  - rq.invalidate_dashboard_caches : periodic cache invalidation (every 15 min)

SYSPCC-012: all three tasks are bound (`bind=True`), auto-retry on transient
infrastructure errors with backoff + jitter, and have a last-barrier
`except Exception` that logs the full stack with structured context before
re-raising — so a genuinely unexpected failure still shows up as a FAILURE
in Celery/Flower instead of disappearing silently.
"""

import logging

import redis.exceptions
from celery import shared_task
from django.db import OperationalError
from django.utils import timezone

logger = logging.getLogger(__name__)

# Bounded, backed-off retries for transient DB/cache errors. These tasks are
# periodic (beat re-runs them anyway) and idempotent (dedup_key / full cache
# wipe), so retrying is safe — but retries must stay bounded, never infinite.
DB_TRANSIENT_ERRORS = (OperationalError,)
CACHE_TRANSIENT_ERRORS = (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError)


@shared_task(
    name='rq.check_sla_deadlines',
    bind=True,
    autoretry_for=DB_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def check_sla_deadlines(self):
    """
    Check for RQs approaching or past their SLA deadline and send
    in-app notifications to the requester.

    Active statuses are those where the RQ is still in-flight — the
    request is not yet delivered, closed, or cancelled.
    """
    from apps.rq.models import Request, Notification

    ctx = {'task_id': self.request.id, 'retries': self.request.retries}

    try:
        today = timezone.now().date()

        active_statuses = [
            'VALIDATED', 'STOCK_CHECK', 'REQUIRES_PURCHASE',
            'QUOTING', 'QUOTE_SELECTED', 'PO_GENERATED', 'RECEIVING',
        ]

        # --- Overdue RQs ---
        overdue_qs = Request.objects.filter(
            fecha_estimada_entrega__lt=today,
            status__in=active_statuses,
        ).select_related('requested_by')

        overdue_notifications = []
        for rq in overdue_qs:
            overdue_notifications.append(
                Notification(
                    user=rq.requested_by,
                    request=rq,
                    title=f'RQ {rq.rq_number} - Plazo vencido',
                    message=(
                        f'El requerimiento {rq.rq_number} ha superado su fecha estimada '
                        f'de entrega ({rq.fecha_estimada_entrega}).'
                    ),
                    # Deterministic per (type, recipient, request, day): re-running this
                    # task the same day (Celery retry or a manual re-run) hits the
                    # partial unique index on dedup_key and is skipped by
                    # ignore_conflicts=True instead of creating a duplicate.
                    dedup_key=f'sla_overdue:{rq.requested_by_id}:{rq.id}:{today.isoformat()}',
                )
            )

        if overdue_notifications:
            Notification.objects.bulk_create(overdue_notifications, ignore_conflicts=True)

        overdue_count = len(overdue_notifications)

        # --- RQs approaching deadline (within 3 days) ---
        approaching_qs = Request.objects.filter(
            fecha_estimada_entrega__range=(today, today + timezone.timedelta(days=3)),
            status__in=active_statuses,
        ).select_related('requested_by')

        approaching_notifications = []
        for rq in approaching_qs:
            days_left = (rq.fecha_estimada_entrega - today).days
            approaching_notifications.append(
                Notification(
                    user=rq.requested_by,
                    request=rq,
                    title=f'RQ {rq.rq_number} - Próximo a vencer',
                    message=(
                        f'El requerimiento {rq.rq_number} vence en {days_left} día(s) '
                        f'({rq.fecha_estimada_entrega}).'
                    ),
                    dedup_key=f'sla_approaching:{rq.requested_by_id}:{rq.id}:{today.isoformat()}',
                )
            )

        if approaching_notifications:
            Notification.objects.bulk_create(approaching_notifications, ignore_conflicts=True)

        approaching_count = len(approaching_notifications)

        logger.info(
            'task.check_sla_deadlines.ok',
            extra=ctx | {'overdue_count': overdue_count, 'approaching_count': approaching_count},
        )
        return f'Checked {overdue_count} overdue, {approaching_count} approaching deadline'
    except DB_TRANSIENT_ERRORS:
        # Expected/recoverable — autoretry_for handles the retry; just log
        # at warning (no stack spam) and let it propagate.
        logger.warning('task.check_sla_deadlines.retry', extra=ctx)
        raise
    except Exception:
        # Last barrier: unexpected failure — full stack, structured context,
        # re-raise so Celery marks the task FAILURE instead of swallowing it.
        logger.exception('task.check_sla_deadlines.failed', extra=ctx)
        raise


@shared_task(
    name='rq.send_pending_approval_reminders',
    bind=True,
    autoretry_for=DB_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def send_pending_approval_reminders(self):
    """
    Send in-app reminders for RQs that have been pending a human-review
    status for more than 24 hours without any update.
    """
    from apps.rq.models import Request, Notification, WorkflowStep
    from apps.core.models import User

    ctx = {'task_id': self.request.id, 'retries': self.request.retries}

    try:
        threshold = timezone.now() - timezone.timedelta(hours=24)
        today = timezone.now().date()

        pending_statuses = [
            'TECHNICAL_REVIEW', 'BUDGET_REVIEW', 'GM_REVIEW',
            'SUPERVISOR_REVIEW', 'ADMIN_BUDGET_REVIEW',
            'COST_OVERRUN_REVIEW', 'QUOTE_COMPARISON',
        ]

        stale_qs = Request.objects.filter(
            status__in=pending_statuses,
            updated_at__lt=threshold,
        ).select_related('requested_by')

        reminder_count = 0
        notifications = []

        for rq in stale_qs:
            # Find the responsible role(s) for the current step in this flow
            # NOTE: field is `from_status`, not `current_status` (WorkflowStep has no
            # `current_status` field) — pre-existing bug found while working on
            # SYSPCC-009: this lookup always raised FieldError, so this task never
            # actually sent a reminder. Fixed there because it blocked writing a
            # working idempotency test for this task; not part of the WorkflowEngine
            # transition table itself (apps/rq/services/workflow_engine.py untouched).
            # SYSPCC-012 note: left as-is here, only wrapping with retry/logging.
            responsible_roles = list(
                WorkflowStep.objects.filter(
                    flow=rq.flow,
                    from_status=rq.status,
                ).values_list('responsible_role', flat=True)
            )

            if not responsible_roles:
                continue

            # Notify active users holding a responsible role
            users_to_notify = User.objects.filter(
                user_roles__role__in=responsible_roles,
                is_active=True,
            ).distinct()

            hours_pending = int((timezone.now() - rq.updated_at).total_seconds() // 3600)

            for user in users_to_notify:
                notifications.append(
                    Notification(
                        user=user,
                        request=rq,
                        title=f'RQ {rq.rq_number} - Pendiente de revisión',
                        message=(
                            f'El requerimiento {rq.rq_number} lleva {hours_pending} hora(s) '
                            f'esperando acción en el estado actual. Por favor revíselo.'
                        ),
                        # One reminder per (recipient, request, day): the task runs
                        # twice daily (9 AM / 2 PM) by design, but if it's re-run or
                        # retried within the same day for a request still stuck in
                        # the same status, this collapses to a single notification
                        # per recipient instead of stacking duplicates.
                        dedup_key=f'approval_reminder:{user.id}:{rq.id}:{today.isoformat()}',
                    )
                )
            reminder_count += 1

        if notifications:
            Notification.objects.bulk_create(notifications, ignore_conflicts=True)

        logger.info(
            'task.send_pending_approval_reminders.ok',
            extra=ctx | {'reminder_count': reminder_count},
        )
        return f'Sent reminders for {reminder_count} stale requests'
    except DB_TRANSIENT_ERRORS:
        logger.warning('task.send_pending_approval_reminders.retry', extra=ctx)
        raise
    except Exception:
        logger.exception('task.send_pending_approval_reminders.failed', extra=ctx)
        raise


@shared_task(
    name='rq.invalidate_dashboard_caches',
    bind=True,
    autoretry_for=CACHE_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def invalidate_dashboard_caches(self):
    """
    Periodically wipe all dashboard stats cache entries so the next
    request to the dashboard will recompute fresh numbers from the DB.
    """
    from apps.rq.cache import safe_delete_pattern

    ctx = {'task_id': self.request.id, 'retries': self.request.retries}

    try:
        safe_delete_pattern('*dashboard_stats:*')
        logger.info('task.invalidate_dashboard_caches.ok', extra=ctx)
        return 'Dashboard caches invalidated'
    except CACHE_TRANSIENT_ERRORS:
        logger.warning('task.invalidate_dashboard_caches.retry', extra=ctx)
        raise
    except Exception:
        logger.exception('task.invalidate_dashboard_caches.failed', extra=ctx)
        raise
