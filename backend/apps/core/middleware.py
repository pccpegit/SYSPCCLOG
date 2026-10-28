"""Infrastructure middleware (SYSPCC-024): platform health check and client IP.

Both run at the very top of the MIDDLEWARE stack (see config/settings) and
never touch the request body, sessions or authentication.
"""

import ipaddress
import logging

from django.db import connections
from django.http import JsonResponse

logger = logging.getLogger(__name__)


class HealthCheckMiddleware:
    """Answer ``GET|HEAD /healthz/`` for platform health checks.

    Must be the FIRST middleware: load balancers call it with a Host header
    that is not in ALLOWED_HOSTS and without ``X-Forwarded-Proto``, so letting
    the request reach SecurityMiddleware / CommonMiddleware would produce a
    301 (HTTPS redirect) or a 400 (disallowed host) and the deploy would never
    turn healthy. Runs ``SELECT 1`` so a dead database is reported as 503.
    """

    PATHS = frozenset({'/healthz/', '/healthz'})

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # request.path does not validate the Host header (get_host() does).
        if request.method in ('GET', 'HEAD') and request.path in self.PATHS:
            return self._health_response()
        return self.get_response(request)

    @staticmethod
    def _health_response():
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except Exception:  # noqa: BLE001 - last barrier: any DB failure means "unhealthy"
            logger.exception('healthz.database_unavailable')
            response = JsonResponse({'status': 'error'}, status=503)
        else:
            response = JsonResponse({'status': 'ok'})
        response['Cache-Control'] = 'no-store'
        return response


class DOConnectingIPMiddleware:
    """Use DigitalOcean's ``do-connecting-ip`` header as the client address.

    App Platform's ingress writes its own address into X-Forwarded-For, so
    DRF's throttle identification (login 5/min, ...) would lump every user
    behind a handful of buckets. The platform sets ``do-connecting-ip`` with
    the real client address. This middleware copies it into REMOTE_ADDR;
    pair it with ``REST_FRAMEWORK['NUM_PROXIES'] = 0`` so DRF uses REMOTE_ADDR.

    Only enable behind App Platform's ingress (settings.TRUST_DO_CONNECTING_IP):
    elsewhere a client could forge the header. A missing or malformed value
    leaves REMOTE_ADDR untouched.

    If the header ever arrives as a comma-separated list (a proxy appended
    its value to one the client sent), the RIGHT-MOST entry is used: it is
    the one written by the trusted ingress, whereas the left-most entries are
    client-controlled and could be rotated to evade the throttles.

    SECURITY: this assumes the ingress overwrites/sets the header. Verify it
    after the first deploy with the smoke test in docs/08 (section "Prueba de
    humo de seguridad"); if it fails, set TRUST_DO_CONNECTING_IP=False.
    """

    HEADER_META = 'HTTP_DO_CONNECTING_IP'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        raw = request.META.get(self.HEADER_META, '').rsplit(',', 1)[-1].strip()
        if raw:
            try:
                request.META['REMOTE_ADDR'] = str(ipaddress.ip_address(raw))
            except ValueError:
                logger.warning('do_connecting_ip.invalid_value')
        return self.get_response(request)
