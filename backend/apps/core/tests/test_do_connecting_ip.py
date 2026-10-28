"""SYSPCC-024: client IP from DigitalOcean's `do-connecting-ip` header."""

import pytest
from django.core.cache.backends.locmem import LocMemCache
from rest_framework.request import Request
from rest_framework.settings import api_settings
from rest_framework.test import APIRequestFactory
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.core.middleware import DOConnectingIPMiddleware

DO_INGRESS_IP = '10.244.0.9'


class _TwoPerMinute(AnonRateThrottle):
    scope = 'do_ip_test'
    cache = LocMemCache('do-ip-test', {})
    THROTTLE_RATES = {'do_ip_test': '2/min'}


class _View(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [_TwoPerMinute]

    def get(self, request):
        return Response({'ok': True})


def _call(ip=None, **extra):
    """Run a request through the middleware, then the throttled view."""
    meta = {'REMOTE_ADDR': DO_INGRESS_IP, 'HTTP_X_FORWARDED_FOR': DO_INGRESS_IP}
    if ip is not None:
        meta['HTTP_DO_CONNECTING_IP'] = ip
    meta.update(extra)
    request = APIRequestFactory().get('/x/', **meta)
    view = _View.as_view()
    return DOConnectingIPMiddleware(view)(request)


@pytest.fixture(autouse=True)
def _isolated_throttle_cache():
    _TwoPerMinute.cache.clear()
    # NUM_PROXIES=0 is what production.py sets with TRUST_DO_CONNECTING_IP.
    saved = api_settings.NUM_PROXIES
    api_settings.NUM_PROXIES = 0
    yield
    api_settings.NUM_PROXIES = saved
    _TwoPerMinute.cache.clear()


class TestDOConnectingIPMiddleware:
    def test_sets_remote_addr_from_header(self):
        seen = {}

        def get_response(request):
            seen['addr'] = request.META['REMOTE_ADDR']
            return Response()

        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP='203.0.113.7')
        DOConnectingIPMiddleware(get_response)(request)

        assert seen['addr'] == '203.0.113.7'

    @pytest.mark.parametrize('bad', ['not-an-ip', '1.2.3.4, not-an-ip', '999.1.1.1', '1.2.3.4,'])
    def test_malformed_header_is_ignored(self, bad):
        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP=bad)
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == DO_INGRESS_IP

    def test_comma_separated_list_uses_the_right_most_entry(self):
        # The left-most entries are client-controlled; the right-most one was
        # written by the trusted ingress.
        request = APIRequestFactory().get(
            '/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP='1.2.3.4, 203.0.113.7'
        )
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == '203.0.113.7'

    def test_rotating_a_forged_left_entry_does_not_change_the_bucket(self):
        statuses = [
            _call(ip=f'1.2.3.{n}, 203.0.113.7').status_code for n in range(1, 5)
        ]

        assert statuses[:2] == [200, 200]
        assert statuses[2:] == [429, 429]

    def test_missing_header_keeps_remote_addr(self):
        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP)
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == DO_INGRESS_IP

    def test_ipv6_is_normalised(self):
        request = APIRequestFactory().get('/x/', HTTP_DO_CONNECTING_IP='2001:DB8:0:0:0:0:0:1')
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == '2001:db8::1'


class TestThrottleBuckets:
    def test_different_clients_get_separate_buckets(self):
        # Client A exhausts its 2/min...
        assert _call('203.0.113.1').status_code == 200
        assert _call('203.0.113.1').status_code == 200
        assert _call('203.0.113.1').status_code == 429
        # ...and client B, behind the same ingress IP, is unaffected.
        assert _call('203.0.113.2').status_code == 200

    def test_spoofed_x_forwarded_for_does_not_bypass_the_throttle(self):
        for spoof in ('1.1.1.1', '2.2.2.2'):
            assert _call('203.0.113.3', HTTP_X_FORWARDED_FOR=spoof).status_code == 200
        assert _call('203.0.113.3', HTTP_X_FORWARDED_FOR='3.3.3.3').status_code == 429

    def test_get_ident_uses_remote_addr_when_num_proxies_is_zero(self):
        request = APIRequestFactory().get(
            '/x/', REMOTE_ADDR='203.0.113.9', HTTP_X_FORWARDED_FOR='10.0.0.1, 10.0.0.2'
        )
        assert AnonRateThrottle().get_ident(Request(request)) == '203.0.113.9'


class TestDOConnectingIPEdgeCases:
    """SYSPCC-024 (QA ronda 1): valores limite del header."""

    def test_surrounding_whitespace_is_trimmed(self):
        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP='  203.0.113.5  ')
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == '203.0.113.5'

    def test_blank_header_keeps_remote_addr(self):
        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP='   ')
        DOConnectingIPMiddleware(lambda r: None)(request)

        assert request.META['REMOTE_ADDR'] == DO_INGRESS_IP

    def test_invalid_value_is_logged_without_echoing_it(self):
        from unittest import mock

        request = APIRequestFactory().get('/x/', REMOTE_ADDR=DO_INGRESS_IP, HTTP_DO_CONNECTING_IP='<script>')
        with mock.patch('apps.core.middleware.logger') as logger:
            DOConnectingIPMiddleware(lambda r: None)(request)

        logger.warning.assert_called_once_with('do_connecting_ip.invalid_value')  # no log injection

    def test_response_of_the_next_layer_is_returned_unchanged(self):
        sentinel = object()

        result = DOConnectingIPMiddleware(lambda r: sentinel)(
            APIRequestFactory().get('/x/', HTTP_DO_CONNECTING_IP='203.0.113.5')
        )

        assert result is sentinel

    def test_without_the_header_the_ingress_ip_is_the_only_bucket(self):
        # Sin do-connecting-ip (p. ej. middleware inactivo): todos comparten REMOTE_ADDR.
        assert _call(None).status_code == 200
        assert _call(None).status_code == 200
        assert _call(None).status_code == 429
