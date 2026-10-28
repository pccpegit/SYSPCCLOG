"""Single dispatch point for CV items (SYSPCC-023).

HR_CV_DISPATCH:
  'celery' (default) -> Celery task on queue hr_cv
  'thread'           -> in-process ThreadPoolExecutor (demo without a worker);
                        the request never waits, progress lives in the DB
  'inline'           -> synchronous (tests only)
A failed enqueue never breaks the request: the item stays QUEUED and the
recovery path (resume / beat task) picks it up. In thread mode an infrastructure
failure (e.g. a pooler hiccup while claiming the item) is retried a few times with a
short delay before falling back to that recovery path.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_lock = threading.Lock()

# Delays (s) of the in-process retries after an unexpected failure in thread mode. After the
# last one the item stays QUEUED for resume / the beat task (HR_CV_STALE_SECONDS).
THREAD_RETRY_DELAYS = (2.0, 6.0, 15.0)


class RetryLater(Exception):
    """Raised by run_item when a transient error needs a delayed retry."""

    def __init__(self, countdown: float):
        super().__init__('retry_later')
        self.countdown = countdown


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=max(1, settings.HR_CV_THREAD_WORKERS), thread_name_prefix='hr-cv'
            )
        return _executor


def _schedule(item_id: int, delay: float, attempt: int) -> None:
    timer = threading.Timer(delay, dispatch_one, args=(item_id, attempt))
    timer.daemon = True
    timer.start()


def _thread_job(item_id: int, attempt: int = 0):
    from apps.hr.services import cv_service

    try:
        cv_service.run_item(item_id)
    except RetryLater as retry:
        _schedule(item_id, retry.countdown, 0)  # transient AI error: own attempt budget in run_item
    except Exception as exc:  # noqa: BLE001 - never kill the pool thread; type only (PII)
        if attempt < len(THREAD_RETRY_DELAYS):
            logger.warning('hr.cv thread_job_retry item_id=%s attempt=%d error_type=%s',
                           item_id, attempt + 1, type(exc).__name__)
            _schedule(item_id, THREAD_RETRY_DELAYS[attempt], attempt + 1)
        else:
            logger.error('hr.cv thread_job_failed item_id=%s error_type=%s', item_id, type(exc).__name__)
    finally:
        connection.close()


def dispatch_one(item_id: int, attempt: int = 0) -> None:
    mode = settings.HR_CV_DISPATCH
    try:
        if mode == 'thread':
            _get_executor().submit(_thread_job, item_id, attempt)
        elif mode == 'inline':
            from apps.hr.services import cv_service

            try:
                cv_service.run_item(item_id)
            except RetryLater:
                pass  # stays QUEUED; tests re-run explicitly
        else:
            from apps.hr.tasks import process_cv_item

            process_cv_item.apply_async(args=[item_id], queue='hr_cv')
    except Exception as exc:  # noqa: BLE001 - broker down etc.; item stays QUEUED for recovery
        logger.error('hr.cv dispatch_failed item_id=%s mode=%s error_type=%s', item_id, mode, type(exc).__name__)


def dispatch(item_ids) -> None:
    for item_id in item_ids:
        dispatch_one(item_id)
