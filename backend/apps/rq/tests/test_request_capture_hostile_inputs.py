"""
SYSPCC-026 (Fase 1, QA ronda 2): hostile and unusual input on the capture endpoints, and
the read paths that must not grow a query per line.

  * catalog search: terms made only of combining marks, decomposed (NFD) accents,
    control characters inside a token, punctuation, very long and many-token terms.
    "An empty box must not dump the catalog" has to hold whatever the user types;
  * the RQ detail and list carry the product code/description of every line: the number
    of queries must not depend on the number of lines;
  * the 201 body of a creation carries the same shape as the detail of that RQ.
"""
import unicodedata

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.rq.throttling import RequestCatalogThrottle
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    client_for,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_stock,
    ops_rq,
)

CATALOG_URL = '/api/v1/request-catalog/'


@pytest.fixture(autouse=True)
def _relaxed_catalog_throttle(monkeypatch):
    """
    This module searches the catalog many times; it must not depend on the counters being
    empty (they are private to each test, see apps/rq/tests/conftest.py) nor on running
    before the module that exercises the 429.
    """
    monkeypatch.setitem(RequestCatalogThrottle.THROTTLE_RATES, 'rq_catalog', '100000/min')


def _search(user, term):
    return client_for(user).get(CATALOG_URL, {'search': term})


@pytest.fixture
def catalog(db):
    """Thirty products: enough to tell 'the whole catalog' apart from 'nothing'."""
    products = [make_inventory(f'EPP-{n:04d}', f'Protección número {n}') for n in range(30)]
    products.append(make_inventory('CAS-0001', 'Casco de seguridad blanco'))
    return products


@pytest.mark.django_db
class TestTermsThatAreShorterThanTheyLook:
    """`len(term) >= 2` is checked on the typed text, but the match runs on the text WITHOUT accents."""

    @pytest.mark.parametrize('term', [
        '́́',            # two combining acute accents
        '́ ́',           # the same, as two tokens
        '̀́̂',      # three different marks
    ])
    def test_a_term_of_only_combining_marks_does_not_dump_the_catalog(self, requester, catalog, term):
        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0
        assert response.data['results'] == []

    @pytest.mark.parametrize('term', [
        'á',            # precomposed (1 code point)
        'a\u0301',      # the same letter decomposed (2 code points)
        'ñ',
        'n\u0303',
    ])
    def test_one_accented_letter_is_below_the_minimum_however_it_was_typed(self, requester, catalog, term):
        """The minimum has to count what is searched, not how many code points the keyboard sent."""
        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0


@pytest.mark.django_db
class TestDecomposedAndOddText:
    def test_an_accent_typed_as_a_combining_mark_finds_the_precomposed_text(self, requester, catalog):
        decomposed = unicodedata.normalize('NFD', 'protección')
        assert decomposed != 'protección'  # really a different code point sequence

        response = _search(requester, decomposed)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 30

    @pytest.mark.xfail(
        strict=True,
        reason=(
            'KNOWN GAP (yellow): accent_insensitive_pattern() strips the accents of the TYPED text only. '
            'A description stored decomposed (n + U+0303, what some macOS-made spreadsheets produce) has the '
            'combining mark between the letters, so "senal"/"señal" never matches it. Fix: normalize stored '
            'text too (column or unaccent) or allow an optional combining mark after each letter. '
            'Remove the marker when fixed.'
        ),
    )
    def test_a_stored_decomposed_description_is_found_by_the_precomposed_term(self, requester, db):
        make_inventory('EPP-7777', unicodedata.normalize('NFD', 'Señal de advertencia'))

        response = _search(requester, 'señal')

        assert [row['product_code'] for row in response.data['results']] == ['EPP-7777']

    @pytest.mark.parametrize('term', ['\x00\x00', '\x07\x08', '​​', '  ', '\t\t', '\n\n'])
    def test_control_and_invisible_characters_are_not_a_search(self, requester, catalog, term):
        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0

    @pytest.mark.parametrize('term', ['..', '**', '((', '[[', '\\\\', '||', '^$', '%%', '__', '--'])
    def test_punctuation_is_matched_literally_never_as_a_pattern(self, requester, catalog, term):
        """A regex metacharacter pair would match everything if it reached the database as syntax."""
        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0

    def test_a_control_character_inside_a_word_splits_it_instead_of_truncating_the_query(
        self, requester, catalog,
    ):
        response = _search(requester, 'CAS\x00-0001')

        assert response.status_code == status.HTTP_200_OK
        # 'CAS' and '-0001' both have to match: only the casco does.
        assert [row['product_code'] for row in response.data['results']] == ['CAS-0001']

    def test_a_very_long_single_word_is_capped_and_answered(self, requester, catalog):
        response = _search(requester, 'a' * 5000)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0

    def test_many_words_only_the_first_five_count(self, requester, catalog):
        term = 'casco seguridad blanco casco seguridad ZZZ-ignorado'

        response = _search(requester, term)

        assert [row['product_code'] for row in response.data['results']] == ['CAS-0001']


@pytest.mark.django_db
class TestReadPathsDoNotGrowWithTheLines:
    @staticmethod
    def _queries(user, url):
        with CaptureQueriesContext(connection) as ctx:
            response = client_for(user).get(url)
        assert response.status_code == status.HTTP_200_OK, response.data
        return len(ctx)

    def test_the_detail_costs_the_same_with_five_or_sixty_linked_lines(self, requester, ops_rq):
        for n in range(1, 6):
            make_item(ops_rq, n, inventory_item=make_inventory(f'EPP-1{n:03d}', f'Producto {n}'), item_source='EPP')
        few = self._queries(requester, f'/api/v1/requests/{ops_rq.pk}/')

        for n in range(6, 61):
            make_item(ops_rq, n, inventory_item=make_inventory(f'EPP-1{n:03d}', f'Producto {n}'), item_source='EPP')
        many = self._queries(requester, f'/api/v1/requests/{ops_rq.pk}/')

        assert many == few

    def test_the_detail_of_confirmed_lines_does_not_load_who_confirmed_them(
        self, requester, ops_rq, logistics_supervisor,
    ):
        """`link_confirmed` is derived from the stamp column; the user behind it is never fetched."""
        from django.utils import timezone

        for n in range(1, 4):
            make_item(
                ops_rq, n, inventory_item=make_inventory(f'EPP-2{n:03d}', f'Producto {n}'),
                inventory_item_confirmed_at=timezone.now(), inventory_item_confirmed_by=logistics_supervisor,
            )
        three = self._queries(requester, f'/api/v1/requests/{ops_rq.pk}/')
        for n in range(4, 25):
            make_item(
                ops_rq, n, inventory_item=make_inventory(f'EPP-2{n:03d}', f'Producto {n}'),
                inventory_item_confirmed_at=timezone.now(), inventory_item_confirmed_by=logistics_supervisor,
            )
        many = self._queries(requester, f'/api/v1/requests/{ops_rq.pk}/')

        assert many == three

    def test_the_list_does_not_depend_on_how_many_lines_each_request_has(self, requester, project, ops_rq):
        from apps.rq.tests.catalog_fixtures import make_request

        for index in range(1, 4):
            other = make_request(number=f'RQ-2026-06{index:02d}', requester=requester, project=project)
            for n in range(1, 4):
                # Linked from the start: the prefetch of the products is a constant cost,
                # only its growth with the number of lines would be a defect.
                make_item(other, n, inventory_item=make_inventory(f'EPP-5{index}{n:02d}', f'Base {index}-{n}'))
        few = self._queries(requester, '/api/v1/requests/')

        for index in range(1, 4):
            other = make_request(number=f'RQ-2026-07{index:02d}', requester=requester, project=project)
            for n in range(1, 30):
                make_item(other, n, inventory_item=make_inventory(f'EPP-3{index}{n:02d}', f'Producto {index}-{n}'))
        many = self._queries(requester, '/api/v1/requests/')

        assert many == few

    def test_availability_with_stock_rows_costs_the_same_as_without(self, logistics_supervisor, ops_rq):
        for n in range(1, 4):
            product = make_inventory(f'EPP-4{n:03d}', f'Producto {n}')
            make_item(ops_rq, n, inventory_item=product)
        url = f'/api/v1/requests/{ops_rq.pk}/stock-availability/'
        without_stock = self._queries(logistics_supervisor, url)

        for item in ops_rq.items.all():
            make_stock(item.inventory_item, 5)
        with_stock = self._queries(logistics_supervisor, url)

        assert with_stock == without_stock


# ──────────────────── creation payload rules (flow scope, key cap, number clash) ────────────────────

CREATE_URL = '/api/v1/requests/'
UNKNOWN_FIELDS_LOG = 'rq.create.item_unknown_fields'


def _create_payload(**overrides):
    payload = {
        'flow': 'OPERATIONS',
        'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': [{
            'line_number': 1, 'description': 'Casco', 'quantity': '1', 'unit': 'UND', 'item_source': 'EPP',
        }],
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
class TestFlowDeterminesTheScope:
    """OPERATIONS needs a project, ADMINISTRATIVE a department; the new fields do not relax that."""

    def test_operations_without_a_project_is_refused(self, requester):
        response = client_for(requester).post(CREATE_URL, _create_payload(), format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'project' in response.data['detail']

    def test_administrative_without_a_department_is_refused(self, department_requester):
        payload = _create_payload(flow='ADMINISTRATIVE', requesting_area='ADM')

        response = client_for(department_requester).post(CREATE_URL, payload, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'department' in response.data['detail']

    def test_a_refused_creation_leaves_no_request_line_or_trace(self, requester):
        from apps.rq.models import ActivityLog, Request, RequestItem

        before = (Request.objects.count(), RequestItem.objects.count(), ActivityLog.objects.count())

        client_for(requester).post(CREATE_URL, _create_payload(), format='json')

        assert (Request.objects.count(), RequestItem.objects.count(), ActivityLog.objects.count()) == before


@pytest.mark.django_db
class TestUnknownKeysAreSampledNotDumped:
    def test_more_than_ten_distinct_unknown_keys_log_only_ten_but_count_all(
        self, requester, project, caplog,
    ):
        from apps.rq.tests.catalog_fixtures import capture_logs

        extra = {f'campo_{n:02d}': n for n in range(25)}
        line = {'line_number': 1, 'description': 'Casco', 'quantity': '1', 'unit': 'UND', 'item_source': 'EPP', **extra}

        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = client_for(requester).post(
                CREATE_URL, _create_payload(project=project.pk, items=[line]), format='json',
            )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        (record,) = [r for r in caplog.records if r.getMessage() == UNKNOWN_FIELDS_LOG]
        assert len(record.unknown_fields) == 10
        assert set(record.unknown_fields) <= set(extra)
        assert record.unknown_total == 25
        assert record.lines_affected == 1


@pytest.mark.django_db
class TestNumberClashRollsEverythingBack:
    def test_a_number_collision_is_a_400_and_nothing_is_kept(self, requester, project, ops_rq, monkeypatch):
        """The unique rq_number is the last barrier; the lines and the audit trail go with the request."""
        from apps.rq.models import ActivityLog, Approval, Request, RequestItem
        from apps.rq.services.number_generator import RQNumberGenerator

        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco')
        monkeypatch.setattr(RQNumberGenerator, 'generate', staticmethod(lambda: ops_rq.rq_number))
        before = (Request.objects.count(), RequestItem.objects.count(), ActivityLog.objects.count(),
                  Approval.objects.count())
        payload = _create_payload(project=project.pk)
        payload['items'][0]['inventory_item'] = helmet.pk

        response = client_for(requester).post(CREATE_URL, payload, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'rq_number' in response.data['detail']
        assert (Request.objects.count(), RequestItem.objects.count(), ActivityLog.objects.count(),
                Approval.objects.count()) == before
