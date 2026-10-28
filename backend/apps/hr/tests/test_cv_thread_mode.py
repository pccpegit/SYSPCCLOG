"""End-to-end in 'thread' mode (demo): the request returns immediately and an
in-process pool finishes the work, with progress living in the DB (SYSPCC-023)."""

import time

import anthropic
import pytest

from apps.hr.enums import CVItemStatus
from apps.hr.models import CVAnalysisItem
from apps.hr.services import cv_dispatch
from apps.hr.tests.conftest import client_for
from apps.hr.tests.cv_helpers import FakeCVClient, make_pdf, upload

pytestmark = pytest.mark.django_db(transaction=True)

BASE = '/api/v1/hr/cv-analyses/'


def test_thread_mode_processes_in_background_and_progress_reports_it(cv_env, hr_manager, monkeypatch, settings):
    settings.HR_CV_DISPATCH = 'thread'
    settings.HR_CV_THREAD_WORKERS = 1  # SQLite test DB: concurrent writers would lock (Postgres in prod/demo)
    monkeypatch.setattr(cv_dispatch, '_executor', None)
    client = FakeCVClient()
    monkeypatch.setattr(anthropic, 'Anthropic', lambda **kw: client)
    api = client_for(hr_manager)
    a = api.post(BASE, {'name': 'Demo hilos'}, format='json').data['id']
    files = [upload(f'{i}.pdf', make_pdf(str(i))) for i in range(4)]
    resp = api.post(f'{BASE}{a}/items/', {'files': files}, format='multipart')
    assert resp.status_code == 200 and resp.data['counts']['accepted'] == 4
    started = time.time()
    deadline = started + 30
    redispatched = False
    while time.time() < deadline:
        pending = CVAnalysisItem.objects.filter(analysis_id=a).exclude(status=CVItemStatus.DONE)
        if not pending.exists():
            break
        # SQLite (shared cache) can raise "table is locked" in the pool thread while the request thread
        # is still reading; the job then leaves the item QUEUED (Postgres in prod/demo does not do this).
        # That is the documented recovery case, so redispatch once, as `resume`/the beat task would.
        if not redispatched and time.time() - started > 3:
            queued = list(pending.filter(status=CVItemStatus.QUEUED).values_list('pk', flat=True))
            if queued and not pending.filter(status=CVItemStatus.PROCESSING).exists():
                cv_dispatch.dispatch(queued)
                redispatched = True
        time.sleep(0.2)
    assert set(CVAnalysisItem.objects.filter(analysis_id=a).values_list('status', flat=True)) == {'DONE'}
    progress = api.get(f'{BASE}{a}/progress/').data
    assert progress['status'] == 'COMPLETED' and progress['percent'] == 100 and progress['counts']['done'] == 4
    cv_dispatch._executor.shutdown(wait=True)
