import logging
from types import SimpleNamespace

import anthropic
import httpx2 as httpx
import pytest

from apps.hr.services.assistant_schemas import ContractExtraction
from apps.hr.tests.conftest import client_for

pytestmark = pytest.mark.django_db
EXTRACT = '/api/v1/hr/assistant/extract/'
STATUS = '/api/v1/hr/assistant/status/'


class FakeMessages:
    def __init__(self, owner, beta=False):
        self.owner, self.beta = owner, beta

    def parse(self, **kwargs):
        self.owner.calls.append({'beta': self.beta, **kwargs})
        if self.owner.error:
            raise self.owner.error
        return self.owner.response


class FakeClient:
    def __init__(self, response=None, error=None):
        self.calls, self.response, self.error = [], response, error
        self.messages = FakeMessages(self)
        self.beta = SimpleNamespace(messages=FakeMessages(self, beta=True))


def ok_response(**fields):
    return SimpleNamespace(
        stop_reason='end_turn', parsed_output=ContractExtraction(**fields),
        usage=SimpleNamespace(input_tokens=300, output_tokens=80),
    )


@pytest.fixture
def with_key(settings):
    settings.ANTHROPIC_API_KEY = 'test-key'
    settings.HR_ASSISTANT_SERVER_FALLBACK = False


def patch_client(monkeypatch, client):
    monkeypatch.setattr(anthropic, 'Anthropic', lambda **kw: client)


def post(client, text='Contrato para Ana Pérez', **extra):
    return client.post(EXTRACT, {'document_type': 'CONTRACT', 'text': text, **extra}, format='json')


class TestAvailability:
    def test_status_disabled_without_key(self, hr_client):
        assert hr_client.get(STATUS).data == {'enabled': False}

    def test_extract_without_key_is_503(self, hr_client):
        resp = post(hr_client)
        assert resp.status_code == 503 and resp.data['code'] == 'assistant_unavailable'

    def test_status_enabled_with_key(self, hr_client, with_key, general_manager):
        assert hr_client.get(STATUS).data == {'enabled': True}
        assert client_for(general_manager).get(STATUS).status_code == 200


class TestExtraction:
    def test_extracts_and_code_computes_missing_and_end_date(self, hr_client, with_key, monkeypatch):
        fake = FakeClient(ok_response(
            worker_full_name='Ana Pérez', position='Asistente', gross_salary='2,000',
            start_date='2026-11-01', term_months=6, contract_type='FIXED_TERM',
        ))
        patch_client(monkeypatch, fake)
        resp = post(hr_client)
        assert resp.status_code == 200, resp.data
        data = resp.data['data']
        assert data['gross_salary'] == '2000.00'
        assert data['end_date'] == '2027-04-30'  # computed by code, not by the model
        missing = {m['field'] for m in resp.data['missing']}
        assert {'worker_dni', 'worker_address', 'fixed_term_modality', 'fixed_term_cause'} <= missing
        assert 'position' not in missing and resp.data['used_ai'] is True
        call = fake.calls[0]
        assert call['model'] == 'claude-opus-5-5'
        assert call['output_config'] == {'effort': 'low'}
        assert call['output_format'] is ContractExtraction

    def test_known_data_wins_and_no_personal_pii_is_sent(self, hr_client, with_key, monkeypatch):
        from decimal import Decimal

        from apps.core.models import Personal

        p = Personal.objects.create(
            dni='99887766', apellidos_nombres='PEREZ GARCIA, ANA', puesto='Cajera', salario=Decimal('1800'),
            direccion_residencia='Calle Secreta 999', numero_cuenta='555-000-111',
        )
        fake = FakeClient(ok_response(worker_full_name='Ana Pérez', position='Asistente'))
        patch_client(monkeypatch, fake)
        resp = post(hr_client, personal_id=p.pk, known_data={'position': 'Jefa de Caja'})
        assert resp.status_code == 200
        assert resp.data['data']['position'] == 'Jefa de Caja'  # known > AI > Personal
        assert resp.data['data']['worker_dni'] == '99887766'  # from Personal prefill (server side)
        assert resp.data['personal_match'] == {'id': p.pk, 'name': 'PEREZ GARCIA, ANA'}
        sent = str(fake.calls[0]['messages']) + str(fake.calls[0]['system'])
        for secret in ('99887766', 'Calle Secreta', '555-000-111', '1800'):
            assert secret not in sent

    def test_name_mismatch_warning(self, hr_client, with_key, monkeypatch):
        from apps.core.models import Personal

        p = Personal.objects.create(dni='11112222', apellidos_nombres='QUISPE MAMANI, LUIS')
        patch_client(monkeypatch, FakeClient(ok_response(worker_full_name='Ana Pérez')))
        resp = post(hr_client, personal_id=p.pk)
        assert any('no coincide' in w for w in resp.data['warnings'])

    def test_invalid_extracted_values_become_warnings(self, hr_client, with_key, monkeypatch):
        patch_client(monkeypatch, FakeClient(ok_response(gross_salary='mucho', start_date='pronto')))
        resp = post(hr_client)
        assert resp.status_code == 200
        assert 'gross_salary' not in resp.data['data'] and len(resp.data['warnings']) == 2

    def test_fallback_uses_beta_parse(self, hr_client, settings, monkeypatch):
        settings.ANTHROPIC_API_KEY = 'k'
        settings.HR_ASSISTANT_SERVER_FALLBACK = True
        fake = FakeClient(ok_response(position='X'))
        patch_client(monkeypatch, fake)
        assert post(hr_client).status_code == 200
        call = fake.calls[0]
        assert call['beta'] is True and call['fallbacks'] == 'default'
        assert call['betas'] == ['server-side-fallback-2026-07-01']

    def test_request_text_is_not_logged(self, hr_client, with_key, monkeypatch, caplog):
        patch_client(monkeypatch, FakeClient(ok_response(position='X')))
        with caplog.at_level(logging.DEBUG):
            post(hr_client, text='texto secreto del pedido')
        assert 'texto secreto' not in caplog.text


class TestErrors:
    def _error_status(self, hr_client, monkeypatch, error=None, response=None):
        patch_client(monkeypatch, FakeClient(response=response, error=error))
        return post(hr_client)

    def test_refusal_is_422(self, hr_client, with_key, monkeypatch):
        resp = self._error_status(
            hr_client, monkeypatch,
            response=SimpleNamespace(stop_reason='refusal', parsed_output=None, usage=None),
        )
        assert resp.status_code == 422 and resp.data['code'] == 'assistant_unreadable'

    def test_null_parse_is_422(self, hr_client, with_key, monkeypatch):
        resp = self._error_status(
            hr_client, monkeypatch,
            response=SimpleNamespace(stop_reason='end_turn', parsed_output=None, usage=None),
        )
        assert resp.status_code == 422

    def test_rate_limit_is_429(self, hr_client, with_key, monkeypatch):
        req = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        err = anthropic.RateLimitError('rl', response=httpx.Response(429, request=req), body=None)
        resp = self._error_status(hr_client, monkeypatch, error=err)
        assert resp.status_code == 429 and resp.data['code'] == 'assistant_rate_limited'

    def test_connection_error_is_502_without_raw_error(self, hr_client, with_key, monkeypatch):
        req = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        resp = self._error_status(hr_client, monkeypatch, error=anthropic.APIConnectionError(request=req))
        assert resp.status_code == 502 and resp.data['code'] == 'assistant_failed'
        assert 'anthropic' not in str(resp.data).lower()

    def test_api_status_error_is_502(self, hr_client, with_key, monkeypatch):
        req = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        err = anthropic.InternalServerError('boom', response=httpx.Response(500, request=req), body=None)
        assert self._error_status(hr_client, monkeypatch, error=err).status_code == 502

    def test_text_too_long_and_daily_limit(self, hr_client, with_key, monkeypatch, settings):
        assert post(hr_client, text='x' * 2001).status_code == 400
        settings.HR_ASSISTANT_DAILY_LIMIT_PER_USER = 1
        patch_client(monkeypatch, FakeClient(ok_response(position='X')))
        assert post(hr_client).status_code == 200
        second = post(hr_client)
        assert second.status_code == 429 and second.data['code'] == 'assistant_rate_limited'
