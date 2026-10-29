"""
SYSPCC-026 (Fase 1): GET /api/v1/request-catalog/?search=

Type-ahead over the warehouse catalog for the people who write an RQ. Lives in
the rq app because a requester has no warehouse role. Contract under test:
authenticated users only, at most 20 rows, only id/code/description/unit/
category/available (CENTRAL pool: project and department NULL), no costs, no
exact location, no supplier data, bounded search input, its own rate limit.
"""
import pytest
from django.core.cache import caches
from django.conf import settings
from rest_framework import status

from apps.core.enums import WarehouseOriginChoices
from apps.rq.throttling import RequestCatalogThrottle
from apps.rq.tests.catalog_fixtures import client_for, make_inventory, make_stock

URL = '/api/v1/request-catalog/'
ROW_KEYS = {'id', 'product_code', 'description', 'unit', 'category', 'available'}


@pytest.fixture(autouse=True)
def _relaxed_catalog_throttle(monkeypatch):
    """
    Throttle counters live in the shared cache and user pks repeat across tests, so
    keep the dedicated limit out of the way except in the tests that exercise it.
    """
    monkeypatch.setitem(RequestCatalogThrottle.THROTTLE_RATES, 'rq_catalog', '100000/min')


def _search(user, term, **params):
    return client_for(user).get(URL, {'search': term, **params})


def _codes(response):
    return [row['product_code'] for row in response.data['results']]


@pytest.mark.django_db
class TestCatalogAccess:
    def test_anonymous_gets_401(self, api_client):
        assert api_client.get(URL, {'search': 'casco'}).status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.parametrize('fixture_name', [
        'requester', 'project_resident', 'project_control', 'general_manager',
        'logistics_coordinator', 'site_warehouse', 'direct_supervisor', 'admin_manager',
        'department_requester', 'user',
    ])
    def test_any_authenticated_user_can_search(self, request, fixture_name):
        """The point of the endpoint: a plain requester (no warehouse role) can use it."""
        user = request.getfixturevalue(fixture_name)
        make_inventory('EPP-0001', 'Casco de seguridad')

        response = _search(user, 'casco')

        assert response.status_code == status.HTTP_200_OK
        assert _codes(response) == ['EPP-0001']

    @pytest.mark.parametrize('method', ['post', 'put', 'patch', 'delete'])
    def test_endpoint_is_read_only(self, requester, method):
        response = getattr(client_for(requester), method)(URL, {'search': 'casco'}, format='json')

        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

    def test_detail_route_does_not_exist(self, requester):
        inv = make_inventory()

        assert client_for(requester).get(f'{URL}{inv.pk}/').status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestCatalogSearch:
    def test_matches_by_code_case_insensitive(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')
        make_inventory('HER-0001', 'Martillo')

        assert _codes(_search(requester, 'epp-00')) == ['EPP-0001']

    def test_matches_by_description_substring_case_insensitive(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad blanco')
        make_inventory('HER-0001', 'Martillo')

        assert _codes(_search(requester, 'SEGURIDAD')) == ['EPP-0001']

    def test_every_word_must_match(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad blanco')
        make_inventory('EPP-0002', 'Casco de seguridad amarillo')
        make_inventory('EPP-0003', 'Guante de seguridad')

        assert sorted(_codes(_search(requester, 'casco blanco'))) == ['EPP-0001']
        assert sorted(_codes(_search(requester, 'seguridad casco'))) == ['EPP-0001', 'EPP-0002']

    def test_no_match_returns_empty_page(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')

        response = _search(requester, 'inexistente')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 0
        assert response.data['results'] == []

    @pytest.mark.parametrize('term', ['', ' ', 'c', '  c  ', None])
    def test_too_short_or_missing_term_returns_nothing_instead_of_the_catalog(self, requester, term):
        make_inventory('EPP-0001', 'Casco de seguridad')
        params = {} if term is None else {'search': term}

        response = client_for(requester).get(URL, params)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['results'] == []

    def test_like_wildcards_are_literal(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')
        make_inventory('EPP-0002', 'Cinta 100% algodón')

        assert _codes(_search(requester, '%%')) == []
        assert _codes(_search(requester, '__')) == []
        assert _codes(_search(requester, '100%')) == ['EPP-0002']

    @pytest.mark.parametrize('term', ["' OR 1=1 --", '"; DROP TABLE inventory; --', '\\', '<script>'])
    def test_hostile_terms_are_harmless(self, requester, term):
        make_inventory('EPP-0001', 'Casco de seguridad')

        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['results'] == []

    @pytest.mark.parametrize('term', ['\x00zz', 'zz\x00', 'z\x00z', '\x01\x02zz', 'zz\u2028'])
    def test_control_characters_never_reach_the_database(self, requester, term):
        """
        A NUL byte truncates a SQLite LIKE pattern to "%" (the whole catalog) and makes
        PostgreSQL reject the statement. Control characters are stripped instead.
        """
        make_inventory('EPP-0001', 'Casco de seguridad')
        make_inventory('EPP-0002', 'Guante zz de cuero')

        response = _search(requester, term)

        assert response.status_code == status.HTTP_200_OK
        assert [row['product_code'] for row in response.data['results']] in ([], ['EPP-0002'])
        assert 'EPP-0001' not in [row['product_code'] for row in response.data['results']]

    def test_very_long_term_is_bounded_not_a_500(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')

        response = _search(requester, 'casco ' * 500)

        assert response.status_code == status.HTTP_200_OK

    def test_results_are_ordered_by_relevance_then_code(self, requester):
        make_inventory('ZZZ-0001', 'Tapa de casco')           # description contains it
        make_inventory('AAA-0001', 'Cascote de obra')        # description starts with it
        make_inventory('CASCO-X', 'Equipo')                  # code starts with it
        make_inventory('CASCO', 'Otra cosa')                 # exact code

        assert _codes(_search(requester, 'casco')) == ['CASCO', 'CASCO-X', 'AAA-0001', 'ZZZ-0001']

    def test_page_is_capped_at_twenty_rows_and_the_client_cannot_raise_it(self, requester):
        for n in range(25):
            make_inventory(f'EPP-{n:04d}', f'Casco modelo {n}')

        response = _search(requester, 'casco', page_size=100)

        assert response.data['count'] == 25
        assert len(response.data['results']) == 20
        assert response.data['next'] is not None
        second = _search(requester, 'casco', page=2)
        assert len(second.data['results']) == 5


@pytest.mark.django_db
class TestCatalogRowContent:
    def test_row_has_exactly_the_allowed_fields(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad', 'UND', 'EPP')

        row = _search(requester, 'casco').data['results'][0]

        assert set(row) == ROW_KEYS
        assert row['product_code'] == 'EPP-0001'
        assert row['description'] == 'Casco de seguridad'
        assert row['unit'] == 'UND'
        assert row['category'] == 'EPP'

    def test_costs_location_brand_and_supplier_data_are_never_exposed(self, requester):
        make_inventory(
            'EPP-0001', 'Casco de seguridad',
            location='B3-2 pasillo secreto', brand='MarcaX', model_name='ModeloZ',
            min_stock=50,
        )

        response = _search(requester, 'casco')

        body = response.content.decode()
        for forbidden in ('pasillo secreto', 'B3-2', 'MarcaX', 'ModeloZ', 'location', 'brand',
                          'model_name', 'min_stock', 'price', 'cost', 'supplier', 'unit_price'):
            assert forbidden not in body, forbidden

    def test_available_is_the_central_pool_only(self, requester, project, department):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad')
        make_stock(helmet, 7)                                                    # the pool
        make_stock(helmet, 100, project=project)                                 # central, earmarked for a project
        make_stock(helmet, 50, department=department)                           # central, earmarked for a department
        make_stock(helmet, 30, warehouse_type=WarehouseOriginChoices.SITE)       # a site warehouse
        make_stock(helmet, 20, warehouse_type=WarehouseOriginChoices.OFFICE)     # an office warehouse

        row = _search(requester, 'casco').data['results'][0]

        assert row['available'] == '7.000'

    def test_available_sums_duplicate_pool_rows(self, requester):
        """The unique constraint does not collapse NULL scopes, so sum defensively."""
        helmet = make_inventory('EPP-0001', 'Casco de seguridad')
        make_stock(helmet, 4)
        make_stock(helmet, 3)

        assert _search(requester, 'casco').data['results'][0]['available'] == '7.000'

    def test_product_without_stock_rows_has_zero_available(self, requester):
        make_inventory('EPP-0001', 'Casco de seguridad')

        assert _search(requester, 'casco').data['results'][0]['available'] == '0.000'

    def test_availability_is_per_product(self, requester):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad')
        gloves = make_inventory('EPP-0002', 'Guante de seguridad')
        make_stock(helmet, 9)
        make_stock(gloves, 2)

        rows = {r['product_code']: r['available'] for r in _search(requester, 'seguridad').data['results']}

        assert rows == {'EPP-0001': '9.000', 'EPP-0002': '2.000'}

    def test_search_does_not_run_a_query_per_row(self, requester, django_assert_max_num_queries):
        for n in range(15):
            product = make_inventory(f'EPP-{n:04d}', f'Casco modelo {n}')
            make_stock(product, n)

        with django_assert_max_num_queries(4):
            response = _search(requester, 'casco')

        assert len(response.data['results']) == 15


@pytest.mark.django_db
class TestCatalogRateLimit:
    @pytest.fixture
    def tight_limit(self, monkeypatch, requester):
        monkeypatch.setitem(RequestCatalogThrottle.THROTTLE_RATES, 'rq_catalog', '3/min')
        cache = caches[getattr(settings, 'THROTTLE_CACHE_ALIAS', 'default')]
        key = f'throttle_rq_catalog_{requester.pk}'
        cache.delete(key)
        yield
        cache.delete(key)

    def test_the_dedicated_limit_answers_429(self, requester, tight_limit):
        make_inventory('EPP-0001', 'Casco de seguridad')

        statuses = [_search(requester, 'casco').status_code for _ in range(5)]

        assert statuses[:3] == [status.HTTP_200_OK] * 3
        assert statuses[3:] == [status.HTTP_429_TOO_MANY_REQUESTS] * 2

    def test_the_limit_is_per_user(self, requester, project_resident, tight_limit):
        make_inventory('EPP-0001', 'Casco de seguridad')
        for _ in range(4):
            _search(requester, 'casco')
        cache = caches[getattr(settings, 'THROTTLE_CACHE_ALIAS', 'default')]
        other_key = f'throttle_rq_catalog_{project_resident.pk}'
        cache.delete(other_key)
        try:
            assert _search(project_resident, 'casco').status_code == status.HTTP_200_OK
        finally:
            cache.delete(other_key)

    def test_default_rate_applies_when_the_scope_is_not_configured(self, monkeypatch):
        """Deploying needs no settings change: the throttle carries its own default."""
        monkeypatch.delitem(RequestCatalogThrottle.THROTTLE_RATES, 'rq_catalog', raising=False)

        assert RequestCatalogThrottle().rate == RequestCatalogThrottle.DEFAULT_RATE == '120/min'
