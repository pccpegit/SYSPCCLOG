"""
SYSPCC-026 (Fase 1, ronda 1 de correcciones): provenance of the catalog link.

A product (or the off-catalog mark) that the REQUESTER proposes when creating the
RQ is not the same thing as one that logistics checked. `RequestItem` keeps
`inventory_item_confirmed_at/_by`, NULL at creation; only an explicit decision of
logistics through PATCH update-items stamps them; the API exposes `link_confirmed`
(RQ detail, update-items response and stock-availability) and creating a request
with proposed products leaves an ActivityLog entry.

Nothing here touches the workflow: the confirmation is data on the line, not a
state of the RQ, and no transition looks at it.
"""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status

from apps.rq.models import ActivityLog, Request, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    client_for,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    ops_rq,
    rq_in_editable_state,
)

CREATE_URL = '/api/v1/requests/'

pytestmark = pytest.mark.usefixtures('rq_in_editable_state')


def _payload(project, items):
    for number, item in enumerate(items, start=1):
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


def _patch(user, rq, items):
    return client_for(user).patch(f'/api/v1/requests/{rq.pk}/update-items/', {'items': items}, format='json')


def _availability_row(user, rq, line_number=1):
    response = client_for(user).get(f'/api/v1/requests/{rq.pk}/stock-availability/')
    assert response.status_code == status.HTTP_200_OK, response.data
    return {row['line_number']: row for row in response.data['items']}[line_number]


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND')


@pytest.fixture
def gloves(db):
    return make_inventory('EPP-0002', 'Guantes de cuero', 'PAR')


@pytest.mark.django_db
class TestCreationProposesNeverConfirms:
    def test_a_product_picked_by_the_requester_is_stored_unconfirmed(self, requester, project, helmet):
        response = client_for(requester).post(
            CREATE_URL, _payload(project, [_line(inventory_item=helmet.pk)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get()
        assert stored.inventory_item_id == helmet.pk
        assert stored.inventory_item_confirmed_at is None
        assert stored.inventory_item_confirmed_by_id is None
        assert stored.link_confirmed is False
        assert response.data['items'][0]['link_confirmed'] is False

    def test_an_off_catalog_mark_by_the_requester_is_unconfirmed_too(self, requester, project):
        response = client_for(requester).post(
            CREATE_URL, _payload(project, [_line(is_off_catalog=True)]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert RequestItem.objects.get().link_confirmed is False
        assert response.data['items'][0]['link_confirmed'] is False

    @pytest.mark.parametrize('field,value', [
        ('inventory_item_confirmed_at', '2026-01-01T00:00:00Z'),
        ('inventory_item_confirmed_by', 1),
        ('link_confirmed', True),
    ])
    def test_the_requester_cannot_pre_confirm_by_sending_the_fields(
        self, requester, project, helmet, field, value,
    ):
        """The confirmation fields are not writable through the creation payload."""
        response = client_for(requester).post(
            CREATE_URL, _payload(project, [_line(inventory_item=helmet.pk, **{field: value})]), format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        stored = RequestItem.objects.get()
        assert stored.inventory_item_confirmed_at is None
        assert stored.inventory_item_confirmed_by_id is None
        assert stored.link_confirmed is False

    def test_the_detail_of_the_rq_reports_the_flag_per_line(self, requester, project, helmet):
        created = client_for(requester).post(
            CREATE_URL,
            _payload(project, [_line(inventory_item=helmet.pk), _line(description='Sin vincular')]),
            format='json',
        )
        rq_id = Request.objects.get(rq_number=created.data['rq_number']).pk

        detail = client_for(requester).get(f'/api/v1/requests/{rq_id}/')

        assert [line['link_confirmed'] for line in detail.data['items']] == [False, False]


@pytest.mark.django_db
class TestCreationLeavesAnAuditTrail:
    def test_proposed_products_are_logged_for_logistics(self, requester, project, helmet, gloves):
        response = client_for(requester).post(
            CREATE_URL,
            _payload(project, [
                _line(inventory_item=helmet.pk),
                _line(description='Guantes', inventory_item=gloves.pk),
                _line(description='Servicio de flete', is_off_catalog=True),
            ]),
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        entry = ActivityLog.objects.get(request__rq_number=response.data['rq_number'])
        assert entry.action == 'CATALOG_LINKS_PROPOSED'
        assert entry.user_id == requester.pk
        assert 'propuestos por el solicitante' in entry.detail
        assert 'pendientes de confirmación de Logística' in entry.detail
        assert 'Línea 1: EPP-0001 - Casco de seguridad blanco' in entry.detail
        assert 'Línea 2: EPP-0002 - Guantes de cuero' in entry.detail
        assert 'flete' not in entry.detail  # off-catalog lines carry no product

    def test_no_entry_when_nothing_was_proposed(self, requester, project):
        response = client_for(requester).post(CREATE_URL, _payload(project, [_line()]), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert not ActivityLog.objects.filter(request__rq_number=response.data['rq_number']).exists()

    def test_the_entry_is_visible_in_the_activity_endpoint(self, requester, project, helmet):
        created = client_for(requester).post(
            CREATE_URL, _payload(project, [_line(inventory_item=helmet.pk)]), format='json',
        )
        rq_id = Request.objects.get(rq_number=created.data['rq_number']).pk

        activity = client_for(requester).get(f'/api/v1/requests/{rq_id}/activity/')

        assert [row['action'] for row in activity.data] == ['CATALOG_LINKS_PROPOSED']

    def test_a_long_proposal_is_summarised_not_dumped(self, requester, project):
        products = [make_inventory(f'EPP-{n:04d}', f'Producto {n}') for n in range(60)]
        items = [_line(description=f'Línea {n}', inventory_item=p.pk) for n, p in enumerate(products, 1)]

        response = client_for(requester).post(CREATE_URL, _payload(project, items), format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        entry = ActivityLog.objects.get(request__rq_number=response.data['rq_number'])
        assert 'Línea 50:' in entry.detail
        assert 'Línea 51:' not in entry.detail
        assert 'y 10 más' in entry.detail

    def test_a_failed_creation_leaves_no_entry(self, requester, project, helmet):
        response = client_for(requester).post(
            CREATE_URL, _payload(project, [_line(inventory_item=helmet.pk, quantity='0')]), format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ActivityLog.objects.count() == 0


@pytest.mark.django_db
class TestLogisticsConfirms:
    def test_linking_a_product_confirms_it_with_who_and_when(self, logistics_coordinator, ops_rq, helmet):
        line = make_item(ops_rq, 1)
        before = timezone.now()

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert line.link_confirmed is True
        assert line.inventory_item_confirmed_by_id == logistics_coordinator.pk
        assert before <= line.inventory_item_confirmed_at <= timezone.now()
        assert response.data['items'][0]['link_confirmed'] is True

    def test_sending_the_proposed_product_back_confirms_it_even_if_the_value_is_the_same(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        """The core of the fix: the requester's proposal becomes a confirmed link only by logistics' say-so."""
        line = make_item(ops_rq, 1, inventory_item=helmet)
        assert line.link_confirmed is False

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data['updated_item_ids'] == [line.pk]
        assert response.data['unchanged_item_ids'] == []
        line.refresh_from_db()
        assert line.inventory_item_id == helmet.pk
        assert line.link_confirmed is True
        assert line.inventory_item_confirmed_by_id == logistics_coordinator.pk

    def test_marking_off_catalog_confirms_it(self, logistics_coordinator, ops_rq):
        line = make_item(ops_rq, 1)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert (line.is_off_catalog, line.link_confirmed) == (True, True)
        assert line.inventory_item_confirmed_by_id == logistics_coordinator.pk

    def test_confirming_an_off_catalog_mark_proposed_by_the_requester(self, logistics_coordinator, ops_rq):
        line = make_item(ops_rq, 1, is_off_catalog=True)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': True}])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert line.link_confirmed is True

    @pytest.mark.parametrize('entry', [
        {'supply_source': 'STOCK'},
        {'item_source': 'GASES'},
        {'supply_source': 'PURCHASE', 'item_source': 'EPP'},
    ])
    def test_editing_other_fields_never_confirms_the_proposed_link(
        self, logistics_coordinator, ops_rq, helmet, entry,
    ):
        line = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, **entry}])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert line.inventory_item_id == helmet.pk
        assert line.link_confirmed is False
        assert line.inventory_item_confirmed_at is None

    def test_editing_other_fields_keeps_an_existing_confirmation(self, logistics_coordinator, ops_rq, helmet):
        stamp = timezone.now() - timedelta(days=1)
        line = make_item(
            ops_rq, 1, inventory_item=helmet,
            inventory_item_confirmed_at=stamp, inventory_item_confirmed_by=logistics_coordinator,
        )

        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'supply_source': 'STOCK'}])

        line.refresh_from_db()
        assert line.link_confirmed is True
        assert line.inventory_item_confirmed_at == stamp

    def test_resending_the_same_confirmed_decision_keeps_who_and_when(
        self, logistics_coordinator, logistics_supervisor, ops_rq, helmet,
    ):
        stamp = timezone.now() - timedelta(days=1)
        line = make_item(
            ops_rq, 1, inventory_item=helmet,
            inventory_item_confirmed_at=stamp, inventory_item_confirmed_by=logistics_coordinator,
        )

        response = _patch(logistics_supervisor, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data['unchanged_item_ids'] == [line.pk]
        line.refresh_from_db()
        assert line.inventory_item_confirmed_at == stamp
        assert line.inventory_item_confirmed_by_id == logistics_coordinator.pk
        assert not ActivityLog.objects.filter(request=ops_rq).exists()

    def test_changing_the_product_re_confirms_it_with_the_new_author(
        self, logistics_coordinator, logistics_supervisor, ops_rq, helmet, gloves,
    ):
        stamp = timezone.now() - timedelta(days=1)
        line = make_item(
            ops_rq, 1, inventory_item=helmet,
            inventory_item_confirmed_at=stamp, inventory_item_confirmed_by=logistics_coordinator,
        )

        _patch(logistics_supervisor, ops_rq, [{'item_id': line.pk, 'inventory_item': gloves.pk}])

        line.refresh_from_db()
        assert line.inventory_item_id == gloves.pk
        assert line.link_confirmed is True
        assert line.inventory_item_confirmed_by_id == logistics_supervisor.pk
        assert line.inventory_item_confirmed_at > stamp

    def test_dropping_the_link_leaves_nothing_confirmed(self, logistics_coordinator, ops_rq, helmet):
        line = make_item(
            ops_rq, 1, inventory_item=helmet,
            inventory_item_confirmed_at=timezone.now(), inventory_item_confirmed_by=logistics_coordinator,
        )

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': None}])

        assert response.status_code == status.HTTP_200_OK, response.data
        line.refresh_from_db()
        assert line.inventory_item_id is None
        assert line.link_confirmed is False
        assert line.inventory_item_confirmed_at is None
        assert line.inventory_item_confirmed_by_id is None

    def test_unmarking_off_catalog_leaves_nothing_to_confirm(self, logistics_coordinator, ops_rq):
        line = make_item(
            ops_rq, 1, is_off_catalog=True,
            inventory_item_confirmed_at=timezone.now(), inventory_item_confirmed_by=logistics_coordinator,
        )

        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': False}])

        line.refresh_from_db()
        assert (line.is_off_catalog, line.link_confirmed) == (False, False)
        assert line.inventory_item_confirmed_at is None

    def test_switching_from_off_catalog_to_a_product_confirms_the_product(
        self, logistics_coordinator, ops_rq, helmet,
    ):
        line = make_item(ops_rq, 1, is_off_catalog=True)

        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        line.refresh_from_db()
        assert (line.inventory_item_id, line.is_off_catalog, line.link_confirmed) == (helmet.pk, False, True)

    def test_each_line_of_one_call_is_confirmed_independently(self, logistics_coordinator, ops_rq, helmet, gloves):
        first = make_item(ops_rq, 1, inventory_item=helmet)
        second = make_item(ops_rq, 2, inventory_item=gloves)

        _patch(logistics_coordinator, ops_rq, [
            {'item_id': first.pk, 'inventory_item': helmet.pk},
            {'item_id': second.pk, 'supply_source': 'PURCHASE'},
        ])

        first.refresh_from_db()
        second.refresh_from_db()
        assert (first.link_confirmed, second.link_confirmed) == (True, False)

    def test_the_activity_entry_says_the_link_was_confirmed(self, logistics_coordinator, ops_rq, helmet):
        line = make_item(ops_rq, 1, inventory_item=helmet)

        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        entry = ActivityLog.objects.get(request=ops_rq)
        assert entry.action == 'ITEMS_UPDATED'
        assert 'vínculo confirmado (EPP-0001 - Casco de seguridad blanco)' in entry.detail

    def test_a_new_product_and_its_confirmation_share_one_phrase(self, logistics_coordinator, ops_rq, helmet):
        line = make_item(ops_rq, 1)

        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        detail = ActivityLog.objects.get(request=ops_rq).detail
        assert 'producto de catálogo: EPP-0001 - Casco de seguridad blanco' in detail
        assert detail.count('vínculo confirmado') == 1

    def test_the_requester_cannot_confirm_through_the_endpoint(self, requester, ops_rq, helmet):
        line = make_item(ops_rq, 1, inventory_item=helmet)

        response = _patch(requester, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        line.refresh_from_db()
        assert line.link_confirmed is False

    def test_a_blocked_edit_does_not_confirm(self, logistics_coordinator, ops_rq, helmet):
        """A 409 writes nothing, confirmation included."""
        line = make_item(ops_rq, 1, inventory_item=helmet)
        ops_rq.status = 'DELIVERED'
        ops_rq.save(update_fields=['status'])

        response = _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert response.status_code == status.HTTP_409_CONFLICT
        line.refresh_from_db()
        assert line.link_confirmed is False


@pytest.mark.django_db
class TestLinkConfirmedModelProperty:
    def test_a_stale_confirmation_without_a_target_does_not_count(self, ops_rq, helmet):
        """If the product is removed by other means (admin, SET_NULL on delete) the old stamp is meaningless."""
        line = make_item(ops_rq, 1, inventory_item=helmet, inventory_item_confirmed_at=timezone.now())
        assert line.link_confirmed is True

        helmet.delete()
        line.refresh_from_db()

        assert line.inventory_item_id is None
        assert line.link_confirmed is False

    def test_a_line_with_nothing_chosen_is_not_confirmed(self, ops_rq):
        assert make_item(ops_rq, 1).link_confirmed is False

    def test_quantity_validator_rejects_zero_at_model_level(self, ops_rq):
        from django.core.exceptions import ValidationError

        line = make_item(ops_rq, 1)
        line.quantity = Decimal('0')

        with pytest.raises(ValidationError) as excinfo:
            line.full_clean()

        assert 'La cantidad debe ser mayor que cero.' in excinfo.value.message_dict['quantity']
        line.quantity = Decimal('0.001')
        line.full_clean()


@pytest.mark.django_db
class TestStockAvailabilityExposesTheFlag:
    def test_a_proposed_product_is_linked_but_not_confirmed(self, logistics_coordinator, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        row = _availability_row(logistics_coordinator, ops_rq)

        assert row['link_status'] == 'LINKED'
        assert row['link_confirmed'] is False

    def test_it_turns_true_after_logistics_confirms(self, logistics_coordinator, ops_rq, helmet):
        line = make_item(ops_rq, 1, inventory_item=helmet)
        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'inventory_item': helmet.pk}])

        assert _availability_row(logistics_coordinator, ops_rq)['link_confirmed'] is True

    def test_off_catalog_and_unlinked_lines_report_the_flag_too(self, logistics_coordinator, ops_rq):
        make_item(ops_rq, 1, is_off_catalog=True)
        make_item(ops_rq, 2)

        assert _availability_row(logistics_coordinator, ops_rq, 1)['link_confirmed'] is False
        assert _availability_row(logistics_coordinator, ops_rq, 2)['link_confirmed'] is False

        line = RequestItem.objects.get(request=ops_rq, line_number=1)
        _patch(logistics_coordinator, ops_rq, [{'item_id': line.pk, 'is_off_catalog': True}])
        assert _availability_row(logistics_coordinator, ops_rq, 1)['link_confirmed'] is True
        assert _availability_row(logistics_coordinator, ops_rq, 2)['link_confirmed'] is False
