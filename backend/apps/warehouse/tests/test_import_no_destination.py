"""
SYSPCC-032 — exits without USUARIO/DESTINO are imported as "Sin destino" (warning) instead of skipped.

The goods did leave the warehouse, so skipping the row left the imported stock above the book's
RESUMEN. Synthetic workbooks only (invented names).
"""
from io import StringIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.warehouse.models import (
    InventoryImport, InventoryImportStatus, InventoryMovement, InventoryStock, MovementGroup,
)
from apps.warehouse.services.imports import parser, planner, service
from apps.warehouse.services.imports.errors import ImportConflict
from apps.warehouse.services.personal_matching import NO_DESTINATION_LABEL

from .conftest import client_for
from .import_workbooks import (
    D2, D3, WORKER_A, build_workbook, catalog_row, entry_row, exit_row, summary_row,
)

pytestmark = pytest.mark.django_db

ACCEPT = ('--accept-warnings', '--accept-skipped-rows')
MOVEMENTS = '/api/v1/warehouse/movements/'
LINK = MOVEMENTS + 'link-personal/'


def book(*extra_exits, stock=4):
    """
    EPP000001: +10, -2 (vale 120, WORKER_A) and the given extra exits.
    EPP000002: +5. The summary reconciles with the exits that are imported.
    """
    exits = [exit_row('EPP000001', 2, WORKER_A, voucher=120, when=D2), *extra_exits]
    exited = 2 + sum(row[5] for row in extra_exits if row[3] == 'EPP000001')
    return build_workbook(
        catalog=[catalog_row('EPP000001', 'GUANTE DE CUERO T: L'), catalog_row('EPP000002', 'CASCO BLANCO')],
        entries=[entry_row('EPP000001', 10), entry_row('EPP000002', 5)],
        exits=exits,
        summary=[
            summary_row('EPP000001', 'GUANTE DE CUERO T: L', entries=10, exits=exited, stock=10 - exited),
            summary_row('EPP000002', 'CASCO BLANCO', entries=5, exits=0, stock=5),
        ],
    )


def make_plan(data):
    return planner.build_plan(parser.parse_workbook(data), warehouse='CENTRAL')


def problems(plan, code):
    return [p for p in plan.problems if p.code == code]


def upload(data, name='libro.xlsx'):
    return SimpleUploadedFile(name, data, content_type=parser.XLSX_CONTENT_TYPE)


def stock(code):
    return InventoryStock.objects.get(inventory__product_code=code).quantity


def run(path, *args):
    out = StringIO()
    call_command('import_warehouse_excel', str(path), *args, stdout=out)
    return out.getvalue()


def import_book(data, user, **kwargs):
    imp = service.create_preview(uploaded_file=upload(data), user=user, **kwargs)
    imp, _ = service.confirm_import(
        imp.pk, user, expected_plan_digest=imp.plan_digest, project_map={'ON PLANT': None},
        accept_warnings=True, accept_skipped_rows=True,
    )
    return imp


class TestPlanner:
    @pytest.mark.parametrize('destination', [None, '', '   ', '--'])
    def test_empty_destination_is_a_warning_and_the_row_is_imported(self, destination):
        plan = make_plan(book(exit_row('EPP000001', 3, destination, voucher=121, when=D3)))
        found = problems(plan, 'DESTINO_VACIO')
        assert len(found) == 1 and found[0].severity == 'warning' and found[0].row == 3
        assert found[0].message == "El egreso no indica usuario/destino; se cargará como 'Sin destino' para revisar."
        assert plan.skipped_rows == 0 and plan.can_confirm
        assert plan.summary()['exits'] == {'to_import': 2, 'skipped_error': 0, 'already_imported': 0, 'groups': 2}

    def test_the_stock_projection_matches_the_book(self):
        plan = make_plan(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)))
        stock_summary = plan.summary()['stock']
        assert stock_summary['projected_total'] == stock_summary['sheet_total'] == 10.0
        assert stock_summary['mismatched_items'] == 0 and not problems(plan, 'STOCK_DISTINTO_AL_LIBRO')

    def test_confirming_requires_accepting_warnings_not_skipped_rows(self):
        requires = make_plan(book(exit_row('EPP000001', 3, None, voucher=121, when=D3))).requires()
        assert requires['accept_warnings'] and not requires['accept_skipped_rows']

    def test_the_group_is_marked_and_not_offered_to_be_linked_to_a_worker(self, make_personal):
        make_personal(NO_DESTINATION_LABEL)          # even a worker with that "name" is not matched
        plan = make_plan(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)))
        blank = next(g for g in plan.exit_groups if g.no_destination)
        assert (blank.destination, blank.internal, blank.personal_id) == (NO_DESTINATION_LABEL, False, None)
        assert plan.unmatched_destinations == [] or all(
            item['display'] != NO_DESTINATION_LABEL for item in plan.unmatched_destinations
        )
        assert [p.row for p in problems(plan, 'DESTINO_SIN_PERSONAL')] == [2]       # only WORKER_A's vale

    def test_a_blank_cell_in_a_vale_that_has_a_destination_is_not_a_reused_vale(self):
        plan = make_plan(book(exit_row('EPP000001', 1, None, voucher=120, when=D2)))
        assert not problems(plan, 'VALE_REUTILIZADO') and len(problems(plan, 'DESTINO_VACIO')) == 1

    def test_the_same_vale_number_on_another_date_is_still_flagged(self):
        plan = make_plan(book(exit_row('EPP000001', 1, None, voucher=120, when=D3)))
        assert len(problems(plan, 'VALE_REUTILIZADO')) == 1

    def test_the_item_must_still_exist_for_the_row_to_be_imported(self):
        plan = make_plan(book(exit_row('EPP999999', 1, None, voucher=121, when=D3)))
        assert problems(plan, 'ITEM_DESCONOCIDO') and plan.summary()['exits']['skipped_error'] == 1

    def test_source_keys_of_the_rows_that_had_a_destination_do_not_change(self):
        with_blank = make_plan(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)))
        without = make_plan(book())
        old = {ln.source_key for g in without.exit_groups for ln in g.lines}
        new = {ln.source_key for g in with_blank.exit_groups for ln in g.lines}
        assert old < new and len(new - old) == 1


class TestConfirm:
    def test_the_exit_is_imported_as_sin_destino_and_the_stock_matches_the_book(self, central_warehouse):
        imp = import_book(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)), central_warehouse)
        assert imp.result['reconciled'] is True and stock('EPP000001') == 5 and stock('EPP000002') == 5
        movement = InventoryMovement.objects.get(destination_detail=NO_DESTINATION_LABEL)
        assert (movement.movement_type, movement.quantity, movement.voucher_number) == ('EXIT', 3, '121')
        assert movement.destination_type == 'ADJUSTMENT' and movement.destination_personal_id is None
        group = MovementGroup.objects.get(destination_detail=NO_DESTINATION_LABEL)
        assert group.destination_type == 'ADJUSTMENT' and 'revisar' in group.notes
        assert group.destination_personal_id is None and movement.import_batch_id == imp.pk

    def test_movements_can_be_found_with_the_no_destination_filter(self, central_warehouse):
        import_book(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)), central_warehouse)
        client = client_for(central_warehouse)
        response = client.get(MOVEMENTS, {'no_destination': 'true'})
        assert response.status_code == 200
        rows = response.json()['results']
        assert [r['destination_detail'] for r in rows] == [NO_DESTINATION_LABEL]
        assert rows[0]['destination_key'] == ''
        # the plain text filter also finds them
        assert len(client.get(MOVEMENTS, {'destination': 'sin destino'}).json()['results']) == 1

    def test_sin_destino_is_not_offered_as_an_unlinked_destination_nor_linkable(
        self, central_warehouse, make_personal,
    ):
        import_book(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)), central_warehouse)
        client = client_for(central_warehouse)
        unlinked = client.get(MOVEMENTS, {'unlinked_destination': 'true'}).json()['results']
        assert all(r['destination_detail'] != NO_DESTINATION_LABEL for r in unlinked) and len(unlinked) == 1
        worker = make_personal('Soto Rios, Ana Test')
        key = 'destino sin'                                   # what normalize_name('SIN DESTINO') gives
        response = client.post(LINK, {'destination_key': key, 'personal': worker.pk}, format='json')
        assert response.status_code == 200 and response.json() == {'linked_movements': 0, 'linked_groups': 0}
        assert InventoryMovement.objects.filter(destination_personal__isnull=False).count() == 0


class TestReimport:
    """The 'old' database: the book was imported while blank-destination exits were still skipped."""

    @staticmethod
    def legacy_import(data, user):
        imp = import_book(data, user)
        blank = InventoryMovement.objects.filter(destination_detail=NO_DESTINATION_LABEL)
        for movement in blank:
            row = InventoryStock.objects.get(inventory=movement.inventory, warehouse_type='CENTRAL')
            row.quantity += movement.quantity
            row.save()
        group_ids = list(blank.values_list('group_id', flat=True))
        blank.delete()
        MovementGroup.objects.filter(pk__in=group_ids).delete()
        return imp

    @pytest.fixture
    def data(self):
        return book(
            exit_row('EPP000001', 3, None, voucher=121, when=D3),
            exit_row('EPP000001', 1, '--', when=D3),
        )

    def test_the_same_book_is_still_rejected_without_the_flag(self, central_warehouse, data):
        first = self.legacy_import(data, central_warehouse)
        with pytest.raises(ImportConflict) as exc:
            service.create_preview(uploaded_file=upload(data), user=central_warehouse)
        assert exc.value.code == 'file_already_imported' and exc.value.extra['import_id'] == str(first.pk)

    def test_reimport_adds_only_the_rows_that_were_never_imported(self, central_warehouse, data):
        self.legacy_import(data, central_warehouse)
        before = set(InventoryMovement.objects.values_list('pk', 'source_key'))
        assert stock('EPP000001') == 8                      # 4 units still to subtract

        imp = import_book(data, central_warehouse, reimport=True)

        assert imp.is_reimport and imp.status == InventoryImportStatus.CONFIRMED
        assert imp.result['movements'] == {'initial': 0, 'entries': 0, 'exits': 2}
        assert imp.result['reconciled'] is True and stock('EPP000001') == 4
        after = set(InventoryMovement.objects.values_list('pk', 'source_key'))
        assert before < after and len(after - before) == 2           # nothing rewritten, 2 new rows
        assert InventoryMovement.objects.filter(destination_detail=NO_DESTINATION_LABEL).count() == 2
        assert InventoryImport.objects.filter(status='CONFIRMED').count() == 2

    def test_reimport_preview_shows_only_the_new_rows_and_no_stock_gap(self, central_warehouse, data):
        self.legacy_import(data, central_warehouse)
        imp = service.create_preview(uploaded_file=upload(data), user=central_warehouse, reimport=True)
        summary = imp.summary
        assert summary['exits']['to_import'] == 2 and summary['exits']['already_imported'] == 1
        assert summary['entries']['to_import'] == 0 and summary['stock']['mismatched_items'] == 0
        assert summary['imported_rows_missing'] == 0 and summary['counts']['error'] == 0

    def test_a_second_reimport_has_nothing_to_add(self, central_warehouse, data):
        self.legacy_import(data, central_warehouse)
        import_book(data, central_warehouse, reimport=True)
        count = InventoryMovement.objects.count()
        imp = service.create_preview(uploaded_file=upload(data), user=central_warehouse, reimport=True)
        assert imp.summary['exits']['to_import'] == 0 and imp.summary['exits']['already_imported'] == 3
        service.cancel_import(imp.pk)
        assert InventoryMovement.objects.count() == count and stock('EPP000001') == 4

    def test_the_unique_file_rule_still_holds_for_normal_imports(self, central_warehouse, data):
        first = import_book(data, central_warehouse)
        with pytest.raises(IntegrityError), transaction.atomic():
            InventoryImport.objects.create(
                uploaded_by=central_warehouse, warehouse='CENTRAL', file_name='x.xlsx',
                file_sha256=first.file_sha256, status='CONFIRMED',
            )

    def test_the_flag_on_a_book_never_imported_is_a_normal_import(self, central_warehouse, data):
        imp = import_book(data, central_warehouse, reimport=True)
        assert not imp.is_reimport and stock('EPP000001') == 4


class TestCommand:
    @pytest.fixture
    def path(self, tmp_path):
        target = tmp_path / 'libro.xlsx'
        target.write_bytes(book(exit_row('EPP000001', 3, None, voucher=121, when=D3)))
        return target

    def test_dry_run_reports_the_warning(self, path):
        output = run(path, '--dry-run')
        assert 'DESTINO_VACIO [warning] x1' in output and 'Se puede confirmar: sí' in output
        assert 'Stock: proyectado=10.0 libro=10.0 ítems distintos=0' in output
        assert InventoryMovement.objects.count() == 0

    def test_without_the_flag_the_same_book_is_rejected(self, path, central_warehouse):
        run(path, '--user', central_warehouse.email, '--skip-projects', *ACCEPT)
        with pytest.raises(Exception, match='file_already_imported'):
            run(path, '--user', central_warehouse.email, '--skip-projects', *ACCEPT)

    def test_reimport_flag_adds_only_the_missing_rows_then_reports_nothing_new(self, path, central_warehouse):
        data = path.read_bytes()
        TestReimport.legacy_import(data, central_warehouse)
        assert stock('EPP000001') == 8

        output = run(path, '--user', central_warehouse.email, '--skip-projects', '--reimport', *ACCEPT)
        assert 'Importación confirmada' in output and 'egresos=1' in output and 'ingresos=0' in output
        assert stock('EPP000001') == 5 and InventoryMovement.objects.filter(
            destination_detail=NO_DESTINATION_LABEL).count() == 1

        output = run(path, '--user', central_warehouse.email, '--skip-projects', '--reimport', *ACCEPT)
        assert 'no tiene filas nuevas' in output
        assert stock('EPP000001') == 5
        assert InventoryImport.objects.filter(status='CONFIRMED').count() == 2
        assert InventoryImport.objects.filter(status='CANCELLED').count() == 1
