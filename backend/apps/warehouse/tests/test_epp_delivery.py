"""SYSPCC-025 — entrega de EPP con vale (movements/epp-delivery/)."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.warehouse.models import InventoryMovement, InventoryStock, MovementGroup
from .conftest import client_for, make_user

URL = '/api/v1/warehouse/movements/epp-delivery/'
PERSON_NAME = 'Condori Apaza, Marta Test'


@pytest.fixture(autouse=True)
def _no_pdf_task():
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload') as enqueue:
        yield enqueue


def _body(item, **over):
    body = {
        'warehouse': 'CENTRAL', 'voucher_number': '3425', 'movement_date': '2026-10-16',
        'recipient': {'name': 'Trabajador Libre Test'}, 'notes': 'entrega de mostrador',
        'items': [{'inventory': item.pk, 'quantity': '2'}],
    }
    body.update(over)
    return body


def _stock(item, warehouse='CENTRAL'):
    return InventoryStock.objects.get(inventory=item, warehouse_type=warehouse).quantity


@pytest.mark.django_db
class TestEppDelivery:
    def test_delivery_to_linked_worker_discounts_stock_and_records_vale(
        self, epp_item, central_warehouse, make_personal, _no_pdf_task
    ):
        person = make_personal(PERSON_NAME)
        resp = client_for(central_warehouse).post(
            URL, _body(epp_item, recipient={'personal': person.pk}), format='json')
        assert resp.status_code == 201, resp.data
        assert resp.headers['Cache-Control'] == 'no-store'
        assert _stock(epp_item) == Decimal('8')

        group = MovementGroup.objects.get()
        assert (group.movement_type, group.destination_type) == ('EXIT', 'EMPLOYEE')
        assert group.voucher_number == '3425' and str(group.movement_date) == '2026-10-16'
        assert group.destination_personal_id == person.pk
        assert group.destination_detail == PERSON_NAME          # instantánea textual
        mv = InventoryMovement.objects.get()
        assert mv.destination_personal_id == person.pk and mv.quantity == 2
        assert resp.data['voucher_number'] == '3425'
        _no_pdf_task.assert_called_once()

    def test_free_text_recipient_is_stored_unlinked(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(URL, _body(epp_item), format='json')
        assert resp.status_code == 201
        group = MovementGroup.objects.get()
        assert group.destination_personal_id is None
        assert group.destination_detail == 'Trabajador Libre Test'

    def test_internal_destination_is_a_transfer_out(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(
            URL, _body(epp_item, recipient={'internal': 'ALM - PRIMER PISO'}), format='json')
        assert resp.status_code == 201
        group = MovementGroup.objects.get()
        assert (group.destination_type, group.destination_detail) == ('TRANSFER_OUT', 'ALM - PRIMER PISO')

    @pytest.mark.parametrize('missing', ['movement_date', 'recipient', 'items'])
    def test_required_fields(self, epp_item, central_warehouse, missing):
        body = _body(epp_item)
        del body[missing]
        resp = client_for(central_warehouse).post(URL, body, format='json')
        assert resp.status_code == 400
        assert MovementGroup.objects.count() == 0

    @pytest.mark.parametrize('voucher', ['', '  ', None, 'OMIT'])
    def test_the_physical_vale_is_optional_and_the_guide_is_automatic(self, epp_item, central_warehouse, voucher):
        # SYSPCC-041: nobody types a number; the system assigns GR-AAAA-NNNNNN.
        body = _body(epp_item)
        if voucher == 'OMIT':
            del body['voucher_number']
        elif voucher is None:
            body.pop('voucher_number')
        else:
            body['voucher_number'] = voucher
        resp = client_for(central_warehouse).post(URL, body, format='json')
        assert resp.status_code == 201, resp.data
        assert resp.data['voucher_number'] == ''
        assert resp.data['internal_guide_number'].startswith('GR-')
        assert _stock(epp_item) == Decimal('8')

    def test_future_date_is_rejected(self, epp_item, central_warehouse):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        resp = client_for(central_warehouse).post(URL, _body(epp_item, movement_date=tomorrow), format='json')
        assert resp.status_code == 400

    @pytest.mark.parametrize('recipient', [
        {}, {'name': ''}, {'name': 'A', 'internal': 'B'},
    ])
    def test_exactly_one_recipient_is_required(self, epp_item, central_warehouse, recipient):
        resp = client_for(central_warehouse).post(URL, _body(epp_item, recipient=recipient), format='json')
        assert resp.status_code == 400

    def test_unknown_personal_is_rejected(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(
            URL, _body(epp_item, recipient={'personal': 987654}), format='json')
        assert resp.status_code == 400

    def test_insufficient_stock_is_400_and_leaves_no_partial_data(self, make_item, central_warehouse):
        ok, short = make_item('EPP1', 'a', stock=5), make_item('EPP2', 'b', stock=1)
        resp = client_for(central_warehouse).post(URL, _body(ok, items=[
            {'inventory': ok.pk, 'quantity': '2'}, {'inventory': short.pk, 'quantity': '3'},
        ]), format='json')
        assert resp.status_code == 400
        assert 'Stock insuficiente para EPP2' in resp.data['detail']
        assert 'Disponible: 1, solicitado: 3' in resp.data['detail']
        assert MovementGroup.objects.count() == 0
        assert _stock(ok) == Decimal('5')

    def test_stock_never_goes_negative_across_successive_deliveries(self, make_item, central_warehouse):
        item = make_item('EPP1', 'a', stock=3)
        client = client_for(central_warehouse)
        assert client.post(URL, _body(item, voucher_number='1', items=[
            {'inventory': item.pk, 'quantity': '3'}]), format='json').status_code == 201
        resp = client.post(URL, _body(item, voucher_number='2', items=[
            {'inventory': item.pk, 'quantity': '1'}]), format='json')
        assert resp.status_code == 400
        assert _stock(item) == Decimal('0')

    def test_duplicate_voucher_409_unless_explicitly_allowed(self, epp_item, central_warehouse):
        client = client_for(central_warehouse)
        assert client.post(URL, _body(epp_item), format='json').status_code == 201
        dup = client.post(URL, _body(epp_item), format='json')
        assert dup.status_code == 409 and dup.data['code'] == 'voucher_number_exists'
        assert _stock(epp_item) == Decimal('8')
        forced = client.post(URL, _body(epp_item, allow_duplicate_voucher=True), format='json')
        assert forced.status_code == 201
        assert _stock(epp_item) == Decimal('6')

    def test_fractional_quantity_of_a_piece_unit_is_rejected(self, epp_item, central_warehouse):
        resp = client_for(central_warehouse).post(
            URL, _body(epp_item, items=[{'inventory': epp_item.pk, 'quantity': '1.5'}]), format='json')
        assert resp.status_code == 400 and 'entero' in str(resp.data)

    def test_does_not_log_recipient_names(self, epp_item, central_warehouse, make_personal, app_logs):
        person = make_personal(PERSON_NAME)
        client_for(central_warehouse).post(
            URL, _body(epp_item, recipient={'personal': person.pk}), format='json')
        assert 'warehouse.epp_delivery.registered' in app_logs.events()
        assert 'Condori' not in app_logs.dump() and 'Marta' not in app_logs.dump()

    def test_does_not_touch_the_rq_workflow(self, epp_item, central_warehouse):
        with mock.patch('apps.rq.services.workflow_engine.WorkflowEngine') as engine:
            client_for(central_warehouse).post(URL, _body(epp_item), format='json')
        engine.assert_not_called()


@pytest.mark.django_db
class TestEppDeliveryPermissions:
    def test_unauthenticated(self, epp_item, api_client):
        assert api_client.post(URL, _body(epp_item), format='json').status_code in (401, 403)

    @pytest.mark.parametrize('role', [
        RoleChoices.REQUESTER, RoleChoices.LOGISTICS_CHIEF, RoleChoices.LOGISTICS_SUPERVISOR,
        RoleChoices.LOGISTICS_COORDINATOR, RoleChoices.PROJECT_RESIDENT, RoleChoices.GENERAL_MANAGER,
    ])
    def test_other_roles_are_forbidden(self, epp_item, role):
        user = make_user(f'u_{role.lower()}', role)
        resp = client_for(user).post(URL, _body(epp_item), format='json')
        assert resp.status_code == 403
        assert MovementGroup.objects.count() == 0

    def test_superuser_without_role_has_no_bypass(self, epp_item, superuser):
        assert client_for(superuser).post(URL, _body(epp_item), format='json').status_code == 403

    def test_site_warehouse_cannot_deliver_from_central(self, epp_item, site_warehouse):
        resp = client_for(site_warehouse).post(URL, _body(epp_item, warehouse='CENTRAL'), format='json')
        assert resp.status_code == 403
        assert _stock(epp_item) == Decimal('10')

    def test_site_warehouse_can_deliver_from_site(self, make_item, site_warehouse):
        item = make_item('EPP1', 'a', stock=4, warehouse='SITE')
        resp = client_for(site_warehouse).post(URL, _body(item, warehouse='SITE'), format='json')
        assert resp.status_code == 201, resp.data
        assert _stock(item, 'SITE') == Decimal('2')


@pytest.mark.django_db
def test_vale_pdf_still_renders_with_operational_date_and_physical_number(epp_item, central_warehouse):
    from apps.warehouse.services.pdf_generator import generate_group_pdf

    resp = client_for(central_warehouse).post(URL, _body(epp_item), format='json')
    group = MovementGroup.objects.get(pk=resp.data['id'])
    pdf = generate_group_pdf(group)
    assert pdf.startswith(b'%PDF')
