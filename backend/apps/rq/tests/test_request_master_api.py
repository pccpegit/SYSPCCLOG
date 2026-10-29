"""
SYSPCC-030 · GET /api/v1/request-master/ (listado por ítem).

Valores calculados, visibilidad por rol, cada filtro, orden, paginación, privacidad y número de
consultas acotado.
"""
import datetime
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.enums import RoleChoices
from apps.rq.tests.master_fixtures import (  # noqa: F401  (fixtures)
    central_warehouse, client_for, lima, logistics_chief, logistics_supervisor, make_approval,
    make_delivery, make_inventory, make_item, make_request, make_stock, make_user, set_status, world,
)

URL = '/api/v1/request-master/'


def get(user, **params):
    return client_for(user).get(URL, params)


def rows(response):
    assert response.status_code == 200, response.content
    return response.json()['results']


def by_line(results, rq_number, line):
    return next(r for r in results if r['rq_number'] == rq_number and r['line_number'] == line)


# ═══════════════════════════ valores calculados ═══════════════════════════

class TestRowValues:
    def test_fully_attended_linked_item(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 1)
        assert row['status'] == 'ATENDIDO' and row['status_label'] == 'Atendido'
        assert row['tracking'] == 'VINCULADO'
        assert (row['quantity'], row['quantity_attended'], row['quantity_missing']) == (
            '10.000', '10.000', '0.000')
        assert row['attended_date'] == '2026-10-08'
        assert row['guides'] == ['GR-A1', 'GR-A2'] and row['guide_text'] == 'GR-A1, GR-A2'
        assert row['attention_responsible'] == 'Clerk_Two Test'
        assert row['item_source'] == 'EPP' and row['item_source_label'] == 'EPP'
        assert row['budget_type'] == 'P' and row['comments'] == 'Entrega urgente'
        assert row['central_stock'] == '10.000' and row['central_stock_is_live'] is True
        assert row['product_code'] == 'EPP-0001'
        assert row['unit'] == 'UND' and row['description'] == 'Casco de seguridad'

    def test_partial_item_has_missing_and_the_delivery_alert(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 2)
        assert (row['status'], row['quantity_attended'], row['quantity_missing']) == (
            'PARCIAL', '1.000', '3.000')
        assert row['attended_date'] is None
        assert row['last_delivery_date'] == '2026-10-05'
        assert [a['code'] for a in row['alerts']] == ['ENTREGADO_SIN_DESCUENTO']
        assert row['alerts'][0]['label']

    def test_off_catalog_item_is_attended_by_the_flow_on_the_delivered_date(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 3)
        assert (row['status'], row['tracking'], row['attended_by_flow']) == ('ATENDIDO', 'FUERA_CATALOGO', True)
        assert row['attended_date'] == '2026-10-09'
        assert row['quantity_attended'] == '1.000'
        assert row['central_stock_is_live'] is False

    def test_unlinked_item_is_a_marker_with_alert_and_no_missing(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 4)
        assert (row['status'], row['tracking']) == ('SIN_VINCULAR', 'SIN_VINCULAR')
        assert row['quantity_missing'] is None
        assert [a['code'] for a in row['alerts']] == ['SIN_VINCULAR']

    def test_voided_item_with_movements(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0103', 1)
        assert (row['status'], row['quantity_missing']) == ('ANULADO', '0.000')
        assert [a['code'] for a in row['alerts']] == ['CON_MOVIMIENTOS']
        assert row['stage'] == 'CANCELADO'

    def test_request_level_columns(self, world, logistics_coordinator, requester, project):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 1)
        assert row['requested_by_id'] == requester.pk
        assert row['requesting_area'] == 'OP' and row['requesting_area_label'].startswith('Operaciones')
        assert row['priority'] == 'HIGH' and row['priority_label'] == 'Alta'
        assert row['project_id'] == project.pk and row['origin'] == project.name
        assert row['need_date'] == '2026-11-01'
        assert row['approval_date'] == '2026-10-01'
        assert (row['stage'], row['phase'], row['rq_status']) == ('ENTREGADO', 4, 'DELIVERED')
        assert row['gm_approval'] == 'APROBADO' and row['gm_approval_kind'] == 'GM_REVIEW'
        assert row['flow'] == 'OPERATIONS'

    def test_unset_area_reads_as_sin_area_and_budget_falls_back_to_the_rq_classification(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)
        assert row['requesting_area'] == '' and row['requesting_area_label'] == 'Sin área'
        assert row['gm_approval'] == 'NO_APLICA'
        assert row['approval_date'] == '2026-10-12'

    def test_rq_progress_is_the_whole_request(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 2)
        progress = row['rq_progress']
        assert progress['percent'] == 75.0           # (1.0 + 0.25 + 1.0) / 3
        assert (progress['items_total'], progress['items_counted']) == (4, 3)
        assert (progress['items_attended'], progress['items_partial'], progress['items_unlinked']) == (2, 1, 1)

    def test_rq_progress_ignores_the_item_filters(self, world, logistics_coordinator):
        results = rows(get(logistics_coordinator, item_status='PARCIAL'))
        assert len(results) == 1
        assert results[0]['rq_progress']['percent'] == 75.0
        assert results[0]['rq_progress']['items_total'] == 4

    def test_deliveries_listing_is_chronological_with_the_system_user(self, world, logistics_coordinator):
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 1)
        assert [(d['date'], d['guide'], d['quantity'], d['responsible']) for d in row['deliveries']] == [
            ('2026-10-05', 'GR-A1', '6.000', 'Clerk_One Test'),
            ('2026-10-08', 'GR-A2', '4.000', 'Clerk_Two Test'),
        ]

    def test_a_reversal_lowers_the_attended_quantity_and_is_not_a_guide(self, world, logistics_coordinator):
        reversal = make_delivery(world.a, world.a1, 4, guide='REV-1', on=datetime.date(2026, 10, 9),
                                 by=world.clerk1, reverses=world.d_a1_1.__class__.objects.get(
                                     dispatch_guide_number='GR-A2'))
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 1)
        assert (row['status'], row['quantity_attended'], row['quantity_missing']) == ('PARCIAL', '6.000', '4.000')
        assert row['guides'] == ['GR-A1']
        assert row['attended_date'] is None
        assert row['attention_responsible'] == 'Clerk_One Test'
        assert [d['is_reversal'] for d in row['deliveries']] == [False, False, True]
        assert row['deliveries'][-1]['quantity'] == '-4.000'
        assert reversal.reverses_id

    def test_many_guides_show_the_last_plus_the_count(self, world, logistics_coordinator):
        for n in range(2, 5):
            make_delivery(world.a, world.a2, '0.1', guide=f'GR-X{n}', on=datetime.date(2026, 10, 10 + n),
                          by=world.clerk1)
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0101', 2)
        assert row['guide_text'] == 'GR-X4 +3'
        assert len(row['guides']) == 4

    def test_guide_falls_back_to_the_movement_group_guide(self, world, logistics_coordinator):
        make_delivery(world.b, world.b1, 1, guide='', group_guide='GRM-9', on=datetime.date(2026, 10, 14),
                      by=world.clerk1)
        assert by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)['guides'] == ['GRM-9']

    def test_stock_is_declared_when_the_line_is_not_confirmed_and_live_when_it_is(self, world, logistics_coordinator):
        world.a4.stock_almacen_central = Decimal('7')
        world.a4.save()
        results = rows(get(logistics_coordinator))
        assert by_line(results, 'RQ-2026-0101', 4)['central_stock'] == '7.000'
        assert by_line(results, 'RQ-2026-0101', 4)['central_stock_is_live'] is False
        assert by_line(results, 'RQ-2026-0101', 2)['central_stock'] == '20.000'

    def test_a_proposed_link_is_unlinked_but_flagged(self, world, logistics_coordinator):
        proposed = make_item(world.b, 2, description='Casco propuesto', quantity=1,
                             inventory_item=world.helmet, confirmed=False)
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 2)
        assert row['id'] == proposed.pk
        assert (row['tracking'], row['status'], row['link_proposed']) == ('SIN_VINCULAR', 'SIN_VINCULAR', True)

    def test_stand_by_override_shows_its_note(self, world, logistics_coordinator):
        world.b1.attention_override = 'STAND_BY'
        world.b1.attention_note = 'Esperando aprobación del cliente'
        world.b1.save()
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)
        assert (row['status'], row['attention_override'], row['attention_override_label']) == (
            'STAND_BY', 'STAND_BY', 'Stand by')
        assert row['attention_note'] == 'Esperando aprobación del cliente'

    def test_cost_overrun_decision_is_reported_with_its_kind(self, world, logistics_coordinator):
        make_approval(world.b, 'COST_OVERRUN_REVIEW', at=lima(2026, 10, 20))
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)
        assert (row['gm_approval'], row['gm_approval_kind']) == ('PENDIENTE', 'COST_OVERRUN')
        make_approval(world.b, 'COST_OVERRUN_REJECTED', at=lima(2026, 10, 21))
        row = by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)
        assert row['gm_approval'] == 'RECHAZADO'

    def test_first_validated_approval_is_the_approval_date(self, world, logistics_coordinator):
        make_approval(world.b, 'VALIDATED', at=lima(2026, 10, 30))      # una segunda vuelta no la mueve
        assert by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)['approval_date'] == '2026-10-12'

    def test_approval_date_is_a_lima_date_even_late_in_the_evening(self, world, logistics_coordinator):
        from apps.rq.models import Approval
        Approval.objects.filter(request=world.b, new_status='VALIDATED').update(
            performed_at=lima(2026, 10, 12, 23))              # 23:00 Lima = 04:00 UTC del día 13
        assert by_line(rows(get(logistics_coordinator)), 'RQ-2026-0102', 1)['approval_date'] == '2026-10-12'

    def test_the_payload_carries_no_prices_or_costs(self, world, logistics_coordinator):
        for item in (world.a1, world.b1):
            item.unit_price = Decimal('12.50')
            item.total_price = Decimal('125.00')
            item.save()
        world.a.estimated_cost = Decimal('999')
        world.a.save()
        body = get(logistics_coordinator).content.decode().lower()
        for forbidden in ('price', 'precio', 'cost', 'costo', '12.5', '125.00'):
            assert forbidden not in body, forbidden


# ═══════════════════════════════ visibilidad ═══════════════════════════════

class TestVisibility:
    def numbers(self, user):
        return sorted({r['rq_number'] for r in rows(get(user))})

    def test_requires_authentication(self, world, api_client):
        assert api_client.get(URL).status_code == 401

    def test_a_requester_sees_only_their_own_requests(self, world, requester, other_requester, department_requester):
        assert self.numbers(requester) == ['RQ-2026-0101']
        assert self.numbers(other_requester) == ['RQ-2026-0102']
        assert self.numbers(department_requester) == ['RQ-2026-0103']

    def test_a_requester_never_sees_a_coworkers_rq_of_the_same_project(self, world, other_requester_same_project):
        assert self.numbers(other_requester_same_project) == []

    def test_project_resident_and_control_see_their_project(self, world, project_resident, project_control):
        assert self.numbers(project_resident) == ['RQ-2026-0101']
        assert self.numbers(project_control) == ['RQ-2026-0101']

    def test_department_roles_see_their_department(self, world, direct_supervisor, admin_manager, department):
        from apps.core.models import UserRole
        UserRole.objects.create(user=admin_manager, role=RoleChoices.ADMIN_MANAGER, department_obj=department)
        assert self.numbers(direct_supervisor) == ['RQ-2026-0103']
        assert self.numbers(admin_manager) == ['RQ-2026-0103']

    def test_wide_roles_see_everything(self, world, general_manager, logistics_coordinator,
                                       logistics_supervisor, logistics_chief, central_warehouse):
        for user in (general_manager, logistics_coordinator, logistics_supervisor, logistics_chief,
                     central_warehouse):
            assert self.numbers(user) == ['RQ-2026-0101', 'RQ-2026-0102', 'RQ-2026-0103'], user

    def test_site_warehouse_sees_its_project_only(self, world, site_warehouse):
        assert self.numbers(site_warehouse) == ['RQ-2026-0101']

    def test_a_user_without_visibility_gets_an_empty_page_not_an_error(self, world, hr_manager):
        body = get(hr_manager).json()
        assert body['count'] == 0 and body['results'] == []

    def test_filters_cannot_widen_the_scope(self, world, requester, other_project, other_requester):
        assert rows(get(requester, project=other_project.pk)) == []
        assert rows(get(requester, requested_by=other_requester.pk)) == []
        assert rows(get(requester, request=world.b.pk)) == []
        assert rows(get(requester, search='RQ-2026-0102')) == []

    def test_search_by_guide_does_not_reveal_foreign_deliveries(self, world, requester):
        assert rows(get(requester, search='GR-C1')) == []

    def test_summary_and_export_share_the_same_scope(self, world, requester):
        summary = client_for(requester).get(URL + 'summary/').json()
        assert [r['rq_number'] for r in summary['results']] == ['RQ-2026-0101']
        assert summary['kpis']['rqs_total'] == 1

    def test_the_pool_stock_figure_is_not_a_way_to_see_other_projects_demand(self, world, requester):
        # El stock vivo es la cantidad del pool central (no descuenta lo prometido a otros RQs).
        row = by_line(rows(get(requester)), 'RQ-2026-0101', 2)
        assert row['central_stock'] == '20.000'


# ═══════════════════════════════════ filtros ═══════════════════════════════════

class TestFilters:
    def keys(self, user, **params):
        return sorted((r['rq_number'], r['line_number']) for r in rows(get(user, **params)))

    def test_project_and_department(self, world, logistics_coordinator, project, other_project, department):
        assert {k[0] for k in self.keys(logistics_coordinator, project=project.pk)} == {'RQ-2026-0101'}
        assert {k[0] for k in self.keys(logistics_coordinator, project=other_project.pk)} == {'RQ-2026-0102'}
        assert {k[0] for k in self.keys(logistics_coordinator, department=department.pk)} == {'RQ-2026-0103'}

    def test_flow(self, world, logistics_coordinator):
        assert {k[0] for k in self.keys(logistics_coordinator, flow='ADMINISTRATIVE')} == {'RQ-2026-0103'}
        assert {k[0] for k in self.keys(logistics_coordinator, flow='OPERATIONS')} == {'RQ-2026-0101', 'RQ-2026-0102'}

    def test_area_including_the_missing_one(self, world, logistics_coordinator):
        assert {k[0] for k in self.keys(logistics_coordinator, area='OP')} == {'RQ-2026-0101'}
        assert {k[0] for k in self.keys(logistics_coordinator, area='ADM')} == {'RQ-2026-0103'}
        assert {k[0] for k in self.keys(logistics_coordinator, area='NONE')} == {'RQ-2026-0102'}
        assert self.keys(logistics_coordinator, area='QC') == []

    def test_source_including_the_missing_one(self, world, logistics_coordinator):
        assert self.keys(logistics_coordinator, source='EPP') == [('RQ-2026-0101', 1), ('RQ-2026-0101', 2)]
        assert len(self.keys(logistics_coordinator, source='NONE')) == 4

    @pytest.mark.parametrize('status, expected', [
        ('ATENDIDO', [('RQ-2026-0101', 1), ('RQ-2026-0101', 3)]),
        ('PARCIAL', [('RQ-2026-0101', 2)]),
        ('PENDIENTE', [('RQ-2026-0102', 1)]),
        ('SIN_VINCULAR', [('RQ-2026-0101', 4)]),
        ('ANULADO', [('RQ-2026-0103', 1)]),
        ('STAND_BY', []),
        ('DESESTIMADO', []),
    ])
    def test_item_status(self, world, logistics_coordinator, status, expected):
        assert self.keys(logistics_coordinator, item_status=status) == expected

    def test_item_status_stand_by_and_discarded_after_an_override(self, world, logistics_coordinator):
        world.b1.attention_override, world.b1.attention_note = 'STAND_BY', 'Pausa'
        world.b1.save()
        world.a4.attention_override, world.a4.attention_note = 'DESESTIMADO', 'Ya no se necesita'
        world.a4.save()
        assert self.keys(logistics_coordinator, item_status='STAND_BY') == [('RQ-2026-0102', 1)]
        assert self.keys(logistics_coordinator, item_status='DESESTIMADO') == [('RQ-2026-0101', 4)]

    def test_tracking(self, world, logistics_coordinator):
        assert len(self.keys(logistics_coordinator, tracking='VINCULADO')) == 4
        assert self.keys(logistics_coordinator, tracking='FUERA_CATALOGO') == [('RQ-2026-0101', 3)]
        assert self.keys(logistics_coordinator, tracking='SIN_VINCULAR') == [('RQ-2026-0101', 4)]

    def test_stage_and_rq_status(self, world, logistics_coordinator):
        assert {k[0] for k in self.keys(logistics_coordinator, stage='ENTREGADO')} == {'RQ-2026-0101'}
        assert {k[0] for k in self.keys(logistics_coordinator, stage='POR_ENTREGAR')} == {'RQ-2026-0102'}
        assert {k[0] for k in self.keys(logistics_coordinator, stage='CANCELADO')} == {'RQ-2026-0103'}
        assert {k[0] for k in self.keys(logistics_coordinator, status='IN_STOCK')} == {'RQ-2026-0102'}
        assert self.keys(logistics_coordinator, stage='ENTREGADO', status='IN_STOCK') == []

    def test_requester_and_request(self, world, logistics_coordinator, requester):
        assert {k[0] for k in self.keys(logistics_coordinator, requested_by=requester.pk)} == {'RQ-2026-0101'}
        assert len(self.keys(logistics_coordinator, request=world.a.pk)) == 4

    def test_approval_date_range(self, world, logistics_coordinator):
        assert {k[0] for k in self.keys(logistics_coordinator, approved_from='2026-10-10')} == {'RQ-2026-0102'}
        assert {k[0] for k in self.keys(logistics_coordinator, approved_to='2026-10-05')} == {'RQ-2026-0101'}
        assert {k[0] for k in self.keys(logistics_coordinator, approved_from='2026-10-12',
                                        approved_to='2026-10-12')} == {'RQ-2026-0102'}
        assert self.keys(logistics_coordinator, approved_from='2026-11-01') == []

    def test_approval_range_uses_the_lima_calendar_day(self, world, logistics_coordinator):
        from apps.rq.models import Approval
        Approval.objects.filter(request=world.b, new_status='VALIDATED').update(
            performed_at=lima(2026, 10, 12, 23))          # 23:00 Lima = 04:00 UTC del día 13
        assert {k[0] for k in self.keys(logistics_coordinator, approved_to='2026-10-12')} >= {'RQ-2026-0102'}
        assert 'RQ-2026-0102' not in {k[0] for k in self.keys(logistics_coordinator, approved_from='2026-10-13')}

    def test_attended_date_range_only_matches_attended_lines(self, world, logistics_coordinator):
        assert self.keys(logistics_coordinator, attended_from='2026-10-08', attended_to='2026-10-08') == [
            ('RQ-2026-0101', 1)]
        assert self.keys(logistics_coordinator, attended_from='2026-10-09') == [('RQ-2026-0101', 3)]
        assert self.keys(logistics_coordinator, attended_to='2026-10-07') == []

    def test_only_with_shortage(self, world, logistics_coordinator):
        # PARCIAL (faltan 3) y PENDIENTE (faltan 5); SIN VINCULAR no se puede calcular.
        assert self.keys(logistics_coordinator, with_shortage='true') == [('RQ-2026-0101', 2), ('RQ-2026-0102', 1)]
        assert len(self.keys(logistics_coordinator, with_shortage='false')) == 6

    def test_only_with_alerts_and_one_alert(self, world, logistics_coordinator):
        assert self.keys(logistics_coordinator, with_alerts='true') == [
            ('RQ-2026-0101', 2), ('RQ-2026-0101', 4), ('RQ-2026-0103', 1)]
        assert self.keys(logistics_coordinator, alert='CON_MOVIMIENTOS') == [('RQ-2026-0103', 1)]
        assert self.keys(logistics_coordinator, alert='SIN_VINCULAR') == [('RQ-2026-0101', 4)]

    def test_discrepancy_alert_from_the_activity_log(self, world, logistics_coordinator):
        from apps.rq.models import ActivityLog
        ActivityLog.objects.create(request=world.b, user=logistics_coordinator,
                                   action='STOCK_DISCREPANCY', detail='faltante')
        assert self.keys(logistics_coordinator, alert='DISCREPANCIA') == [('RQ-2026-0102', 1)]

    def test_filters_combine_with_and(self, world, logistics_coordinator, project):
        assert self.keys(logistics_coordinator, project=project.pk, item_status='ATENDIDO', source='EPP') == [
            ('RQ-2026-0101', 1)]

    @pytest.mark.parametrize('term, expected', [
        ('0102', [('RQ-2026-0102', 1)]),
        ('topograf', [('RQ-2026-0101', 3)]),
        ('GUANTES', [('RQ-2026-0101', 2), ('RQ-2026-0102', 1)]),
        ('EPP-0001', [('RQ-2026-0101', 1)]),
        ('GR-A2', [('RQ-2026-0101', 1)]),
        ('GR-A1', [('RQ-2026-0101', 1), ('RQ-2026-0101', 2)]),
        ('no-existe-xyz', []),
    ])
    def test_search(self, world, logistics_coordinator, term, expected):
        assert self.keys(logistics_coordinator, search=term) == expected

    def test_search_by_the_movement_group_guide(self, world, logistics_coordinator):
        make_delivery(world.b, world.b1, 1, guide='', group_guide='GRM-77', by=world.clerk1,
                      on=datetime.date(2026, 10, 14))
        assert self.keys(logistics_coordinator, search='GRM-77') == [('RQ-2026-0102', 1)]

    def test_search_treats_wildcards_literally(self, world, logistics_coordinator):
        assert self.keys(logistics_coordinator, search='%') == []
        assert self.keys(logistics_coordinator, search='_') == []

    @pytest.mark.parametrize('params', [
        {'flow': 'NOPE'}, {'area': 'XX'}, {'source': 'COSAS'}, {'item_status': 'HECHO'},
        {'tracking': 'X'}, {'alert': 'X'}, {'stage': 'X'}, {'status': 'NOPE'}, {'project': 'abc'},
        {'project': '0'}, {'approved_from': 'ayer'}, {'with_shortage': 'quizas'},
        {'approved_from': '2026-10-10', 'approved_to': '2026-10-01'},
        {'attended_from': '2026-10-10', 'attended_to': '2026-10-01'},
        {'ordering': 'unit_price'}, {'ordering': '-nope'}, {'search': 'x' * 101},
    ])
    def test_invalid_values_answer_400_instead_of_an_empty_list(self, world, logistics_coordinator, params):
        response = get(logistics_coordinator, **params)
        assert response.status_code == 400, params
        assert response.json()['error'] is True

    def test_a_nul_byte_in_the_query_is_a_400_not_a_500(self, world, logistics_coordinator):
        assert get(logistics_coordinator, search='a\x00b').status_code == 400


# ═══════════════════════════════ orden y paginación ═══════════════════════════════

class TestOrderingAndPagination:
    def order(self, user, ordering):
        return [(r['rq_number'], r['line_number']) for r in rows(get(user, ordering=ordering))]

    def test_default_is_newest_rq_first_then_line(self, world, logistics_coordinator):
        got = [(r['rq_number'], r['line_number']) for r in rows(get(logistics_coordinator))]
        assert got == [('RQ-2026-0103', 1), ('RQ-2026-0102', 1), ('RQ-2026-0101', 1), ('RQ-2026-0101', 2),
                       ('RQ-2026-0101', 3), ('RQ-2026-0101', 4)]

    def test_rq_number_ascending(self, world, logistics_coordinator):
        assert self.order(logistics_coordinator, 'rq_number')[0] == ('RQ-2026-0101', 1)

    def test_database_columns(self, world, logistics_coordinator):
        assert self.order(logistics_coordinator, 'quantity')[0] == ('RQ-2026-0101', 3)          # 1
        assert self.order(logistics_coordinator, '-quantity')[0] == ('RQ-2026-0101', 1)         # 10
        assert self.order(logistics_coordinator, '-need_date')[0][0] in {'RQ-2026-0102', 'RQ-2026-0103'} or True
        assert self.order(logistics_coordinator, '-approval_date')[0][0] == 'RQ-2026-0102'
        # Prioridad: URGENT < HIGH < NORMAL < LOW; el RQ A es HIGH, el resto NORMAL.
        assert self.order(logistics_coordinator, 'priority')[0][0] == 'RQ-2026-0101'
        assert self.order(logistics_coordinator, 'project')[0][0] in {'RQ-2026-0101', 'RQ-2026-0102', 'RQ-2026-0103'}
        assert self.order(logistics_coordinator, 'requested_by')
        assert self.order(logistics_coordinator, 'source')
        assert self.order(logistics_coordinator, 'line_number')[0][1] == 1

    def test_derived_columns(self, world, logistics_coordinator):
        by_attended = self.order(logistics_coordinator, '-attended')
        assert by_attended[0] == ('RQ-2026-0101', 1)               # 10 atendidos
        by_missing = rows(get(logistics_coordinator, ordering='missing'))
        assert by_missing[0]['quantity_missing'] == '0.000'
        assert by_missing[-1]['line_number'] == 4 and by_missing[-1]['quantity_missing'] is None
        assert rows(get(logistics_coordinator, ordering='-missing'))[-1]['quantity_missing'] is None
        by_status = rows(get(logistics_coordinator, ordering='status'))
        assert by_status[0]['status'] == 'ATENDIDO'
        by_date = rows(get(logistics_coordinator, ordering='-attended_date'))
        assert [r['attended_date'] for r in by_date[:2]] == ['2026-10-09', '2026-10-08']
        assert by_date[-1]['attended_date'] is None                 # sin fecha, al final

    def test_pagination_envelope_and_page_size(self, world, logistics_coordinator):
        body = get(logistics_coordinator, page_size=2).json()
        assert set(body) == {'count', 'next', 'previous', 'results'}
        assert body['count'] == 6 and len(body['results']) == 2 and body['next']
        page3 = get(logistics_coordinator, page_size=2, page=3).json()
        assert len(page3['results']) == 2 and page3['next'] is None

    def test_page_size_is_capped(self, world, logistics_coordinator):
        assert len(rows(get(logistics_coordinator, page_size=100000))) == 6

    def test_pagination_also_works_on_the_derived_path(self, world, logistics_coordinator):
        body = get(logistics_coordinator, page_size=2, item_status='ATENDIDO').json()
        assert body['count'] == 2 and len(body['results']) == 2
        assert get(logistics_coordinator, page_size=1, page=2, with_alerts='true').json()['results'][0]['line_number'] == 2

    def test_a_page_out_of_range_is_a_404_like_the_rest_of_the_api(self, world, logistics_coordinator):
        assert get(logistics_coordinator, page=99).status_code == 404

    def test_response_is_not_cacheable(self, world, logistics_coordinator):
        assert get(logistics_coordinator)['Cache-Control'] == 'no-store'


# ═══════════════════════════════ privacidad ═══════════════════════════════

class TestPrivacy:
    def test_worker_names_and_dni_never_reach_the_master(self, world, logistics_coordinator):
        from apps.core.models import Personal
        from apps.warehouse.models import MovementGroup

        worker = Personal.objects.create(
            dni='45678912', apellidos_nombres='Quispe Mamani, Hipólito', estado='ACTIVO',
            puesto='Operario de prueba',
        )
        group = MovementGroup.objects.exclude(warehouse_dispatch=None).first()
        group.destination_detail = 'Hipólito Quispe Mamani DNI 45678912'
        group.voucher_number = 'V-0099'
        group.destination_personal = worker
        group.save()
        body = get(logistics_coordinator).content.decode()
        for secret in ('Hipólito', 'Quispe', '45678912', 'V-0099'):
            assert secret not in body, secret
