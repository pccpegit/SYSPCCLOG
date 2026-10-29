"""
SYSPCC-025 · QA ronda 2 — importación del libro: escenarios cruzados con libros SINTÉTICOS.

La ronda 1 cubrió cada código de problema por separado. Aquí se prueban las combinaciones que
rompen a un importador de verdad: el mismo libro con las filas en otro orden, filas idénticas
repetidas, un libro más largo, cargas iniciales que cambian, columnas desordenadas, ítems que ya
existen en el sistema y fallos a mitad de la confirmación.

Todos los nombres y códigos son inventados; nada sale del libro real.
"""
import io
import logging
import random
from datetime import date
from decimal import Decimal
from unittest import mock

import openpyxl
import pytest
from django.db import IntegrityError

from apps.core.models import Project
from apps.warehouse.models import (
    Inventory, InventoryImport, InventoryImportStatus, InventoryMovement, InventoryStock,
)
from apps.warehouse.services.imports import service
from apps.warehouse.services.imports.reporting import TEMPLATE_HEADERS
from apps.warehouse.throttling import WarehouseImportThrottle

from .import_workbooks import (
    D1, D2, D3, WORKER_A, WORKER_B, build_workbook, catalog_row, entry_row, exit_row, standard_workbook, summary_row,
)
from .qa_support import INVENTORY, confirm, snapshot_database, stock_of, tolerant_client, upload

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_upload_limit(monkeypatch):
    monkeypatch.setattr(WarehouseImportThrottle, 'THROTTLE_RATES', {'warehouse_import': '1000/hour'})


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


def _import(client, data, **overrides):
    preview = upload(client, data)
    assert preview.status_code == 201, preview.content
    done = confirm(client, preview.json(), project_map={'ON PLANT': None}, **overrides)
    assert done.status_code == 200, done.content
    return preview.json(), done.json()


def _pairs(rows):
    return [list(row) for row in rows]


# ---------------------------------------------------------------------------
# Idempotencia
# ---------------------------------------------------------------------------

CATALOG = [catalog_row('EPP1', 'GUANTE T: L'), catalog_row('EPP2', 'CASCO'), catalog_row('EPP3', 'LENTE')]
ENTRIES = [entry_row('EPP1', 10, D1), entry_row('EPP2', 6, D1), entry_row('EPP3', 4, D2, po='PO-9')]
EXITS = [
    exit_row('EPP1', 2, WORKER_A, voucher=1, when=D2), exit_row('EPP2', 1, WORKER_B, voucher=2, when=D2),
    exit_row('EPP1', 3, WORKER_B, voucher=3, when=D3), exit_row('EPP3', 1, WORKER_A, voucher=1, when=D2),
]


class TestReimportIsIdempotent:
    @pytest.mark.parametrize('seed', [1, 2, 3])
    def test_the_same_rows_in_another_order_change_nothing(self, client, seed):
        _import(client, build_workbook(catalog=CATALOG, entries=ENTRIES, exits=EXITS))
        before = snapshot_database()
        rng = random.Random(seed)
        shuffled = [_pairs(part) for part in (CATALOG, ENTRIES, EXITS)]
        for part in shuffled:
            rng.shuffle(part)
        preview = upload(client, build_workbook(catalog=shuffled[0], entries=shuffled[1], exits=shuffled[2])).json()

        assert preview['summary']['entries']['to_import'] == 0 and preview['summary']['exits']['to_import'] == 0
        assert preview['summary']['entries']['already_imported'] == len(ENTRIES)
        assert preview['summary']['exits']['already_imported'] == len(EXITS)
        assert confirm(client, preview, project_map={}).status_code == 200
        assert snapshot_database() == before

    def test_identical_rows_inside_one_book_are_both_imported_and_a_third_adds_exactly_one(self, client):
        twin = entry_row('EPP1', 5, D1, po='PO-1')
        _import(client, build_workbook(catalog=CATALOG[:1], entries=[twin, twin]))
        assert stock_of('EPP1') == 10 and InventoryMovement.objects.count() == 2

        # (same two rows in a different file: an extra catalog line changes the bytes, not the movements)
        again = upload(
            client, build_workbook(catalog=CATALOG[:2], entries=[twin, twin]),
        ).json()
        assert again['summary']['entries']['to_import'] == 0                 # same two rows: nothing new

        longer = upload(client, build_workbook(catalog=CATALOG[:1], entries=[twin, twin, twin])).json()
        assert longer['summary']['entries']['to_import'] == 1                # only the third twin
        assert confirm(client, longer, project_map={'ON PLANT': None}).status_code == 200
        assert stock_of('EPP1') == 15 and InventoryMovement.objects.count() == 3

    def test_a_destination_written_differently_is_still_the_same_row(self, client):
        original = exit_row('EPP1', 2, 'Quispe Mamani, Rosa Test', voucher=7, when=D2)
        _import(client, build_workbook(catalog=CATALOG[:1], entries=[entry_row('EPP1', 10, D1)], exits=[original]))
        before = snapshot_database()

        sloppy = exit_row('EPP1', 2, '  ROSA   TEST quispe  MAMANI ', voucher='7', when=D2)
        preview = upload(
            client, build_workbook(catalog=CATALOG[:1], entries=[entry_row('EPP1', 10, D1)], exits=[sloppy]),
        ).json()
        assert preview['summary']['exits']['to_import'] == 0 and preview['summary']['exits']['already_imported'] == 1
        assert confirm(client, preview, project_map={}).status_code == 200
        assert snapshot_database() == before

    def test_a_longer_book_adds_only_the_new_rows_and_everything_still_balances(self, client):
        _import(client, build_workbook(catalog=CATALOG, entries=ENTRIES, exits=EXITS))
        more_entries = ENTRIES + [entry_row('EPP2', 3, D3)]
        more_exits = EXITS + [exit_row('EPP2', 2, WORKER_A, voucher=9, when=D3)]
        summary = [
            summary_row('EPP1', 'GUANTE T: L', entries=10, exits=5, stock=5),
            summary_row('EPP2', 'CASCO', entries=9, exits=3, stock=6),
            summary_row('EPP3', 'LENTE', entries=4, exits=1, stock=3),
        ]
        preview = upload(
            client, build_workbook(catalog=CATALOG, entries=more_entries, exits=more_exits, summary=summary),
        ).json()
        assert preview['summary']['entries']['to_import'] == 1 and preview['summary']['exits']['to_import'] == 1
        done = confirm(client, preview, project_map={'ON PLANT': None}).json()

        assert done['result']['reconciled'] is True
        assert (stock_of('EPP1'), stock_of('EPP2'), stock_of('EPP3')) == (5, 6, 3)
        rows = client.get(INVENTORY + 'movement-summary/', {'no_page': 'true'}).json()['results']
        assert {r['product_code']: r['closing_stock'] for r in rows} == {'EPP1': 5, 'EPP2': 6, 'EPP3': 3}


# ---------------------------------------------------------------------------
# Hoja RESUMEN DE MOVIMIENTO y carga inicial
# ---------------------------------------------------------------------------

class TestSummarySheetAndOpeningStock:
    def test_a_repeated_summary_row_is_informational_and_the_first_one_counts(self, client):
        data = build_workbook(
            catalog=CATALOG[:1],
            summary=[summary_row('EPP1', 'GUANTE T: L', initial=7, stock=7),
                     summary_row('EPP1', 'GUANTE T: L', initial=99, stock=99)],
        )
        preview = upload(client, data).json()
        assert preview['summary']['by_code']['CODIGO_DUPLICADO_IDENTICO'] == 1
        assert confirm(client, preview, project_map={'ON PLANT': None}).status_code == 200
        assert stock_of('EPP1') == 7

    def test_an_opening_stock_of_an_item_skipped_for_a_unit_conflict_is_reported_and_not_loaded(
        self, client, make_item,
    ):
        make_item('EPP1', 'GUANTE T: L', 'EA', stock=3)
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'GUANTE T: L', unit='LT'), catalog_row('EPP2', 'CASCO')],   # EPP1: unit differs
            summary=[summary_row('EPP1', 'GUANTE T: L', unit='LT', initial=5, stock=5),
                     summary_row('EPP2', 'CASCO', initial=2, stock=2)],
        )
        preview = upload(client, data).json()
        codes = preview['summary']['by_code']
        assert codes.get('UNIDAD_EN_CONFLICTO') == 1 and codes.get('ITEM_OMITIDO') == 1
        assert preview['can_confirm'] is True                                  # an error skips the row, it does not block
        assert confirm(client, preview, project_map={'ON PLANT': None}).status_code == 200
        assert stock_of('EPP1') == 3 and stock_of('EPP2') == 2                 # the conflicting opening stock never loaded
        assert InventoryMovement.objects.filter(inventory__product_code='EPP1').count() == 0

    def test_a_catalog_row_that_fails_validation_blocks_the_movements_of_that_item(self, client):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'D' * 400), catalog_row('EPP2', 'CASCO')],       # EPP1: description too long
            entries=[entry_row('EPP1', 5, D1), entry_row('EPP2', 2, D1)],
        )
        preview = upload(client, data).json()
        assert preview['summary']['by_code']['FILA_INVALIDA'] == 1
        assert preview['can_confirm'] is False                                   # nothing is half-imported silently
        response = confirm(client, preview, project_map={})
        assert response.status_code == 400 and response.json()['code'] == 'blockers'
        assert Inventory.objects.count() == 0

    def test_the_opening_stock_is_loaded_once_even_if_a_later_book_changes_the_figure(self, client):
        first = build_workbook(
            catalog=CATALOG[:1], entries=[entry_row('EPP1', 4, D2)],
            summary=[summary_row('EPP1', 'GUANTE T: L', initial=10, entries=4, stock=14)],
        )
        _import(client, first)
        assert stock_of('EPP1') == 14
        initial = InventoryMovement.objects.get(source_type='INITIAL_LOAD')
        assert initial.quantity == 10 and initial.movement_date == D2           # the oldest date of the book

        corrected = build_workbook(
            catalog=CATALOG[:1], entries=[entry_row('EPP1', 4, D2), entry_row('EPP1', 1, D3)],
            summary=[summary_row('EPP1', 'GUANTE T: L', initial=12, entries=5, stock=17)],
        )
        preview = upload(client, corrected).json()
        assert preview['summary']['initial_loads'] == {'to_import': 0, 'already_imported': 1}   # not loaded again
        assert preview['summary']['by_code']['STOCK_DISTINTO_AL_LIBRO'] == 1   # but the mismatch is shouted
        assert confirm(client, preview, project_map={'ON PLANT': None}).status_code == 200
        assert InventoryMovement.objects.filter(source_type='INITIAL_LOAD').count() == 1
        assert stock_of('EPP1') == 15                                          # 10 initial + 4 + 1

    def test_the_kardex_opens_with_the_initial_load_when_the_period_starts_after_it(self, client):
        data = build_workbook(
            catalog=CATALOG[:1], entries=[entry_row('EPP1', 4, D2)], exits=[exit_row('EPP1', 3, WORKER_A, voucher=1, when=D3)],
            summary=[summary_row('EPP1', 'GUANTE T: L', initial=10, entries=4, exits=3, stock=11)],
        )
        _import(client, data)
        item = Inventory.objects.get(product_code='EPP1')
        card = client.get(f'{INVENTORY}{item.pk}/kardex/', {'date_from': D3.isoformat()}).json()
        assert card['opening_stock'] == 14 and card['closing_stock'] == 11     # 10 initial + 4 entered before D3
        rows = client.get(INVENTORY + 'movement-summary/', {'no_page': 'true', 'date_from': D3.isoformat()}).json()
        row = rows['results'][0]
        assert (row['initial_stock'], row['entries'], row['exits'], row['closing_stock']) == (14, 0, 3, 11)


# ---------------------------------------------------------------------------
# Ítems que ya existen en el sistema
# ---------------------------------------------------------------------------

class TestItemsAlreadyInTheSystem:
    def test_a_blank_category_and_type_are_filled_from_the_code_prefix(self, client, make_item):
        item = make_item('EPP1', 'GUANTE T: L', 'EA', category='', item_type='MATERIAL')
        _import(client, build_workbook(catalog=CATALOG[:1], entries=[entry_row('EPP1', 1, D1)]))
        item.refresh_from_db()
        assert (item.category, item.item_type) == ('EPP', 'EPP')

    def test_a_category_set_by_hand_is_never_overwritten(self, client, make_item):
        item = make_item('EPP1', 'GUANTE T: L', 'EA', category='Guantes', item_type='MATERIAL')
        _import(client, build_workbook(catalog=CATALOG[:1], entries=[entry_row('EPP1', 1, D1)]))
        item.refresh_from_db()
        assert (item.category, item.item_type) == ('Guantes', 'MATERIAL')

    def test_without_the_update_flag_a_different_oc_and_packing_list_are_kept(self, client, make_item):
        item = make_item('EPP1', 'GUANTE T: L', 'EA', purchase_order_ref='1.02', packing_list='P-OLD', size='L')
        preview = upload(
            client, build_workbook(catalog=[catalog_row('EPP1', 'GUANTE T: L', oc=2.03, packing='P-NEW')]),
        ).json()
        assert preview['summary']['catalog']['to_update'] == 0
        assert confirm(client, preview, project_map={}).status_code == 200
        item.refresh_from_db()
        assert (item.purchase_order_ref, item.packing_list) == ('1.02', 'P-OLD')

    def test_even_with_the_update_flag_description_and_unit_never_change(self, client, make_item):
        item = make_item('EPP1', 'GUANTE T: L', 'EA', purchase_order_ref='1.02')
        preview = upload(
            client, build_workbook(catalog=[catalog_row('EPP1', 'OTRO NOMBRE T: L', unit='EA', oc=2.03)]),
            update_existing='true',
        ).json()
        assert preview['summary']['by_code']['DESCRIPCION_DISTINTA'] == 1
        assert confirm(client, preview, project_map={}).status_code == 200
        item.refresh_from_db()
        assert (item.description, item.unit, item.purchase_order_ref) == ('GUANTE T: L', 'EA', '2.03')

    def test_with_the_update_flag_the_catalog_attributes_follow_the_book(self, client, make_item):
        item = make_item('EPP1', 'GUANTE T: L', 'EA', purchase_order_ref='1.02', packing_list='P-OLD')
        book = build_workbook(catalog=[catalog_row('EPP1', 'GUANTE T: L', unit='EA', oc=2.03, packing='P-NEW')])
        preview = upload(client, book, update_existing='true').json()
        assert preview['summary']['catalog']['to_update'] == 1
        done = confirm(client, preview, project_map={}).json()
        item.refresh_from_db()
        assert (item.purchase_order_ref, item.packing_list) == ('2.03', 'P-NEW')
        assert done['result']['catalog'] == {'created': 0, 'updated': 1}

    def test_a_matching_project_is_suggested_and_assigned_to_the_catalog_not_to_the_stock_scope(self, client, make_item):
        plant = Project.objects.create(code='ONP', name='On Plant', is_active=True)
        existing = make_item('EPP1', 'GUANTE T: L', 'EA')
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'GUANTE T: L'), catalog_row('EPP2', 'CASCO')],
            entries=[entry_row('EPP1', 3, D1), entry_row('EPP2', 2, D1)],
            summary=[summary_row('EPP1', 'GUANTE T: L', entries=3, stock=3), summary_row('EPP2', 'CASCO', entries=2, stock=2)],
        )
        preview = upload(client, data).json()
        [project_info] = preview['projects']
        assert project_info['suggested_id'] == plant.pk and project_info['items'] == 2
        done = confirm(client, preview, project_map={'ON PLANT': plant.pk})
        assert done.status_code == 200, done.content

        existing.refresh_from_db()
        assert existing.project_id == plant.pk and Inventory.objects.get(product_code='EPP2').project_id == plant.pk
        scopes = InventoryStock.objects.values_list('project_id', 'department_id', 'warehouse_type').distinct()
        assert set(scopes) == {(None, None, 'CENTRAL')}                         # the stock stays in the central pool

    def test_an_inactive_project_is_refused_at_confirmation(self, client):
        plant = Project.objects.create(code='ONP', name='On Plant', is_active=False)
        preview = upload(client, standard_workbook()).json()
        before = snapshot_database()
        response = confirm(client, preview, project_map={'ON PLANT': plant.pk})
        assert response.status_code == 400 and response.json()['code'] == 'project_not_found'
        assert snapshot_database() == before


# ---------------------------------------------------------------------------
# Forma del libro
# ---------------------------------------------------------------------------

def _sloppy_copy(source: bytes) -> bytes:
    """
    The same data with the columns of every sheet in REVERSE order, headers in lower case with extra
    spaces and accents, an extra unknown column, and an extra unknown sheet in the middle.
    """
    book = openpyxl.load_workbook(io.BytesIO(source))
    out = openpyxl.Workbook()
    out.remove(out.active)
    for sheet in book.worksheets:
        rows = [list(r) for r in sheet.iter_rows(values_only=True)]
        width = max(len(r) for r in rows)
        rows = [r + [None] * (width - len(r)) for r in rows]
        rows = [list(reversed(r)) + ['comentario libre' if i else 'Notas internas'] for i, r in enumerate(rows)]
        rows[0] = [f'  {str(h).lower()}  ' if h and h != 'Notas internas' else h for h in rows[0]]
        target = out.create_sheet(sheet.title.title())            # 'Ingresos' instead of 'INGRESOS'
        for row in rows:
            target.append(row)
        if sheet.title == 'INGRESOS':
            out.create_sheet('Hoja1').append(['esto no es parte del inventario', 'ni esto'])
    buffer = io.BytesIO()
    out.save(buffer)
    return buffer.getvalue()


class TestWorkbookShapes:
    def test_columns_in_another_order_with_sloppy_headers_extra_columns_and_sheets_import_the_same(self, client):
        original = standard_workbook()
        sloppy = _sloppy_copy(original)
        assert sloppy != original

        preview = upload(client, sloppy)
        assert preview.status_code == 201, preview.content
        preview = preview.json()
        assert preview['summary']['counts']['blocker'] == 0, preview['summary']['by_code']
        assert confirm(client, preview, project_map={'ON PLANT': None}).status_code == 200
        assert (stock_of('EPP000001'), stock_of('EPP000002'), stock_of('EPP000003')) == (5, 4, 0)
        assert InventoryMovement.objects.filter(movement_type='EXIT').count() == 3

    def test_the_template_headers_are_what_the_parser_expects(self, client):
        """The downloadable template and the parser must never drift apart."""
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'GUANTE')], entries=[entry_row('EPP1', 1, D1)],
            headers={name: TEMPLATE_HEADERS[name] for name in TEMPLATE_HEADERS},
        )
        preview = upload(client, data).json()
        assert preview['summary']['counts']['blocker'] == 0

    def test_a_workbook_with_a_number_stored_as_text_in_the_item_code_still_matches_the_catalog(self, client):
        data = build_workbook(
            catalog=[catalog_row(100234, 'TORNILLO', unit='UND')],           # numeric code in the catalog
            entries=[entry_row('100234', 7, D1)],                              # same code as text in the movements
        )
        _import(client, data)
        assert stock_of('100234') == 7 and Inventory.objects.count() == 1


# ---------------------------------------------------------------------------
# Atomicidad y fallos
# ---------------------------------------------------------------------------

class TestFailuresLeaveNothingBehind:
    def test_a_collision_on_the_final_save_is_a_conflict_and_nothing_stays_written(self, client, central_warehouse):
        """Dos confirmaciones del mismo libro: la segunda choca con el índice único y se deshace por completo."""
        preview = upload(client, standard_workbook()).json()
        before = snapshot_database()
        real_save = InventoryImport.save

        def colliding(self, *args, **kwargs):
            if 'status' in (kwargs.get('update_fields') or ()):
                raise IntegrityError('duplicate key value violates unique constraint')
            return real_save(self, *args, **kwargs)

        with mock.patch.object(InventoryImport, 'save', colliding):
            response = confirm(client, preview, project_map={'ON PLANT': None})
        assert response.status_code == 409 and response.json()['code'] == 'file_already_imported'
        assert snapshot_database() == before
        assert InventoryImport.objects.get().status == InventoryImportStatus.PREVIEWED

    def test_an_unexpected_failure_is_a_500_that_leaves_no_trace_and_names_nothing_in_the_log(
        self, client, app_logs,
    ):
        preview = upload(client, standard_workbook()).json()
        before = snapshot_database()
        with mock.patch.object(service, 'confirm_import', side_effect=RuntimeError(f'falló con {WORKER_A}')):
            response = confirm(client, preview, project_map={'ON PLANT': None})
        assert response.status_code == 500
        assert snapshot_database() == before
        dump = app_logs.dump()
        assert 'warehouse.import.fail' in dump and 'RuntimeError' in dump
        assert 'Quispe' not in dump and 'Rosa' not in dump and WORKER_A not in response.content.decode()

    def test_a_failure_while_writing_the_movements_rolls_the_catalog_back_too(self, client):
        preview = upload(client, standard_workbook()).json()
        before = snapshot_database()
        with mock.patch.object(InventoryMovement.objects, 'bulk_create', side_effect=RuntimeError('boom')):
            response = confirm(client, preview, project_map={'ON PLANT': None})
        assert response.status_code == 500
        assert snapshot_database() == before and Inventory.objects.count() == 0
        retry = confirm(client, preview, project_map={'ON PLANT': None})                   # the same preview can still be confirmed
        assert retry.status_code == 200 and Inventory.objects.count() == 3


class TestUploadedFileName:
    @pytest.mark.parametrize('name', ['../../etc/passwd.xlsx', 'C:\\temp\\libro.xlsx',
                                      'libro\n\rinyectado.xlsx', 'libro\u202egpj.xlsx'])
    def test_the_stored_name_is_a_short_plain_basename(self, client, name):
        response = upload(client, standard_workbook(), name=name)
        assert response.status_code == 201, response.content
        stored = InventoryImport.objects.get().file_name
        max_length = InventoryImport._meta.get_field('file_name').max_length
        assert len(stored) <= max_length
        assert '/' not in stored and '\\' not in stored and '\n' not in stored and '\r' not in stored
        assert '\u202e' not in stored
        logging.getLogger(__name__).debug('stored name length %s', len(stored))     # never the name itself

    def test_defect_qa20_a_long_file_name_keeps_its_extension_instead_of_being_rejected(self, client):
        """
        DEFECTO QA-20 (menor): ``sanitize_file_name`` corta a 200 caracteres ANTES de validar la extensión;
        un libro válido con un nombre largo se rechaza con "solo se aceptan libros .xlsx".
        """
        response = upload(client, standard_workbook(), name='inventario_' + 'x' * 250 + '.xlsx')
        assert response.status_code == 201, response.content
        stored = InventoryImport.objects.get().file_name
        assert len(stored) <= InventoryImport._meta.get_field('file_name').max_length
        assert stored.endswith('.xlsx')

    def test_the_name_returned_to_the_screen_is_the_sanitised_one(self, client):
        response = upload(client, standard_workbook(), name='../../secreto/libro.xlsx').json()
        assert response['file_name'] == 'libro.xlsx'


class TestNothingLeaksIntoDates:
    def test_an_import_without_any_date_still_counts_in_an_unfiltered_summary(self, client):
        data = build_workbook(catalog=CATALOG[:1], entries=[entry_row('EPP1', 6, None)])
        _import(client, data)
        undated = client.get(INVENTORY + 'movement-summary/', {'no_page': 'true'}).json()
        assert undated['results'][0]['closing_stock'] == 6
        filtered = client.get(
            INVENTORY + 'movement-summary/', {'no_page': 'true', 'date_from': date(2020, 1, 1).isoformat()},
        ).json()
        assert filtered['results'][0]['closing_stock'] == 0                      # left out of a dated window...
        assert filtered['meta']['undated_movements'] == 1                         # ...and reported, not hidden
        assert Decimal(str(stock_of('EPP1'))) == 6
