"""
Celery tasks for the RQ app.

Registered tasks:
  - rq.check_sla_deadlines         : daily SLA health check (8 AM Lima)
  - rq.send_pending_approval_reminders : stale-approval reminders (9 AM & 2 PM)
  - rq.invalidate_dashboard_caches : periodic cache invalidation (every 15 min)
"""

import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='rq.check_sla_deadlines')
def check_sla_deadlines():
    """
    Check for RQs approaching or past their SLA deadline and send
    in-app notifications to the requester.

    Active statuses are those where the RQ is still in-flight — the
    request is not yet delivered, closed, or cancelled.
    """
    from apps.rq.models import Request, Notification

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
            )
        )

    if approaching_notifications:
        Notification.objects.bulk_create(approaching_notifications, ignore_conflicts=True)

    approaching_count = len(approaching_notifications)

    logger.info(
        'check_sla_deadlines: %d overdue, %d approaching deadline',
        overdue_count,
        approaching_count,
    )
    return f'Checked {overdue_count} overdue, {approaching_count} approaching deadline'


@shared_task(name='rq.send_pending_approval_reminders')
def send_pending_approval_reminders():
    """
    Send in-app reminders for RQs that have been pending a human-review
    status for more than 24 hours without any update.
    """
    from apps.rq.models import Request, Notification, WorkflowStep
    from apps.core.models import User

    threshold = timezone.now() - timezone.timedelta(hours=24)

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
        responsible_roles = list(
            WorkflowStep.objects.filter(
                flow=rq.flow,
                current_status=rq.status,
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
                )
            )
        reminder_count += 1

    if notifications:
        Notification.objects.bulk_create(notifications, ignore_conflicts=True)

    logger.info(
        'send_pending_approval_reminders: reminders sent for %d stale requests',
        reminder_count,
    )
    return f'Sent reminders for {reminder_count} stale requests'


@shared_task(name='rq.invalidate_dashboard_caches')
def invalidate_dashboard_caches():
    """
    Periodically wipe all dashboard stats cache entries so the next
    request to the dashboard will recompute fresh numbers from the DB.
    """
    from django.core.cache import cache

    cache.delete_pattern('*dashboard_stats:*')
    logger.info('invalidate_dashboard_caches: dashboard caches cleared')
    return 'Dashboard caches invalidated'
