"""Throttle building blocks (SYSPCC-024).

* ``ThrottleCacheMixin`` lets a deployment keep rate-limit counters in a cache
  alias of its own (``settings.THROTTLE_CACHE_ALIAS``, default ``'default'``).
  With Redis configured to swallow errors (``DJANGO_REDIS_IGNORE_EXCEPTIONS``)
  the default cache fails OPEN: while Redis is down the counters read as empty
  and the login limit disappears exactly when it is least visible. Pointing the
  throttles at a process-local cache keeps them enforced (per process) during
  a Redis outage.
* ``LoginUsernameThrottle`` limits login attempts per *username*, so rotating
  the source IP (or sharing one NAT) does not allow unlimited password
  guessing against a single account.
"""

import hashlib

from django.conf import settings
from django.core.cache import caches
from rest_framework.exceptions import APIException
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle


class ThrottleCacheMixin:
    """Resolve the throttle cache lazily from ``settings.THROTTLE_CACHE_ALIAS``."""

    @property
    def cache(self):
        return caches[getattr(settings, 'THROTTLE_CACHE_ALIAS', 'default')]


class AnonThrottle(ThrottleCacheMixin, AnonRateThrottle):
    """Drop-in replacement for DRF's AnonRateThrottle (scope ``anon``)."""


class UserThrottle(ThrottleCacheMixin, UserRateThrottle):
    """Drop-in replacement for DRF's UserRateThrottle (scope ``user``)."""


class LoginUsernameThrottle(ThrottleCacheMixin, SimpleRateThrottle):
    """Per-username throttle for the login endpoint (scope ``login_user``).

    The username is lower-cased and hashed so the cache key is bounded and
    never contains user-supplied text. Requests without a username are not
    counted here (they fail validation anyway and the per-IP throttle still
    applies).
    """

    scope = 'login_user'
    DEFAULT_RATE = '10/min'

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope) or self.DEFAULT_RATE

    def get_cache_key(self, request, view):
        try:
            data = request.data
            username = data.get('username') if hasattr(data, 'get') else None
        except APIException:
            # Malformed body: the view reports the parse error itself.
            return None
        if not isinstance(username, str) or not username.strip():
            return None
        ident = hashlib.sha256(username.strip().lower().encode('utf-8')).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': ident}
