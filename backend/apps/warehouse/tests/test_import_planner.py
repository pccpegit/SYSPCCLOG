"""SYSPCC-025 — importer planner: problem codes, grouping, matching, projection (read-only)."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock, MovementGroup
from apps.warehouse.services import movements as movement_svc
from apps.warehouse.services.imports import parser, planner
from apps.warehouse.services.imports.parser import SHEET_CATALOG, SHEET_ENTRIES, SHEET_EXITS, SHEET_SUMMARY

from .import_workbooks import (
    D1, D2, D3, WORKER_A, WORKER_A_REORDERED, WORKER_B, build_workbook, catalog_row, entry_row, exit_row,
    standard_workbook, summary_row,
)

pytestmark = pytest.mark.django_db


def make_plan(data, **kwargs):
    kwargs.setdefault('warehouse', 'CENTRAL')
    return planner.build_plan(parser.parse_workbook(data), **kwargs)


def by_code(plan):
    grouped = defaultdict(list)
    for problem in plan.problems:
        grouped[problem.code].append(problem)
    return grouped


def one(plan, code):
    found = by_code(plan)[code]
    assert len(found) == 1, f'{code}: {len(found)} problems'
    return found[0]


def small(**sheets):
    """Workbook with one catalog item (EPP000001, stock 10 via entry) plus the given sheets."""
    sheets.setdefault('catalog', [catalog_row('EPP000001', 'GUANTE DE CUERO T: L')])
    return build_workbook(**sheets)


class TestStandardWorkbook:
    def test_consistent_workbook_has_no_blockers_and_reconciles(self):
        plan = make_plan(standard_workbook())
        summary = plan.summary()
        assert plan.can_confirm
        assert summary['catalog'] == {'new': 3, 'existing': 0, 'to_update': 0, 'conflicts': 0}
        assert summary['entries'] == {'to_import': 2, 'skipped_error': 0, 'already_imported': 0, 'groups': 1}
        assert summary['exits'] == {'to_import': 3, 'skipped_error': 0, 'already_imported': 0, 'groups': 2}
        assert summary['stock'] == {'projected_total': 9.0, 'sheet_total': 9.0, 'mismatched_items': 0, 'negative_items': 0}
        assert {k: v['rows'] for k, v in summary['sheets'].items()} == {
            SHEET_CATALOG: 3, SHEET_ENTRIES: 2, SHEET_EXITS: 3, SHEET_SUMMARY: 3,
        }

    def test_int_and_str_vouchers_of_the_same_vale_share_a_group(self):
        plan = make_plan(standard_workbook())
        vale_120 = next(g for g in plan.exit_groups if g.voucher == '120')
        assert [ln.code for ln in vale_120.lines] == ['EPP000001', 'EPP000002']

    def test_catalog_fields_are_derived(self):
        plan = make_plan(standard_workbook())
        glove = plan.catalog['EPP000001']
        assert (glove.size, glove.category, glove.item_type) == ('L', 'EPP', 'EPP')
        assert (glove.purchase_order_ref, glove.packing_list, glove.order_number) == ('1.02', '24003-13', 'ORD-1')
        assert plan.catalog['EPP000002'].purchase_order_ref == '2.03'

    def test_expected_informational_and_warning_problems(self):
        grouped = by_code(make_plan(standard_workbook()))
        assert len(grouped['UBICACION_PISO_SIN_PABELLON']) == 3
        assert len(grouped['DESTINO_SIN_PERSONAL']) == 2          # one per distinct destination
        assert len(grouped['VALE_VACIO']) == 0
        assert len(grouped['PRODUCTO_SIN_STOCK_CERO']) == 1       # EPP000003 never moves

    def test_projects_are_reported_without_creating_them(self):
        plan = make_plan(standard_workbook())
        assert plan.summary()['projects'] == [{'label': 'ON PLANT', 'items': 3, 'matches': [], 'suggested_id': None}]
        assert plan.requires()['project_labels'] == ['ON PLANT']

    def test_requires_acceptances_when_there_are_warnings(self):
        requires = make_plan(standard_workbook()).requires()
        assert requires['accept_warnings'] is True and requires['accept_skipped_rows'] is False

    def test_planning_never_writes(self):
        make_plan(standard_workbook())
        assert Inventory.objects.count() == 0 and InventoryMovement.objects.count() == 0
        assert MovementGroup.objects.count() == 0


class TestQuantities:
    def test_empty_quantity_is_a_skipped_row(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', None)]))
        problem = one(plan, 'CANTIDAD_VACIA')
        assert (problem.severity, problem.sheet, problem.row) == ('error', SHEET_ENTRIES, 2)
        assert plan.summary()['entries']['skipped_error'] == 1 and plan.entry_groups == []
        assert plan.requires()['accept_skipped_rows'] is True

    @pytest.mark.parametrize('value', [0, -3, 'abc', '1,5', 1.2345, '   -2', True, 10 ** 12])
    def test_invalid_quantities(self, value):
        plan = make_plan(small(entries=[entry_row('EPP000001', value)]))
        assert one(plan, 'CANTIDAD_INVALIDA').severity == 'error'

    @pytest.mark.parametrize('value, expected', [(3, '3'), ('4', '4'), (3.0, '3')])
    def test_valid_quantities(self, value, expected):
        plan = make_plan(small(entries=[entry_row('EPP000001', value)]))
        assert 'CANTIDAD_INVALIDA' not in by_code(plan)
        assert format(plan.entry_groups[0].lines[0].quantity.normalize(), 'f') == expected

    @pytest.mark.parametrize('value, expected', [(2.5, '2.5'), (0.1 + 0.2, '0.3'), ('0.125', '0.125')])
    def test_decimal_quantities_are_valid_for_measured_units(self, value, expected):
        data = build_workbook(
            catalog=[catalog_row('LYPCC0001', 'LIQUIDO', unit='LT')], entries=[entry_row('LYPCC0001', value)],
        )
        plan = make_plan(data)
        assert 'CANTIDAD_INVALIDA' not in by_code(plan)
        assert format(plan.entry_groups[0].lines[0].quantity.normalize(), 'f') == expected

    @pytest.mark.parametrize('unit', ['EA', 'UND', 'PAR', 'JGO', 'ea', ' Par '])
    def test_a_fractional_quantity_of_a_piece_unit_is_a_skipped_row(self, unit):
        """Same rule as the manual entry: EA / UND / PAR / JGO are counted in whole pieces."""
        data = build_workbook(
            catalog=[catalog_row('EPP000001', 'GUANTE', unit=unit)],
            entries=[entry_row('EPP000001', 10), entry_row('EPP000001', 2.5)],
            exits=[exit_row('EPP000001', 0.5, WORKER_A, voucher=1)],
        )
        plan = make_plan(data)
        problems = by_code(plan)['CANTIDAD_INVALIDA']
        assert sorted((p.sheet, p.row) for p in problems) == [(SHEET_EXITS, 2), (SHEET_ENTRIES, 3)]
        assert all(p.severity == 'error' for p in problems)
        assert [ln.quantity for g in plan.entry_groups for ln in g.lines] == [Decimal('10')]
        assert plan.exit_groups == []
        assert plan.summary()['stock']['projected_total'] == 10.0

    def test_a_whole_quantity_written_with_decimals_is_still_a_whole_piece(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', '5.000'), entry_row('EPP000001', 6.0)]))
        assert 'CANTIDAD_INVALIDA' not in by_code(plan)

    def test_a_fractional_opening_stock_of_a_piece_unit_is_not_loaded(self):
        data = build_workbook(
            catalog=[catalog_row('EPP000001', 'GUANTE')],
            summary=[summary_row('EPP000001', 'GUANTE', initial=2.5, stock=2.5)],
        )
        plan = make_plan(data)
        assert one(plan, 'CANTIDAD_INVALIDA').sheet == SHEET_SUMMARY
        assert plan.initial_lines == []


class TestDates:
    def test_empty_date_is_imported_without_date_and_flagged(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 3, when=None)]))
        assert one(plan, 'FECHA_VACIA').severity == 'warning'
        assert plan.entry_groups[0].date is None

    @pytest.mark.parametrize('value', ['ayer', 'nunca', 5, 99999999])
    def test_invalid_date(self, value):
        plan = make_plan(small(entries=[entry_row('EPP000001', 3, when=value)]))
        assert one(plan, 'FECHA_INVALIDA').severity == 'error'

    def test_future_date(self):
        future = timezone.localdate() + timedelta(days=30)
        plan = make_plan(small(entries=[entry_row('EPP000001', 3, when=future)]))
        assert one(plan, 'FECHA_FUTURA').severity == 'error'

    @pytest.mark.parametrize('value', ['2026-10-05', '05/10/2026'])
    def test_text_dates_are_accepted(self, value):
        plan = make_plan(small(entries=[entry_row('EPP000001', 3, when=value)]))
        assert plan.entry_groups[0].date == date(2026, 10, 5)

    def test_undated_entries_are_one_group_per_row(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 1, when=None), entry_row('EPP000001', 2, when=None)]))
        assert len(plan.entry_groups) == 2


class TestEntryGrouping:
    def test_same_date_po_and_guide_make_one_group(self):
        rows = [entry_row('EPP000001', 1, D1, po='P1', guide='G1'), entry_row('EPP000001', 2, D1, po='P1', guide='G1')]
        assert len(make_plan(small(entries=rows)).entry_groups) == 1

    def test_different_po_guide_or_transfer_split_groups(self):
        rows = [
            entry_row('EPP000001', 1, D1, po='P1'), entry_row('EPP000001', 1, D1, po='P2'),
            entry_row('EPP000001', 1, D1, guide='G9'), entry_row('EPP000001', 1, D1, transfer='ALM'),
            entry_row('EPP000001', 1, D2),
        ]
        assert len(make_plan(small(entries=rows)).entry_groups) == 5

    def test_numeric_po_is_kept_as_text(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 1, D1, po=1.1)]))
        assert plan.entry_groups[0].po == '1.10'


class TestExits:
    def test_empty_voucher_is_flagged_and_each_row_is_its_own_group(self):
        rows = [exit_row('EPP000001', 1, WORKER_A), exit_row('EPP000001', 1, WORKER_A)]
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=rows))
        assert len(by_code(plan)['VALE_VACIO']) == 2 and len(plan.exit_groups) == 2

    def test_same_voucher_same_date_and_destination_is_one_group(self):
        rows = [exit_row('EPP000001', 1, WORKER_A, voucher=7), exit_row('EPP000001', 1, WORKER_A_REORDERED, voucher=7)]
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=rows))
        assert len(plan.exit_groups) == 1 and len(plan.exit_groups[0].lines) == 2

    def test_voucher_reused_with_another_destination_is_flagged(self):
        rows = [exit_row('EPP000001', 1, WORKER_A, voucher=7), exit_row('EPP000001', 1, WORKER_B, voucher=7)]
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=rows))
        assert len(plan.exit_groups) == 2
        problem = one(plan, 'VALE_REUTILIZADO')
        assert (problem.severity, problem.row) == ('warning', 3)

    def test_voucher_reused_with_another_date_is_flagged(self):
        rows = [exit_row('EPP000001', 1, WORKER_A, voucher=7, when=D2), exit_row('EPP000001', 1, WORKER_A, voucher=7, when=D3)]
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=rows))
        assert len(by_code(plan)['VALE_REUTILIZADO']) == 1

    def test_voucher_already_used_by_a_manual_delivery_is_flagged(self, central_warehouse, epp_item):
        movement_svc.register_entry_batch(
            [{'inventory_id': epp_item.pk, 'quantity': 5}], 'CENTRAL', None, 'PURCHASE', '', '', '', central_warehouse,
        )
        movement_svc.register_exit_batch(
            [{'inventory_id': epp_item.pk, 'quantity': 1}], 'CENTRAL', None, 'EMPLOYEE', 'Alguien Test', None, None, '',
            central_warehouse, voucher_number='555',
        )
        plan = make_plan(small(
            catalog=[catalog_row(epp_item.product_code, epp_item.description)],
            entries=[entry_row(epp_item.product_code, 5)],
            exits=[exit_row(epp_item.product_code, 1, WORKER_A, voucher=555)],
        ))
        assert one(plan, 'VALE_REUTILIZADO').severity == 'warning'

    def test_empty_destination_is_a_skipped_row(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=[exit_row('EPP000001', 1, None, voucher=1)]))
        assert one(plan, 'DESTINO_VACIO').severity == 'error' and plan.exit_groups == []

    def test_destination_of_only_punctuation_is_empty(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=[exit_row('EPP000001', 1, '--', voucher=1)]))
        assert 'DESTINO_VACIO' in by_code(plan)

    def test_inter_floor_transfer_is_internal_and_not_matched_to_personal(self, make_personal):
        make_personal('Alm Primer Piso')
        plan = make_plan(small(
            entries=[entry_row('EPP000001', 5)], exits=[exit_row('EPP000001', 1, 'ALM - PRIMER PISO', voucher=1)],
        ))
        group = plan.exit_groups[0]
        assert group.internal and group.personal_id is None
        assert 'DESTINO_SIN_PERSONAL' not in by_code(plan) and plan.unmatched_destinations == []

    def test_item_cannot_be_exited_beyond_its_stock(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 2)], exits=[exit_row('EPP000001', 3, WORKER_A, voucher=1)]))
        problem = one(plan, 'STOCK_NEGATIVO')
        assert problem.severity == 'blocker' and not plan.can_confirm

    def test_entries_count_before_exits_whatever_the_sheet_order(self):
        # the exit row is dated BEFORE the entry: still fine, all entries are applied first
        plan = make_plan(small(
            entries=[entry_row('EPP000001', 5, when=D3)], exits=[exit_row('EPP000001', 5, WORKER_A, voucher=1, when=D1)],
        ))
        assert 'STOCK_NEGATIVO' not in by_code(plan)


class TestPersonalMatching:
    def test_exact_match_ignores_accents_case_and_token_order(self, make_personal):
        person = make_personal(WORKER_A)
        plan = make_plan(small(
            entries=[entry_row('EPP000001', 5)],
            exits=[exit_row('EPP000001', 1, WORKER_A_REORDERED + '  ', voucher=1)],
        ))
        assert plan.exit_groups[0].personal_id == person.pk
        assert 'DESTINO_SIN_PERSONAL' not in by_code(plan) and plan.unmatched_destinations == []

    def test_two_workers_with_the_same_name_are_ambiguous(self, make_personal):
        make_personal(WORKER_A)
        make_personal(WORKER_A)
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=[exit_row('EPP000001', 1, WORKER_A, voucher=1)]))
        assert plan.exit_groups[0].personal_id is None
        assert one(plan, 'DESTINO_AMBIGUO').severity == 'warning'
        assert plan.unmatched_destinations[0]['candidates'] == 2

    def test_unknown_destination_is_reported_once_per_destination(self):
        rows = [exit_row('EPP000001', 1, WORKER_B, voucher=v) for v in (1, 2, 3)]
        plan = make_plan(small(entries=[entry_row('EPP000001', 9)], exits=rows))
        assert len(by_code(plan)['DESTINO_SIN_PERSONAL']) == 1
        assert plan.unmatched_destinations[0]['rows'] == 3

    def test_problem_messages_never_contain_the_destination(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 5)], exits=[exit_row('EPP000001', 1, WORKER_B, voucher=1)]))
        text = ' '.join(p.message for p in plan.problems)
        assert 'Ccori' not in text and 'Huaman' not in text


class TestItems:
    def test_movement_of_an_item_missing_from_the_catalog_is_a_blocker(self):
        plan = make_plan(small(entries=[entry_row('EPP999999', 1)]))
        problem = one(plan, 'ITEM_DESCONOCIDO')
        assert (problem.severity, problem.row) == ('blocker', 2) and not plan.can_confirm

    def test_summary_row_of_an_unknown_item_is_a_blocker(self):
        plan = make_plan(small(summary=[summary_row('EPP999999', 'FANTASMA', stock=1)]))
        assert one(plan, 'ITEM_DESCONOCIDO').sheet == SHEET_SUMMARY

    def test_item_known_to_the_system_but_not_in_the_catalog_sheet_is_accepted(self, epp_item):
        plan = make_plan(build_workbook(
            catalog=[catalog_row('EPP777777', 'OTRO')], entries=[entry_row(epp_item.product_code, 1)],
        ))
        assert 'ITEM_DESCONOCIDO' not in by_code(plan)
        assert plan.catalog[epp_item.product_code].action == planner.ACTION_EXTERNAL

    def test_row_without_item_code(self):
        plan = make_plan(small(entries=[entry_row(None, 1)]))
        assert one(plan, 'ITEM_VACIO').severity == 'error'

    @pytest.mark.parametrize('code', ['+SUMA(1)', '-2+3', '@SUM(A1)'])
    def test_codes_that_look_like_formulas_are_rejected(self, code):
        plan = make_plan(build_workbook(catalog=[catalog_row(code, 'X')]))
        assert one(plan, 'FILA_INVALIDA').severity == 'error' and plan.catalog == {}

    def test_a_code_starting_with_equals_is_rejected_by_the_validator(self):
        from apps.warehouse.services.imports.validators import CatalogRowSerializer, validate_row

        _data, errors = validate_row(CatalogRowSerializer, {'product_code': '=CMD', 'description': 'X', 'unit': 'EA'})
        assert [code for code, _ in errors] == ['FILA_INVALIDA']

    def test_code_is_normalized(self):
        plan = make_plan(small(entries=[entry_row(' epp000001 ', 1)]))
        assert 'ITEM_DESCONOCIDO' not in by_code(plan)

    def test_unit_conflict_skips_the_item_and_its_movements(self, epp_item):
        plan = make_plan(build_workbook(
            catalog=[catalog_row(epp_item.product_code, epp_item.description, unit='M2')],
            entries=[entry_row(epp_item.product_code, 1)],
        ))
        assert one(plan, 'UNIDAD_EN_CONFLICTO').severity == 'error'
        assert one(plan, 'ITEM_OMITIDO').sheet == SHEET_ENTRIES
        assert plan.catalog[epp_item.product_code].action == planner.ACTION_SKIP and plan.entry_groups == []

    def test_different_description_is_a_warning_and_is_not_overwritten(self, epp_item):
        plan = make_plan(build_workbook(catalog=[catalog_row(epp_item.product_code, 'OTRA DESCRIPCION')]))
        assert one(plan, 'DESCRIPCION_DISTINTA').severity == 'warning'
        assert 'description' not in plan.catalog[epp_item.product_code].changes

    def test_duplicate_code_with_other_data_is_a_blocker(self):
        plan = make_plan(build_workbook(catalog=[catalog_row('EPP1', 'A'), catalog_row('EPP1', 'B')]))
        assert one(plan, 'CODIGO_DUPLICADO_DISTINTO').severity == 'blocker'

    def test_identical_duplicate_is_informational(self):
        plan = make_plan(build_workbook(catalog=[catalog_row('EPP1', 'A'), catalog_row('EPP1', ' a ')]))
        assert one(plan, 'CODIGO_DUPLICADO_IDENTICO').severity == 'info' and plan.can_confirm

    def test_unknown_prefix_is_classified_as_otros(self):
        plan = make_plan(build_workbook(catalog=[catalog_row('TMT000001', 'TORNILLO')]))
        assert one(plan, 'PREFIJO_NO_CLASIFICADO').severity == 'info'
        entry = plan.catalog['TMT000001']
        assert (entry.category, entry.item_type) == ('Otros', 'MATERIAL')

    def test_existing_item_only_gets_blank_fields_filled(self, make_item):
        item = make_item('EPP000001', 'GUANTE', purchase_order_ref='9.99')
        plan = make_plan(build_workbook(
            catalog=[catalog_row('EPP000001', 'GUANTE', oc=1.02, packing='PK-1', order_number='ORD-9')],
        ))
        entry = plan.catalog[item.product_code]
        assert entry.action == planner.ACTION_UPDATE
        assert entry.changes == {'order_number': 'ORD-9', 'packing_list': 'PK-1'}     # OC already set: kept

    def test_update_existing_overwrites_the_catalog_attributes_but_never_unit_or_description(self, make_item):
        make_item('EPP000001', 'GUANTE', purchase_order_ref='9.99')
        plan = make_plan(
            build_workbook(catalog=[catalog_row('EPP000001', 'GUANTE', oc=1.02)]), update_existing=True,
        )
        assert plan.catalog['EPP000001'].changes == {'purchase_order_ref': '1.02'}

    def test_unchanged_existing_item(self, make_item):
        make_item('EPP000001', 'GUANTE')
        plan = make_plan(build_workbook(catalog=[catalog_row('EPP000001', 'GUANTE')]))
        assert plan.catalog['EPP000001'].action == planner.ACTION_UNCHANGED


class TestSummarySheet:
    def test_initial_stock_becomes_one_initial_load_per_item(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', initial=7, stock=7)]))
        assert [(ln.code, int(ln.quantity)) for ln in plan.initial_lines] == [('EPP000001', 7)]
        assert plan.summary()['stock']['projected_total'] == 7.0 and by_code(plan)['STOCK_DISTINTO_AL_LIBRO'] == []

    def test_opening_date_is_the_earliest_movement_date(self):
        plan = make_plan(small(
            summary=[summary_row('EPP000001', 'G', initial=7, stock=8)],
            entries=[entry_row('EPP000001', 1, D3)], exits=[],
        ))
        assert plan.opening_date == D3
        plan = make_plan(small(
            summary=[summary_row('EPP000001', 'G', initial=7)],
            entries=[entry_row('EPP000001', 1, D3), entry_row('EPP000001', 1, D1)],
        ))
        assert plan.opening_date == D1

    def test_book_stock_that_does_not_match_the_movements_is_a_warning(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', 4)], summary=[summary_row('EPP000001', 'G', stock=9)]))
        assert one(plan, 'STOCK_DISTINTO_AL_LIBRO').severity == 'warning'
        assert plan.summary()['stock']['mismatched_items'] == 1

    def test_missing_project_is_informational(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', project=None)]))
        assert one(plan, 'PROYECTO_VACIO').severity == 'info' and plan.project_labels == {}

    def test_project_matching_is_suggested_only_when_unique(self, project):
        project.code, project.name = 'ON-PLANT', 'On Plant'
        project.save()
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G')]))
        assert plan.summary()['projects'][0]['suggested_id'] == project.pk

    def test_negative_summary_values_are_rejected(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', initial=-1)]))
        assert one(plan, 'CANTIDAD_INVALIDA').sheet == SHEET_SUMMARY

    def test_summary_observation_is_stored_on_the_item(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', observation='Revisar tallas')]))
        assert plan.catalog['EPP000001'].observation == 'Revisar tallas'


class TestLocations:
    def test_floor_label_means_pending_to_locate_and_never_invents_a_pavilion(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', location='PISO 2 ')]))
        entry = plan.catalog['EPP000001']
        assert (entry.floor, entry.location) == (2, '')
        assert one(plan, 'UBICACION_PISO_SIN_PABELLON').severity == 'warning'

    def test_exact_location_is_applied_without_warning(self):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', location='f3-2')]))
        entry = plan.catalog['EPP000001']
        assert (entry.location, entry.floor) == ('F3-2', 2)
        assert 'UBICACION_PISO_SIN_PABELLON' not in by_code(plan)

    @pytest.mark.parametrize('text', ['Z9-9', 'BODEGA', 'F9-1', 'A1-9', 'PISO 3'])
    def test_unrecognized_location_is_ignored_with_a_warning(self, text):
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', location=text)]))
        assert one(plan, 'UBICACION_NO_RECONOCIDA').severity == 'warning'
        assert plan.catalog['EPP000001'].location == '' and plan.catalog['EPP000001'].floor is None

    def test_exact_location_found_in_a_movement_sheet_beats_the_floor_of_the_summary(self):
        plan = make_plan(small(
            summary=[summary_row('EPP000001', 'G', location='PISO 2')],
            entries=[entry_row('EPP000001', 1, location='G4-3')],
        ))
        assert plan.catalog['EPP000001'].location == 'G4-3'
        assert 'UBICACION_PISO_SIN_PABELLON' not in by_code(plan)

    def test_location_already_assigned_in_the_system_is_never_overwritten(self, make_item):
        make_item('EPP000001', 'GUANTE', location='A1-1', floor=1)
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', location='F3-2')]))
        entry = plan.catalog['EPP000001']
        assert 'location' not in entry.changes and 'UBICACION_PISO_SIN_PABELLON' not in by_code(plan)

    def test_existing_item_with_floor_only_is_not_flagged_again(self, make_item):
        make_item('EPP000001', 'GUANTE', floor=2)
        plan = make_plan(small(summary=[summary_row('EPP000001', 'G', location='PISO 2')]))
        assert 'UBICACION_PISO_SIN_PABELLON' not in by_code(plan)


class TestCatalogFromSummary:
    def test_summary_alone_is_enough_to_rebuild_the_catalog(self):
        plan = make_plan(build_workbook(
            summary=[summary_row('EPP000001', 'GUANTE T: M', initial=4, stock=4, location='F1-1')],
        ))
        assert plan.catalog_source == SHEET_SUMMARY and plan.can_confirm
        entry = plan.catalog['EPP000001']
        assert (entry.description, entry.size, entry.location) == ('GUANTE T: M', 'M', 'F1-1')


class TestDigestAndProblemStorage:
    def test_digest_is_deterministic(self):
        data = standard_workbook()
        assert make_plan(data, file_sha256='x').digest() == make_plan(data, file_sha256='x').digest()

    def test_digest_changes_when_the_database_changes(self, make_item):
        data = standard_workbook()
        before = make_plan(data).digest()
        make_item('EPP000002', 'CASCO BLANCO')
        assert make_plan(data).digest() != before

    def test_digest_changes_with_the_options(self):
        data = standard_workbook()
        assert make_plan(data).digest() != make_plan(data, update_existing=True).digest()

    def test_problems_are_stored_most_severe_first(self):
        plan = make_plan(small(entries=[entry_row('EPP000001', None), entry_row('EPP999999', 1)]))
        stored = plan.problems_payload()
        severities = [p['severity'] for p in stored['items']]
        assert severities == sorted(severities, key=['blocker', 'error', 'warning', 'info'].index)

    def test_problem_storage_is_capped_and_flags_truncation(self, monkeypatch):
        monkeypatch.setattr(planner, 'MAX_STORED_PROBLEMS', 3)
        plan = make_plan(small(entries=[entry_row('EPP000001', None, when=None) for _ in range(5)]))
        stored = plan.problems_payload()
        assert len(stored['items']) == 3 and stored['truncated'] is True and stored['total'] > 3
        assert plan.counts()['error'] == 5          # counts are computed before truncation

    def test_summary_is_json_serializable(self):
        import json
        json.dumps(make_plan(standard_workbook()).summary())
        json.dumps(make_plan(standard_workbook()).problems_payload())


class TestAlreadyImportedRows:
    def test_rows_with_an_existing_source_key_are_skipped(self, central_warehouse, epp_item):
        data = small(
            catalog=[catalog_row(epp_item.product_code, epp_item.description)],
            entries=[entry_row(epp_item.product_code, 4, D1), entry_row(epp_item.product_code, 4, D1)],
        )
        first = make_plan(data)
        keys = [ln.source_key for g in first.entry_groups for ln in g.lines]
        assert len(set(keys)) == 2                            # identical rows get different keys (occurrence)
        movement_svc.register_entry_batch(
            [{'inventory_id': epp_item.pk, 'quantity': 4, 'source_key': keys[0]}], 'CENTRAL', None, 'PURCHASE',
            '', '', '', central_warehouse, movement_date=D1,
        )
        again = make_plan(data)
        assert again.summary()['entries'] == {'to_import': 1, 'skipped_error': 0, 'already_imported': 1, 'groups': 1}
        assert len(by_code(again)['FILA_YA_IMPORTADA']) == 1

    def test_source_keys_do_not_depend_on_other_rows(self):
        a = make_plan(small(entries=[entry_row('EPP000001', 4, D1)]))
        b = make_plan(small(entries=[entry_row('EPP000001', 9, D2), entry_row('EPP000001', 4, D1)]))
        key = a.entry_groups[0].lines[0].source_key
        assert key in {ln.source_key for g in b.entry_groups for ln in g.lines}

    def test_stock_projection_includes_what_the_system_already_holds(self, make_item):
        item = make_item('EPP000001', 'GUANTE', stock=6)
        plan = make_plan(small(entries=[entry_row(item.product_code, 4)]))
        assert plan.catalog[item.product_code].projected == 10
        assert InventoryStock.objects.get(inventory=item).quantity == 6


class TestValidators:
    """Cell-level rules that a spreadsheet writer cannot produce (so they are tested directly)."""

    @pytest.mark.parametrize('value', [float('inf'), float('nan'), 'NaN', 'Infinity', '1e3', '--1', object()])
    def test_non_finite_or_exotic_quantities_are_invalid(self, value):
        from rest_framework import serializers as drf

        from apps.warehouse.services.imports.validators import QuantityField

        with pytest.raises(drf.ValidationError) as exc:
            QuantityField().run_validation(value)
        assert exc.value.detail[0].code == 'CANTIDAD_INVALIDA'

    def test_quantity_is_quantized_to_three_decimals(self):
        from apps.warehouse.services.imports.validators import QuantityField

        assert QuantityField().run_validation(2.5) == Decimal('2.500')
        assert QuantityField().run_validation('7') == Decimal('7.000')

    def test_number_as_text(self):
        from apps.warehouse.services.imports.validators import number_as_text

        assert number_as_text(120) == '120' and number_as_text(120.0) == '120'
        assert number_as_text(1.02, 2) == '1.02' and number_as_text(1.1, 2) == '1.10'
        assert number_as_text('x') == 'x'

    def test_error_messages_never_echo_the_cell(self):
        from apps.warehouse.services.imports.validators import ExitRowSerializer, validate_row

        _data, errors = validate_row(ExitRowSerializer, {
            'quantity': 'Rosa Test', 'date': 'Rosa Test', 'product_code': 'EPP1', 'destination': 'Rosa Test',
        })
        assert errors and all('Rosa' not in detail for _code, detail in errors)
