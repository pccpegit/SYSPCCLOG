"""Document lifecycle, numbering, IDOR, listing and downloads — gaps found in FASE 4 (SYSPCC-022)."""

import hashlib
from datetime import date

import pytest
from django.db import IntegrityError

from apps.core.models import Personal
from apps.hr.models import DocumentEvent, GeneratedDocument
from apps.hr.services import document_service
from apps.hr.tests.conftest import client_for, docx_text, upload
from apps.hr.tests.test_documents import URL, create_draft
from apps.hr.tests.test_security_fixes import fake_pdf  # noqa: F401
from apps.hr.tests.test_templates import build_docx_with_text

pytestmark = pytest.mark.django_db
TEMPLATES = '/api/v1/hr/templates/'


def issue(client, doc_id):
    return client.post(f'{URL}{doc_id}/issue/', {}, format='json')


def void(client, doc_id, reason='Error en los datos del contrato'):
    return client.post(f'{URL}{doc_id}/void/', {'reason': reason}, format='json')


@pytest.fixture
def draft_id(hr_client, active_template, contract_data):
    return create_draft(hr_client, active_template, contract_data).data['id']


@pytest.fixture
def fixed_data(contract_data):
    return {
        **contract_data, 'contract_type': 'FIXED_TERM', 'fixed_term_modality': 'NECESIDAD_MERCADO',
        'fixed_term_cause': 'Aumento temporal de la demanda', 'end_date': '2027-04-30',
    }


# ----------------------------------------------------------- state machine
class TestTransitions:
    def test_double_issue_gives_one_effect(self, hr_client, draft_id):
        first, second = issue(hr_client, draft_id), issue(hr_client, draft_id)
        assert first.status_code == 200 and second.status_code == 409
        assert second.data['code'] == 'invalid_state'
        doc = GeneratedDocument.objects.get(pk=draft_id)
        assert doc.reference_number == first.data['reference_number']
        assert DocumentEvent.objects.filter(document=doc, action='ISSUED').count() == 1
        assert GeneratedDocument.objects.exclude(reference_number=None).count() == 1

    def test_failed_second_issue_does_not_burn_a_number(self, hr_client, draft_id, active_template, contract_data):
        issue(hr_client, draft_id)
        issue(hr_client, draft_id)
        other = create_draft(hr_client, active_template, contract_data).data['id']
        assert issue(hr_client, other).data['reference_number'].endswith('-0002')

    def test_issued_document_rejects_patch_and_delete_with_409(self, hr_client, draft_id):
        issue(hr_client, draft_id)
        patch = hr_client.patch(f'{URL}{draft_id}/', {'data': {'position': 'Otro'}}, format='json')
        assert patch.status_code == 409 and patch.data['code'] == 'invalid_state'
        assert hr_client.delete(f'{URL}{draft_id}/').status_code == 409
        assert GeneratedDocument.objects.get(pk=draft_id).data['position'] == 'Asistente'

    def test_voided_document_is_immutable(self, hr_client, draft_id):
        issue(hr_client, draft_id)
        assert void(hr_client, draft_id).status_code == 200
        assert hr_client.patch(f'{URL}{draft_id}/', {'data': {}}, format='json').status_code == 409
        assert hr_client.delete(f'{URL}{draft_id}/').status_code == 409
        assert issue(hr_client, draft_id).status_code == 409
        assert void(hr_client, draft_id).status_code == 409  # cannot void twice

    def test_void_requires_issued_state(self, hr_client, draft_id):
        resp = void(hr_client, draft_id)
        assert resp.status_code == 409 and resp.data['code'] == 'invalid_state'
        assert GeneratedDocument.objects.get(pk=draft_id).status == 'DRAFT'

    @pytest.mark.parametrize('reason', [None, '', '   ', 'corto', '123456789', '         x'])
    def test_void_without_valid_reason_is_400_and_keeps_issued(self, hr_client, draft_id, reason):
        issue(hr_client, draft_id)
        body = {} if reason is None else {'reason': reason}
        resp = hr_client.post(f'{URL}{draft_id}/void/', body, format='json')
        assert resp.status_code == 400
        assert GeneratedDocument.objects.get(pk=draft_id).status == 'ISSUED'

    def test_void_with_exactly_ten_chars_ok_and_records_actor_and_reason(self, hr_client, hr_manager, draft_id):
        issue(hr_client, draft_id)
        resp = void(hr_client, draft_id, reason='0123456789')
        assert resp.status_code == 200 and resp.data['status'] == 'VOIDED'
        doc = GeneratedDocument.objects.get(pk=draft_id)
        assert doc.voided_by == hr_manager and doc.voided_at and doc.void_reason == '0123456789'

    def test_void_reason_is_not_written_to_the_event_log(self, hr_client, draft_id):
        issue(hr_client, draft_id)
        void(hr_client, draft_id, reason='Motivo confidencial XYZ')
        events = DocumentEvent.objects.filter(document_id=draft_id)
        assert 'XYZ' not in str(list(events.values_list('metadata', flat=True)))

    def test_voided_keeps_its_reference_number_and_next_number_continues(
        self, hr_client, draft_id, active_template, contract_data
    ):
        ref = issue(hr_client, draft_id).data['reference_number']
        void(hr_client, draft_id)
        assert GeneratedDocument.objects.get(pk=draft_id).reference_number == ref
        other = create_draft(hr_client, active_template, contract_data).data['id']
        assert issue(hr_client, other).data['reference_number'] != ref

    def test_delete_draft_removes_row_events_and_files(
        self, hr_client, draft_id, django_capture_on_commit_callbacks
    ):
        doc = GeneratedDocument.objects.get(pk=draft_id)
        storage, name = doc.docx_file.storage, doc.docx_file.name
        assert storage.exists(name)
        with django_capture_on_commit_callbacks(execute=True):
            assert hr_client.delete(f'{URL}{draft_id}/').status_code == 204
        assert not storage.exists(name)
        assert not DocumentEvent.objects.filter(document_id=draft_id).exists()
        assert hr_client.get(f'{URL}{draft_id}/').status_code == 404

    def test_issue_revalidates_and_stays_draft_when_data_became_invalid(self, hr_client, draft_id):
        GeneratedDocument.objects.filter(pk=draft_id).update(data={'worker_full_name': 'Ana'})
        resp = issue(hr_client, draft_id)
        assert resp.status_code == 400
        doc = GeneratedDocument.objects.get(pk=draft_id)
        assert doc.status == 'DRAFT' and doc.reference_number is None
        assert not DocumentEvent.objects.filter(document=doc, action='ISSUED').exists()

    def test_issue_with_missing_template_file_is_409_and_stays_draft(self, hr_client, draft_id, active_template):
        active_template.file.storage.delete(active_template.file.name)
        resp = issue(hr_client, draft_id)
        assert resp.status_code == 409 and resp.data['code'] == 'template_file_missing'
        assert GeneratedDocument.objects.get(pk=draft_id).status == 'DRAFT'

    def test_issue_rerenders_with_the_reference_number(self, hr_client, draft_id):
        resp = issue(hr_client, draft_id)
        doc = GeneratedDocument.objects.get(pk=draft_id)
        text = docx_text(doc.docx_file)
        assert resp.data['reference_number'] in text
        assert doc.issued_by is not None and doc.issued_at is not None
        doc.docx_file.open('rb')
        try:
            assert hashlib.sha256(doc.docx_file.read()).hexdigest() == doc.docx_sha256
        finally:
            doc.docx_file.close()


# ------------------------------------------------------------- numbering
class TestNumbering:
    def test_sequential_in_current_year(self, hr_client, active_template, contract_data):
        year = date.today().year
        refs = []
        for _ in range(3):
            doc_id = create_draft(hr_client, active_template, contract_data).data['id']
            refs.append(issue(hr_client, doc_id).data['reference_number'])
        assert refs == [f'CT-{year}-0001', f'CT-{year}-0002', f'CT-{year}-0003']

    def test_format_is_ct_year_four_digits(self, hr_client, draft_id):
        import re

        assert re.fullmatch(r'CT-\d{4}-\d{4}', issue(hr_client, draft_id).data['reference_number'])

    def test_counter_restarts_each_year(self, hr_client, active_template, contract_data, monkeypatch):
        first = issue(hr_client, create_draft(hr_client, active_template, contract_data).data['id'])
        monkeypatch.setattr(document_service.timezone, 'localdate', lambda: date(2031, 1, 2))
        second = issue(hr_client, create_draft(hr_client, active_template, contract_data).data['id'])
        third = issue(hr_client, create_draft(hr_client, active_template, contract_data).data['id'])
        assert first.data['reference_number'].endswith('-0001')
        assert second.data['reference_number'] == 'CT-2031-0001'
        assert third.data['reference_number'] == 'CT-2031-0002'

    def test_continues_after_highest_existing_number(self, hr_client, active_template, contract_data):
        year = date.today().year
        seed = create_draft(hr_client, active_template, contract_data).data['id']
        GeneratedDocument.objects.filter(pk=seed).update(
            reference_number=f'CT-{year}-0099', status='ISSUED', issued_at=date.today(),
        )
        nxt = issue(hr_client, create_draft(hr_client, active_template, contract_data).data['id'])
        assert nxt.data['reference_number'] == f'CT-{year}-0100'

    def test_reference_number_is_unique_at_db_level(self, hr_client, active_template, contract_data):
        a = create_draft(hr_client, active_template, contract_data).data['id']
        issue(hr_client, a)
        ref = GeneratedDocument.objects.get(pk=a).reference_number
        b = GeneratedDocument.objects.get(pk=create_draft(hr_client, active_template, contract_data).data['id'])
        b.reference_number, b.status, b.issued_at = ref, 'ISSUED', date.today()
        with pytest.raises(IntegrityError):
            b.save()

    def test_collision_is_retried_and_succeeds(self, hr_client, active_template, contract_data, monkeypatch):
        a = create_draft(hr_client, active_template, contract_data).data['id']
        taken = issue(hr_client, a).data['reference_number']
        b = create_draft(hr_client, active_template, contract_data).data['id']
        real, calls = document_service._next_reference, []

        def flaky(spec):
            calls.append(1)
            return taken if len(calls) == 1 else real(spec)

        monkeypatch.setattr(document_service, '_next_reference', flaky)
        resp = issue(hr_client, b)
        assert resp.status_code == 200 and len(calls) == 2
        assert resp.data['reference_number'] != taken

    def test_persistent_collision_gives_409_issue_conflict_and_leaves_draft(
        self, hr_client, active_template, contract_data, monkeypatch
    ):
        a = create_draft(hr_client, active_template, contract_data).data['id']
        taken = issue(hr_client, a).data['reference_number']
        b = create_draft(hr_client, active_template, contract_data).data['id']
        monkeypatch.setattr(document_service, '_next_reference', lambda spec: taken)
        resp = issue(hr_client, b)
        assert resp.status_code == 409 and resp.data['code'] == 'issue_conflict'
        assert GeneratedDocument.objects.get(pk=b).status == 'DRAFT'


# --------------------------------------------------------------- create/update
class TestCreateAndUpdate:
    def test_company_in_payload_is_ignored_snapshot_uses_settings(self, hr_client, active_template, contract_data):
        data = {**contract_data, 'company': {'name': 'EMPRESA FALSA', 'ruc': '1'}, 'is_superuser': True}
        resp = create_draft(hr_client, active_template, data)
        assert resp.status_code == 201
        doc = GeneratedDocument.objects.get(pk=resp.data['id'])
        assert doc.data['company']['name'] == 'EMPRESA DEMO S.A.C.'
        assert 'is_superuser' not in doc.data
        assert 'EMPRESA FALSA' not in docx_text(doc.docx_file)

    def test_snapshot_traceability_survives_new_template_version(self, hr_client, hr_manager, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        v2 = hr_client.post(
            TEMPLATES, {'document_type': 'CONTRACT', 'name': 'v2', 'slug': 'contrato-trabajo',
                        'file': upload(build_docx_with_text('{{ nombre_trabajador }} v2'))},
            format='multipart',
        )
        assert v2.status_code == 201
        hr_client.post(f'{TEMPLATES}{v2.data["id"]}/activate/')
        issue(hr_client, doc_id)  # old draft still renders with the template it was created with
        doc = GeneratedDocument.objects.get(pk=doc_id)
        assert doc.template_id == active_template.pk and doc.template_version == active_template.version
        assert doc.template_sha256 == active_template.file_sha256
        assert 'v2' not in docx_text(doc.docx_file)

    def test_patch_merges_and_rerenders_and_updates_subject(self, hr_client, draft_id):
        resp = hr_client.patch(
            f'{URL}{draft_id}/', {'data': {'worker_full_name': 'Beatriz Soto', 'gross_salary': '3000'}}, format='json'
        )
        assert resp.status_code == 200
        doc = GeneratedDocument.objects.get(pk=draft_id)
        assert doc.subject_name == 'Beatriz Soto' and doc.data['position'] == 'Asistente'
        assert 'Beatriz Soto' in docx_text(doc.docx_file) and 'TRES MIL Y 00/100 SOLES' in docx_text(doc.docx_file)
        assert DocumentEvent.objects.filter(document=doc, action='UPDATED').count() == 1

    def test_patch_with_invalid_data_is_400_and_changes_nothing(self, hr_client, draft_id):
        before = GeneratedDocument.objects.get(pk=draft_id)
        resp = hr_client.patch(f'{URL}{draft_id}/', {'data': {'worker_dni': '12'}}, format='json')
        assert resp.status_code == 400 and 'worker_dni' in resp.data['detail']
        after = GeneratedDocument.objects.get(pk=draft_id)
        assert after.data == before.data and after.docx_sha256 == before.docx_sha256

    def test_patch_switching_to_indefinite_requires_dropping_fixed_term_fields(self, hr_client, active_template, fixed_data):
        doc_id = create_draft(hr_client, active_template, fixed_data).data['id']
        bad = hr_client.patch(f'{URL}{doc_id}/', {'data': {'contract_type': 'INDEFINITE'}}, format='json')
        assert bad.status_code == 400
        ok = hr_client.patch(
            f'{URL}{doc_id}/',
            {'data': {'contract_type': 'INDEFINITE', 'end_date': None, 'fixed_term_modality': None,
                      'fixed_term_cause': ''}}, format='json',
        )
        assert ok.status_code == 200, ok.data

    def test_patch_to_other_active_template_updates_version(self, hr_client, active_template, draft_id):
        v2 = hr_client.post(
            TEMPLATES, {'document_type': 'CONTRACT', 'name': 'v2', 'slug': 'otra-serie',
                        'file': upload(build_docx_with_text('SEGUNDA {{ nombre_trabajador }}'))},
            format='multipart',
        ).data
        hr_client.post(f'{TEMPLATES}{v2["id"]}/activate/')
        resp = hr_client.patch(f'{URL}{draft_id}/', {'template_id': v2['id']}, format='json')
        assert resp.status_code == 200 and resp.data['template']['id'] == v2['id']
        doc = GeneratedDocument.objects.get(pk=draft_id)
        assert doc.template_id == v2['id'] and doc.template_version == 1
        assert 'SEGUNDA Ana Pérez' in docx_text(doc.docx_file)

    def test_patch_to_inactive_or_unknown_template(self, hr_client, active_template, draft_id):
        inactive = hr_client.post(
            TEMPLATES, {'document_type': 'CONTRACT', 'name': 'x', 'slug': 'inactiva',
                        'file': upload(build_docx_with_text('{{ nombre_trabajador }}'))}, format='multipart',
        ).data['id']
        r1 = hr_client.patch(f'{URL}{draft_id}/', {'template_id': inactive}, format='json')
        assert r1.status_code == 409 and r1.data['code'] == 'template_inactive'
        r2 = hr_client.patch(f'{URL}{draft_id}/', {'template_id': 987654}, format='json')
        assert r2.status_code == 400 and 'template_id' in r2.data['detail']
        assert GeneratedDocument.objects.get(pk=draft_id).template_id == active_template.pk

    @pytest.mark.parametrize('payload,field', [
        ({'document_type': 'CESE'}, 'document_type'),
        ({'source': 'IA'}, 'source'),
        ({'template_id': 'abc'}, 'template_id'),
        ({'personal_id': 987654}, 'personal_id'),
        ({'template_id': 987654}, 'template_id'),
    ])
    def test_create_rejects_bad_references(self, hr_client, active_template, contract_data, payload, field):
        body = {'document_type': 'CONTRACT', 'template_id': active_template.pk, 'data': contract_data, **payload}
        resp = hr_client.post(URL, body, format='json')
        assert resp.status_code == 400 and field in resp.data['detail']
        assert GeneratedDocument.objects.count() == 0

    def test_create_without_data_is_400(self, hr_client, active_template):
        resp = hr_client.post(URL, {'document_type': 'CONTRACT', 'template_id': active_template.pk}, format='json')
        assert resp.status_code == 400

    def test_create_links_personal_and_records_source_and_created_event(self, hr_client, hr_manager, active_template, contract_data):
        p = Personal.objects.create(dni='12345678', apellidos_nombres='PEREZ, ANA')
        resp = create_draft(hr_client, active_template, contract_data, personal_id=p.pk, source='ASSISTANT')
        assert resp.status_code == 201 and resp.data['personal_id'] == p.pk and resp.data['source'] == 'ASSISTANT'
        doc = GeneratedDocument.objects.get(pk=resp.data['id'])
        assert doc.created_by == hr_manager and doc.status == 'DRAFT' and doc.reference_number is None
        assert DocumentEvent.objects.filter(document=doc, action='CREATED', actor=hr_manager).count() == 1

    def test_deleting_personal_keeps_the_document(self, hr_client, active_template, contract_data):
        p = Personal.objects.create(dni='12345678', apellidos_nombres='PEREZ, ANA')
        doc_id = create_draft(hr_client, active_template, contract_data, personal_id=p.pk).data['id']
        p.delete()
        doc = GeneratedDocument.objects.get(pk=doc_id)
        assert doc.personal_id is None and doc.subject_name == 'Ana Pérez'

    def test_fixed_term_draft_renders_cause_and_indefinite_does_not(self, hr_client, active_template, contract_data, fixed_data):
        fixed_doc = GeneratedDocument.objects.get(pk=create_draft(hr_client, active_template, fixed_data).data['id'])
        indef_doc = GeneratedDocument.objects.get(pk=create_draft(hr_client, active_template, contract_data).data['id'])
        assert 'Aumento temporal de la demanda' in docx_text(fixed_doc.docx_file)
        assert '30 de abril de 2027' in docx_text(fixed_doc.docx_file)
        assert 'causa objetiva' not in docx_text(indef_doc.docx_file)

    def test_special_characters_are_rendered_as_text(self, hr_client, active_template, contract_data):
        name = 'Ñandú & <Hnos> "Pérez"'
        doc = GeneratedDocument.objects.get(
            pk=create_draft(hr_client, active_template, {**contract_data, 'worker_full_name': name}).data['id']
        )
        assert name in docx_text(doc.docx_file)

    def test_no_none_or_unrendered_tags_in_output(self, hr_client, active_template, contract_data):
        doc = GeneratedDocument.objects.get(pk=create_draft(hr_client, active_template, contract_data).data['id'])
        text = docx_text(doc.docx_file)
        assert '{{' not in text and '{%' not in text and 'None' not in text

    def test_overlap_warning_is_not_raised_for_voided_or_other_worker(self, hr_client, active_template, contract_data):
        a = create_draft(hr_client, active_template, contract_data).data['id']
        issue(hr_client, a)
        void(hr_client, a)
        again = create_draft(hr_client, active_template, contract_data)
        assert not any('traslapan' in w for w in again.data['warnings'])
        issue(hr_client, create_draft(hr_client, active_template, contract_data).data['id'])
        other = create_draft(hr_client, active_template, {**contract_data, 'worker_dni': '87654321'})
        assert not any('traslapan' in w for w in other.data['warnings'])

    def test_overlap_warning_only_when_dates_intersect(self, hr_client, active_template, fixed_data):
        a = create_draft(hr_client, active_template, fixed_data).data['id']  # 2026-11-01..2027-04-30
        issue(hr_client, a)
        later = create_draft(hr_client, active_template, {**fixed_data, 'start_date': '2027-05-01', 'end_date': '2027-10-31'})
        assert not any('traslapan' in w for w in later.data['warnings'])
        inside = create_draft(hr_client, active_template, {**fixed_data, 'start_date': '2027-04-30', 'end_date': '2027-10-31'})
        assert any('traslapan' in w for w in inside.data['warnings'])

    def test_warnings_not_shown_for_issued_documents(self, hr_client, active_template, contract_data):
        low = {**contract_data, 'gross_salary': '500'}
        doc_id = create_draft(hr_client, active_template, low).data['id']
        assert hr_client.get(f'{URL}{doc_id}/').data['warnings']
        issue(hr_client, doc_id)
        assert hr_client.get(f'{URL}{doc_id}/').data['warnings'] == []

    def test_detail_hides_company_from_data_and_has_no_file_paths(self, hr_client, draft_id):
        body = hr_client.get(f'{URL}{draft_id}/').data
        assert 'company' not in body['data'] and body['company']['ruc'] == '20123456789'
        assert 'docx_file' not in body and 'pdf_file' not in body and 'file' not in body


# ------------------------------------------------------------------- list
class TestList:
    def _make(self, template, hr_manager, n, **over):
        for i in range(n):
            GeneratedDocument.objects.create(
                document_type='CONTRACT', template=template, template_version=1, template_sha256='x',
                subject_name=over.get('subject_name', f'Trabajador {i:02d}'), data={'worker_dni': '1'},
                created_by=hr_manager, status=over.get('status', 'DRAFT'),
            )

    def test_pagination_is_20_per_page_and_cannot_be_overridden(self, hr_client, hr_manager, active_template):
        self._make(active_template, hr_manager, 25)
        page1 = hr_client.get(f'{URL}?page_size=500').data
        assert page1['count'] == 25 and len(page1['results']) == 20 and page1['next']
        assert len(hr_client.get(f'{URL}?page=2').data['results']) == 5

    def test_search_by_name_and_reference(self, hr_client, active_template, contract_data):
        a = create_draft(hr_client, active_template, {**contract_data, 'worker_full_name': 'Zulema Quispe'}).data['id']
        create_draft(hr_client, active_template, {**contract_data, 'worker_full_name': 'Otro Nombre'})
        ref = issue(hr_client, a).data['reference_number']
        assert [r['id'] for r in hr_client.get(f'{URL}?search=zulema').data['results']] == [a]
        assert [r['id'] for r in hr_client.get(f'{URL}?search={ref}').data['results']] == [a]
        assert hr_client.get(f'{URL}?search=inexistente').data['count'] == 0

    def test_search_does_not_match_dni(self, hr_client, active_template, contract_data):
        create_draft(hr_client, active_template, contract_data)
        assert hr_client.get(f'{URL}?search=12345678').data['count'] == 0

    def test_filter_by_status_type_and_creator(self, hr_client, hr_manager, active_template, contract_data):
        a = create_draft(hr_client, active_template, contract_data).data['id']
        create_draft(hr_client, active_template, contract_data)
        issue(hr_client, a)
        assert hr_client.get(f'{URL}?status=ISSUED').data['count'] == 1
        assert hr_client.get(f'{URL}?status=DRAFT').data['count'] == 1
        assert hr_client.get(f'{URL}?document_type=CONTRACT').data['count'] == 2
        assert hr_client.get(f'{URL}?created_by={hr_manager.pk}').data['count'] == 2
        assert hr_client.get(f'{URL}?created_by=999999').data['count'] == 0

    def test_filter_by_date_range(self, hr_client, active_template, contract_data):
        create_draft(hr_client, active_template, contract_data)
        today = date.today().isoformat()
        assert hr_client.get(f'{URL}?created_after={today}&created_before={today}').data['count'] == 1
        assert hr_client.get('%s?created_before=2000-01-01' % URL).data['count'] == 0

    @pytest.mark.parametrize('query', ['status=BOGUS', 'created_after=ayer', 'personal=abc', 'created_by=x'])
    def test_invalid_filters_are_400_not_500(self, hr_client, query):
        assert hr_client.get(f'{URL}?{query}').status_code == 400

    def test_ordering_and_default_newest_first(self, hr_client, hr_manager, active_template):
        self._make(active_template, hr_manager, 1, subject_name='Beta')
        self._make(active_template, hr_manager, 1, subject_name='Alfa')
        newest = [r['subject_name'] for r in hr_client.get(URL).data['results']]
        assert newest == ['Alfa', 'Beta']
        asc = [r['subject_name'] for r in hr_client.get(f'{URL}?ordering=subject_name').data['results']]
        assert asc == ['Alfa', 'Beta']

    def test_list_rows_never_contain_pii_or_data(self, hr_client, draft_id):
        row = hr_client.get(URL).data['results'][0]
        assert 'data' not in row and '12345678' not in str(row) and 'gross_salary' not in str(row)


# ---------------------------------------------------------------- download
class TestDownloadExtra:
    def test_issued_filename_uses_reference_and_ascii_surname(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, {**contract_data, 'worker_full_name': 'Ñandú Pérez'}).data['id']
        ref = issue(hr_client, doc_id).data['reference_number']
        resp = hr_client.get(f'{URL}{doc_id}/download/')
        assert f'Contrato_Nandu_{ref}.docx' in resp['Content-Disposition']
        assert resp['Content-Disposition'].startswith('attachment')
        assert resp['Content-Type'].startswith('application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    @pytest.mark.parametrize('name', ['../../etc/passwd', '"; X-Evil: 1', 'a\r\nSet-Cookie: x=1', '日本語', ' ,'])
    def test_hostile_names_cannot_inject_into_filename(self, name):
        doc = GeneratedDocument(subject_name=name, document_type='CONTRACT')
        filename = document_service.download_filename(doc, 'docx')
        assert filename.startswith('Contrato_') and filename.endswith('_borrador.docx')
        assert all(c.isalnum() or c in '_-.' for c in filename), filename

    def test_hostile_name_end_to_end_has_clean_header(self, hr_client, active_template, contract_data):
        data = {**contract_data, 'worker_full_name': '../../x"; filename="evil.exe'}
        doc_id = create_draft(hr_client, active_template, data).data['id']
        resp = hr_client.get(f'{URL}{doc_id}/download/')
        assert resp.status_code == 200
        disposition = resp['Content-Disposition']
        assert 'evil.exe' not in disposition and '\n' not in disposition
        assert '/' not in disposition.split('filename=')[-1] and disposition.count('filename=') == 1

    def test_downloaded_bytes_match_stored_hash(self, hr_client, draft_id):
        resp = hr_client.get(f'{URL}{draft_id}/download/')
        content = b''.join(resp.streaming_content)
        assert hashlib.sha256(content).hexdigest() == GeneratedDocument.objects.get(pk=draft_id).docx_sha256
        assert content[:2] == b'PK'

    def test_event_has_actor_and_no_pii_and_one_per_download(self, hr_client, hr_manager, draft_id):
        for _ in range(2):
            b''.join(hr_client.get(f'{URL}{draft_id}/download/').streaming_content)
        events = DocumentEvent.objects.filter(document_id=draft_id, action='DOWNLOADED')
        assert events.count() == 2 and all(e.actor == hr_manager for e in events)
        meta = events[0].metadata
        assert meta['format'] == 'docx' and set(meta) <= {'format', 'template_version'}
        assert '12345678' not in str(meta)

    def test_general_manager_download_is_logged_with_their_identity(self, hr_client, general_manager, draft_id):
        b''.join(client_for(general_manager).get(f'{URL}{draft_id}/download/').streaming_content)
        assert DocumentEvent.objects.get(document_id=draft_id, action='DOWNLOADED').actor == general_manager

    def test_denied_download_leaves_no_event(self, admin_manager, api_client, draft_id):
        assert client_for(admin_manager).get(f'{URL}{draft_id}/download/').status_code == 403
        assert api_client.get(f'{URL}{draft_id}/download/').status_code == 401
        assert not DocumentEvent.objects.filter(document_id=draft_id, action='DOWNLOADED').exists()

    def test_invalid_format_is_400(self, hr_client, draft_id):
        resp = hr_client.get(f'{URL}{draft_id}/download/?format=exe')
        assert resp.status_code == 400 and resp.data['code'] == 'invalid_format'

    def test_format_json_is_not_a_drf_renderer_override(self, hr_client, draft_id):
        resp = hr_client.get(f'{URL}{draft_id}/download/?format=json')
        assert resp.status_code == 400 and resp.data['code'] == 'invalid_format'

    def test_missing_file_on_disk_is_404_without_event(self, hr_client, draft_id):
        doc = GeneratedDocument.objects.get(pk=draft_id)
        doc.docx_file.storage.delete(doc.docx_file.name)
        resp = hr_client.get(f'{URL}{draft_id}/download/')
        assert resp.status_code == 404 and resp.data['code'] == 'file_missing'
        assert not DocumentEvent.objects.filter(document_id=draft_id, action='DOWNLOADED').exists()

    def test_pdf_served_only_when_hash_matches(self, hr_client, draft_id, fake_pdf):  # noqa: F811
        issued = issue(hr_client, draft_id)
        assert issued.data['pdf_available'] is True
        ok = hr_client.get(f'{URL}{draft_id}/download/?format=PDF')  # case-insensitive
        assert ok.status_code == 200 and ok['Content-Type'] == 'application/pdf'
        assert b''.join(ok.streaming_content) == b'%PDF-fake'
        assert 'Contrato_Ana_' in ok['Content-Disposition'] and ok['Content-Disposition'].endswith('.pdf"')
        GeneratedDocument.objects.filter(pk=draft_id).update(docx_sha256='0' * 64)
        stale = hr_client.get(f'{URL}{draft_id}/download/?format=pdf')
        assert stale.status_code == 404 and stale.data['code'] == 'pdf_not_available'
        assert hr_client.get(f'{URL}{draft_id}/').data['pdf_available'] is False

    def test_pdf_event_metadata_records_format(self, hr_client, draft_id, fake_pdf):  # noqa: F811
        issue(hr_client, draft_id)
        b''.join(hr_client.get(f'{URL}{draft_id}/download/?format=pdf').streaming_content)
        assert DocumentEvent.objects.filter(document_id=draft_id, action='DOWNLOADED', metadata__format='pdf').exists()
        assert DocumentEvent.objects.filter(document_id=draft_id, action='PDF_RENDERED').exists()

    def test_render_pdf_on_draft_then_edit_invalidates(self, hr_client, draft_id, fake_pdf):  # noqa: F811
        assert hr_client.post(f'{URL}{draft_id}/render-pdf/').data['pdf_available'] is True
        hr_client.patch(f'{URL}{draft_id}/', {'data': {'position': 'Cajera'}}, format='json')
        assert hr_client.get(f'{URL}{draft_id}/').data['pdf_available'] is False
        assert hr_client.get(f'{URL}{draft_id}/download/?format=pdf').status_code == 404

    def test_events_endpoint_lists_lifecycle_in_order(self, hr_client, draft_id):
        issue(hr_client, draft_id)
        b''.join(hr_client.get(f'{URL}{draft_id}/download/').streaming_content)
        void(hr_client, draft_id)
        events = hr_client.get(f'{URL}{draft_id}/events/').data
        assert [e['action'] for e in events] == ['CREATED', 'ISSUED', 'DOWNLOADED', 'VOIDED']
        assert all('action_label' in e and 'actor_name' in e for e in events)

    def test_download_throttle_is_enforced(self, hr_client, draft_id, monkeypatch):
        from django.core.cache import cache

        from apps.hr.views.common import HRDownloadThrottle

        monkeypatch.setitem(HRDownloadThrottle.THROTTLE_RATES, 'hr_download', '2/min')
        cache.clear()
        codes = []
        for _ in range(3):
            resp = hr_client.get(f'{URL}{draft_id}/download/')
            codes.append(resp.status_code)
            if resp.status_code == 200:
                b''.join(resp.streaming_content)
        cache.clear()
        assert codes == [200, 200, 429]


# --------------------------------------------------------------- IDOR / ids
class TestIdsAndIdor:
    @pytest.mark.parametrize('path', ['abc/', '0/', '-1/', '99999999999999999999/'])
    def test_malformed_or_absurd_ids_are_404_never_500(self, hr_client, path):
        assert hr_client.get(f'{URL}{path}').status_code == 404
        assert hr_client.post(f'{URL}{path}issue/', {}, format='json').status_code == 404

    def test_prefill_and_template_nonexistent(self, hr_client):
        assert hr_client.get('/api/v1/hr/personal/999999/prefill/').status_code == 404
        assert hr_client.get(f'{TEMPLATES}999999/download/').status_code == 404

    def test_prefill_unsupported_document_type_is_400(self, hr_client, db):
        p = Personal.objects.create(dni='12345678', apellidos_nombres='A, B')
        resp = hr_client.get(f'/api/v1/hr/personal/{p.pk}/prefill/?document_type=CESE')
        assert resp.status_code == 400 and resp.data['code'] == 'unsupported_document_type'

    def test_another_hr_manager_sees_the_same_documents_by_design(self, hr_client, draft_id, db):
        """Documents are an area-wide resource (no per-owner scoping): any HR_MANAGER can act on any document."""
        from django.contrib.auth import get_user_model

        from apps.core.enums import RoleChoices
        from apps.core.models import UserRole

        other = get_user_model().objects.create_user(username='hr2', password='TestPass2026!')
        UserRole.objects.create(user=other, role=RoleChoices.HR_MANAGER, is_primary=True)
        assert client_for(other).get(f'{URL}{draft_id}/').status_code == 200
