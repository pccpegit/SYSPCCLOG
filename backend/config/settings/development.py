"""
Development settings for SYSPCCLOG project.
"""

import os
from django.core.exceptions import ImproperlyConfigured

from .guards import validate_cv_provider

# FIX-15: Guard against this file being loaded outside development environments.
_django_env = os.environ.get('DJANGO_ENV')
if _django_env not in ('development', 'local', None):
    raise ImproperlyConfigured(
        f'development.py was loaded in a non-development environment '
        f'(DJANGO_ENV={_django_env!r}). '
        'Use the correct settings module for this environment.'
    )

from .base import *  # noqa: F401, F403

DEBUG = True

# SYSPCC-023: 'fake' (modo de prueba) is only valid with DEBUG on.
validate_cv_provider(HR_CV_PROVIDER, DEBUG)  # noqa: F405

ALLOWED_HOSTS = ['*']

# Show SQL queries in debug
INSTALLED_APPS += ['django.contrib.admindocs']  # noqa: F405

# Emails to console in development
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# Relaxed CORS in development
CORS_ALLOW_ALL_ORIGINS = True

# The browser runs the SPA on the Vite dev server while the API lives on
# Django's port, so state-changing requests arrive with a cross-origin
# Origin header that the CSRF check must trust (see base.py).
CSRF_TRUSTED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
]

# Higher rate limits for development
REST_FRAMEWORK_THROTTLE_RATES = {
    'anon': '300/min',
    'user': '1000/min',
    'login': '30/min',
    'login_user': '30/min',
    'hr_assistant': '20/min',
    'hr_download': '60/min',
    'hr_cv_upload': '60/min',
    'hr_cv_progress': '90/min',
    'hr_cv_posting': '20/min',
    # SYSPCC-025 (warehouse)
    'warehouse_lookup': '120/min',
    'warehouse_import': '10/hour',
    # SYSPCC-029 (entregas parciales y reversas de RQ)
    'warehouse_delivery': '60/min',
    # SYSPCC-030 (Master de RQ: descarga en Excel)
    'rq_master_export': '10/min',
}
REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] = REST_FRAMEWORK_THROTTLE_RATES  # noqa: F405

# Django Debug Toolbar (optional, install separately if needed)
# INSTALLED_APPS += ['debug_toolbar']
# MIDDLEWARE += ['debug_toolbar.middleware.DebugToolbarMiddleware']
# INTERNAL_IPS = ['127.0.0.1']

# ---------------------------------------------------------------------------
# Redis / Cache
# ---------------------------------------------------------------------------
# The base settings configure Redis via REDIS_URL (default: redis://localhost:6379/0).
# If Redis is not running locally, uncomment the block below to fall back to
# an in-process memory cache so the app still starts.  Note: session data and
# rate-limit counters will NOT persist between server restarts in this mode.
#
# CACHES = {
#     'default': {
#         'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
#     }
# }
