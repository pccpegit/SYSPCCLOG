"""
SYSPCC-026 (Fase 1, QA ronda 1): edge cases of the catalog search and of the read-only
stock helpers that test_request_catalog_search.py and test_stock_availability_endpoint.py
do not reach.

  * `normalize_search_term` as a unit (what really reaches the database);
  * the pagination contract (stable, gap-free, no overlap; a bad `page` is a 404, not a 500);
  * unusual but real inputs: pasted non-breaking spaces, emoji, repeated query parameters,
    the 5-word cap, accents;
  * the pure helpers behind the availability report (`_classify`, `central_pool_available`,
    `committed_to_other_requests`) and a few report invariants.
"""
import re
from decimal import Decimal

import pytest
from rest_framework import status

from apps.core.enums import WarehouseOriginChoices
from apps.rq.services.request_catalog import (
    CATALOG_MAX_SEARCH_LENGTH,
    CATALOG_MAX_SEARCH_TOKENS,
    CATALOG_PAGE_SIZE,
    accent_insensitive_pattern,
    central_pool_available,
    normalize_search_term,
    search_catalog,
    search_words,
    strip_combining_marks,
)
from apps.rq.services.stock_availability import (
    Coverage,
    _classify,
    committed_to_other_requests,
)
from apps.rq.throttling import RequestCatalogThrottle
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    client_for,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
    ops_rq,
)

URL = '/api/v1/request-catalog/'


@pytest.fixture(autouse=True)
def _relaxed_catalog_throttle(monkeypatch):
    monkeypatch.setitem(RequestCatalogThrottle.THROTTLE_RATES, 'rq_catalog', '100000/min')


def _search(user, term, **params):
    return client_for(user).get(URL, {'search': term, **params})


def _codes(response):
    return [row['product_code'] for row in response.data['results']]


# ─────────────────── accent-insensitive pattern (unit) ───────────────────

def _matches(typed, stored):
    """What `iregex` does on SQLite: re.search with (?i). PostgreSQL gets the same pattern with `~*`."""
    return re.search('(?i)' + accent_insensitive_pattern(typed), stored) is not None


class TestAccentInsensitivePattern:
    @pytest.mark.parametrize('typed, stored', [
        ('proteccion', 'Protección auditiva'),
        ('protección', 'Proteccion auditiva'),
        ('PROTECCION', 'protección'),
        ('senal', 'Señal de seguridad'),
        ('señal', 'SENAL DE SEGURIDAD'),
        ('SEÑAL', 'senal'),
        ('panuelo', 'Pañuelo de algodón'),
        ('algodon', 'Pañuelo de algodón'),
        ('ingles', 'Llave inglés'),
        ('pinguino', 'Pingüino'),
        ('cafe', 'CAFÉ'),
        ('ÁÉÍÓÚ', 'aeiou'),
        ('aeiou', 'ÁÉÍÓÚ'),
        ('a ver', 'Á VER'),
    ])
    def test_it_ignores_case_and_written_accents_in_both_directions(self, typed, stored):
        assert _matches(typed, stored)

    @pytest.mark.parametrize('typed, stored', [
        ('casco', 'casca'),
        ('senal', 'Sedal'),
        ('proteccion', 'protecciox'),
        ('a.b', 'axb'),
        ('a+', 'aaa'),
        ('^casco', 'casco'),
        ('casco$', 'casco blanco'),
        ('a|b', 'a'),
        ('ca.*co', 'cascos'),
        ('[a-z]', 'casco'),
    ])
    def test_everything_else_is_literal_and_does_not_match_by_accident(self, typed, stored):
        assert not _matches(typed, stored)

    @pytest.mark.parametrize('typed', [
        '(', ')', '[', ']', '{', '}', '*', '+', '?', '.', '^', '$', '|', '\\', '(x+y)', 'a\\b', '[x]',
        '^$|*?{1}', 'C:\\dir', 'a_b', '50%', 'a b', "o'brien", 'x-y', '#1', 'a&b',
    ])
    def test_regex_syntax_typed_by_the_user_is_matched_as_plain_text(self, typed):
        assert _matches(typed, f'k{typed}k')
        re.compile('(?i)' + accent_insensitive_pattern(typed))  # always a valid expression

    def test_the_pattern_has_no_repetition_operator_so_it_cannot_backtrack_catastrophically(self):
        pattern = accent_insensitive_pattern('aaaaaaaaaaaaaaaaaaaaaaaa' * 4 + '(a+)+$')

        assert '(' not in pattern.replace('\\(', '').replace('\\)', '')
        assert not re.search(r'(?<!\\)[*+?]', pattern)

    def test_decomposed_input_behaves_like_precomposed(self):
        decomposed = 'sen\u0303al'  # n + combining tilde, e.g. pasted from some PDFs

        assert _matches(decomposed, 'Señal')
        assert _matches(decomposed, 'senal')

    def test_the_empty_string_gives_the_empty_pattern(self):
        assert accent_insensitive_pattern('') == ''


# ──────────────────────── normalize_search_term (unit) ────────────────────────

class TestNormalizeSearchTerm:
    @pytest.mark.parametrize('raw', [None, 5, 3.5, ['casco'], {'q': 'casco'}, b'casco', True])
    def test_anything_that_is_not_text_becomes_empty(self, raw):
        assert normalize_search_term(raw) == ''

    @pytest.mark.parametrize('raw, expected', [
        ('  casco   blanco  ', 'casco blanco'),
        ('casco\tblanco\nazul', 'casco blanco azul'),
        ('casco blanco', 'casco blanco'),              # non-breaking space pasted from a spreadsheet
        ('casco​blanco', 'casco blanco'),              # zero-width space
        ('\x00casco\x1f', 'casco'),
        ('ca\x00sco', 'ca sco'),                            # control char splits, it never glues words
        ('', ''),
        ('   ', ''),
    ])
    def test_whitespace_and_control_characters_collapse_to_single_spaces(self, raw, expected):
        assert normalize_search_term(raw) == expected

    def test_the_length_is_capped(self):
        assert len(normalize_search_term('a' * 5000)) == CATALOG_MAX_SEARCH_LENGTH

    def test_text_that_fits_is_left_untouched(self):
        assert normalize_search_term('Pañuelo de algodón 100%') == 'Pañuelo de algodón 100%'


# ─────────────── combining marks: what is searched is what is measured (unit) ───────────────

class TestStripCombiningMarks:
    @pytest.mark.parametrize('typed, expected', [
        ('señal', 'senal'),                      # precomposed
        ('sen\u0303al', 'senal'),                # decomposed
        ('Protección', 'Proteccion'),
        ('\u0301\u0301', ''),                    # nothing but accents
        ('', ''),
        ('100%', '100%'),                        # not a mark: untouched
    ])
    def test_it_keeps_the_base_letters_only(self, typed, expected):
        assert strip_combining_marks(typed) == expected


class TestSearchWords:
    @pytest.mark.parametrize('raw, expected', [
        ('casco blanco', ['casco', 'blanco']),
        ('  casco   blanco  ', ['casco', 'blanco']),
        ('Protección', ['Proteccion']),
        ('a\u0301', ['a']),                      # one letter, however it was typed
        ('\u0301\u0301', []),
        ('\u0301 \u0301', []),
        ('casco \u0301 blanco', ['casco', 'blanco']),   # a stray accent is not a word
        ('\u0301casco', ['casco']),
        ('', []),
        (None, []),
        (5, []),
    ])
    def test_it_returns_the_words_that_will_really_be_searched(self, raw, expected):
        assert search_words(raw) == expected

    def test_a_word_that_survives_always_has_a_non_empty_pattern(self):
        """The empty regular expression matches every row; no returned word may produce it."""
        for raw in ('\u0301', 'a\u0301 \u0300', '\u0301\u0301 x', 'ñ', 'n\u0303'):
            for word in search_words(raw):
                assert accent_insensitive_pattern(word) != ''


# ──────────────────────── search_catalog (service) ────────────────────────

@pytest.mark.django_db
class TestSearchCatalogService:
    def test_a_term_of_exactly_two_characters_searches(self):
        make_inventory('XX-1', 'Producto xx')

        assert [p.product_code for p in search_catalog('xx')] == ['XX-1']

    def test_a_term_that_is_two_characters_only_after_cleaning_does_not_search(self):
        make_inventory('XX-1', 'Producto xx')

        assert list(search_catalog(' x\x00 ')) == []

    @pytest.mark.parametrize('term', ['\u0301\u0301', '\u0301 \u0301', 'a\u0301', 'á', 'n\u0303', 'ñ', 'a \u0301'])
    def test_the_minimum_counts_the_letters_not_the_combining_marks(self, term):
        make_inventory('XX-1', 'Producto xx')
        make_inventory('AA-1', 'Aceite')

        assert list(search_catalog(term)) == []

    def test_a_stray_accent_next_to_a_real_word_neither_widens_nor_blocks_the_search(self):
        make_inventory('CAS-1', 'Casco blanco')
        make_inventory('BOT-1', 'Botas')

        assert [p.product_code for p in search_catalog('casco \u0301')] == ['CAS-1']
        assert [p.product_code for p in search_catalog('\u0301\u0301 casco')] == ['CAS-1']

    def test_a_stray_accent_does_not_use_up_one_of_the_five_word_slots(self):
        make_inventory('LONG-1', 'alfa beta gamma delta epsilon')

        # Four real words, an accent, then the fifth real word: it still has to narrow.
        assert list(search_catalog('alfa beta gamma delta \u0301 zzzz')) == []
        assert [p.product_code for p in search_catalog('alfa beta gamma delta \u0301 epsilon')] == ['LONG-1']

    def test_only_the_first_words_narrow_the_search(self):
        assert CATALOG_MAX_SEARCH_TOKENS == 5
        make_inventory('LONG-1', 'alfa beta gamma delta epsilon')

        found = search_catalog('alfa beta gamma delta epsilon zeta')       # the 6th word is ignored

        assert [p.product_code for p in found] == ['LONG-1']

    def test_the_fifth_word_still_narrows(self):
        make_inventory('LONG-1', 'alfa beta gamma delta epsilon')

        assert list(search_catalog('alfa beta gamma delta zzzz')) == []

    def test_the_same_word_in_code_and_description_does_not_duplicate_the_row(self):
        make_inventory('CASCO-1', 'Casco casco CASCO')

        assert [p.product_code for p in search_catalog('casco')] == ['CASCO-1']

    def test_stock_rows_do_not_inflate_the_rows_nor_the_sum(self):
        product = make_inventory('EPP-1', 'Casco')
        for qty in (1, 2, 3):
            make_stock(product, qty)                     # three duplicate pool rows
        make_stock(product, 50, warehouse_type=WarehouseOriginChoices.SITE)

        rows = list(search_catalog('casco'))

        assert len(rows) == 1
        assert rows[0].available == Decimal('6.000')


@pytest.mark.django_db
class TestSearchEndpointEdges:
    def test_pages_are_gap_free_and_do_not_overlap(self, requester):
        expected = []
        for n in range(45):
            code = f'EPP-{n:04d}'
            make_inventory(code, f'Casco modelo {n}')
            expected.append(code)

        first = _search(requester, 'casco')
        second = _search(requester, 'casco', page=2)
        third = _search(requester, 'casco', page=3)

        assert first.data['count'] == second.data['count'] == third.data['count'] == 45
        got = _codes(first) + _codes(second) + _codes(third)
        assert len(got) == len(set(got)) == 45
        assert got == sorted(expected)                                  # ties break by code: deterministic
        assert [len(p.data['results']) for p in (first, second, third)] == [CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE, 5]
        assert first.data['previous'] is None and third.data['next'] is None

    @pytest.mark.parametrize('page', ['99', '0', '-1', 'abc', '1.5', ''])
    def test_a_bad_page_is_a_client_error_never_a_500(self, requester, page):
        make_inventory('EPP-0001', 'Casco')

        response = _search(requester, 'casco', page=page)

        assert response.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_200_OK)
        if response.status_code == status.HTTP_200_OK:        # an empty page param falls back to page 1
            assert _codes(response) == ['EPP-0001']

    def test_a_repeated_search_parameter_does_not_break_the_endpoint(self, requester):
        make_inventory('EPP-0001', 'Casco')
        make_inventory('EPP-0002', 'Guante')

        response = client_for(requester).get(f'{URL}?search=casco&search=guante')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1              # one of the two, never a union or a crash

    def test_non_breaking_spaces_from_a_pasted_description_still_find_the_product(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad blanco')

        assert _codes(_search(requester, 'casco blanco')) == ['EPP-0001']

    @pytest.mark.parametrize('term', ['casco 😀', '😀😀', 'ca\U0001f600sco'])
    def test_emoji_do_not_break_the_search(self, requester, term):
        make_inventory('EPP-0001', 'Casco de seguridad')

        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['results'] == []

    def test_accented_text_matches_when_typed_with_the_accent(self, requester):
        make_inventory('EPP-0001', 'Pañuelo de algodón')
        make_inventory('EPP-0002', 'Señal de seguridad')

        assert _codes(_search(requester, 'pañuelo')) == ['EPP-0001']
        assert _codes(_search(requester, 'señal')) == ['EPP-0002']
        assert _codes(_search(requester, 'algodón')) == ['EPP-0001']

    def test_search_finds_products_typed_without_accents(self, requester):
        make_inventory('EPP-0003', 'Protección auditiva tipo copa')

        assert _codes(_search(requester, 'proteccion')) == ['EPP-0003']

    @pytest.mark.parametrize('typed', ['senal', 'SENAL', 'señal', 'Señal', 'sEñAl'])
    def test_every_way_of_typing_a_word_finds_the_same_products(self, requester, typed):
        make_inventory('EPP-0001', 'Señal de seguridad')
        make_inventory('EPP-0002', 'Cinta de senal')
        make_inventory('EPP-0003', 'Casco blanco')

        assert _codes(_search(requester, typed)) == ['EPP-0001', 'EPP-0002']

    def test_several_words_each_ignore_accents(self, requester):
        make_inventory('EPP-0001', 'Protección auditiva tipo copa')
        make_inventory('EPP-0002', 'Protección visual')

        assert _codes(_search(requester, 'proteccion auditiva')) == ['EPP-0001']
        assert _codes(_search(requester, 'protección auditiva')) == ['EPP-0001']

    def test_the_code_is_matched_too(self, requester):
        make_inventory('EPP-ÁÑO-1', 'Producto uno')

        assert _codes(_search(requester, 'epp-ano')) == ['EPP-ÁÑO-1']

    def test_relevance_ordering_also_ignores_accents(self, requester):
        """A description that STARTS with the typed word outranks one that merely contains it."""
        make_inventory('EPP-0001', 'Lentes con protección lateral')
        make_inventory('EPP-0002', 'Protección auditiva')

        assert _codes(_search(requester, 'proteccion')) == ['EPP-0002', 'EPP-0001']

    def test_an_exact_code_typed_without_the_accent_still_ranks_first(self, requester):
        make_inventory('Ñ-1', 'Producto uno')
        make_inventory('N-10', 'Producto diez')

        assert _codes(_search(requester, 'n-1')) == ['Ñ-1', 'N-10']

    @pytest.mark.parametrize('term', ['(', 'a(', '[x', '*', 'a+', '\\', 'x{1', '?', '^$', '|a', 'a)b'])
    def test_regex_characters_in_the_search_box_never_break_the_endpoint(self, requester, term):
        make_inventory('EPP-0001', 'Casco (blanco) 50% [grande] a+b')

        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK

    def test_a_typed_regex_is_not_interpreted(self, requester):
        make_inventory('EPP-0001', 'Casco blanco')
        make_inventory('EPP-0002', 'Casco (blanco)')

        assert _codes(_search(requester, 'ca.*co')) == []
        assert _codes(_search(requester, '(blanco)')) == ['EPP-0002']

    def test_percent_and_underscore_stay_plain_characters(self, requester):
        make_inventory('EPP-0001', 'Descuento 50% garantizado')
        make_inventory('EPP-0002', 'Descuento 500 garantizado')
        make_inventory('EPP-0003', 'Perno a_b')
        make_inventory('EPP-0004', 'Perno axb')

        assert _codes(_search(requester, '50%')) == ['EPP-0001']
        assert _codes(_search(requester, 'a_b')) == ['EPP-0003']

    def test_count_is_the_number_of_products_not_of_stock_rows(self, requester):
        for n in range(3):
            product = make_inventory(f'EPP-{n}', f'Casco {n}')
            for qty in (1, 2, 3):
                make_stock(product, qty)

        response = _search(requester, 'casco')

        assert response.data['count'] == 3
        assert [row['available'] for row in response.data['results']] == ['6.000'] * 3

    def test_a_product_without_category_comes_back_with_an_empty_string(self, requester):
        make_inventory('EPP-0001', 'Casco', category='')

        row = _search(requester, 'casco').data['results'][0]

        assert row['category'] == ''

    def test_available_is_a_decimal_string_with_three_decimals(self, requester):
        product = make_inventory('EPP-0001', 'Casco')
        make_stock(product, '12.5')

        row = _search(requester, 'casco').data['results'][0]

        assert row['available'] == '12.500'


# ──────────────── pure helpers behind the availability report ────────────────

class TestClassifyBoundaries:
    @pytest.mark.parametrize('requested, net, expected', [
        ('10', '10', Coverage.FULL),                # exactly enough
        ('10', '10.001', Coverage.FULL),
        ('10', '9.999', Coverage.PARTIAL),          # one thousandth short
        ('10', '0.001', Coverage.PARTIAL),
        ('10', '0', Coverage.NONE),
        ('0.001', '0', Coverage.NONE),
        ('0', '0', Coverage.FULL),                  # nothing asked for is covered
        ('0', '5', Coverage.FULL),
    ])
    def test_boundaries(self, requested, net, expected):
        assert _classify(Decimal(requested), Decimal(net)) == expected


@pytest.mark.django_db
class TestPoolAndCommittedHelpers:
    @pytest.mark.parametrize('ids', [[], [None], [0], [None, 0], set(), ()])
    def test_nothing_to_look_up_means_nothing_to_query(self, ids, django_assert_num_queries):
        with django_assert_num_queries(0):
            assert central_pool_available(ids) == {}
            assert committed_to_other_requests(ids, exclude_request_id=1) == {}

    def test_pool_only_lists_products_that_have_pool_rows(self, project, department):
        in_pool = make_inventory('EPP-1', 'Casco')
        elsewhere = make_inventory('EPP-2', 'Guante')
        make_stock(in_pool, 7)
        make_stock(elsewhere, 9, project=project)
        make_stock(elsewhere, 4, department=department)
        make_stock(elsewhere, 2, warehouse_type=WarehouseOriginChoices.SITE)

        assert central_pool_available([in_pool.pk, elsewhere.pk]) == {in_pool.pk: Decimal('7.000')}

    def test_pool_sums_duplicate_rows_per_product(self):
        product = make_inventory('EPP-1', 'Casco')
        make_stock(product, 2)
        make_stock(product, 3)

        assert central_pool_available([product.pk]) == {product.pk: Decimal('5.000')}

    def test_a_negative_remainder_is_never_added_up(self, requester, project):
        """Two lines of the same product in one IN_STOCK RQ: one over-dispatched must not cancel the other."""
        from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

        product = make_inventory('EPP-1', 'Casco')
        other = make_request(number='RQ-2026-0900', requester=requester, project=project, status='IN_STOCK')
        over = make_item(other, 1, quantity=2, inventory_item=product)
        make_item(other, 2, quantity=6, inventory_item=product)
        dispatch = WarehouseDispatch.objects.create(
            request=other, dispatched_by=requester, origin=WarehouseOriginChoices.CENTRAL,
        )
        WarehouseDispatchItem.objects.create(dispatch=dispatch, request_item=over, quantity_dispatched=Decimal('5'))

        owed = committed_to_other_requests([product.pk], exclude_request_id=0)

        assert owed == {product.pk: Decimal('6.000')}       # 0 for the over-dispatched line + 6, not (2 - 5) + 6 = 3

    def test_two_lines_of_the_same_product_in_one_request_add_up(self, requester, project):
        product = make_inventory('EPP-1', 'Casco')
        other = make_request(number='RQ-2026-0901', requester=requester, project=project, status='IN_STOCK')
        make_item(other, 1, quantity=4, inventory_item=product)
        make_item(other, 2, quantity=3, inventory_item=product)

        assert committed_to_other_requests([product.pk], exclude_request_id=0) == {product.pk: Decimal('7.000')}

    def test_an_administrative_request_in_stock_also_commits_the_shared_pool(
        self, department_requester, department,
    ):
        product = make_inventory('EPP-1', 'Casco')
        from apps.core.enums import RQFlowChoices

        other = make_request(
            number='RQ-2026-0902', requester=department_requester, flow=RQFlowChoices.ADMINISTRATIVE,
            department=department, status='IN_STOCK',
        )
        make_item(other, 1, quantity=5, inventory_item=product)

        assert committed_to_other_requests([product.pk], exclude_request_id=0) == {product.pk: Decimal('5.000')}

    def test_the_excluded_request_is_left_out(self, requester, project):
        product = make_inventory('EPP-1', 'Casco')
        mine = make_request(number='RQ-2026-0903', requester=requester, project=project, status='IN_STOCK')
        make_item(mine, 1, quantity=5, inventory_item=product)

        assert committed_to_other_requests([product.pk], exclude_request_id=mine.pk) == {}

    def test_unlinked_and_off_catalog_lines_commit_nothing(self, requester, project):
        product = make_inventory('EPP-1', 'Casco')
        other = make_request(number='RQ-2026-0904', requester=requester, project=project, status='IN_STOCK')
        make_item(other, 1, quantity=5)
        make_item(other, 2, quantity=5, is_off_catalog=True)

        assert committed_to_other_requests([product.pk], exclude_request_id=0) == {}


# ──────────────────────── report invariants over HTTP ────────────────────────

@pytest.mark.django_db
class TestAvailabilityReportInvariants:
    def _get(self, user, rq):
        return client_for(user).get(f'/api/v1/requests/{rq.pk}/stock-availability/')

    def test_summary_buckets_add_up_to_the_total(self, logistics_coordinator, ops_rq):
        full = make_inventory('EPP-1', 'Casco')
        partial = make_inventory('EPP-2', 'Guante')
        none = make_inventory('EPP-3', 'Botas')
        make_stock(full, 100)
        make_stock(partial, 1)
        make_item(ops_rq, 1, quantity=10, inventory_item=full)
        make_item(ops_rq, 2, quantity=10, inventory_item=partial)
        make_item(ops_rq, 3, quantity=10, inventory_item=none)
        make_item(ops_rq, 4, quantity=10, is_off_catalog=True)
        make_item(ops_rq, 5, quantity=10)
        make_item(ops_rq, 6, quantity=10)

        summary = self._get(logistics_coordinator, ops_rq).data['summary']

        assert summary == {
            'items_total': 6, 'full': 1, 'partial': 1, 'none': 1, 'off_catalog': 1, 'unlinked': 2,
        }
        assert sum(v for k, v in summary.items() if k != 'items_total') == summary['items_total']

    def test_lines_come_back_ordered_by_line_number_whatever_the_insertion_order(
        self, logistics_coordinator, ops_rq,
    ):
        for number in (3, 1, 2):
            make_item(ops_rq, number, description=f'Línea {number}')

        rows = self._get(logistics_coordinator, ops_rq).data['items']

        assert [row['line_number'] for row in rows] == [1, 2, 3]

    def test_a_product_deleted_after_linking_leaves_an_unlinked_line_not_an_error(
        self, logistics_coordinator, ops_rq,
    ):
        product = make_inventory('EPP-1', 'Casco')
        make_stock(product, 10)
        make_item(ops_rq, 1, quantity=5, inventory_item=product)
        product.delete()

        response = self._get(logistics_coordinator, ops_rq)

        assert response.status_code == status.HTTP_200_OK
        row = response.data['items'][0]
        assert (row['link_status'], row['coverage'], row['inventory_item']) == ('UNLINKED', None, None)

    def test_the_decimals_come_back_as_strings_with_three_places(self, logistics_coordinator, ops_rq):
        product = make_inventory('EPP-1', 'Casco')
        make_stock(product, '2.5')
        make_item(ops_rq, 1, quantity='4.25', inventory_item=product)

        row = self._get(logistics_coordinator, ops_rq).data['items'][0]

        assert (row['requested'], row['available_central'], row['available_net'], row['shortfall']) == (
            '4.250', '2.500', '2.500', '1.750',
        )

    def test_an_administrative_request_is_reported_like_an_operations_one(self, logistics_supervisor, adm_rq):
        product = make_inventory('EPP-1', 'Papel bond')
        make_stock(product, 3)
        make_item(adm_rq, 1, quantity=10, unit='MLL', inventory_item=product)

        row = self._get(logistics_supervisor, adm_rq).data['items'][0]

        assert (row['link_status'], row['coverage'], row['shortfall']) == ('LINKED', 'PARTIAL', '7.000')
