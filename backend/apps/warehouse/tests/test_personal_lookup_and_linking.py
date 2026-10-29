"""SYSPCC-025 — lookup mínimo de personal para almacén y vinculación de destinos."""
import pytest

from apps.core.enums import RoleChoices
from apps.warehouse.services import movements as svc
from .conftest import client_for, make_user

LOOKUP = '/api/v1/warehouse/personal-lookup/'
LINK = '/api/v1/warehouse/movements/link-personal/'


@pytest.mark.django_db
class TestPersonalLookup:
    def test_requires_three_characters(self, central_warehouse):
        for q in ('', 'ab', '  a '):
            assert client_for(central_warehouse).get(LOOKUP, {'search': q}).status_code == 400

    def test_returns_only_minimal_fields_of_active_workers(self, central_warehouse, make_personal):
        make_personal('Quispe Rojas, Carlos Test')
        make_personal('Quispe Vega, Lucia Test', active=False)
        resp = client_for(central_warehouse).get(LOOKUP, {'search': 'quispe'})
        assert resp.status_code == 200
        assert resp.headers['Cache-Control'] == 'no-store'
        assert len(resp.data) == 1
        assert set(resp.data[0]) == {'id', 'full_name', 'position', 'project_code'}   # sin DNI ni sueldo
        assert resp.data[0]['full_name'] == 'Quispe Rojas, Carlos Test'
        assert '9000' not in str(resp.data)   # ni rastro del DNI

    def test_search_is_accent_and_order_insensitive(self, central_warehouse, make_personal):
        make_personal('Ñahui Pérez, José Test')
        client = client_for(central_warehouse)
        assert len(client.get(LOOKUP, {'search': 'perez nahui'}).data) == 1
        assert len(client.get(LOOKUP, {'search': 'JOSE'}).data) == 1
        assert client.get(LOOKUP, {'search': 'zzzz'}).data == []

    def test_results_are_capped_at_20(self, central_warehouse, make_personal):
        for i in range(25):
            make_personal(f'Apellido{i:02d} Comun, Nombre Test')
        assert len(client_for(central_warehouse).get(LOOKUP, {'search': 'comun'}).data) == 20

    @pytest.mark.parametrize('role', [RoleChoices.REQUESTER, RoleChoices.HR_MANAGER, RoleChoices.GENERAL_MANAGER])
    def test_only_warehouse_roles(self, role):
        user = make_user(f'lk_{role.lower()}', role)
        assert client_for(user).get(LOOKUP, {'search': 'quispe'}).status_code == 403

    @pytest.mark.parametrize('fixture', ['central_warehouse', 'logistics_chief', 'site_warehouse'])
    def test_only_the_roles_that_need_it_can_search(self, fixture, request):
        """Counter roles (EPP recipient) and the roles that link destinations (import/link)."""
        user = request.getfixturevalue(fixture)
        assert client_for(user).get(LOOKUP, {'search': 'quispe'}).status_code == 200

    @pytest.mark.parametrize('fixture', ['logistics_supervisor', 'logistics_coordinator'])
    def test_logistics_coordinators_and_supervisors_cannot_enumerate_the_staff(
        self, fixture, request, make_personal,
    ):
        """Their screens never offer the EPP mode: the lookup is not an open directory for them."""
        make_personal('Quispe Mamani, Rosa Test')
        user = request.getfixturevalue(fixture)
        response = client_for(user).get(LOOKUP, {'search': 'quispe'})
        assert response.status_code == 403
        assert 'Quispe' not in response.content.decode()

    def test_unauthenticated(self, api_client):
        assert api_client.get(LOOKUP, {'search': 'quispe'}).status_code in (401, 403)

    def test_does_not_log_the_query_or_names(self, central_warehouse, make_personal, app_logs):
        make_personal('Chambi Soncco, Pedro Test')
        client_for(central_warehouse).get(LOOKUP, {'search': 'chambi'})
        assert 'warehouse.personal_lookup' in app_logs.events()
        assert 'chambi' not in app_logs.dump().lower()

    def test_hr_endpoint_stays_closed_for_warehouse(self, central_warehouse):
        # La API completa de RR. HH. (con DNI/sueldo) no se abre al almacén.
        assert client_for(central_warehouse).get('/api/v1/personal/').status_code == 403


def _exit(item, user, detail, **kw):
    return svc.register_exit_batch(
        items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail=detail, requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user, **kw)


@pytest.mark.django_db
class TestLinkPersonal:
    @pytest.fixture(autouse=True)
    def _setup(self, make_item, central_warehouse, make_personal):
        self.item = make_item('EPP1', 'a', stock=20)
        self.user = central_warehouse
        self.person = make_personal('Vilca Ramos, Sonia Test')
        self.other = make_personal('Otro Distinto, Nombre Test')
        self.g1 = _exit(self.item, self.user, 'VILCA RAMOS SONIA TEST')
        self.g2 = _exit(self.item, self.user, 'Sonia Test Vilca Ramos')       # misma persona, otro formato
        self.g3 = _exit(self.item, self.user, 'Otro Distinto Nombre Test')    # persona distinta
        self.g4 = _exit(self.item, self.user, 'Vilca Ramos Sonia Test', destination_personal_id=self.other.pk)

    def _key(self):
        row = client_for(self.user).get(
            '/api/v1/warehouse/movements/',
            {'destination': 'VILCA RAMOS SONIA', 'unlinked_destination': 'true'}).data['results'][0]
        return row['destination_key']

    def test_links_every_spelling_of_the_destination_in_bulk(self):
        resp = client_for(self.user).post(LINK, {'destination_key': self._key(), 'personal': self.person.pk},
                                          format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data == {'linked_movements': 2, 'linked_groups': 2}
        for g in (self.g1, self.g2):
            g.refresh_from_db()
            assert g.destination_personal_id == self.person.pk
            assert g.destination_detail                       # el texto original se conserva
        self.g3.refresh_from_db(); self.g4.refresh_from_db()
        assert self.g3.destination_personal_id is None        # otro nombre: intacto
        assert self.g4.destination_personal_id == self.other.pk   # ya vinculado: no se pisa

    def test_is_idempotent(self):
        client = client_for(self.user)
        payload = {'destination_key': self._key(), 'personal': self.person.pk}
        client.post(LINK, payload, format='json')
        again = client.post(LINK, payload, format='json')
        assert again.data == {'linked_movements': 0, 'linked_groups': 0}

    def test_accepts_a_raw_name_as_key_and_normalizes_it(self):
        resp = client_for(self.user).post(
            LINK, {'destination_key': 'VILCA, Ramos Sonia Test', 'personal': self.person.pk}, format='json')
        assert resp.data['linked_groups'] == 2

    @pytest.mark.parametrize('payload', [
        {'destination_key': '', 'personal': 1}, {'destination_key': '---', 'personal': 1},
        {'destination_key': 'x'}, {'personal': 1},
    ])
    def test_invalid_payload(self, payload):
        assert client_for(self.user).post(LINK, payload, format='json').status_code == 400

    def test_unknown_personal(self):
        resp = client_for(self.user).post(LINK, {'destination_key': 'sonia', 'personal': 99999}, format='json')
        assert resp.status_code == 400

    def test_logistics_chief_allowed_others_forbidden(self, logistics_chief, logistics_supervisor, site_warehouse):
        payload = {'destination_key': self._key(), 'personal': self.person.pk}
        assert client_for(site_warehouse).post(LINK, payload, format='json').status_code == 403
        assert client_for(logistics_supervisor).post(LINK, payload, format='json').status_code == 403
        assert client_for(logistics_chief).post(LINK, payload, format='json').status_code == 200

    def test_does_not_log_names(self, app_logs):
        client_for(self.user).post(LINK, {'destination_key': self._key(), 'personal': self.person.pk},
                                   format='json')
        assert 'warehouse.link_personal' in app_logs.events()
        dump = app_logs.dump().lower()
        assert 'vilca' not in dump and 'sonia' not in dump
