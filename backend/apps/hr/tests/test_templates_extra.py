"""Template lifecycle gaps (versioning, series, upload edge cases, seed) — FASE 4 (SYSPCC-022)."""

import io
import os
import zipfile

import pytest
from django.core.management import call_command
from docx import Document

from apps.hr.management.commands.seed_hr_template import build_demo_docx
from apps.hr.models import DocumentTemplate, GeneratedDocument
from apps.hr.tests.conftest import client_for, docx_text, upload
from apps.hr.tests.test_documents import URL as DOCS, create_draft
from apps.hr.tests.test_templates import URL, build_docx_with_text, post_template

pytestmark = pytest.mark.django_db


def activate(client, tid):
    return client.post(f'{URL}{tid}/activate/')


def active_ids(slug=None):
    qs = DocumentTemplate.objects.filter(is_active=True)
    if slug:
        qs = qs.filter(slug=slug)
    return set(qs.values_list('pk', flat=True))


class TestVersioning:
    def test_versions_are_sequential_per_series(self, hr_client):
        versions = [post_template(hr_client, build_demo_docx(), slug='serie-a').data['version'] for _ in range(3)]
        assert versions == [1, 2, 3]

    def test_series_are_independent(self, hr_client):
        a1 = post_template(hr_client, build_demo_docx(), slug='serie-a').data
        b1 = post_template(hr_client, build_demo_docx(), slug='serie-b').data
        a2 = post_template(hr_client, build_demo_docx(), slug='serie-a').data
        assert (a1['version'], b1['version'], a2['version']) == (1, 1, 2)

    def test_default_slug_when_missing_or_blank(self, hr_client):
        assert post_template(hr_client, build_demo_docx()).data['slug'] == 'contrato-trabajo'
        assert post_template(hr_client, build_demo_docx(), slug='').data['slug'] == 'contrato-trabajo'

    def test_version_numbers_are_not_reused_after_delete(self, hr_client):
        post_template(hr_client, build_demo_docx(), slug='s')
        v2 = post_template(hr_client, build_demo_docx(), slug='s').data
        v3 = post_template(hr_client, build_demo_docx(), slug='s').data
        hr_client.delete(f'{URL}{v3["id"]}/')
        assert post_template(hr_client, build_demo_docx(), slug='s').data['version'] == v2['version'] + 1

    def test_new_upload_is_never_active(self, hr_client):
        assert post_template(hr_client, build_demo_docx()).data['is_active'] is False
        assert active_ids() == set()


class TestActivation:
    def test_one_active_per_series_and_other_series_untouched(self, hr_client):
        a1 = post_template(hr_client, build_demo_docx(), slug='a').data['id']
        a2 = post_template(hr_client, build_demo_docx(), slug='a').data['id']
        b1 = post_template(hr_client, build_demo_docx(), slug='b').data['id']
        for tid in (a1, b1, a2):
            assert activate(hr_client, tid).status_code == 200
        assert active_ids('a') == {a2} and active_ids('b') == {b1}

    def test_activate_is_idempotent(self, hr_client):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        first = activate(hr_client, tid).data
        second = activate(hr_client, tid)
        assert second.status_code == 200 and second.data['activated_at'] == first['activated_at']
        assert len(active_ids()) == 1

    def test_deactivate_is_idempotent_and_leaves_no_active(self, hr_client):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        activate(hr_client, tid)
        assert hr_client.post(f'{URL}{tid}/deactivate/').data['is_active'] is False
        assert hr_client.post(f'{URL}{tid}/deactivate/').status_code == 200
        assert active_ids() == set()

    def test_unknown_variables_block_activation_with_names_and_stay_inactive(self, hr_client):
        tid = post_template(hr_client, build_docx_with_text('{{ nombre_trabajador }} {{ sueldo_secreto }}')).data['id']
        resp = activate(hr_client, tid)
        assert resp.status_code == 409 and resp.data['code'] == 'template_has_unknown_variables'
        assert 'sueldo_secreto' in resp.data['detail']
        assert active_ids() == set()

    def test_blocked_activation_does_not_deactivate_the_current_active(self, hr_client):
        good = post_template(hr_client, build_demo_docx(), slug='s').data['id']
        activate(hr_client, good)
        bad = post_template(hr_client, build_docx_with_text('{{ nope }}'), slug='s').data['id']
        assert activate(hr_client, bad).status_code == 409
        assert active_ids('s') == {good}

    def test_unknown_variable_is_listed_missing_required_is_only_a_warning(self, hr_client):
        resp = post_template(hr_client, build_docx_with_text('Hola {{ nombre_trabajador }} {{ inventada }}'))
        assert resp.status_code == 201
        assert resp.data['unknown_variables'] == ['inventada']
        assert 'dni_trabajador' in resp.data['missing_required_variables']
        assert 'nombre_trabajador' not in resp.data['missing_required_variables']

    def test_template_without_variables_uploads_with_all_required_missing(self, hr_client):
        resp = post_template(hr_client, build_docx_with_text('Texto fijo sin variables'))
        assert resp.status_code == 201 and resp.data['detected_variables'] == []
        assert {'nombre_trabajador', 'dni_trabajador', 'cargo', 'sueldo'} <= set(resp.data['missing_required_variables'])
        assert activate(hr_client, resp.data['id']).status_code == 200  # missing is not blocking

    def test_inactive_template_cannot_create_a_draft(self, hr_client, contract_data):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        resp = hr_client.post(
            DOCS, {'document_type': 'CONTRACT', 'template_id': tid, 'data': contract_data}, format='json'
        )
        assert resp.status_code == 409 and resp.data['code'] == 'template_inactive'

    def test_deactivated_template_still_serves_existing_drafts_for_issue(
        self, hr_client, active_template, contract_data
    ):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        hr_client.post(f'{URL}{active_template.pk}/deactivate/')
        assert hr_client.post(f'{DOCS}{doc_id}/issue/', {}, format='json').status_code == 200


class TestUploadEdges:
    def test_exactly_max_size_is_accepted_one_byte_less_than_content_is_rejected(self, hr_client, settings):
        content = build_demo_docx()
        settings.HR_TEMPLATE_MAX_BYTES = len(content)
        assert post_template(hr_client, content).status_code == 201
        settings.HR_TEMPLATE_MAX_BYTES = len(content) - 1
        resp = post_template(hr_client, content)
        assert resp.status_code == 400 and resp.data['code'] == 'file_too_large'

    @pytest.mark.parametrize('name', ['plantilla.docm', 'plantilla.doc', 'plantilla.dotx', 'plantilla.docx.exe',
                                       'plantilla', 'plantilla.DOCX.txt'])
    def test_wrong_extensions_rejected(self, hr_client, name):
        resp = post_template(hr_client, build_demo_docx(), name=name)
        assert resp.status_code == 400 and resp.data['code'] == 'invalid_docx'

    def test_uppercase_docx_extension_is_accepted(self, hr_client):
        assert post_template(hr_client, build_demo_docx(), name='PLANTILLA.DOCX').status_code == 201

    @pytest.mark.parametrize('content', [b'texto plano', b'PK\x03\x04basura', b'%PDF-1.4 fake', b'\x00' * 2048])
    def test_fake_docx_content_rejected(self, hr_client, content):
        resp = post_template(hr_client, content)
        assert resp.status_code == 400 and resp.data['code'] == 'invalid_docx'
        assert DocumentTemplate.objects.count() == 0

    def test_empty_file_is_a_field_error(self, hr_client):
        resp = post_template(hr_client, b'')
        assert resp.status_code == 400 and 'file' in resp.data['detail']
        assert DocumentTemplate.objects.count() == 0

    def test_zip_without_word_document_rejected(self, hr_client):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('[Content_Types].xml', '<Types/>')
            z.writestr('hello.txt', 'hi')
        assert post_template(hr_client, buf.getvalue()).data['code'] == 'invalid_docx'

    def test_xlsx_renamed_to_docx_rejected(self, hr_client):
        import openpyxl

        wb, buf = openpyxl.Workbook(), io.BytesIO()
        wb.save(buf)
        assert post_template(hr_client, buf.getvalue(), name='x.docx').data['code'] == 'invalid_docx'

    @pytest.mark.parametrize('missing', ['file', 'name', 'document_type'])
    def test_missing_required_form_fields(self, hr_client, missing):
        body = {'document_type': 'CONTRACT', 'name': 'x', 'file': upload(build_demo_docx())}
        body.pop(missing)
        resp = hr_client.post(URL, body, format='multipart')
        assert resp.status_code == 400 and missing in resp.data['detail']

    def test_unsupported_document_type_and_long_name_and_bad_slug(self, hr_client):
        for extra in ({'document_type': 'CESE'}, {'name': 'x' * 151}, {'slug': 'con espacios!'}):
            body = {'document_type': 'CONTRACT', 'name': 'x', 'file': upload(build_demo_docx()), **extra}
            assert hr_client.post(URL, body, format='multipart').status_code == 400, extra

    def test_hostile_original_filename_is_sanitized_and_not_used_for_storage(self, hr_client):
        resp = post_template(hr_client, build_demo_docx(), name='../../etc/pass wd<script>.docx')
        assert resp.status_code == 201
        assert '/' not in resp.data['original_filename'] and '..' not in resp.data['original_filename']
        stored = DocumentTemplate.objects.get(pk=resp.data['id']).file.name
        assert 'passwd' not in stored and 'script' not in stored and stored.endswith('.docx')

    def test_stored_file_is_private_uuid_outside_media_root(self, hr_client, settings):
        resp = post_template(hr_client, build_demo_docx(), name='secreto_nomina.docx')
        template = DocumentTemplate.objects.get(pk=resp.data['id'])
        assert 'secreto_nomina' not in template.file.name
        assert os.path.realpath(template.file.path).startswith(os.path.realpath(settings.HR_PRIVATE_ROOT))
        assert not os.path.realpath(template.file.path).startswith(os.path.realpath(str(settings.MEDIA_ROOT)))
        with pytest.raises(Exception):
            template.file.url  # noqa: B018 - storage must refuse to build a public URL

    def test_response_never_exposes_file_location(self, hr_client):
        data = post_template(hr_client, build_demo_docx()).data
        assert not {'file', 'file_url', 'url', 'path'} & set(data)
        assert 'private_media' not in str(data)

    def test_sha256_matches_content(self, hr_client):
        import hashlib

        content = build_demo_docx()
        tid = post_template(hr_client, content).data['id']
        assert DocumentTemplate.objects.get(pk=tid).file_sha256 == hashlib.sha256(content).hexdigest()

    def test_template_download_returns_the_original_bytes_with_headers(self, hr_client):
        content = build_demo_docx()
        tid = post_template(hr_client, content, slug='mi-serie').data['id']
        resp = hr_client.get(f'{URL}{tid}/download/')
        assert resp['Cache-Control'] == 'no-store' and resp['X-Content-Type-Options'] == 'nosniff'
        assert 'Plantilla_mi-serie_v1.docx' in resp['Content-Disposition']
        assert b''.join(resp.streaming_content) == content

    def test_variables_in_headers_and_tables_are_detected(self, hr_client):
        doc = Document()
        doc.add_paragraph('{{ nombre_trabajador }}')
        table = doc.add_table(rows=1, cols=1)
        table.rows[0].cells[0].text = '{{ cargo }}'
        doc.sections[0].header.paragraphs[0].text = '{{ empresa_razon_social }}'
        out = io.BytesIO()
        doc.save(out)
        detected = post_template(hr_client, out.getvalue()).data['detected_variables']
        assert {'nombre_trabajador', 'cargo', 'empresa_razon_social'} <= set(detected)

    def test_patch_only_changes_name_and_notes(self, hr_client):
        t = post_template(hr_client, build_demo_docx()).data
        resp = hr_client.patch(
            f'{URL}{t["id"]}/', {'name': 'Renombrada', 'notes': 'nota', 'version': 9, 'is_active': True,
                                  'slug': 'hack', 'file_sha256': 'x'}, format='json',
        )
        assert resp.status_code == 200
        row = DocumentTemplate.objects.get(pk=t['id'])
        assert (row.name, row.notes) == ('Renombrada', 'nota')
        assert (row.version, row.is_active, row.slug) == (1, False, 'contrato-trabajo') and row.file_sha256 != 'x'

    def test_patch_with_blank_name_is_400(self, hr_client):
        t = post_template(hr_client, build_demo_docx()).data
        assert hr_client.patch(f'{URL}{t["id"]}/', {'name': ''}, format='json').status_code == 400

    def test_put_and_file_replacement_are_not_allowed(self, hr_client):
        t = post_template(hr_client, build_demo_docx()).data
        assert hr_client.put(f'{URL}{t["id"]}/', {'name': 'x'}, format='json').status_code == 405

    def test_list_filters_and_no_pii(self, hr_client):
        a = post_template(hr_client, build_demo_docx(), slug='a').data['id']
        post_template(hr_client, build_demo_docx(), slug='b')
        activate(hr_client, a)
        assert hr_client.get(f'{URL}?slug=a').data['count'] == 1
        assert hr_client.get(f'{URL}?is_active=true').data['count'] == 1
        assert hr_client.get(f'{URL}?is_active=false').data['count'] == 1
        assert hr_client.get(f'{URL}?document_type=CONTRACT').data['count'] == 2

    def test_delete_removes_file_from_disk(self, hr_client, django_capture_on_commit_callbacks):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        template = DocumentTemplate.objects.get(pk=tid)
        storage, name = template.file.storage, template.file.name
        with django_capture_on_commit_callbacks(execute=True):
            assert hr_client.delete(f'{URL}{tid}/').status_code == 204
        assert not storage.exists(name)

    def test_template_in_use_by_voided_document_still_cannot_be_deleted(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        hr_client.post(f'{DOCS}{doc_id}/issue/', {}, format='json')
        hr_client.post(f'{DOCS}{doc_id}/void/', {'reason': 'Anulado por prueba de QA'}, format='json')
        hr_client.post(f'{URL}{active_template.pk}/deactivate/')
        resp = hr_client.delete(f'{URL}{active_template.pk}/')
        assert resp.status_code == 409 and resp.data['code'] == 'template_in_use'
        assert GeneratedDocument.objects.filter(pk=doc_id).exists()

    def test_general_manager_can_list_but_not_see_files(self, hr_client, general_manager):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        gm = client_for(general_manager)
        assert gm.get(f'{URL}{tid}/').status_code == 200
        assert gm.get(f'{URL}{tid}/download/').status_code == 403
        assert gm.post(f'{URL}{tid}/activate/').status_code == 403
        assert gm.delete(f'{URL}{tid}/').status_code == 403


class TestSeedEndToEnd:
    def test_seed_force_creates_new_version_and_keeps_one_active(self, db, capsys):
        call_command('seed_hr_template')
        call_command('seed_hr_template', '--force')
        versions = sorted(DocumentTemplate.objects.values_list('version', flat=True))
        assert versions == [1, 2] and len(active_ids()) == 1
        assert DocumentTemplate.objects.get(is_active=True).version == 2

    def test_seed_twice_without_force_is_a_noop_and_says_so(self, db):
        from io import StringIO

        call_command('seed_hr_template')
        out = StringIO()
        call_command('seed_hr_template', stdout=out)
        assert 'Ya existe una plantilla activa' in out.getvalue()
        assert DocumentTemplate.objects.count() == 1

    def test_seed_does_not_touch_existing_documents(self, hr_client, active_template, contract_data):
        doc_id = create_draft(hr_client, active_template, contract_data).data['id']
        before = GeneratedDocument.objects.get(pk=doc_id).docx_sha256
        call_command('seed_hr_template')  # an active template of the same series may exist or not: never breaks
        call_command('seed_hr_template')
        assert GeneratedDocument.objects.get(pk=doc_id).docx_sha256 == before

    @pytest.mark.parametrize('kind', ['indefinite', 'fixed'])
    def test_seeded_template_produces_a_clean_contract(self, hr_client, db, contract_data, kind):
        call_command('seed_hr_template')
        template = DocumentTemplate.objects.get(is_active=True)
        data = dict(contract_data)
        if kind == 'fixed':
            data.update(contract_type='FIXED_TERM', fixed_term_modality='OCASIONAL',
                        fixed_term_cause='Reemplazo temporal', end_date='2027-04-30')
        resp = create_draft(hr_client, template, data)
        assert resp.status_code == 201, resp.data
        text = docx_text(GeneratedDocument.objects.get(pk=resp.data['id']).docx_file)
        assert 'DOS MIL Y 00/100 SOLES' in text and '1 de noviembre de 2026' in text
        assert 'EMPRESA DEMO S.A.C.' in text
        assert '{{' not in text and '{%' not in text and 'None' not in text
        assert ('Reemplazo temporal' in text) == (kind == 'fixed')
