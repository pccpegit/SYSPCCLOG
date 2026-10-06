"""Regression tests for the SYSPCC-022 FASE 5 review fixes."""

import signal
import subprocess
from types import SimpleNamespace

import pytest
from django.core.management import call_command

from apps.hr.exceptions import HRDomainError
from apps.hr.models import DocumentTemplate
from apps.hr.services import docx_renderer, pdf_converter
from apps.hr.tests.conftest import docx_text
from apps.hr.tests.test_documents import URL, create_draft
from apps.hr.tests.test_templates import build_docx_with_text, post_template

pytestmark = pytest.mark.django_db
ENGLISH_HINTS = ('unexpected', 'expected token', 'jinja', 'is undefined', 'unsafe', 'not callable')


class TestSpanishEngineErrors:
    @pytest.mark.parametrize('text', ['{% if %} roto {{ nombre_trabajador }}', '{{ nombre_trabajador } }',
                                      "{{ ''.__class__ }}", '{% for a in "ab" %}x{% endfor %}'])
    def test_upload_errors_are_fixed_spanish_text(self, hr_client, text):
        resp = post_template(hr_client, build_docx_with_text(text))
        assert resp.status_code == 400 and resp.data['code'] == 'template_syntax_error'
        detail = resp.data['detail'].lower()
        assert not any(h in detail for h in ENGLISH_HINTS), detail
        assert 'plantilla' in detail

    def test_render_error_has_no_engine_message(self):
        with pytest.raises(HRDomainError) as exc:
            docx_renderer.render(build_docx_with_text('{{ variable_que_no_existe }}'), {})
        assert exc.value.code == 'template_render_error'
        assert 'variable_que_no_existe' not in str(exc.value.detail)
        assert 'undefined' not in str(exc.value.detail).lower()

    def test_our_own_limit_messages_stay_visible(self):
        with pytest.raises(HRDomainError) as exc:
            docx_renderer.render(build_docx_with_text("{{ 'A'*200000000 }}"), {})
        assert 'Repetición' in str(exc.value.detail)


class TestDefaults:
    def test_server_fallback_is_opt_in(self):
        from django.conf import settings

        assert settings.HR_ASSISTANT_SERVER_FALLBACK is False

    def test_modality_labels(self, hr_client):
        spec = hr_client.get('/api/v1/hr/document-types/').data[0]
        field = next(f for f in spec['fields'] if f['key'] == 'fixed_term_modality')
        labels = {c['value']: c['label'] for c in field['choices']}
        assert labels['NECESIDAD_MERCADO'] == 'Por necesidades del mercado'
        assert labels['TEMPORADA'] == 'De temporada'


class TestCompanyAndDemoGuards:
    def test_warnings_when_company_data_missing_and_demo_template(self, hr_client, active_template, contract_data, settings):
        settings.HR_COMPANY_NAME = ''
        settings.HR_COMPANY_LEGAL_REP_DNI = ''
        active_template.name = 'Contrato (MODELO DEMO — SIN VALOR LEGAL)'
        active_template.save()
        resp = create_draft(hr_client, active_template, contract_data)
        text = ' '.join(resp.data['warnings'])
        assert 'razón social' in text and 'DNI del representante legal' in text
        assert 'MODELO DEMO' in text

    def test_issue_blocked_without_core_company_data(self, hr_client, active_template, contract_data, settings):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        settings.HR_COMPANY_RUC = ''
        resp = hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        assert resp.status_code == 400 and resp.data['code'] == 'company_data_missing'
        assert 'RUC' in resp.data['detail'] and 'HR_COMPANY_' in resp.data['detail']
        from apps.hr.models import GeneratedDocument

        doc = GeneratedDocument.objects.get(pk=doc_id)
        assert doc.status == 'DRAFT' and doc.reference_number is None  # no correlative consumed
        settings.HR_COMPANY_RUC = '20123456789'
        assert hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json').status_code == 200

    def test_non_core_gaps_and_demo_template_only_warn(self, hr_client, active_template, contract_data, settings):
        settings.HR_COMPANY_LEGAL_REP_DNI = ''
        settings.HR_COMPANY_LEGAL_REP_POWERS = ''
        active_template.name = 'MODELO DEMO'
        active_template.save()
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        assert hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json').status_code == 200

    def test_template_that_does_not_use_company_variables_is_not_blocked(self, hr_client, contract_data, settings,
                                                                         hr_manager):
        from apps.hr.services import template_service
        from apps.hr.tests.conftest import upload

        t = template_service.create_template(
            user=hr_manager, document_type='CONTRACT', name='Fija', slug='fija', notes='',
            uploaded_file=upload(build_docx_with_text('Contrato de {{ nombre_trabajador }} con ACME S.A.C.')),
        )
        template_service.activate_template(t.pk, user=hr_manager)
        settings.HR_COMPANY_NAME = settings.HR_COMPANY_RUC = settings.HR_COMPANY_LEGAL_REP_NAME = ''
        doc_id = create_draft(hr_client, t, contract_data).data['id']
        assert hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json').status_code == 200


class TestDemoTemplate:
    def test_demo_text_is_marked_and_reads_well(self, hr_client, contract_data):
        call_command('seed_hr_template')
        template = DocumentTemplate.objects.get()
        assert 'SIN VALOR LEGAL' in template.name
        resp = hr_client.post(
            URL,
            {'document_type': 'CONTRACT', 'template_id': template.pk,
             'data': {**contract_data, 'contract_type': 'FIXED_TERM', 'fixed_term_modality': 'NECESIDAD_MERCADO',
                      'fixed_term_cause': 'Mayor demanda', 'end_date': '2027-04-30'}},
            format='json',
        )
        assert resp.status_code == 201, resp.data
        from apps.hr.models import GeneratedDocument

        text = docx_text(GeneratedDocument.objects.get(pk=resp.data['id']).docx_file)
        assert 'MODELO DEMO — SIN VALOR LEGAL' in text and text.count('[EJEMPLO]') >= 6
        assert 'se celebra a plazo fijo' in text
        assert 'es A plazo' not in text and 'contrato Por necesidades' not in text
        assert 'Modalidad del contrato a plazo fijo: Por necesidades del mercado.' in text


class FakeProc:
    pid = 424242

    def __init__(self, returncode=0, hang=False):
        self.returncode, self.hang, self.waits = returncode, hang, 0

    def wait(self, timeout=None):
        self.waits += 1
        if self.hang and self.waits == 1:
            raise subprocess.TimeoutExpired('soffice', timeout)
        return self.returncode


class TestPdfConverterHardening:
    @pytest.fixture(autouse=True)
    def enable(self, monkeypatch, settings):
        settings.HR_PDF_ENABLED = True
        monkeypatch.setattr(pdf_converter, '_soffice_path', lambda: '/usr/bin/soffice')
        self.killed = []
        monkeypatch.setattr(pdf_converter.os, 'killpg', lambda pid, sig: self.killed.append((pid, sig)))

    def test_minimal_env_new_session_and_pdf_read(self, monkeypatch, settings):
        settings.SECRET_KEY = 'super-secret'
        monkeypatch.setenv('ANTHROPIC_API_KEY', 'sk-secret')
        monkeypatch.setenv('DB_PASSWORD', 'dbpass')
        seen = {}

        def popen(argv, **kw):
            seen.update(kw, argv=argv)
            outdir = argv[argv.index('--outdir') + 1]
            with open(f'{outdir}/documento.pdf', 'wb') as fh:
                fh.write(b'%PDF-ok')
            return FakeProc()

        monkeypatch.setattr(pdf_converter.subprocess, 'Popen', popen)
        assert pdf_converter.convert(b'docx') == b'%PDF-ok'
        assert set(seen['env']) == {'PATH', 'HOME', 'LANG'}
        assert 'secret' not in str(seen['env']).lower() and 'dbpass' not in str(seen['env'])
        assert seen['start_new_session'] is True and seen['shell'] is False
        assert '--nolockcheck' in seen['argv']
        assert self.killed and self.killed[-1][1] == signal.SIGKILL  # orphan cleanup

    def test_timeout_kills_the_process_group(self, monkeypatch):
        monkeypatch.setattr(pdf_converter.subprocess, 'Popen', lambda argv, **kw: FakeProc(hang=True))
        with pytest.raises(HRDomainError) as exc:
            pdf_converter.convert(b'docx')
        assert exc.value.code == 'pdf_conversion_failed'
        assert (FakeProc.pid, signal.SIGKILL) in self.killed

    def test_nonzero_exit_is_a_domain_error(self, monkeypatch):
        monkeypatch.setattr(pdf_converter.subprocess, 'Popen', lambda argv, **kw: FakeProc(returncode=1))
        with pytest.raises(HRDomainError):
            pdf_converter.convert(b'docx')


def test_issue_survives_unexpected_pdf_error(hr_client, active_template, contract_data, monkeypatch, settings):
    settings.HR_PDF_ENABLED = True
    monkeypatch.setattr(pdf_converter, '_soffice_path', lambda: '/usr/bin/soffice')

    def boom(docx_bytes):
        raise OSError('disk exploded')

    monkeypatch.setattr(pdf_converter, 'convert', boom)
    doc_id = create_draft(hr_client, active_template, contract_data).data['id']
    resp = hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
    assert resp.status_code == 200 and resp.data['status'] == 'ISSUED' and resp.data['pdf_available'] is False


class TestAssistantWording:
    def test_user_facing_texts_say_descripcion(self, hr_client, settings, monkeypatch):
        from apps.hr.tests.test_assistant import FakeClient, ok_response, patch_client, post

        settings.ANTHROPIC_API_KEY = 'k'
        settings.HR_ASSISTANT_SERVER_FALLBACK = False
        assert 'descripción' in post(hr_client, text='x' * 2001).data['detail']['text'][0]
        patch_client(monkeypatch, FakeClient(response=SimpleNamespace(stop_reason='refusal', parsed_output=None, usage=None)))
        detail = post(hr_client).data['detail']
        assert 'descripción' in detail and 'pedido' not in detail.lower() and 'pude' not in detail
        patch_client(monkeypatch, FakeClient(ok_response(gross_salary='mucho')))
        warnings = ' '.join(post(hr_client).data['warnings'])
        assert 'de la descripción' in warnings and 'pedido' not in warnings
