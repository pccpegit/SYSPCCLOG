"""
Cache helpers for frequently accessed, rarely-changing RQ data.

Uses Django's default cache backend (Redis in all environments that
configure CACHES). All keys are prefixed by KEY_PREFIX='syspcclog'
in settings, so no manual namespacing is needed here.
"""

import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache key templates
# ---------------------------------------------------------------------------

WORKFLOW_STEPS_KEY = 'workflow_steps:{flow}'
ACQUISITION_CONFIG_KEY = 'acquisition_type_configs'
DASHBOARD_STATS_KEY = 'dashboard_stats:{user_id}:{role}'


def safe_delete_pattern(pattern: str) -> None:
    """
    Delete all cache keys matching a glob pattern.

    Requires django-redis (only backend that implements `delete_pattern`).
    If the configured cache backend doesn't support it (e.g. LocMemCache in
    some test/dev configurations), skip with a warning instead of raising
    AttributeError — a missed bulk-invalidation is a staleness issue, not a
    request-breaking one, and callers already have a per-key fallback path.
    """
    if not hasattr(cache, 'delete_pattern'):
        logger.warning(
            'cache.delete_pattern.unsupported',
            extra={'pattern': pattern, 'backend': type(cache).__name__},
        )
        return
    cache.delete_pattern(pattern)


# ---------------------------------------------------------------------------
# Workflow steps
# ---------------------------------------------------------------------------

def get_workflow_steps(flow: str) -> list:
    """Return workflow steps for a flow from cache, falling back to the DB."""
    key = WORKFLOW_STEPS_KEY.format(flow=flow)
    steps = cache.get(key)
    if steps is None:
        from apps.rq.models import WorkflowStep
        steps = list(
            WorkflowStep.objects.filter(flow=flow)
            .order_by('step_order')
            .values()
        )
        cache.set(key, steps, timeout=3600)  # 1 hour — changes only via admin
    return steps


def invalidate_workflow_cache(flow: str = None) -> None:
    """
    Invalidate workflow steps cache.

    Pass a specific flow string to invalidate only that flow's entry.
    Omit (or pass None) to invalidate all workflow step entries using a
    key-pattern delete, which requires django-redis as the cache backend.
    """
    if flow:
        cache.delete(WORKFLOW_STEPS_KEY.format(flow=flow))
    else:
        safe_delete_pattern('*workflow_steps:*')


# ---------------------------------------------------------------------------
# Acquisition type configs
# ---------------------------------------------------------------------------

def get_acquisition_configs() -> list:
    """Return all acquisition type configs from cache, falling back to the DB."""
    configs = cache.get(ACQUISITION_CONFIG_KEY)
    if configs is None:
        from apps.rq.models import AcquisitionTypeConfig
        configs = list(AcquisitionTypeConfig.objects.all().values())
        cache.set(ACQUISITION_CONFIG_KEY, configs, timeout=3600)
    return configs


def invalidate_acquisition_cache() -> None:
    """Invalidate acquisition type config cache."""
    cache.delete(ACQUISITION_CONFIG_KEY)


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

def invalidate_dashboard_cache(user_id: int = None) -> None:
    """
    Invalidate dashboard stats cache.

    Pass a user_id to invalidate only that user's cached entries across all
    roles. Omit to invalidate all dashboard caches (e.g. from a periodic task).
    Requires django-redis for delete_pattern support.
    """
    if user_id:
        safe_delete_pattern(f'*{DASHBOARD_STATS_KEY.format(user_id=user_id, role="*")}*')
    else:
        safe_delete_pattern('*dashboard_stats:*')
