"""Simulated provider ("modo de prueba gratis", HR_CV_PROVIDER=fake) and its guards (SYSPCC-023 iteration 2)."""

import hashlib
import io
import os
import re
import subprocess
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.hr.enums import CVItemStatus
from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_agent, cv_fake
from apps.hr.services.cv_agent import AgentPermanent, CVAgent
from apps.hr.services.cv_schemas import CVReportBase, report_model
from apps.hr.tests.conftest import client_for
from apps.hr.tests.cv_helpers import POSTING_TEXT, make_docx, make_pdf, make_png, upload
from apps.hr.tests.test_cv_api import BASE, create, post_files
from config.settings.guards import check_cv_provider_value, validate_cv_provider

pytestmark = pytest.mark.django_db

REQS = [
    {'id': 1, 'text': 'Ingeniero civil colegiado', 'weight': 3},
    {'id': 2, 'text': 'Manejo de AutoCAD', 'weight': 1},
    {'id': 3, 'text': 'Inglés intermedio', 'weight': 1},
]


def sha(i: int) -> str:
    return hashlib.sha256(f'cv-{i}'.encode()).hexdigest()


# ================================================================= guards

class TestGuards:
    def test_fake_needs_debug(self):
        with pytest.raises(ImproperlyConfigured, match='DEBUG'):
            validate_cv_provider('fake', False)
        assert validate_cv_provider('fake', True) == 'fake'

    @pytest.mark.parametrize('debug', [True, False])
    def test_anthropic_is_always_valid(self, debug):
        assert validate_cv_provider('anthropic', debug) == 'anthropic'

    @pytest.mark.parametrize('value', ['', 'FAKE', 'openai', 'mock'])
    def test_unknown_values_are_rejected(self, value):
        with pytest.raises(ImproperlyConfigured, match='HR_CV_PROVIDER'):
            check_cv_provider_value(value)
        with pytest.raises(ImproperlyConfigured):
            validate_cv_provider(value, True)

    def _import(self, module: str, **extra):
        # The dev container may export HR_CV_PROVIDER=fake: the subprocess starts clean unless told otherwise.
        env = {**os.environ, 'DB_NAME': 'x', 'DB_USER': 'x', 'DB_PASSWORD': 'x', 'DB_HOST': 'x', 'DB_PORT': '5432',
               'ALLOWED_HOSTS': 'x', 'DJANGO_SETTINGS_MODULE': module, 'HR_CV_PROVIDER': 'anthropic',
               'HR_CV_FAKE_DELAY_SECONDS': '0', **extra}
        env.pop('DJANGO_ENV', None)
        return subprocess.run(
            [sys.executable, '-c', f'import {module} as s; print("OK", s.HR_CV_PROVIDER)'],
            env=env, capture_output=True, text=True, timeout=90)

    def test_production_and_demo_refuse_to_boot_with_fake(self):
        for module in ('config.settings.production', 'config.settings.demo'):
            out = self._import(module, HR_CV_PROVIDER='fake')
            assert out.returncode != 0 and 'ImproperlyConfigured' in out.stderr, module
            assert 'solo se permite con DEBUG=True' in out.stderr

    def test_demo_with_debug_true_still_refuses_fake(self):
        """demo may run with DEBUG=true (to seed); the simulated provider stays forbidden."""
        out = self._import('config.settings.demo', HR_CV_PROVIDER='fake', DEBUG='true')
        assert out.returncode != 0 and 'ImproperlyConfigured' in out.stderr

    def test_production_boots_with_the_real_provider(self):
        out = self._import('config.settings.production')
        assert out.stdout.split() == ['OK', 'anthropic'], out.stderr[-300:]

    def test_invalid_value_stops_the_boot(self):
        out = self._import('config.settings.production', HR_CV_PROVIDER='nope')
        assert out.returncode != 0 and 'HR_CV_PROVIDER' in out.stderr

    def test_development_accepts_fake(self):
        out = self._import('config.settings.development', HR_CV_PROVIDER='fake')
        assert out.stdout.split() == ['OK', 'fake'], out.stderr[-300:]


class TestProviderName:
    def test_fake_only_with_debug(self, settings):
        settings.HR_CV_PROVIDER, settings.DEBUG = 'fake', True
        assert cv_agent.provider_name() == 'fake' and cv_agent.is_enabled() is True
        assert cv_agent.model_label() == 'simulado'

    def test_fail_closed_without_debug_logs_error_once(self, settings, monkeypatch, logs):
        monkeypatch.setattr(cv_agent, '_fake_denied_logged', False)
        settings.HR_CV_PROVIDER, settings.DEBUG, settings.ANTHROPIC_API_KEY = 'fake', False, ''
        assert cv_agent.provider_name() == 'anthropic' and cv_agent.provider_name() == 'anthropic'
        assert cv_agent.is_enabled() is False and cv_agent.model_label() == settings.HR_CV_MODEL
        errors = [r for r in logs.records if r.levelname == 'ERROR' and 'provider=fake' in r.getMessage()]
        assert len(errors) == 1

    def test_real_provider_by_default(self, settings):
        settings.DEBUG, settings.ANTHROPIC_API_KEY = True, ''
        assert cv_agent.provider_name() == 'anthropic' and cv_agent.is_enabled() is False
        settings.ANTHROPIC_API_KEY = 'k'
        assert cv_agent.is_enabled() is True


# ============================================================= generator

class TestGenerator:
    @pytest.mark.parametrize('with_reqs', [False, True])
    def test_two_hundred_seeds_validate_against_the_real_schema(self, with_reqs):
        for i in range(200):
            report = cv_fake.fake_report(sha(i), with_reqs, REQS if with_reqs else None)
            assert isinstance(report, report_model(with_reqs))
            assert ('evaluation' in report.model_fields) is with_reqs
            if with_reqs:
                assert [r.requirement_id for r in report.evaluation.requirement_results] == [1, 2, 3]

    def test_same_file_same_report_different_file_different_report(self):
        a1, a2, b = (cv_fake.fake_report(sha(1), True, REQS), cv_fake.fake_report(sha(1), True, REQS),
                     cv_fake.fake_report(sha(2), True, REQS))
        assert a1.model_dump() == a2.model_dump() and a1.model_dump() != b.model_dump()

    def test_does_not_touch_the_global_rng(self):
        import random

        random.seed(1234)
        expected = random.random()
        random.seed(1234)
        cv_fake.fake_report(sha(1), True, REQS)
        cv_fake.fake_posting(sha(1), None)
        assert random.random() == expected

    def test_contact_data_is_fictional(self):
        for i in range(100):
            cand = cv_fake.fake_report(sha(i), False).candidate
            assert re.fullmatch(r'[a-z.]+@example\.com', cand.email)
            assert re.fullmatch(r'\+51 900 000 \d{3}', cand.phone)

    def test_distribution_exercises_the_ui(self):
        reports = [cv_fake.fake_report(sha(i), True, REQS) for i in range(600)]
        good = sum(r.readability == 'good' for r in reports) / 600
        assert 0.70 < good < 0.90 and any(r.readability == 'poor' for r in reports)
        assert 0 < sum(r.injection_suspected for r in reports) < 40
        statuses = {x.status for r in reports for x in r.evaluation.requirement_results}
        assert statuses == {'met', 'partial', 'not_met', 'unknown'}

    def test_non_hex_seed_is_accepted(self):
        assert cv_fake.fake_report('algo', False).model_dump() == cv_fake.fake_report('algo', False).model_dump()
        assert isinstance(cv_fake.fake_report(None, False), CVReportBase)

    def test_delay_is_deterministic_and_scaled(self, settings, monkeypatch):
        settings.HR_CV_FAKE_DELAY_SECONDS = 2
        slept = []
        monkeypatch.setattr(cv_fake.time, 'sleep', slept.append)
        seed = 'ff' + '0' * 62
        cv_fake.simulate_delay(seed)
        cv_fake.simulate_delay('00' + '0' * 62)
        assert slept == [pytest.approx(2 * 1.5), pytest.approx(2 * 0.5)]
        settings.HR_CV_FAKE_DELAY_SECONDS = 0
        cv_fake.simulate_delay(seed)
        assert len(slept) == 2  # no sleep at all with delay 0

    def test_fail_percent(self, settings):
        assert not any(cv_fake.should_fail(sha(i)) for i in range(50))
        settings.HR_CV_FAKE_FAIL_PERCENT = 100
        assert all(cv_fake.should_fail(sha(i)) for i in range(50))
        settings.HR_CV_FAKE_FAIL_PERCENT = 30
        failures = sum(cv_fake.should_fail(sha(i)) for i in range(400))
        assert 60 < failures < 180
        assert [cv_fake.should_fail(sha(i)) for i in range(20)] == [cv_fake.should_fail(sha(i)) for i in range(20)]


class TestAgentHook:
    def test_analyze_never_opens_the_sdk(self, fake_provider, monkeypatch):
        import anthropic

        monkeypatch.setattr(anthropic, 'Anthropic', lambda **kw: pytest.fail('SDK must not be built'))
        result = CVAgent().analyze([], True, seed=sha(7), requirements=REQS)
        assert (result.tokens_in, result.tokens_out, result.model, result.simulated) == (0, 0, 'simulado', True)

    def test_analyze_fail_percent_raises_permanent_ai_failed(self, fake_provider):
        fake_provider.HR_CV_FAKE_FAIL_PERCENT = 100
        with pytest.raises(AgentPermanent) as exc:
            CVAgent().analyze([], False, seed=sha(1))
        assert exc.value.code == 'ai_failed'

    def test_real_provider_ignores_the_seed(self, cv_env, fake_cv_client):
        from apps.hr.tests.cv_helpers import FakeCVClient

        client = FakeCVClient()
        result = CVAgent(client).analyze([{'type': 'text', 'text': 'x'}], False, seed=sha(1), requirements=[])
        assert result.simulated is False and result.model == 'claude-opus-5-5' and len(client.calls) == 1


# ======================================================== config + pipeline

def run(hr_client, requirements_text='', files=None, callbacks=None):
    a = create(hr_client, requirements_text=requirements_text).data['id']
    files = files or [('uno.pdf', make_pdf('uno')), ('dos.docx', make_docx()), ('tres.png', make_png())]
    with callbacks(execute=True):
        resp = post_files(hr_client, a, files)
    assert resp.status_code == 200, resp.data
    return a


class TestConfig:
    def test_fake_config(self, fake_provider, hr_client):
        cfg = hr_client.get(BASE + 'config/').data
        assert cfg['provider'] == 'fake' and cfg['simulated'] is True and cfg['enabled'] is True
        assert cfg['posting']['extraction'] == 'fake'
        # additive: the previous contract is intact
        assert {'dispatch', 'limits', 'estimate_usd', 'disclaimer'} <= set(cfg)

    def test_real_config_without_key(self, hr_client):
        cfg = hr_client.get(BASE + 'config/').data
        assert cfg['provider'] == 'anthropic' and cfg['simulated'] is False and cfg['enabled'] is False
        assert cfg['posting'] == {
            'max_file_mb': 5, 'max_file_bytes': 5 * 1024 * 1024, 'extensions': ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
            'max_text_chars': 12000, 'max_requirements': 15, 'extraction': 'text',
            'estimate_usd': {'min': 0.01, 'max': 0.03}}

    def test_real_config_with_key(self, cv_env, hr_client):
        cfg = hr_client.get(BASE + 'config/').data
        assert cfg['provider'] == 'anthropic' and cfg['simulated'] is False and cfg['enabled'] is True
        assert cfg['posting']['extraction'] == 'ai'

    def test_fake_requested_without_debug_reports_the_real_provider(self, settings, hr_client):
        settings.HR_CV_PROVIDER, settings.DEBUG = 'fake', False
        cfg = hr_client.get(BASE + 'config/').data
        assert cfg['provider'] == 'anthropic' and cfg['simulated'] is False and cfg['enabled'] is False


class TestEndToEnd:
    def test_full_flow_with_requirements(self, fake_provider, hr_client, django_capture_on_commit_callbacks):
        a = run(hr_client, 'Ingeniero civil (obligatorio)\nAutoCAD\nInglés', callbacks=django_capture_on_commit_callbacks)
        items = list(CVAnalysisItem.objects.filter(analysis_id=a))
        assert len(items) == 3 and all(i.status == CVItemStatus.DONE for i in items)
        for item in items:
            assert (item.tokens_in, item.tokens_out, float(item.cost_usd)) == (0, 0, 0.0)
            assert item.model_name == 'simulado' and item.result['meta'] == {
                'model': 'simulado', 'prompt_version': 'cv-v2', 'simulated': True}
            assert item.score is not None and item.recommendation in ('ADVANCE', 'REVIEW', 'NO_ADVANCE')
            assert item.candidate_name and item.report_pdf
            assert len(item.result['computed']['requirements']) == 3
        detail = hr_client.get(f'{BASE}{a}/').data
        assert detail['model_name'] == 'simulado' and detail['cost_usd'] == 0 and detail['status'] == 'COMPLETED'
        assert CVAnalysis.objects.get(pk=a).model_name == 'simulado'
        rows = hr_client.get(f'{BASE}{a}/items/').data['results']
        assert [r['rank'] for r in rows] == sorted(r['rank'] for r in rows if r['rank'])
        progress = hr_client.get(f'{BASE}{a}/progress/').data
        assert progress['percent'] == 100 and progress['counts']['done'] == 3 and progress['cost_usd'] == 0
        assert sum(progress['recommendations'].values()) == 3
        assert progress['flagged'] == {'injection': sum(i.injection_suspected for i in items)}

    def test_full_flow_without_requirements_has_no_score(self, fake_provider, hr_client,
                                                         django_capture_on_commit_callbacks):
        a = run(hr_client, callbacks=django_capture_on_commit_callbacks)
        items = list(CVAnalysisItem.objects.filter(analysis_id=a))
        assert all(i.status == CVItemStatus.DONE and i.score is None and i.recommendation == '' for i in items)
        assert all('evaluation' not in i.result['report'] for i in items)

    def test_same_file_gives_the_same_candidate_in_another_analysis(self, fake_provider, hr_client,
                                                                    django_capture_on_commit_callbacks):
        files = [('uno.pdf', make_pdf('mismo'))]
        names = []
        for _ in range(2):
            a = run(hr_client, files=files, callbacks=django_capture_on_commit_callbacks)
            names.append(CVAnalysisItem.objects.get(analysis_id=a).candidate_name)
        assert names[0] == names[1] != ''

    def test_downloads_work_and_the_pdf_says_simulated(self, fake_provider, hr_client,
                                                       django_capture_on_commit_callbacks):
        from pypdf import PdfReader

        a = run(hr_client, 'AutoCAD', callbacks=django_capture_on_commit_callbacks)
        item = CVAnalysisItem.objects.filter(analysis_id=a).first()
        pdf = hr_client.get(f'{BASE}{a}/items/{item.pk}/report/')
        assert pdf.status_code == 200
        text = PdfReader(io.BytesIO(b''.join(pdf.streaming_content))).pages[0].extract_text()
        assert 'DATOS SIMULADOS - modo de prueba' in text
        assert hr_client.get(f'{BASE}{a}/download-zip/').status_code == 200
        assert hr_client.get(f'{BASE}{a}/download-xlsx/').status_code == 200

    def test_real_report_pdf_has_no_simulated_notice(self, fake_cv_client, hr_client,
                                                     django_capture_on_commit_callbacks):
        from pypdf import PdfReader

        a = run(hr_client, files=[('uno.pdf', make_pdf('uno'))], callbacks=django_capture_on_commit_callbacks)
        item = CVAnalysisItem.objects.get(analysis_id=a)
        data = b''.join(hr_client.get(f'{BASE}{a}/items/{item.pk}/report/').streaming_content)
        assert 'SIMULADOS' not in PdfReader(io.BytesIO(data)).pages[0].extract_text()
        assert 'simulated' not in item.result['meta']

    def test_fail_percent_100_fails_every_item_and_retry_fails_again(self, fake_provider, hr_client,
                                                                     django_capture_on_commit_callbacks):
        fake_provider.HR_CV_FAKE_FAIL_PERCENT = 100
        a = run(hr_client, callbacks=django_capture_on_commit_callbacks)
        items = list(CVAnalysisItem.objects.filter(analysis_id=a))
        assert all(i.status == CVItemStatus.FAILED and i.error_code == 'ai_failed' for i in items)
        assert hr_client.get(f'{BASE}{a}/').data['status'] == 'COMPLETED_WITH_ERRORS'
        with django_capture_on_commit_callbacks(execute=True):
            assert hr_client.post(f'{BASE}{a}/retry-failed/').status_code == 202  # works without API key
        assert all(i.status == CVItemStatus.FAILED for i in CVAnalysisItem.objects.filter(analysis_id=a))
        fake_provider.HR_CV_FAKE_FAIL_PERCENT = 0
        with django_capture_on_commit_callbacks(execute=True):
            hr_client.post(f'{BASE}{a}/retry-failed/')
        assert all(i.status == CVItemStatus.DONE for i in CVAnalysisItem.objects.filter(analysis_id=a))

    def test_without_fake_the_upload_is_still_blocked_without_a_key(self, hr_client):
        a = create(hr_client).data['id']
        assert post_files(hr_client, a, [('a.pdf', make_pdf())]).data['code'] == 'analysis_unavailable'

    def test_logs_carry_no_candidate_data(self, fake_provider, hr_client, django_capture_on_commit_callbacks, logs):
        a = run(hr_client, 'AutoCAD', callbacks=django_capture_on_commit_callbacks)
        names = [i.candidate_name for i in CVAnalysisItem.objects.filter(analysis_id=a)]
        assert 'outcome=ok' in logs.text
        for name in names:
            assert name and name not in logs.text
        for original in ('uno.pdf', 'dos.docx', 'tres.png'):
            assert original not in logs.text
        assert '@example.com' not in logs.text


class TestFakePosting:
    def post(self, hr_client, body=None):
        a = create(hr_client).data['id']
        return a, hr_client.post(f'{BASE}{a}/posting/extract/', body or {}, format='json')

    def test_without_a_file_or_text_it_still_needs_a_source(self, fake_provider, hr_client):
        _a, resp = self.post(hr_client)
        assert resp.status_code == 400 and resp.data['code'] == 'no_posting'

    def test_image_posting_gets_sample_requirements(self, fake_provider, hr_client):
        a = create(hr_client).data['id']
        hr_client.post(f'{BASE}{a}/posting/', {'file': upload('c.png', make_png())}, format='multipart')
        first = hr_client.post(f'{BASE}{a}/posting/extract/', {}, format='json')
        again = hr_client.post(f'{BASE}{a}/posting/extract/', {}, format='json')
        assert first.status_code == 200 and first.data['source'] == 'fake'
        assert 5 <= len(first.data['requirements']) <= 7
        assert any(r['weight'] == 3 for r in first.data['requirements'])
        assert first.data['requirements'] == again.data['requirements']  # deterministic
        assert [w['code'] for w in first.data['warnings']] == ['simulated']
        assert first.data['warnings'][0]['detail'] == 'Modo de prueba: requisitos simulados.'
        assert first.data['usage'] == {'tokens_in': 0, 'tokens_out': 0, 'cost_usd': 0}
        assert first.data['position_title']
        assert CVAnalysis.objects.get(pk=a).posting_tokens_in == 0

    def test_real_text_goes_through_the_heuristic(self, fake_provider, hr_client):
        _a, resp = self.post(hr_client, {'text': POSTING_TEXT})
        assert resp.data['source'] == 'fake'
        assert resp.data['requirements'][0]['text'] == 'Ingeniero civil colegiado y habilitado'
        assert resp.data['position_title'] == 'Residente de obra'

    def test_text_without_requirements_falls_back_to_samples(self, fake_provider, hr_client):
        _a, resp = self.post(hr_client, {'text': 'Texto sin estructura alguna, solo una frase corta.'})
        assert 5 <= len(resp.data['requirements']) <= 7

    def test_proposals_are_still_filtered_for_protected_attributes(self, fake_provider, hr_client):
        _a, resp = self.post(hr_client, {'text': 'Requisitos:\n- Sexo masculino\n- Manejo de AutoCAD avanzado'})
        assert [r['text'] for r in resp.data['requirements']] == ['Manejo de AutoCAD avanzado']
        assert {w['code'] for w in resp.data['warnings']} == {'simulated', 'protected_attribute_omitted'}

    def test_whole_wizard_with_the_fake_provider(self, fake_provider, hr_client, django_capture_on_commit_callbacks):
        """Step 1 (create + posting + extract + confirm) -> step 2 (CVs) -> step 3 (results)."""
        a = create(hr_client, name='Convocatoria 27/10/2026').data['id']
        assert hr_client.post(f'{BASE}{a}/posting/', {'file': upload('c.docx', make_docx(POSTING_TEXT))},
                              format='multipart').status_code == 200
        proposal = hr_client.post(f'{BASE}{a}/posting/extract/', {}, format='json').data
        assert hr_client.patch(f'{BASE}{a}/', {'name': proposal['position_title'],
                                               'requirements_text': proposal['requirements_text']},
                               format='json').status_code == 200
        with django_capture_on_commit_callbacks(execute=True):
            assert post_files(hr_client, a, [('uno.pdf', make_pdf('uno')), ('dos.pdf', make_pdf('dos'))]).status_code == 200
        data = hr_client.get(f'{BASE}{a}/').data
        assert data['name'] == 'Residente de obra' and data['status'] == 'COMPLETED' and data['requirements_locked']
        assert data['has_posting'] and len(data['requirements']) == 4
        assert all(r['score'] is not None for r in hr_client.get(f'{BASE}{a}/items/').data['results'])
