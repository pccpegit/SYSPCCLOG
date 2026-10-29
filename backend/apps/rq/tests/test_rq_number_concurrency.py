"""
SYSPCC-031: numbering under REAL concurrency (threads, one connection each).

`SELECT ... FOR UPDATE ... LIMIT 1` on the latest RQ does not serialize the generator: every
caller locks the same current row and, once it is released, computes the same "next" number,
so all but one collided on the unique constraint (4 simultaneous sends gave 3 errors). The
generator now takes a transaction-scoped advisory lock. Like `test_dispatch_concurrency.py`,
this only runs on PostgreSQL (SQLite has a single writer).
"""
import datetime
import threading

import pytest
from django.db import connection, connections
from rest_framework.test import APIClient

from apps.rq.models import Request
from apps.rq.services.request_submission import PROVISIONAL_PREFIX, submit_draft
from apps.rq.tests.catalog_fixtures import make_item, make_request

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(
        connection.vendor != 'postgresql',
        reason='La carrera de numeración solo es real en PostgreSQL.',
    ),
]

THREADS = 4


def _run_in_threads(callables):
    results = [None] * len(callables)
    barrier = threading.Barrier(len(callables))

    def worker(index, fn):
        try:
            barrier.wait(timeout=10)
            results[index] = fn()
        except Exception as exc:  # noqa: BLE001 - the test inspects the exception
            results[index] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i, fn)) for i, fn in enumerate(callables)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    return results


def _ready_draft(n, requester, project):
    rq = make_request(number=f'{PROVISIONAL_PREFIX}CONC{n:08d}', requester=requester, project=project, status='DRAFT')
    Request.objects.filter(pk=rq.pk).update(requesting_area='OP', front_area='Frente 1', service='Servicio')
    make_item(rq, 1, quantity=3, is_off_catalog=True, item_source='EPP')
    return rq.pk


def _sequence(numbers):
    return sorted(int(number[-4:]) for number in numbers)


def test_four_simultaneous_draft_sends_all_succeed_with_unique_consecutive_numbers(requester, project):
    ids = [_ready_draft(n, requester, project) for n in range(THREADS)]

    results = _run_in_threads([
        lambda pk=pk: submit_draft(Request.objects.get(pk=pk), requester) for pk in ids
    ])

    assert not [r for r in results if isinstance(r, Exception)], results
    numbers = list(Request.objects.filter(pk__in=ids).values_list('rq_number', flat=True))
    year = datetime.date.today().year
    assert all(number.startswith(f'RQ-{year}-') for number in numbers), numbers
    assert _sequence(numbers) == list(range(1, THREADS + 1))
    assert set(Request.objects.filter(pk__in=ids).values_list('status', flat=True)) == {'SUBMITTED'}


def test_four_simultaneous_direct_creations_all_succeed_with_unique_consecutive_numbers(requester, project):
    payload = {
        'flow': 'OPERATIONS', 'project': project.pk, 'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL', 'fecha_necesidad': '2026-12-31',
        'items': [{'line_number': 1, 'description': 'Casco', 'quantity': '1', 'unit': 'UND',
                   'item_source': 'EPP', 'is_off_catalog': True}],
    }

    def create():
        client = APIClient()
        client.force_authenticate(user=requester)
        return client.post('/api/v1/requests/', payload, format='json')

    results = _run_in_threads([create] * THREADS)

    assert not [r for r in results if isinstance(r, Exception)], results
    assert [r.status_code for r in results] == [201] * THREADS, [getattr(r, 'data', r) for r in results]
    assert _sequence(r.data['rq_number'] for r in results) == list(range(1, THREADS + 1))
