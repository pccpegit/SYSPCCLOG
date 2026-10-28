"""QA gap-fillers for the CV analysis module (SYSPCC-023, iteration 2, QA round 1).

Covers the error branches that the feature suites leave out: hostile files on
the validation / text-extraction edge, pipeline last-barrier branches (soft
timeout, undecodable stored files, report best-effort), dispatcher swallow
paths, upload race, progress contract added in iteration 2 and a few
read-only / IDOR checks. No test touches the network."""

import io
import logging
from types import SimpleNamespace

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from apps.hr.enums import CVItemStatus
from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_analysis_service as svc
from apps.hr.services import cv_dispatch, cv_service, cv_text
from apps.hr.services.cv_dispatch import RetryLater
from apps.hr.services.cv_file_validation import CVFileRejected, validate_cv_upload
from apps.hr.storage import get_private_storage
from apps.hr.tests.conftest import client_for
from apps.hr.tests.cv_helpers import (
    FakeCVClient,
    default_report,
    make_docx,
    make_encrypted_pdf,
    make_pdf,
    make_png,
    upload,
)
from apps.hr.tests.test_cv_api import BASE, create, post_files

pytestmark = pytest.mark.django_db


def seed(user, files, requirements=''):
    analysis = svc.create_analysis(user=user, name='Proceso QA', requirements_text=requirements)
    result = svc.upload_files(analysis=analysis, user=user, files=[upload(n, d) for n, d in files])
    return analysis, [a['id'] for a in result['accepted']]


def overwrite_stored_file(item_pk, data: bytes):
    item = CVAnalysisItem.objects.get(pk=item_pk)
    with open(item.file.path, 'wb') as fh:
        fh.write(data)


def stored(prefix):
    storage = get_private_storage()
    try:
        _d, files = storage.listdir(prefix)
    except (FileNotFoundError, OSError):
        return []
    return sorted(files)


# ======================================================== file validation edge

class TestValidationEdge:
    def test_declared_size_that_lies_is_still_capped_while_streaming(self):
        class LyingFile(io.BytesIO):
            size = 10  # declared small, real content is bigger
            name = 'cv.pdf'

        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(LyingFile(make_pdf() * 5), max_bytes=500)
        assert exc.value.code == 'file_too_large'

    def test_pixel_bomb_is_rejected_before_decoding(self, settings):
        settings.HR_CV_MAX_IMAGE_PIXELS = 100
        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(upload('foto.png', make_png((50, 50))))
        assert exc.value.code == 'image_invalid' and 'píxeles' in exc.value.detail

    def test_truncated_image_is_rejected_as_invalid(self):
        broken = make_png((200, 200))[:60] + b'\x00' * 40  # valid signature, garbage body
        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(upload('foto.png', broken))
        assert exc.value.code == 'image_invalid'

    def test_pdf_without_pages_is_corrupt(self):
        from pypdf import PdfWriter

        out = io.BytesIO()
        PdfWriter().write(out)
        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(upload('vacio.pdf', out.getvalue()))
        assert exc.value.code == 'pdf_corrupt'

    def test_encrypted_pdf_asks_to_remove_the_password(self):
        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(upload('clave.pdf', make_encrypted_pdf()))
        assert exc.value.code == 'pdf_encrypted' and 'contraseña' in exc.value.detail

    def test_ctrl_c_is_never_swallowed_by_the_hostile_pdf_guard(self, monkeypatch):
        import pypdf

        def interrupted(*a, **k):
            raise KeyboardInterrupt

        monkeypatch.setattr(pypdf, 'PdfReader', interrupted)
        with pytest.raises(KeyboardInterrupt):
            validate_cv_upload(upload('cv.pdf', make_pdf()))

    def test_extension_is_ignored_an_exe_renamed_to_pdf_is_unsupported(self):
        with pytest.raises(CVFileRejected) as exc:
            validate_cv_upload(upload('cv.pdf', b'MZ\x90\x00' + b'\x00' * 200))
        assert exc.value.code == 'unsupported_type'


# ================================================================= cv_text

class TestCvTextEdge:
    def test_encrypted_pdf_yields_no_text(self):
        assert cv_text.pdf_text(make_encrypted_pdf(), 5, 1000) == ''

    def test_a_page_that_cannot_be_read_is_skipped_not_fatal(self, monkeypatch):
        import pypdf

        good = SimpleNamespace(extract_text=lambda: 'Texto bueno de la página dos')

        def bad_extract():
            raise RecursionError

        reader = SimpleNamespace(is_encrypted=False, pages=[SimpleNamespace(extract_text=bad_extract), good])
        monkeypatch.setattr(pypdf, 'PdfReader', lambda *a, **k: reader)
        assert cv_text.pdf_text(b'%PDF', 5, 1000) == 'Texto bueno de la página dos'

    def test_text_is_cut_at_max_chars_and_stops_reading_pages(self):
        text = cv_text.pdf_text(make_pdf('x' * 80, pages=6), 6, 100)
        assert 0 < len(text) <= 100

    def test_garbage_bytes_yield_empty_string(self):
        assert cv_text.pdf_text(b'not a pdf at all', 5, 100) == ''

    def test_rgba_and_palette_images_are_flattened_to_jpeg(self):
        from PIL import Image

        for mode in ('RGBA', 'P'):
            out = io.BytesIO()
            Image.new(mode, (30, 30)).save(out, format='PNG')
            b64 = cv_text.image_b64(out.getvalue())
            assert isinstance(b64, str) and b64


# ============================================================= pipeline edge

@pytest.fixture
def one_pdf(cv_env, hr_manager):
    analysis, ids = seed(hr_manager, [('ana_perez.pdf', make_pdf())], 'Ingeniero civil (obligatorio)\nAutoCAD')
    return analysis, ids[0]


class TestPipelineEdge:
    def test_undecodable_stored_image_fails_as_unreadable_without_calling_the_ai(self, cv_env, hr_manager):
        _a, ids = seed(hr_manager, [('foto.png', make_png())])
        overwrite_stored_file(ids[0], b'definitely not an image')
        client = FakeCVClient()
        cv_service.run_item(ids[0], client=client)
        item = CVAnalysisItem.objects.get(pk=ids[0])
        assert item.status == CVItemStatus.FAILED and item.error_code == 'cv_unreadable'
        assert client.calls == [] and item.error_message

    def test_undecodable_stored_docx_fails_as_unreadable(self, cv_env, hr_manager):
        _a, ids = seed(hr_manager, [('cv.docx', make_docx())])
        overwrite_stored_file(ids[0], b'PK\x03\x04 broken zip')
        client = FakeCVClient()
        cv_service.run_item(ids[0], client=client)
        item = CVAnalysisItem.objects.get(pk=ids[0])
        assert item.status == CVItemStatus.FAILED and item.error_code == 'cv_unreadable' and client.calls == []

    def test_soft_timeout_requeues_while_attempts_remain(self, one_pdf, monkeypatch):
        _a, pk = one_pdf

        def timeout(self, *a, **k):
            raise SoftTimeLimitExceeded()

        monkeypatch.setattr(cv_service.CVAgent, 'analyze', timeout)
        with pytest.raises(RetryLater):
            cv_service.run_item(pk, client=FakeCVClient())
        item = CVAnalysisItem.objects.get(pk=pk)
        assert item.status == CVItemStatus.QUEUED and item.locked_at is None and item.attempts == 1

    def test_soft_timeout_with_attempts_exhausted_fails_cleanly(self, one_pdf, monkeypatch, settings):
        _a, pk = one_pdf
        settings.HR_CV_MAX_ATTEMPTS = 1

        def timeout(self, *a, **k):
            raise SoftTimeLimitExceeded()

        monkeypatch.setattr(cv_service.CVAgent, 'analyze', timeout)
        cv_service.run_item(pk, client=FakeCVClient())
        item = CVAnalysisItem.objects.get(pk=pk)
        assert item.status == CVItemStatus.FAILED and item.error_code == 'ai_failed'
        assert item.locked_at is None and item.finished_at

    def test_a_failing_report_render_keeps_the_item_done_and_logs_type_only(self, one_pdf, monkeypatch, logs):
        from apps.hr.services import cv_report_pdf

        def boom(item):
            raise RuntimeError('Ana Pérez Gómez 12345678')

        monkeypatch.setattr(cv_report_pdf, 'build', boom)
        _a, pk = one_pdf
        cv_service.run_item(pk, client=FakeCVClient())
        item = CVAnalysisItem.objects.get(pk=pk)
        assert item.status == CVItemStatus.DONE and not item.report_pdf
        assert 'report_failed' in logs.text and 'RuntimeError' in logs.text
        assert 'Ana Pérez' not in logs.text and '12345678' not in logs.text

    def test_the_report_is_generated_on_demand_when_it_was_not_stored(self, one_pdf, monkeypatch, hr_client):
        from apps.hr.services import cv_report_pdf

        real_build = cv_report_pdf.build
        monkeypatch.setattr(cv_report_pdf, 'build', lambda item: (_ for _ in ()).throw(RuntimeError('x')))
        analysis, pk = one_pdf
        cv_service.run_item(pk, client=FakeCVClient())
        monkeypatch.setattr(cv_report_pdf, 'build', real_build)
        resp = hr_client.get(f'{BASE}{analysis.pk}/items/{pk}/report/')
        assert resp.status_code == 200 and resp.getvalue().startswith(b'%PDF')

    def test_store_report_ignores_missing_and_not_done_items(self, one_pdf):
        _a, pk = one_pdf
        assert cv_service.store_report(999999) is False
        assert cv_service.store_report(pk) is False  # still QUEUED

    def test_report_of_an_item_deleted_meanwhile_leaves_no_orphan_file(self, one_pdf, monkeypatch):
        from apps.hr.services import cv_report_pdf

        _a, pk = one_pdf
        cv_service.run_item(pk, client=FakeCVClient())
        CVAnalysisItem.objects.filter(pk=pk).update(report_pdf='')
        before = stored('hr/cv/reports')

        real_build = cv_report_pdf.build

        def build_then_delete(item):
            data = real_build(item)
            CVAnalysisItem.objects.filter(pk=item.pk).delete()  # user deleted the CV mid-render
            return data

        monkeypatch.setattr(cv_report_pdf, 'build', build_then_delete)
        assert cv_service.store_report(pk) is False
        assert stored('hr/cv/reports') == before  # the freshly saved PDF was removed

    def test_persist_keeps_tokens_of_a_refused_cv(self, one_pdf):
        _a, pk = one_pdf
        client = FakeCVClient([FakeCVClient().response(None, stop_reason='refusal', tokens=(700, 40))])
        cv_service.run_item(pk, client=client)
        item = CVAnalysisItem.objects.get(pk=pk)
        assert item.status == CVItemStatus.FAILED and item.error_code == 'ai_refusal'
        assert (item.tokens_in, item.tokens_out) == (700, 40) and item.cost_usd > 0


# ============================================================ dispatcher edge

class TestDispatchEdge:
    def test_thread_job_never_kills_the_pool_thread_and_logs_type_only(self, monkeypatch, logs):
        closed = []

        def boom(pk, client=None):
            raise ValueError('Juan Perez 99999999')

        monkeypatch.setattr(cv_service, 'run_item', boom)
        monkeypatch.setattr(cv_dispatch.connection, 'close', lambda: closed.append(1))
        cv_dispatch._thread_job(7, len(cv_dispatch.THREAD_RETRY_DELAYS))  # retries exhausted; must not raise
        assert closed == [1]
        assert 'thread_job_failed' in logs.text and 'ValueError' in logs.text
        assert 'Juan' not in logs.text and '99999999' not in logs.text

    def test_inline_mode_swallows_retry_later_leaving_the_item_queued(self, settings, one_pdf, monkeypatch):
        settings.HR_CV_DISPATCH = 'inline'
        _a, pk = one_pdf
        monkeypatch.setattr(cv_service.CVAgent, 'analyze', lambda self, *a, **k: (_ for _ in ()).throw(
            SoftTimeLimitExceeded()))
        cv_dispatch.dispatch([pk])  # RetryLater must not escape
        assert CVAnalysisItem.objects.get(pk=pk).status == CVItemStatus.QUEUED

    def test_unknown_item_id_is_ignored(self, cv_env):
        cv_dispatch.dispatch([123456])  # claim finds nothing: no crash, no call


# ======================================================== upload race / limits

class TestUploadEdge:
    def test_integrity_error_race_is_reported_as_duplicate_and_cleans_its_file(self, cv_env, hr_manager, monkeypatch):
        analysis = svc.create_analysis(user=hr_manager, name='Proceso QA', requirements_text='')
        real_validate = svc.validate_cv_upload
        winner = {}

        def racing_validate(uploaded):
            valid = real_validate(uploaded)
            # another request inserts the same CV between our check and our INSERT
            winner['id'] = CVAnalysisItem.objects.create(
                analysis=analysis, position=1, original_name='ganador.pdf', file='hr/cv/ganador.pdf',
                size_bytes=valid.size, sha256=valid.sha256, kind='PDF', status='QUEUED').pk
            return valid

        monkeypatch.setattr(svc, 'validate_cv_upload', racing_validate)
        before = stored('hr/cv')
        result = svc.upload_files(analysis=analysis, user=hr_manager, files=[upload('otra.pdf', make_pdf('uno'))])
        assert result['counts'] == {'accepted': 0, 'duplicates': 1, 'rejected': 0}
        assert result['duplicates'][0]['duplicate_of'] == winner['id']
        assert CVAnalysisItem.objects.filter(analysis=analysis).count() == 1
        assert stored('hr/cv') == before  # the speculative file was removed

    def test_unexpected_save_error_cleans_the_stored_file_and_propagates(self, cv_env, hr_manager, monkeypatch):
        analysis = svc.create_analysis(user=hr_manager, name='Proceso QA', requirements_text='')
        before = stored('hr/cv')

        def boom(self, *a, **k):
            raise RuntimeError('db down')

        monkeypatch.setattr(CVAnalysisItem, 'save', boom)
        with pytest.raises(RuntimeError):
            svc.upload_files(analysis=analysis, user=hr_manager, files=[upload('uno.pdf', make_pdf())])
        assert stored('hr/cv') == before

    def test_duplicates_inside_the_same_batch_are_reported_once(self, cv_env, hr_client):
        a = create(hr_client).data['id']
        same = make_pdf('igual')
        resp = post_files(hr_client, a, [('a.pdf', same), ('b.pdf', same), ('c.pdf', make_pdf('otro'))])
        assert resp.data['counts'] == {'accepted': 2, 'duplicates': 1, 'rejected': 0}
        assert resp.data['duplicates'][0]['original_name'] == 'b.pdf'

    def test_a_mixed_batch_never_aborts(self, cv_env, hr_client):
        a = create(hr_client).data['id']
        resp = post_files(hr_client, a, [
            ('ok.pdf', make_pdf('ok')), ('virus.pdf', b'MZ' + b'\x00' * 100), ('vacio.pdf', b''),
            ('clave.pdf', make_encrypted_pdf()), ('viejo.doc', b'\xd0\xcf\x11\xe0' + b'\x00' * 100)])
        assert resp.status_code == 200
        codes = sorted(r['code'] for r in resp.data['rejected'])
        assert resp.data['counts']['accepted'] == 1
        assert codes == ['file_empty', 'pdf_encrypted', 'unsupported_type', 'unsupported_type']
        assert all(r['detail'] for r in resp.data['rejected'])

    def test_retention_purge_with_zero_days_is_a_noop(self, cv_env, hr_manager):
        svc.create_analysis(user=hr_manager, name='Proceso QA', requirements_text='')
        assert svc.purge_expired(0) == 0 and CVAnalysis.objects.count() == 1


# ========================================================= API contract extras

class TestApiContractExtras:
    def test_progress_exposes_recommendation_and_injection_counts(self, cv_env, hr_manager, hr_client):
        analysis, ids = seed(hr_manager, [('a.pdf', make_pdf('a')), ('b.pdf', make_pdf('b')),
                                          ('c.pdf', make_pdf('c'))], 'Ingeniero civil\nAutoCAD')
        CVAnalysisItem.objects.filter(pk=ids[0]).update(status='DONE', recommendation='ADVANCE', score=90)
        CVAnalysisItem.objects.filter(pk=ids[1]).update(
            status='DONE', recommendation='REVIEW', score=60, injection_suspected=True)
        CVAnalysisItem.objects.filter(pk=ids[2]).update(status='FAILED', recommendation='')
        data = hr_client.get(f'{BASE}{analysis.pk}/progress/').data
        assert data['recommendations'] == {'advance': 1, 'review': 1, 'no_advance': 0}
        assert data['flagged'] == {'injection': 1}
        assert data['counts']['done'] == 2 and data['counts']['failed'] == 1

    def test_progress_ignores_non_done_items_in_recommendation_counts(self, cv_env, hr_manager, hr_client):
        analysis, ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        CVAnalysisItem.objects.filter(pk=ids[0]).update(recommendation='ADVANCE', injection_suspected=True)
        data = hr_client.get(f'{BASE}{analysis.pk}/progress/').data
        assert data['recommendations']['advance'] == 0 and data['flagged']['injection'] == 0

    def test_progress_includes_the_posting_cost_in_cost_usd(self, cv_env, hr_manager, hr_client):
        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        CVAnalysis.objects.filter(pk=analysis.pk).update(posting_cost_usd='0.0200')
        assert hr_client.get(f'{BASE}{analysis.pk}/progress/').data['cost_usd'] == pytest.approx(0.02)

    def test_progress_since_without_timezone_is_accepted(self, cv_env, hr_manager, hr_client):
        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        resp = hr_client.get(f'{BASE}{analysis.pk}/progress/?since=2020-01-01T00:00:00')
        assert resp.status_code == 200

    def test_items_ordering_by_unknown_field_falls_back_without_error(self, cv_env, hr_manager, hr_client):
        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        for ordering in ('password', '-result', 'analysis__created_by', ''):
            assert hr_client.get(f'{BASE}{analysis.pk}/items/', {'ordering': ordering}).status_code == 200

    def test_items_unknown_status_filter_is_ignored(self, cv_env, hr_manager, hr_client):
        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        resp = hr_client.get(f'{BASE}{analysis.pk}/items/', {'status': 'NOPE'})
        assert resp.status_code == 200 and resp.data['count'] == 1

    def test_item_of_another_analysis_is_404_for_every_item_route(self, cv_env, hr_manager, hr_client):
        a1, ids1 = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        a2 = svc.create_analysis(user=hr_manager, name='Otro', requirements_text='')
        CVAnalysisItem.objects.filter(pk=ids1[0]).update(status='FAILED', error_code='ai_failed')
        for method, path in (('get', ''), ('delete', ''), ('post', 'retry/'), ('get', 'report/'), ('get', 'file/')):
            resp = getattr(hr_client, method)(f'{BASE}{a2.pk}/items/{ids1[0]}/{path}')
            assert resp.status_code == 404, (method, path, resp.status_code)
        assert CVAnalysisItem.objects.filter(pk=ids1[0]).exists()

    def test_general_manager_reads_everything_and_changes_nothing(self, cv_env, hr_manager, general_manager):
        analysis, ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        CVAnalysisItem.objects.filter(pk=ids[0]).update(status='FAILED', error_code='ai_failed')
        gm = client_for(general_manager)
        a = analysis.pk
        for url in (f'{BASE}', f'{BASE}config/', f'{BASE}{a}/', f'{BASE}{a}/progress/', f'{BASE}{a}/items/',
                    f'{BASE}{a}/items/{ids[0]}/', f'{BASE}{a}/items/{ids[0]}/file/'):
            assert gm.get(url).status_code == 200, url
        writes = (
            ('post', BASE), ('patch', f'{BASE}{a}/'), ('delete', f'{BASE}{a}/'), ('post', f'{BASE}{a}/items/'),
            ('delete', f'{BASE}{a}/items/{ids[0]}/'), ('post', f'{BASE}{a}/items/{ids[0]}/retry/'),
            ('post', f'{BASE}{a}/retry-failed/'), ('post', f'{BASE}{a}/resume/'), ('post', f'{BASE}{a}/cancel/'),
            ('post', f'{BASE}{a}/posting/'), ('delete', f'{BASE}{a}/posting/'),
            ('post', f'{BASE}{a}/posting/extract/'))
        for method, url in writes:
            assert getattr(gm, method)(url).status_code == 403, (method, url)
        item = CVAnalysisItem.objects.get(pk=ids[0])
        assert item.status == 'FAILED' and CVAnalysis.objects.filter(pk=a).exists()

    def test_general_manager_can_download_but_not_when_nothing_is_done(self, cv_env, hr_manager, general_manager):
        analysis, ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        gm = client_for(general_manager)
        for kind in ('download-zip', 'download-xlsx'):
            resp = gm.get(f'{BASE}{analysis.pk}/{kind}/')
            assert resp.status_code == 409 and resp.data['code'] == 'nothing_to_download'
        CVAnalysisItem.objects.filter(pk=ids[0]).update(status='FAILED', error_code='ai_failed')
        assert gm.get(f'{BASE}{analysis.pk}/download-xlsx/').status_code == 409

    def test_anonymous_gets_401_on_posting_and_progress(self, cv_env, hr_manager):
        from rest_framework.test import APIClient

        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        anon = APIClient()
        for method, path in (('get', 'progress/'), ('get', 'posting/file/'), ('post', 'posting/extract/'),
                             ('post', 'posting/'), ('get', 'download-zip/')):
            assert getattr(anon, method)(f'{BASE}{analysis.pk}/{path}').status_code == 401, path

    def test_unauthenticated_and_denied_responses_use_the_uniform_envelope(self, cv_env, user):
        resp = client_for(user).get(BASE)
        assert resp.status_code == 403
        assert {'error', 'status_code', 'detail'} <= set(resp.data)

    def test_cache_control_is_no_store_on_new_endpoints(self, cv_env, hr_manager, hr_client):
        analysis, _ids = seed(hr_manager, [('a.pdf', make_pdf('a'))])
        for path in ('config/', f'{analysis.pk}/progress/', f'{analysis.pk}/'):
            assert 'no-store' in hr_client.get(BASE + path)['Cache-Control']

    def test_default_report_helper_matches_both_schema_variants(self):
        # Guards the shared test helper: the fake client must be able to build both variants.
        from apps.hr.services.cv_schemas import report_model

        assert default_report(report_model(False)).summary
        assert default_report(report_model(True)).evaluation is not None


def test_module_logger_is_quiet_about_filenames(cv_env, hr_manager, logs):
    logs.set_level(logging.DEBUG)
    seed(hr_manager, [('Juan_Perez_DNI_44556677.pdf', make_pdf('x'))])
    assert 'Juan_Perez' not in logs.text and '44556677' not in logs.text
