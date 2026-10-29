"""
SYSPCC-026 (Fase 1, revisión): the size cap of PATCH update-items.

develop had no cap and the stock-check screen sends EVERY line of the RQ in one PATCH.
A fixed `MAX_ITEMS` would therefore make the stock check impossible for an RQ with more
lines than the cap (one created before the 200-line creation limit). The cap bounds a
hostile payload; it is `max(MAX_ITEMS, lines the RQ has)`, so it can never reject a full,
legitimate payload.

The real constant (500) is replaced by a small one in these tests so they stay fast.
"""
import pytest
from rest_framework import status

from apps.rq.serializers.request import UpdateItemsSerializer
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    client_for,
    logistics_supervisor,
    make_item,
    ops_rq,
    rq_in_editable_state,
)

CAP = 5


@pytest.fixture(autouse=True)
def _small_cap(monkeypatch):
    monkeypatch.setattr(UpdateItemsSerializer, 'MAX_ITEMS', CAP)


def _patch(user, rq, entries):
    url = f'/api/v1/requests/{rq.pk}/update-items/'
    return client_for(user).patch(url, {'items': entries}, format='json')


def _lines(rq, how_many):
    return [make_item(rq, n, description=f'Línea {n}') for n in range(1, how_many + 1)]


@pytest.mark.django_db
class TestPayloadCap:
    @pytest.fixture(autouse=True)
    def _editable(self, rq_in_editable_state):
        pass

    def test_the_real_cap_is_still_500(self, monkeypatch):
        monkeypatch.undo()
        assert UpdateItemsSerializer.MAX_ITEMS == 500

    def test_a_payload_within_the_cap_is_accepted(self, ops_rq, logistics_supervisor):
        lines = _lines(ops_rq, CAP)

        response = _patch(
            logistics_supervisor, ops_rq,
            [{'item_id': line.pk, 'supply_source': 'STOCK'} for line in lines],
        )

        assert response.status_code == status.HTTP_200_OK, response.data

    def test_a_payload_over_the_cap_is_rejected_with_a_clear_message(self, ops_rq, logistics_supervisor):
        lines = _lines(ops_rq, 2)
        # More entries than the cap AND than the RQ has lines: the foreign ids are hostile padding.
        entries = [{'item_id': line.pk, 'supply_source': 'STOCK'} for line in lines]
        entries += [{'item_id': 10_000 + n, 'supply_source': 'STOCK'} for n in range(CAP)]

        response = _patch(logistics_supervisor, ops_rq, entries)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        messages = [str(m) for m in response.data['detail']['items']['non_field_errors']]
        assert messages == [f'Se pueden actualizar como máximo {CAP} ítems por solicitud.']
        for line in lines:
            line.refresh_from_db()
            assert line.supply_source == ''

    def test_a_request_with_more_lines_than_the_cap_can_still_be_updated_whole(
        self, ops_rq, logistics_supervisor,
    ):
        """The case the cap must not break: a historical RQ whose full payload is above it."""
        lines = _lines(ops_rq, CAP + 3)

        response = _patch(
            logistics_supervisor, ops_rq,
            [{'item_id': line.pk, 'supply_source': 'PURCHASE'} for line in lines],
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data['updated_item_ids']) == CAP + 3

    def test_the_larger_cap_does_not_open_the_door_to_padding(self, ops_rq, logistics_supervisor):
        """With 8 lines the cap is 8: one more entry than lines is already over it."""
        lines = _lines(ops_rq, CAP + 3)
        entries = [{'item_id': line.pk, 'supply_source': 'STOCK'} for line in lines]
        entries.append({'item_id': 99_999, 'supply_source': 'STOCK'})

        response = _patch(logistics_supervisor, ops_rq, entries)

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_without_context_the_plain_cap_applies(self):
        serializer = UpdateItemsSerializer(data={'items': []})

        assert serializer.fields['items'].max_length == CAP

    def test_the_line_count_of_one_request_does_not_leak_into_another_serializer(self):
        big = UpdateItemsSerializer(data={'items': []}, context={'line_count': 50})
        plain = UpdateItemsSerializer(data={'items': []})

        assert big.fields['items'].max_length == 50
        assert plain.fields['items'].max_length == CAP
