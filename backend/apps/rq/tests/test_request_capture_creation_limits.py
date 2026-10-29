"""
SYSPCC-026 (Fase 1, ronda 1 de correcciones): one POST must not be an amplifier.

The creation payload used to have no ceiling, validated every catalog link with its own
query (about 3 queries per line) and logged one warning per line with every unknown key.
Now:

  * at most 200 lines per request and at least one;
  * the catalog links of the whole payload are resolved with ONE query;
  * unknown keys are reported in a single bounded warning per request;
  * a line asks for more than zero units;
  * the ids of update-items stay inside the 64-bit range of the primary keys.
"""
import logging

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.rq.models import Request, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    capture_logs,
    client_for,
    make_inventory,
    make_item,
    ops_rq,
    rq_in_editable_state,
)

URL = '/api/v1/requests/'
UNKNOWN_FIELDS_LOG = 'rq.create.item_unknown_fields'


def _payload(project, items):
    for number, item in enumerate(items, start=1):
        if isinstance(item, dict):
            item.setdefault('line_number', number)
    return {
        'flow': 'OPERATIONS',
        'project': project.pk,
        'requesting_area': 'OP',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': items,
    }


def _line(**overrides):
    line = {'description': 'Casco de seguridad', 'quantity': '10.000', 'unit': 'UND', 'item_source': 'EPP'}
    line.update(overrides)
    return line


def _post(user, project, items):
    return client_for(user).post(URL, _payload(project, items), format='json')


def _nothing_was_created():
    return Request.objects.count() == 0 and RequestItem.objects.count() == 0


def _inventory_selects(queries):
    return [q['sql'] for q in queries if 'FROM "inventory"' in q['sql'] and q['sql'].lstrip().startswith('SELECT')]


def _records(caplog):
    return [r for r in caplog.records if r.getMessage() == UNKNOWN_FIELDS_LOG]


@pytest.mark.django_db
class TestLineCount:
    def test_exactly_the_maximum_is_accepted(self, requester, project):
        response = _post(requester, project, [_line(description=f'Línea {n}') for n in range(200)])

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert RequestItem.objects.count() == 200

    def test_one_more_than_the_maximum_is_rejected_and_nothing_is_created(self, requester, project):
        response = _post(requester, project, [_line(description=f'Línea {n}') for n in range(201)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        message = str(response.data['detail']['items']['non_field_errors'][0])
        assert '200' in message and 'ítems' in message
        assert _nothing_was_created()

    def test_an_oversized_hostile_payload_is_cut_before_any_line_is_validated(self, requester, project, caplog):
        """3000 lines: refused at the ceiling, without 3000 lookups and without 3000 log lines."""
        items = [_line(description=f'Línea {n}', stock_almacen_principal=1) for n in range(3000)]

        with capture_logs(caplog, 'apps.rq.serializers.request'), CaptureQueriesContext(connection) as queries:
            response = _post(requester, project, items)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert len(queries) < 15
        assert len(_records(caplog)) <= 1
        assert _nothing_was_created()

    def test_an_empty_list_is_rejected_in_spanish(self, requester, project):
        response = _post(requester, project, [])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'Agregue al menos un ítem' in str(response.data['detail']['items']['non_field_errors'][0])
        assert _nothing_was_created()


@pytest.mark.django_db
class TestCatalogLinksAreResolvedInBulk:
    def test_the_number_of_catalog_lookups_does_not_grow_with_the_lines(self, requester, project):
        products = [make_inventory(f'EPP-{n:04d}', f'Producto {n}') for n in range(40)]

        def lookups(count):
            items = [_line(description=f'Línea {n}', inventory_item=products[n].pk) for n in range(count)]
            with CaptureQueriesContext(connection) as queries:
                response = _post(requester, project, items)
            assert response.status_code == status.HTTP_201_CREATED, response.data
            return len(_inventory_selects(queries.captured_queries))

        # One to validate the links of the payload and one to render the 201 body.
        assert lookups(2) == lookups(40) == 2

    def test_a_full_request_costs_about_one_insert_per_line_and_nothing_else_per_line(self, requester, project):
        products = [make_inventory(f'EPP-{n:04d}', f'Producto {n}') for n in range(100)]
        items = [_line(description=f'Línea {n}', inventory_item=products[n].pk) for n in range(100)]

        with CaptureQueriesContext(connection) as queries:
            response = _post(requester, project, items)

        assert response.status_code == status.HTTP_201_CREATED, response.data
        # 100 line INSERTs + a constant (auth, scoping, number, request, approval, log, response).
        # It was ~3 per line (≈300) before the bulk lookup.
        assert len(queries) < 100 + 50, len(queries)

    def test_repeating_a_product_in_many_lines_does_not_repeat_the_lookup(self, requester, project):
        helmet = make_inventory('EPP-0001', 'Casco')
        items = [_line(description=f'Casco {n}', inventory_item=helmet.pk) for n in range(30)]

        with CaptureQueriesContext(connection) as queries:
            response = _post(requester, project, items)

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert len(_inventory_selects(queries.captured_queries)) == 2  # validation + response body
        assert RequestItem.objects.filter(inventory_item=helmet).count() == 30

    def test_every_line_gets_the_right_product(self, requester, project):
        a = make_inventory('EPP-0001', 'Casco')
        b = make_inventory('EPP-0002', 'Guante')
        response = _post(requester, project, [
            _line(description='uno', inventory_item=b.pk),
            _line(description='dos'),
            _line(description='tres', inventory_item=a.pk),
        ])

        assert response.status_code == status.HTTP_201_CREATED, response.data
        lines = {i.line_number: i.inventory_item_id for i in RequestItem.objects.all()}
        assert lines == {1: b.pk, 2: None, 3: a.pk}

    def test_a_missing_product_is_reported_on_its_own_line_and_nothing_is_created(self, requester, project):
        helmet = make_inventory('EPP-0001', 'Casco')

        response = _post(requester, project, [
            _line(inventory_item=helmet.pk),
            _line(inventory_item=999999),
            _line(inventory_item=helmet.pk),
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        errors = response.data['detail']['items']
        assert errors[0] == {} and errors[2] == {}
        assert 'inventory_item' in errors[1]
        assert _nothing_was_created()

    @pytest.mark.parametrize('value', [
        2**63, 10**30, -10**30, -1, 0, 1.9, True, False, [1], {'id': 1}, 'abc', ' ',
    ])
    def test_hostile_product_ids_are_a_400_on_their_line_never_a_500(self, requester, project, value):
        make_inventory('EPP-0001', 'Casco')

        response = _post(requester, project, [_line(), _line(inventory_item=value)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST, (value, response.data)
        assert 'inventory_item' in response.data['detail']['items'][1]
        assert _nothing_was_created()

    def test_a_numeric_string_id_from_an_old_client_still_resolves(self, requester, project):
        """Not a JSON integer, so it takes the per-line path instead of the bulk cache."""
        helmet = make_inventory('EPP-0001', 'Casco')

        response = _post(requester, project, [_line(inventory_item=str(helmet.pk))])

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert RequestItem.objects.get().inventory_item_id == helmet.pk

    def test_a_deleted_product_between_requests_is_not_served_from_a_stale_cache(self, requester, project):
        """The cache lives and dies with one serializer: a new request looks the catalog up again."""
        helmet = make_inventory('EPP-0001', 'Casco')
        helmet_id = helmet.pk
        assert _post(requester, project, [_line(inventory_item=helmet_id)]).status_code == 201
        helmet.delete()

        response = _post(requester, project, [_line(inventory_item=helmet_id)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_other_shapes_of_a_line_do_not_break_the_prefetch(self, requester, project):
        helmet = make_inventory('EPP-0001', 'Casco')

        for items in ([None, _line(inventory_item=helmet.pk)], ['text', {'inventory_item': helmet.pk}], [[1], 5]):
            assert _post(requester, project, items).status_code == status.HTTP_400_BAD_REQUEST
        assert _nothing_was_created()


@pytest.mark.django_db
class TestUnknownKeysAreOneBoundedWarning:
    def test_a_single_warning_for_a_whole_request(self, requester, project, caplog):
        items = [_line(description=f'Línea {n}', stock_almacen_principal='7') for n in range(150)]

        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = _post(requester, project, items)

        assert response.status_code == status.HTTP_201_CREATED, response.data
        records = _records(caplog)
        assert len(records) == 1
        record = records[0]
        assert record.levelno == logging.WARNING
        assert record.unknown_fields == ['stock_almacen_principal']
        assert record.unknown_total == 150
        assert record.lines_affected == 150
        assert record.user_id == requester.pk

    def test_at_most_ten_keys_each_cut_to_64_characters(self, requester, project, caplog):
        hostile = {f'{"k" * 500}_{n}': 'x' for n in range(40)}
        items = [_line(**hostile), _line(description='otra', **{'z' * 200: 1})]

        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = _post(requester, project, items)

        assert response.status_code == status.HTTP_201_CREATED, response.data
        (record,) = _records(caplog)
        assert len(record.unknown_fields) <= 10
        assert all(len(key) <= 64 for key in record.unknown_fields)
        assert record.unknown_total == 41
        assert record.lines_affected == 2

    def test_only_the_lines_with_unknown_keys_are_counted(self, requester, project, caplog):
        items = [_line(), _line(description='b', foo=1, bar=2), _line(description='c')]

        with capture_logs(caplog, 'apps.rq.serializers.request'):
            _post(requester, project, items)

        (record,) = _records(caplog)
        assert (record.unknown_fields, record.unknown_total, record.lines_affected) == (['bar', 'foo'], 2, 1)

    def test_no_warning_when_every_key_is_known(self, requester, project, caplog):
        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = _post(requester, project, [_line(), _line(description='b')])

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert _records(caplog) == []

    def test_the_warning_is_also_left_when_the_payload_is_then_rejected(self, requester, project, caplog):
        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = _post(requester, project, [_line(quantity='0', stock_almacen_principal=1)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert len(_records(caplog)) == 1

    def test_non_mapping_entries_are_ignored_by_the_report_and_rejected_by_validation(
        self, requester, project, caplog,
    ):
        with capture_logs(caplog, 'apps.rq.serializers.request'):
            response = _post(requester, project, [None, 'x', 3, [1], _line(extra=1)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        (record,) = _records(caplog)
        assert (record.unknown_fields, record.lines_affected) == (['extra'], 1)


@pytest.mark.django_db
class TestQuantityMustBePositive:
    @pytest.mark.parametrize('value', ['0', '0.000', 0, '-1', -0.5, '-0.001'])
    def test_zero_and_negative_quantities_are_rejected_in_spanish(self, requester, project, value):
        response = _post(requester, project, [_line(), _line(quantity=value)])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        errors = response.data['detail']['items'][1]['quantity']
        assert 'La cantidad debe ser mayor que cero.' in [str(e) for e in errors]
        assert _nothing_was_created()

    @pytest.mark.parametrize('value', ['0.001', '0.5', '1', 1, 2.5, '999999999.999'])
    def test_any_positive_quantity_is_accepted(self, requester, project, value):
        response = _post(requester, project, [_line(quantity=value)])

        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_a_missing_quantity_is_still_required(self, requester, project):
        line = _line()
        del line['quantity']

        response = _post(requester, project, [line])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'quantity' in response.data['detail']['items'][0]

    def test_a_blank_quantity_is_not_silently_turned_into_zero(self, requester, project):
        """The form used to send parseFloat('') || 0, and the API stored a line of 0 units."""
        response = _post(requester, project, [_line(quantity='')])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'quantity' in response.data['detail']['items'][0]
        assert _nothing_was_created()

    def test_a_quantity_with_more_than_three_decimals_is_still_rejected_not_rounded_to_zero(
        self, requester, project,
    ):
        response = _post(requester, project, [_line(quantity='0.0004')])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert _nothing_was_created()


@pytest.mark.usefixtures('rq_in_editable_state')
@pytest.mark.django_db
class TestUpdateItemsIdentifiers:
    def _patch(self, user, rq, items):
        return client_for(user).patch(f'/api/v1/requests/{rq.pk}/update-items/', {'items': items}, format='json')

    @pytest.mark.parametrize('value', [2**63 - 1, -(2**63), 2**31, -1, 0])
    def test_ids_inside_the_64_bit_range_are_not_lines_so_they_are_ignored(
        self, logistics_coordinator, ops_rq, value,
    ):
        make_item(ops_rq, 1)

        response = self._patch(logistics_coordinator, ops_rq, [{'item_id': value, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data['ignored_item_ids'] == [value]

    @pytest.mark.parametrize('value', [2**63, -(2**63) - 1, 10**30, -10**30, 10**100])
    def test_ids_outside_the_range_are_a_400_never_a_500(self, logistics_coordinator, ops_rq, value):
        line = make_item(ops_rq, 1)

        response = self._patch(logistics_coordinator, ops_rq, [{'item_id': value, 'supply_source': 'STOCK'}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'item_id' in response.data['detail']['items'][0]
        line.refresh_from_db()
        assert line.supply_source == ''

    def test_one_hostile_id_among_good_ones_rejects_the_whole_call_before_touching_anything(
        self, logistics_coordinator, ops_rq,
    ):
        line = make_item(ops_rq, 1)

        response = self._patch(logistics_coordinator, ops_rq, [
            {'item_id': line.pk, 'supply_source': 'STOCK'},
            {'item_id': 10**30, 'supply_source': 'STOCK'},
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        line.refresh_from_db()
        assert line.supply_source == ''

    def test_the_catalog_links_of_the_payload_are_resolved_with_one_query(self, logistics_coordinator, ops_rq):
        products = [make_inventory(f'EPP-{n:04d}', f'Producto {n}') for n in range(20)]
        lines = [make_item(ops_rq, n + 1) for n in range(20)]
        payload = [{'item_id': line.pk, 'inventory_item': products[n].pk} for n, line in enumerate(lines)]

        with CaptureQueriesContext(connection) as queries:
            response = self._patch(logistics_coordinator, ops_rq, payload)

        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data['updated_item_ids']) == 20
        validation_lookups = [
            q for q in _inventory_selects(queries.captured_queries) if 'IN (' in q or ' IN(' in q
        ]
        assert len(validation_lookups) == 1

    def test_a_missing_catalog_product_is_still_a_400_on_its_own_entry(self, logistics_coordinator, ops_rq):
        line = make_item(ops_rq, 1)
        other = make_item(ops_rq, 2)

        response = self._patch(logistics_coordinator, ops_rq, [
            {'item_id': line.pk, 'supply_source': 'STOCK'},
            {'item_id': other.pk, 'inventory_item': 999999},
        ])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'inventory_item' in response.data['detail']['items'][1]
        line.refresh_from_db()
        assert line.supply_source == ''
