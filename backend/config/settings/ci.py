"""
CI settings (SYSPCC-037): development settings + PostgreSQL from the environment.

GitHub Actions runs the backend suite against PostgreSQL 16 (production's
engine), not SQLite. `development.py` inherits the SQLite default from
`base.py` and `production.py` forces TLS plus a managed-database host, so
neither fits a throwaway service container. This module keeps everything else
identical to development (DEBUG, relaxed throttles, console email) and only
swaps the database, read from DB_NAME / DB_USER / DB_PASSWORD / DB_HOST /
DB_PORT. Never used outside CI.
"""

import os

from decouple import config

from .development import *  # noqa: F401, F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='syspcc_ci'),
        'USER': config('DB_USER', default='postgres'),
        'PASSWORD': config('DB_PASSWORD', default='postgres'),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5432'),
        'CONN_MAX_AGE': 0,
    }
}

# pytest-xdist: each worker (gw0, gw1, ...) gets its own Redis database for the
# cache — tests call cache.clear(), which flushes the whole database, so
# workers sharing one would wipe each other's throttle counters and sessions.
# DBs 1 and 2 stay for the Celery broker/results (base.py defaults).
_worker = os.environ.get('PYTEST_XDIST_WORKER', '')
_cache_db = 3 + (int(_worker[2:]) if _worker.startswith('gw') else 0)
CACHES['default']['LOCATION'] = f"{REDIS_URL.rsplit('/', 1)[0]}/{_cache_db}"  # noqa: F405
