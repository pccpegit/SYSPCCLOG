"""Celery tasks for the RR. HH. CV analysis (SYSPCC-023)."""

import logging

from celery import shared_task

from apps.hr.services.cv_dispatch import RetryLater

logger = logging.getLogger(__name__)


@shared_task(
    bind=True, name='hr.process_cv_item', queue='hr_cv', acks_late=True,
    soft_time_limit=150, time_limit=180, rate_limit='40/m', max_retries=10,
)
def process_cv_item(self, item_id: int):
    """One CV = one task. Idempotent: the claim (QUEUED -> PROCESSING) is an atomic
    UPDATE, so a duplicate delivery or a retry after a crash does nothing twice.
    Retry accounting lives in the DB (`attempts`), not in Celery."""
    from apps.hr.services import cv_service

    try:
        cv_service.run_item(item_id)
    except RetryLater as retry:
        raise self.retry(countdown=retry.countdown)


@shared_task(name='hr.cv_requeue_stale', queue='hr_cv')
def cv_requeue_stale():
    """Beat task: re-enqueue items stuck in QUEUED/PROCESSING (worker crash, lost broker)."""
    from apps.hr.services import cv_analysis_service

    n = cv_analysis_service.requeue_stale()
    if n:
        logger.info('hr.cv requeue_stale count=%d', n)
    return n
