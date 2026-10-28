"""QA round 2 for the CV module (SYSPCC-023, iteration 2).

Covers what the review fixes of round 1 left without a test: cache failures in the extraction
ceilings (fail-open), the fake provider vs. ceilings, resume/cancel in the simulated mode,
storage errors in serializers and cleanup, read-only GENERAL_MANAGER on the download routes
and the lock rule with the simulated provider. No network."""

import datetime

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.hr.enums import CVItemStatus
from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_analysis_service, cv_posting_service as posting_svc
from apps.hr.tests.cv_helpers import POSTING_TEXT, api_error, make_docx, make_pdf, posting_response
from apps.hr.tests.conftest import client_for
from apps.hr.tests.test_cv_api import BASE, create, post_files
from apps.hr.tests.test_cv_posting import extract, post_posting

pytestmark = pytest.mark.django_db


@pytest.fixture
def analysis_id(hr_client):
    return create(hr_client).data['id']


def add_item(analysis_id, status, n=1, **extra):
    return CVAnalysisItem.objects.create(
        analysis_id=analysis_id, position=n, original_name=f'{n}.pdf', file=f'hr/cv/{n}.pdf', size_bytes=1,
        sha256=f'{n:064d}', kind='PDF', status=status, **extra)


def boom(*args, **kwargs):
    raise ConnectionError('redis down')


# ------------------------------------------------ cache failures in the ceilings (fail-open)

class TestCeilingsFailOpen:
    @pytest.fixture
    def ai(self, fake_cv_client):
        return fake_cv_client

    def test_daily_counter_failure_does_not_block_an_ai_read(self, ai, hr_client, analysis_id, monkeypatch, logs):
        ai.script = [posting_response(ai)]
        monkeypatch.setattr(cache, 'incr', boom)
        resp = extract(hr_client, analysis_id, {'text': POSTING_TEXT + '\n' + 'Experiencia en obras civiles. ' * 10})
        assert resp.status_code == 200 and resp.data['source'] == 'ai'
        assert 'extract_quota_unavailable error_type=ConnectionError' in logs.text
        assert 'redis down' not in logs.text

    def test_unlock_failure_is_logged_without_the_message_and_does_not_fail_the_read(
            self, hr_client, analysis_id, monkeypatch, logs):
        monkeypatch.setattr(cache, 'delete', boom)
        resp = extract(hr_client, analysis_id, {'text': POSTING_TEXT})
        assert resp.status_code == 200
        assert 'extract_unlock_failed error_type=ConnectionError' in logs.text

    def test_lock_unavailable_is_logged_by_type_only(self, hr_client, analysis_id, monkeypatch, logs):
        monkeypatch.setattr(cache, 'add', boom)
        assert extract(hr_client, analysis_id, {'text': POSTING_TEXT}).status_code == 200
        assert 'extract_lock_unavailable error_type=ConnectionError' in logs.text

    def test_without_a_user_there_is_no_lock_and_no_daily_quota(self, analysis_id):
        assert posting_svc._acquire_extract_lock(None) is None
        posting_svc._release_extract_lock(None)  # no-op
        analysis = CVAnalysis.objects.get(pk=analysis_id)
        posting_svc._check_ai_budget(analysis, None)  # no raise

    def test_daily_limit_zero_disables_the_daily_ceiling(self, ai, hr_client, analysis_id, settings):
        settings.HR_CV_POSTING_DAILY_LIMIT_PER_USER = 0
        long_text = POSTING_TEXT + '\n' + 'Experiencia en obras civiles y supervisión. ' * 10
        for _ in range(3):
            ai.script = [posting_response(ai)]
            assert extract(hr_client, analysis_id, {'text': long_text}).status_code == 200

    def test_a_failed_ai_read_does_not_leave_the_user_locked(self, ai, hr_client, hr_manager, analysis_id):
        import anthropic

        ai.script = [api_error(anthropic.InternalServerError, 500), api_error(anthropic.InternalServerError, 500)]
        long_text = POSTING_TEXT + '\n' + 'Experiencia en obras civiles y supervisión. ' * 10
        extract(hr_client, analysis_id, {'text': long_text})  # falls back to text or 502; either way
        assert cache.get(f'hr:cv:posting_extract:{hr_manager.pk}') is None
        assert extract(hr_client, analysis_id, {'text': POSTING_TEXT}).status_code in (200, 502)


# ------------------------------------------------ the simulated provider is outside the ceilings

class TestSimulatedProviderCeilings:
    def test_fake_extraction_ignores_cost_and_daily_ceilings(self, fake_provider, hr_client, analysis_id):
        fake_provider.HR_CV_POSTING_MAX_COST_USD = '0'
        fake_provider.HR_CV_POSTING_DAILY_LIMIT_PER_USER = 1
        for _ in range(3):
            resp = extract(hr_client, analysis_id, {'text': POSTING_TEXT})
            assert resp.status_code == 200 and resp.data['source'] == 'fake'

    def test_fake_extraction_lock_still_applies(self, fake_provider, hr_client, hr_manager, analysis_id):
        cache.add(f'hr:cv:posting_extract:{hr_manager.pk}', 1, 90)
        resp = extract(hr_client, analysis_id, {'text': POSTING_TEXT})
        assert resp.status_code == 429 and resp.data['code'] == 'extraction_in_progress'

    def test_fake_mode_locks_requirements_while_cvs_are_queued(self, fake_provider, hr_client, analysis_id):
        add_item(analysis_id, CVItemStatus.QUEUED)
        resp = hr_client.patch(f'{BASE}{analysis_id}/', {'requirements_text': 'AutoCAD'}, format='json')
        assert resp.status_code == 409 and resp.data['code'] == 'requirements_locked'
        assert 'Espera a que terminen' in resp.data['detail']


# ------------------------------------------------ resume / cancel / retry in the simulated mode

class TestResumeAndCancelWithoutKey:
    def stalled(self, analysis_id, n=1):
        old = timezone.now() - datetime.timedelta(hours=2)
        return add_item(analysis_id, CVItemStatus.QUEUED, n=n, enqueued_at=old)

    def test_resume_works_without_a_key_in_simulated_mode(self, fake_provider, hr_client, analysis_id,
                                                          django_capture_on_commit_callbacks):
        item = self.stalled(analysis_id)
        with django_capture_on_commit_callbacks(execute=True):
            resp = hr_client.post(f'{BASE}{analysis_id}/resume/')
        assert resp.status_code == 202 and resp.data == {'redispatched': 1}
        item.refresh_from_db()
        assert item.status in (CVItemStatus.DONE, CVItemStatus.FAILED)  # inline dispatch ran it

    def test_resume_twice_is_idempotent(self, fake_cv_client, hr_client, analysis_id):
        # dispatch is replaced by a counter: a re-dispatched item is no longer "stale" afterwards
        self.stalled(analysis_id)
        first = hr_client.post(f'{BASE}{analysis_id}/resume/')
        second = hr_client.post(f'{BASE}{analysis_id}/resume/')
        assert first.data['redispatched'] == 1
        assert second.data == {'redispatched': 0}

    def test_resume_without_a_key_and_without_fake_is_503(self, hr_client, analysis_id, settings):
        settings.ANTHROPIC_API_KEY = ''
        self.stalled(analysis_id)
        resp = hr_client.post(f'{BASE}{analysis_id}/resume/')
        assert resp.status_code == 503 and resp.data['code'] == 'analysis_unavailable'

    def test_cancel_only_touches_queued_items_and_is_repeatable(self, fake_cv_client, hr_client, analysis_id):
        add_item(analysis_id, CVItemStatus.QUEUED, n=1)
        add_item(analysis_id, CVItemStatus.PROCESSING, n=2)
        add_item(analysis_id, CVItemStatus.DONE, n=3, score=50)
        assert hr_client.post(f'{BASE}{analysis_id}/cancel/').data == {'cancelled': 1}
        assert hr_client.post(f'{BASE}{analysis_id}/cancel/').data == {'cancelled': 0}
        statuses = sorted(CVAnalysisItem.objects.values_list('status', flat=True))
        assert statuses == ['CANCELLED', 'DONE', 'PROCESSING']

    def test_cancelled_items_can_be_retried_one_by_one(self, fake_cv_client, hr_client, analysis_id,
                                                       django_capture_on_commit_callbacks):
        item = add_item(analysis_id, CVItemStatus.CANCELLED, n=1)
        with django_capture_on_commit_callbacks(execute=True):
            resp = hr_client.post(f'{BASE}{analysis_id}/items/{item.pk}/retry/')
        assert resp.status_code == 202
        # a DONE item cannot be retried
        done = add_item(analysis_id, CVItemStatus.DONE, n=2, score=10)
        resp = hr_client.post(f'{BASE}{analysis_id}/items/{done.pk}/retry/')
        assert resp.status_code == 409 and resp.data['code'] == 'invalid_state'


# ------------------------------------------------ storage errors

class TestStorageErrors:
    def test_posting_file_available_false_when_storage_raises(self, hr_client, analysis_id, monkeypatch):
        assert post_posting(hr_client, analysis_id, data=make_docx(POSTING_TEXT)).status_code == 200
        from django.core.files.storage import FileSystemStorage

        def explode(self, name):
            raise OSError('disk')

        monkeypatch.setattr(FileSystemStorage, 'exists', explode)
        data = hr_client.get(f'{BASE}{analysis_id}/').data
        assert data['posting']['file_available'] is False

    def test_item_file_available_false_when_storage_raises(self, fake_cv_client, hr_client, analysis_id, monkeypatch,
                                                           django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            resp = post_files(hr_client, analysis_id, [('a.pdf', make_pdf('a'))])
        item_id = resp.data['accepted'][0]['id']
        from django.core.files.storage import FileSystemStorage

        def explode(self, name):
            raise OSError('disk')

        monkeypatch.setattr(FileSystemStorage, 'exists', explode)
        data = hr_client.get(f'{BASE}{analysis_id}/items/{item_id}/').data
        assert data['file_available'] is False

    def test_delete_names_logs_the_error_type_and_keeps_going(self, monkeypatch, logs):
        deleted = []

        class Storage:
            def delete(self, name):
                if name == 'bad':
                    raise OSError('/secret/path/with/name.pdf')
                deleted.append(name)

        monkeypatch.setattr(cv_analysis_service, 'get_private_storage', lambda: Storage())
        monkeypatch.setattr(posting_svc, 'get_private_storage', lambda: Storage())
        cv_analysis_service._delete_names(['bad', '', None, 'ok1'])
        posting_svc._delete_names(['bad', 'ok2'])
        assert deleted == ['ok1', 'ok2']
        assert 'file_delete_failed error_type=OSError' in logs.text
        assert '/secret/path' not in logs.text


# ------------------------------------------------ GENERAL_MANAGER is read-only on downloads too

class TestReadOnlyManagerDownloads:
    @pytest.fixture
    def done(self, fake_cv_client, hr_client, analysis_id, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            resp = post_files(hr_client, analysis_id, [('a.pdf', make_pdf('a'))])
        return resp.data['accepted'][0]['id']

    @pytest.mark.parametrize('suffix', ['download-zip/', 'download-xlsx/'])
    def test_general_manager_can_download_bulk_files(self, done, general_manager, analysis_id, suffix):
        resp = client_for(general_manager).get(f'{BASE}{analysis_id}/{suffix}')
        assert resp.status_code == 200
        assert 'no-store' in resp['Cache-Control']

    def test_general_manager_can_download_report_and_original(self, done, general_manager, analysis_id):
        gm = client_for(general_manager)
        report = gm.get(f'{BASE}{analysis_id}/items/{done}/report/')
        original = gm.get(f'{BASE}{analysis_id}/items/{done}/file/')
        assert report.status_code == 200 and original.status_code == 200
        assert 'attachment' in report['Content-Disposition']
        assert 'attachment' in original['Content-Disposition']

    def test_requester_cannot_download(self, done, requester, analysis_id):
        client = client_for(requester)
        for suffix in ('download-zip/', 'download-xlsx/', f'items/{done}/report/', f'items/{done}/file/'):
            assert client.get(f'{BASE}{analysis_id}/{suffix}').status_code == 403

    def test_downloads_are_409_when_nothing_is_done(self, fake_cv_client, hr_client, analysis_id):
        add_item(analysis_id, CVItemStatus.FAILED, error_code='ai_failed')
        for suffix in ('download-zip/', 'download-xlsx/'):
            resp = hr_client.get(f'{BASE}{analysis_id}/{suffix}')
            assert resp.status_code == 409 and resp.data['code'] == 'nothing_to_download'

    def test_report_of_a_failed_item_is_409(self, fake_cv_client, hr_client, analysis_id):
        item = add_item(analysis_id, CVItemStatus.FAILED, error_code='ai_failed')
        resp = hr_client.get(f'{BASE}{analysis_id}/items/{item.pk}/report/')
        assert resp.status_code == 409 and resp.data['code'] == 'invalid_state'
