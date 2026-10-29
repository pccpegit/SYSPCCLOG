"""
SYSPCC-030 · GET /api/v1/request-master/summary/ (una fila por RQ + KPIs).
"""
import pytest

from apps.rq.tests.master_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse, client_for, logistics_chief, logistics_supervisor, make_item, world,
)

URL = '/api/v1/request-master/summary/'


def get(user, **params):
    return client_for(user).get(URL, params)


def body(user, **params):
    response = get(user, **params)
    assert response.status_code == 200, response.content
    return response.json()


def row(data, rq_number):
    return next(r for r in data['results'] if r['rq_number'] == rq_number)


class TestSummaryRows:
    def test_one_row_per_request_with_percent_and_counts(self, world, logistics_coordinator):
        data = body(logistics_coordinator)
        assert data['count'] == 3
        a = row(data, 'RQ-2026-0101')
        assert a['percent'] == 75.0
        assert (a['items_total'], a['items_counted'], a['items_attended'], a['items_partial'],
                a['items_pending'], a['items_unlinked'], a['items_stand_by'],
                a['items_discarded'], a['items_voided']) == (4, 3, 2, 1, 0, 1, 0, 0, 0)
        assert (a['stage'], a['stage_label'], a['phase'], a['rq_status']) == (
            'ENTREGADO', 'Entregado', 4, 'DELIVERED')
        assert a['approval_date'] == '2026-10-01' and a['need_date'] == '2026-11-01'
        assert (a['gm_approval'], a['gm_approval_kind']) == ('APROBADO', 'GM_REVIEW')
        assert a['is_open'] is True and a['origin']
        assert a['requested_by_name']

    def test_pending_and_voided_requests(self, world, logistics_coordinator):
        data = body(logistics_coordinator)
        b = row(data, 'RQ-2026-0102')
        assert (b['percent'], b['items_pending'], b['stage']) == (0.0, 1, 'POR_ENTREGAR')
        c = row(data, 'RQ-2026-0103')
        assert (c['percent'], c['items_voided'], c['is_open'], c['stage']) == (None, 1, False, 'CANCELADO')

    def test_overrides_move_the_counts(self, world, logistics_coordinator):
        world.a2.attention_override, world.a2.attention_note = 'DESESTIMADO', 'Ya no'
        world.a2.save()
        world.b1.attention_override, world.b1.attention_note = 'STAND_BY', 'Pausa'
        world.b1.save()
        data = body(logistics_coordinator)
        a, b = row(data, 'RQ-2026-0101'), row(data, 'RQ-2026-0102')
        assert (a['items_discarded'], a['items_counted'], a['percent']) == (1, 2, 100.0)
        assert (b['items_stand_by'], b['percent']) == (1, 0.0)

    def test_percent_is_for_the_whole_rq_even_with_item_level_filters(self, world, logistics_coordinator):
        data = body(logistics_coordinator, item_status='PARCIAL')
        assert [r['rq_number'] for r in data['results']] == ['RQ-2026-0101']
        assert data['results'][0]['percent'] == 75.0
        assert data['results'][0]['items_total'] == 4

    def test_request_filters_bound_the_rows(self, world, logistics_coordinator, project):
        assert [r['rq_number'] for r in body(logistics_coordinator, project=project.pk)['results']] == [
            'RQ-2026-0101']
        assert [r['rq_number'] for r in body(logistics_coordinator, flow='ADMINISTRATIVE')['results']] == [
            'RQ-2026-0103']
        assert body(logistics_coordinator, stage='RECHAZADO')['results'] == []

    def test_ordering(self, world, logistics_coordinator):
        def order(ordering):
            return [r['rq_number'] for r in body(logistics_coordinator, ordering=ordering)['results']]
        assert order('') == ['RQ-2026-0103', 'RQ-2026-0102', 'RQ-2026-0101']
        assert order('rq_number') == ['RQ-2026-0101', 'RQ-2026-0102', 'RQ-2026-0103']
        assert order('-percent')[0] == 'RQ-2026-0101'
        assert order('percent')[-1] == 'RQ-2026-0103'          # sin % siempre al final
        assert order('-percent')[-1] == 'RQ-2026-0103'
        assert order('-items_total')[0] == 'RQ-2026-0101'
        assert order('approval_date')[0] == 'RQ-2026-0101'
        assert order('need_date')
        assert order('project') and order('stage')
        assert get(logistics_coordinator, ordering='quantity').status_code == 400   # columna solo de ítems

    def test_pagination(self, world, logistics_coordinator):
        data = body(logistics_coordinator, page_size=2)
        assert data['count'] == 3 and len(data['results']) == 2 and data['next']
        assert data['kpis']['rqs_total'] == 3        # los KPIs cubren todo el conjunto, no la página


class TestKpis:
    def test_global_kpis(self, world, logistics_coordinator, project, other_project):
        kpis = body(logistics_coordinator)['kpis']
        assert kpis['rqs_total'] == 3 and kpis['rqs_open'] == 2
        assert kpis['items_total'] == 6
        assert kpis['items_by_status'] == {
            'ATENDIDO': 2, 'PARCIAL': 1, 'PENDIENTE': 1, 'STAND_BY': 0,
            'DESESTIMADO': 0, 'ANULADO': 1, 'SIN_VINCULAR': 1,
        }
        assert (kpis['items_attended'], kpis['items_partial'], kpis['items_pending']) == (2, 1, 1)
        assert kpis['percent_avg'] == 37.5               # (75.0 + 0.0) / 2 RQs con %
        # Vinculados (o fuera de catálogo) / no anulados ni desestimados: 4 de 5.
        assert kpis['linked_pct'] == 80.0

    def test_percent_by_origin(self, world, logistics_coordinator, project, other_project, department):
        by_origin = {(o['kind'], o['id']): o for o in body(logistics_coordinator)['kpis']['by_origin']}
        assert by_origin[('PROJECT', project.pk)]['percent_avg'] == 75.0
        assert by_origin[('PROJECT', other_project.pk)]['percent_avg'] == 0.0
        assert by_origin[('DEPARTMENT', department.pk)]['percent_avg'] is None
        assert by_origin[('PROJECT', project.pk)]['rqs'] == 1

    def test_kpis_follow_the_filters_and_the_scope(self, world, requester, logistics_coordinator, project):
        mine = body(requester)['kpis']
        assert mine['rqs_total'] == 1 and mine['items_total'] == 4
        filtered = body(logistics_coordinator, project=project.pk)['kpis']
        assert filtered['rqs_total'] == 1 and filtered['percent_avg'] == 75.0

    def test_empty_set(self, world, hr_manager):
        data = body(hr_manager)
        assert data['count'] == 0
        assert data['kpis']['rqs_total'] == 0 and data['kpis']['percent_avg'] is None
        assert data['kpis']['linked_pct'] is None and data['kpis']['by_origin'] == []

    def test_authentication_and_validation(self, world, api_client, logistics_coordinator):
        assert api_client.get(URL).status_code == 401
        assert get(logistics_coordinator, flow='NOPE').status_code == 400
        assert get(logistics_coordinator, search='a\x00').status_code == 400


class TestSummaryVisibility:
    def test_each_role_gets_its_own_requests(self, world, requester, other_requester, project_resident,
                                             general_manager):
        assert [r['rq_number'] for r in body(requester)['results']] == ['RQ-2026-0101']
        assert [r['rq_number'] for r in body(other_requester)['results']] == ['RQ-2026-0102']
        assert [r['rq_number'] for r in body(project_resident)['results']] == ['RQ-2026-0101']
        assert body(general_manager)['count'] == 3
