import pytest

from apps.hr.management.commands.seed_hr_template import build_demo_docx
from apps.hr.tests.conftest import client_for, make_zip, upload

pytestmark = pytest.mark.django_db
URL = '/api/v1/hr/templates/'


def post_template(client, content, name='plantilla.docx', **extra):
    return client.post(
        URL, {'document_type': 'CONTRACT', 'name': 'Mi plantilla', 'file': upload(content, name), **extra},
        format='multipart',
    )


def build_docx_with_text(text: str) -> bytes:
    import io
    from docx import Document

    d = Document()
    d.add_paragraph(text)
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


class TestUpload:
    def test_valid_upload_detects_variables_and_versions(self, hr_client):
        r1 = post_template(hr_client, build_demo_docx())
        assert r1.status_code == 201, r1.data
        assert r1.data['version'] == 1 and r1.data['is_active'] is False
        assert 'nombre_trabajador' in r1.data['detected_variables']
        assert r1.data['unknown_variables'] == []
        r2 = post_template(hr_client, build_demo_docx())
        assert r2.data['version'] == 2
        assert 'file' not in r1.data

    def test_unknown_variable_blocks_activation_not_upload(self, hr_client):
        resp = post_template(hr_client, build_docx_with_text('Hola {{ variable_inventada }} {{ nombre_trabajador }}'))
        assert resp.status_code == 201
        assert resp.data['unknown_variables'] == ['variable_inventada']
        act = hr_client.post(f"{URL}{resp.data['id']}/activate/")
        assert act.status_code == 409 and act.data['code'] == 'template_has_unknown_variables'

    def test_activation_keeps_one_active_per_series(self, hr_client):
        a = post_template(hr_client, build_demo_docx()).data['id']
        b = post_template(hr_client, build_demo_docx()).data['id']
        assert hr_client.post(f'{URL}{a}/activate/').status_code == 200
        assert hr_client.post(f'{URL}{b}/activate/').status_code == 200
        listing = hr_client.get(URL + '?is_active=true')
        assert [r['id'] for r in listing.data['results']] == [b]

    def test_rejects_non_docx(self, hr_client):
        for content, name in ((b'texto plano', 'a.docx'), (build_demo_docx(), 'a.doc'), (b'', 'a.docx')):
            resp = post_template(hr_client, content, name)
            assert resp.status_code == 400, name
            if content:
                assert resp.data['code'] == 'invalid_docx'

    def test_rejects_macros_and_external_links(self, hr_client):
        base = {'[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>'}
        macro = make_zip({**base, 'word/vbaProject.bin': 'x'})
        resp = post_template(hr_client, macro)
        assert resp.status_code == 400 and resp.data['code'] == 'macros_not_allowed'
        ext = make_zip({**base, 'word/_rels/document.xml.rels':
                        '<Relationships><Relationship TargetMode="External" Target="http://evil"/></Relationships>'})
        resp = post_template(hr_client, ext)
        assert resp.status_code == 400 and resp.data['code'] == 'external_links_not_allowed'

    def test_rejects_zip_bomb(self, hr_client):
        bomb = make_zip({'[Content_Types].xml': '<Types/>', 'word/document.xml': 'A' * (20 * 1024 * 1024)})
        resp = post_template(hr_client, bomb)
        assert resp.status_code == 400 and resp.data['code'] == 'invalid_docx'

    def test_rejects_too_large(self, hr_client, settings):
        settings.HR_TEMPLATE_MAX_BYTES = 100
        resp = post_template(hr_client, build_demo_docx())
        assert resp.status_code == 400 and resp.data['code'] == 'file_too_large'

    def test_syntax_error(self, hr_client):
        resp = post_template(hr_client, build_docx_with_text('{% if %} roto {{ nombre_trabajador }}'))
        assert resp.status_code == 400 and resp.data['code'] == 'template_syntax_error'

    def test_sandbox_blocks_ssti(self, hr_client):
        resp = post_template(hr_client, build_docx_with_text("{{ ''.__class__.__mro__[1].__subclasses__() }}"))
        assert resp.status_code == 400

    def test_only_manager_can_upload_and_download(self, general_manager, hr_client):
        tid = post_template(hr_client, build_demo_docx()).data['id']
        gm = client_for(general_manager)
        assert gm.get(URL).status_code == 200
        assert gm.get(f'{URL}{tid}/download/').status_code == 403
        assert post_template(gm, build_demo_docx()).status_code == 403
        assert hr_client.get(f'{URL}{tid}/download/').status_code == 200

    def test_delete_rules(self, hr_client, active_template, contract_data):
        assert hr_client.delete(f'{URL}{active_template.pk}/').data['code'] == 'template_active'
        hr_client.post(
            '/api/v1/hr/documents/',
            {'document_type': 'CONTRACT', 'template_id': active_template.pk, 'data': contract_data}, format='json',
        )
        hr_client.post(f'{URL}{active_template.pk}/deactivate/')
        assert hr_client.delete(f'{URL}{active_template.pk}/').data['code'] == 'template_in_use'
        free = post_template(hr_client, build_demo_docx()).data['id']
        assert hr_client.delete(f'{URL}{free}/').status_code == 204


class TestSeedCommand:
    def test_seed_is_idempotent_and_activates(self, db):
        from django.core.management import call_command

        from apps.hr.models import DocumentTemplate

        call_command('seed_hr_template')
        call_command('seed_hr_template')
        assert DocumentTemplate.objects.count() == 1
        t = DocumentTemplate.objects.get()
        assert t.is_active and t.unknown_variables == [] and t.missing_required_variables == []
