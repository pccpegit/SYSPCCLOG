import re
from datetime import date
from decimal import Decimal

import pytest

from apps.core.enums import RoleChoices
from apps.core.models import UserRole
from apps.hr.documents.formatters import long_date_es, money_fmt, money_to_words_es
from apps.hr.models import DocumentEvent, GeneratedDocument
from apps.hr.tests.conftest import client_for, docx_text

pytestmark = pytest.mark.django_db
URL = '/api/v1/hr/documents/'


def create_draft(client, template, data, **extra):
    return client.post(
        URL,
        {'document_type': 'CONTRACT', 'template_id': template.pk, 'data': data, **extra},
        format='json',
    )


class TestFormatters:
    def test_salary_in_words(self):
        assert money_to_words_es(Decimal('2000')) == 'DOS MIL Y 00/100 SOLES'
        assert money_to_words_es(Decimal('1500.50')) == 'MIL QUINIENTOS Y 50/100 SOLES'
        assert money_to_words_es(Decimal('1')) == 'UN Y 00/100 SOL'

    def test_money_fmt_and_long_date(self):
        assert money_fmt(Decimal('2000')) == 'S/ 2,000.00'
        assert long_date_es(date(2026, 11, 1)) == '1 de noviembre de 2026'


class TestDraftAndIssue:
    def test_create_draft_renders_docx_with_derived_values(self, hr_client, active_template, contract_data):
        resp = create_draft(hr_client, active_template, contract_data)
        assert resp.status_code == 201, resp.data
        assert resp.data['status'] == 'DRAFT'
        assert resp.data['reference_number'] is None
        assert resp.data['data']['gross_salary'] == '2000.00'
        assert 'company' not in resp.data['data']
        doc = GeneratedDocument.objects.get(pk=resp.data['id'])
        text = docx_text(doc.docx_file)
        assert 'Ana Pérez' in text
        assert 'DOS MIL Y 00/100 SOLES' in text
        assert '1 de noviembre de 2026' in text
        assert 'EMPRESA DEMO S.A.C.' in text
        assert doc.template_version == active_template.version
        assert doc.events.filter(action='CREATED').exists()

    def test_issue_assigns_number_and_is_not_repeatable(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        resp = hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        assert resp.status_code == 200, resp.data
        assert re.fullmatch(r'CT-\d{4}-0001', resp.data['reference_number'])
        assert resp.data['status'] == 'ISSUED'
        assert GeneratedDocument.objects.get(pk=doc_id).docx_sha256

        again = hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        assert again.status_code == 409
        assert again.data['code'] == 'invalid_state'

        second = create_draft(hr_client, active_template, contract_data).data['id']
        resp2 = hr_client.post(f'{URL}{second}/issue/', {}, format='json')
        assert resp2.data['reference_number'].endswith('-0002')

    def test_issued_document_cannot_be_edited_or_deleted(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        assert hr_client.patch(f'{URL}{doc_id}/', {'data': {'position': 'Otro'}}, format='json').status_code == 409
        assert hr_client.delete(f'{URL}{doc_id}/').status_code == 409

    def test_edit_draft_rerenders(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        resp = hr_client.patch(f'{URL}{doc_id}/', {'data': {'position': 'Jefe de Obra'}}, format='json')
        assert resp.status_code == 200, resp.data
        assert 'Jefe de Obra' in docx_text(GeneratedDocument.objects.get(pk=doc_id).docx_file)

    def test_void_flow(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        assert hr_client.post(f'{URL}{doc_id}/void/', {'reason': 'motivo largo de prueba'}, format='json').status_code == 409
        hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        assert hr_client.post(f'{URL}{doc_id}/void/', {'reason': 'corto'}, format='json').status_code == 400
        ok = hr_client.post(f'{URL}{doc_id}/void/', {'reason': 'Error en el sueldo consignado'}, format='json')
        assert ok.status_code == 200 and ok.data['status'] == 'VOIDED'

    def test_delete_draft(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        assert hr_client.delete(f'{URL}{doc_id}/').status_code == 204
        assert not GeneratedDocument.objects.filter(pk=doc_id).exists()


class TestValidation:
    def test_fixed_term_requires_end_date_modality_and_cause(self, hr_client, active_template, contract_data):
        resp = create_draft(hr_client, active_template, {**contract_data, 'contract_type': 'FIXED_TERM'})
        assert resp.status_code == 400
        detail = resp.data['detail']
        assert {'end_date', 'fixed_term_modality', 'fixed_term_cause'} <= set(detail)

    def test_end_before_start_and_indefinite_with_end(self, hr_client, active_template, contract_data):
        resp = create_draft(hr_client, active_template, {
            **contract_data, 'contract_type': 'FIXED_TERM', 'fixed_term_modality': 'OCASIONAL',
            'fixed_term_cause': 'Causa', 'end_date': '2026-10-01',
        })
        assert 'end_date' in resp.data['detail']
        resp = create_draft(hr_client, active_template, {**contract_data, 'end_date': '2027-01-01'})
        assert 'end_date' in resp.data['detail']

    def test_invalid_dni_and_salary(self, hr_client, active_template, contract_data):
        resp = create_draft(hr_client, active_template, {**contract_data, 'worker_dni': '123', 'gross_salary': '-5'})
        assert {'worker_dni', 'gross_salary'} <= set(resp.data['detail'])

    def test_low_salary_is_a_warning_not_an_error(self, hr_client, active_template, contract_data):
        resp = create_draft(hr_client, active_template, {**contract_data, 'gross_salary': '500.00'})
        assert resp.status_code == 201
        assert any('remuneración mínima' in w for w in resp.data['warnings'])

    def test_inactive_template_conflict(self, hr_client, active_template, contract_data):
        active_template.is_active = False
        active_template.save()
        resp = create_draft(hr_client, active_template, contract_data)
        assert resp.status_code == 409 and resp.data['code'] == 'template_inactive'

    def test_overlap_warning_with_issued_contract(self, hr_client, active_template, contract_data):
        first = create_draft(hr_client, active_template, contract_data).data['id']
        hr_client.post(f'{URL}{first}/issue/', {}, format='json')
        resp = create_draft(hr_client, active_template, contract_data)
        assert any('se traslapan' in w for w in resp.data['warnings'])


class TestDownload:
    def test_download_docx_logs_event_and_headers(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        resp = hr_client.get(f'{URL}{doc_id}/download/')
        assert resp.status_code == 200
        assert resp['Cache-Control'] == 'no-store'
        assert resp['X-Content-Type-Options'] == 'nosniff'
        assert 'Contrato_Ana_borrador.docx' in resp['Content-Disposition']
        b''.join(resp.streaming_content)
        assert DocumentEvent.objects.filter(document_id=doc_id, action='DOWNLOADED').exists()

    def test_pdf_not_available(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        resp = hr_client.get(f'{URL}{doc_id}/download/?format=pdf')
        assert resp.status_code == 404 and resp.data['code'] == 'pdf_not_available'
        assert hr_client.post(f'{URL}{doc_id}/render-pdf/').status_code == 501


class TestPermissions:
    def _seed(self, hr_client, active_template, contract_data):
        return create_draft(hr_client, active_template, contract_data).data['id']

    def test_general_manager_is_read_only(self, hr_client, general_manager, active_template, contract_data):
        doc_id = self._seed(hr_client, active_template, contract_data)
        hr_client.post(f'{URL}{doc_id}/issue/', {}, format='json')
        gm = client_for(general_manager)
        assert gm.get(URL).status_code == 200
        assert gm.get(f'{URL}{doc_id}/').status_code == 200
        assert gm.get(f'{URL}{doc_id}/download/').status_code == 200
        assert gm.get(f'{URL}{doc_id}/events/').status_code == 200
        assert gm.post(URL, {'document_type': 'CONTRACT', 'template_id': active_template.pk,
                             'data': contract_data}, format='json').status_code == 403
        assert gm.post(f'{URL}{doc_id}/void/', {'reason': 'motivo de prueba largo'}, format='json').status_code == 403
        assert gm.delete(f'{URL}{doc_id}/').status_code == 403
        assert gm.get('/api/v1/hr/personal/?search=ab').status_code == 403
        assert gm.post('/api/v1/hr/assistant/extract/', {}, format='json').status_code == 403

    def test_roles_without_access(self, admin_manager, superuser, staff_user, requester,
                                  hr_client, active_template, contract_data):
        doc_id = self._seed(hr_client, active_template, contract_data)
        for user in (admin_manager, superuser, staff_user, requester):
            c = client_for(user)
            assert c.get(URL).status_code == 403, user.username
            assert c.get(f'{URL}{doc_id}/').status_code == 403, user.username
            assert c.get(f'{URL}{doc_id}/download/').status_code == 403, user.username
            assert c.get('/api/v1/hr/templates/').status_code == 403, user.username
            assert c.get('/api/v1/hr/document-types/').status_code == 403, user.username
            assert c.get('/api/v1/hr/assistant/status/').status_code == 403, user.username

    def test_superuser_with_role_gets_access(self, superuser):
        UserRole.objects.create(user=superuser, role=RoleChoices.HR_MANAGER, is_primary=True)
        assert client_for(superuser).get(URL).status_code == 200

    def test_anonymous_is_401(self, api_client):
        assert api_client.get(URL).status_code == 401

    def test_unknown_id_is_404(self, hr_client):
        assert hr_client.get(f'{URL}999999/').status_code == 404


class TestListAndPersonal:
    def test_list_has_no_pii(self, hr_client, active_template, contract_data):
        create_draft(hr_client, active_template, contract_data)
        resp = hr_client.get(URL + '?search=Ana')
        assert resp.status_code == 200 and resp.data['count'] == 1
        row = resp.data['results'][0]
        assert 'data' not in row and 'worker_dni' not in str(row)

    def test_personal_search_and_prefill(self, hr_client, db):
        from apps.core.models import Personal

        p = Personal.objects.create(
            dni='44556677', apellidos_nombres='LOPEZ RUIZ, JUAN', puesto='Operario', salario=Decimal('2500'),
            numero_cuenta='123-456', direccion_residencia='Jr. Uno 1', distrito_residencia='Miraflores',
        )
        assert hr_client.get('/api/v1/hr/personal/?search=a').status_code == 400
        resp = hr_client.get('/api/v1/hr/personal/?search=LOPEZ')
        assert resp.status_code == 200
        row = resp.data['results'][0]
        assert set(row) == {'id', 'dni', 'apellidos_nombres', 'puesto', 'estado', 'fecha_ingreso'}
        pre = hr_client.get(f'/api/v1/hr/personal/{p.pk}/prefill/?document_type=CONTRACT')
        assert pre.data['data']['worker_full_name'] == 'LOPEZ RUIZ, JUAN'
        assert pre.data['data']['gross_salary'] == '2500.00'
        assert 'numero_cuenta' not in str(pre.data) and '123-456' not in str(pre.data)

    def test_document_types_schema(self, hr_client):
        resp = hr_client.get('/api/v1/hr/document-types/')
        assert resp.status_code == 200
        spec = resp.data[0]
        assert spec['key'] == 'CONTRACT'
        assert 'sueldo_en_letras' in {v['name'] for v in spec['variables']}
        assert 'gross_salary' in {f['key'] for f in spec['fields']}

    def test_document_types_expose_constraints(self, hr_client, settings):
        settings.HR_MIN_WAGE = '1130'
        spec = hr_client.get('/api/v1/hr/document-types/').data[0]
        assert spec['constraints'] == {'min_wage': '1130.00', 'default_probation_months': 3}


class TestNoStore:
    def test_every_hr_response_is_no_store(self, hr_client, general_manager, api_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        paths = ['/api/v1/hr/document-types/', '/api/v1/hr/templates/', URL, f'{URL}{doc_id}/',
                 f'{URL}{doc_id}/events/', '/api/v1/hr/assistant/status/', f'{URL}999999/']
        for path in paths:
            assert hr_client.get(path)['Cache-Control'] == 'no-store', path
        assert hr_client.post(URL, {}, format='json')['Cache-Control'] == 'no-store'  # 400
        assert client_for(general_manager).post(URL, {}, format='json')['Cache-Control'] == 'no-store'  # 403
        assert api_client.get(URL)['Cache-Control'] == 'no-store'  # 401

    def test_other_api_prefixes_are_untouched(self, hr_client):
        assert hr_client.get('/api/v1/personal/').get('Cache-Control') != 'no-store'
