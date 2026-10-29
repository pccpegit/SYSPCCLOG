"""SYSPCC-025 — importer: upload validation and safe parsing (no database)."""
import io
import time
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.warehouse.services.imports import parser
from apps.warehouse.services.imports.errors import ImportFileError
from apps.warehouse.services.imports.parser import SHEET_CATALOG, SHEET_ENTRIES, SHEET_EXITS, SHEET_SUMMARY

from .import_workbooks import (
    build_workbook, catalog_row, entry_row, exit_row, inject_cached_values, rewrite_zip,
    standard_workbook, summary_row,
)

XLSX = parser.XLSX_CONTENT_TYPE


def upload(data, name='libro.xlsx', content_type=XLSX):
    return SimpleUploadedFile(name, data, content_type=content_type)


def codes(parsed):
    return [(p.code, p.sheet) for p in parsed.problems]


class TestUploadValidation:
    def test_valid_workbook_is_accepted(self):
        data, name = parser.inspect_upload(upload(standard_workbook()))
        assert data.startswith(b'PK') and name == 'libro.xlsx'

    @pytest.mark.parametrize('name', ['libro.xlsm', 'libro.xls', 'libro.csv', 'libro', 'libro.xlsx.exe'])
    def test_other_extensions_are_rejected(self, name):
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(standard_workbook(), name=name))
        assert exc.value.code == 'extension_not_allowed'

    @pytest.mark.parametrize('content_type', [
        'text/csv', 'application/vnd.ms-excel', 'application/vnd.ms-excel.sheet.macroenabled.12', 'text/html',
    ])
    def test_wrong_content_type_is_rejected(self, content_type):
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(standard_workbook(), content_type=content_type))
        assert exc.value.code == 'ARCHIVO_INVALIDO'

    @pytest.mark.parametrize('content_type', ['application/octet-stream', 'application/zip', ''])
    def test_generic_browser_content_types_are_accepted(self, content_type):
        parser.inspect_upload(upload(standard_workbook(), content_type=content_type))

    def test_text_file_renamed_to_xlsx_is_rejected(self):
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(b'esto no es un libro', content_type=''))
        assert exc.value.code == 'ARCHIVO_INVALIDO'

    def test_empty_file_is_rejected(self):
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(b''))

    def test_zip_that_is_not_a_workbook_is_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('hola.txt', 'hola')
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(buf.getvalue()))

    def test_truncated_zip_is_rejected(self):
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(standard_workbook()[:200]))

    def test_oversize_file_is_rejected_without_parsing(self):
        data = b'PK\x03\x04' + b'0' * (parser.MAX_UPLOAD_BYTES + 10)
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(data))
        assert exc.value.code == 'file_too_large'

    def test_zip_bomb_by_compression_ratio_is_rejected(self):
        bomb = rewrite_zip(standard_workbook(), add={'xl/media/zeros.bin': b'\0' * (6 * 1024 * 1024)})
        assert len(bomb) < 100_000                      # tiny on the wire...
        with pytest.raises(ImportFileError) as exc:     # ...but 6 MB inflated
            parser.inspect_upload(upload(bomb))
        assert 'descomprimirse' in exc.value.message

    def test_total_uncompressed_size_is_capped(self, monkeypatch):
        monkeypatch.setattr(parser, 'MAX_UNCOMPRESSED_BYTES', 10_000)
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(standard_workbook()))

    def test_the_default_uncompressed_cap_leaves_room_for_the_real_workbook(self):
        # the real book is ~3 MB inflated; 25 MB is the ceiling on a 1 GB host with one worker
        assert 5 * parser.MB < parser.MAX_UNCOMPRESSED_BYTES <= 25 * parser.MB

    def test_too_many_zip_entries_are_rejected(self, monkeypatch):
        monkeypatch.setattr(parser, 'MAX_ZIP_ENTRIES', 3)
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(standard_workbook()))

    def test_path_traversal_entry_is_rejected(self):
        evil = rewrite_zip(standard_workbook(), add={'../evil.xml': b'<a/>'})
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(evil))

    def test_macros_are_rejected(self):
        macro = rewrite_zip(standard_workbook(), add={'xl/vbaProject.bin': b'binary'})
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(macro))
        assert 'macros' in exc.value.message

    @pytest.mark.parametrize('payload', [
        b'<!DOCTYPE lolz [<!ENTITY lol "lol">]><x>&lol;</x>',
        b'<?xml version="1.0"?><!DOCTYPE foo SYSTEM "file:///etc/passwd"><x/>',
    ])
    def test_xml_with_dtd_or_entities_is_rejected(self, payload):
        evil = rewrite_zip(standard_workbook(), add={'xl/customXml/item1.xml': payload})
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(evil))
        assert 'XML' in exc.value.message

    def test_file_name_is_reduced_to_a_safe_basename(self):
        assert parser.sanitize_file_name('C:\\Users\\x\\..\\libro.xlsx') == 'libro.xlsx'
        assert parser.sanitize_file_name('/etc/passwd\x00.xlsx') == 'passwd.xlsx'
        assert len(parser.sanitize_file_name('a' * 500 + '.xlsx')) <= parser.MAX_FILE_NAME_LENGTH


_SST_HEAD = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{n}" uniqueCount="{n}">'
)


def _shared_strings(count, *, declared=None, prefix=''):
    """sharedStrings.xml with ``count`` real entries; ``declared`` forges the count attributes."""
    tag = f'{prefix}:si' if prefix else 'si'
    text = f'{prefix}:t' if prefix else 't'
    body = f'<{tag}><{text}>x</{text}></{tag}>' * count
    return (_SST_HEAD.format(n=count if declared is None else declared) + body + '</sst>').encode()


class TestSharedStringsLimit:
    """
    DEFECTO de seguridad (memoria): 9 MB de zip con 1,8 M de cadenas compartidas costaron +226 MB de RSS en
    un hilo de gunicorn. Los límites de tamaño no la acotaban; ahora la tabla de cadenas tiene tope propio.
    """

    def test_a_normal_workbook_is_untouched(self):
        parser.inspect_upload(upload(standard_workbook()))
        assert parser.parse_workbook(standard_workbook()).sheets

    def test_the_limits_leave_room_for_the_real_workbook(self):
        # the real book holds ~27 KB of shared strings and a few hundred entries
        assert parser.MAX_SHARED_STRINGS >= 50_000
        assert parser.MAX_SHARED_STRINGS_BYTES >= 1024 * 1024

    def test_exactly_the_limit_is_accepted(self):
        data = rewrite_zip(standard_workbook(), add={'xl/sharedStrings.xml': _shared_strings(parser.MAX_SHARED_STRINGS)})
        parser.inspect_upload(upload(data))

    def test_one_string_over_the_limit_is_rejected(self):
        data = rewrite_zip(
            standard_workbook(), add={'xl/sharedStrings.xml': _shared_strings(parser.MAX_SHARED_STRINGS + 1)},
        )
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(data))
        assert exc.value.code == 'ARCHIVO_INVALIDO' and 'demasiado texto' in exc.value.message

    def test_forged_count_attributes_do_not_hide_the_real_number_of_strings(self):
        forged = _shared_strings(parser.MAX_SHARED_STRINGS + 1, declared=1)
        data = rewrite_zip(standard_workbook(), add={'xl/sharedStrings.xml': forged})
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(data))

    def test_prefixed_elements_are_counted_too(self):
        data = rewrite_zip(
            standard_workbook(),
            add={'xl/sharedStrings.xml': _shared_strings(parser.MAX_SHARED_STRINGS + 1, prefix='x')},
        )
        with pytest.raises(ImportFileError):
            parser.inspect_upload(upload(data))

    def test_the_part_size_has_its_own_cap(self, monkeypatch):
        monkeypatch.setattr(parser, 'MAX_SHARED_STRINGS_BYTES', 200)
        data = rewrite_zip(standard_workbook(), add={'xl/sharedStrings.xml': _shared_strings(50)})
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload(data))
        assert 'demasiado texto' in exc.value.message


class TestParsing:
    def test_reads_the_four_sheets_with_their_rows(self):
        parsed = parser.parse_workbook(standard_workbook())
        assert set(parsed.sheets) == {SHEET_CATALOG, SHEET_ENTRIES, SHEET_EXITS, SHEET_SUMMARY}
        assert [len(parsed.sheets[s].rows) for s in (SHEET_CATALOG, SHEET_ENTRIES, SHEET_EXITS, SHEET_SUMMARY)] == [3, 2, 3, 3]
        assert parsed.catalog_sheet == SHEET_CATALOG
        assert parsed.problems == []
        first_exit = parsed.sheets[SHEET_EXITS].rows[0]
        assert first_exit.row == 2 and first_exit.values['voucher'] == 120 and first_exit.values['quantity'] == 2

    def test_mixed_types_are_kept_raw_for_the_validators(self):
        parsed = parser.parse_workbook(standard_workbook())
        vouchers = [r.values['voucher'] for r in parsed.sheets[SHEET_EXITS].rows]
        assert vouchers == [120, '120', 121]            # int and str, exactly like the real workbook
        ocs = [r.values['purchase_order_ref'] for r in parsed.sheets[SHEET_CATALOG].rows]
        assert ocs == [1.02, 2.03, None]

    def test_headers_match_ignoring_accents_case_and_spacing(self):
        headers = {SHEET_EXITS: ['n°', 'nª vale', 'fecha', 'item', 'descripción', 'cantidad a egresar',
                                 'locación', 'transferencia interna', ' Usuario/ Destino ', 'observación']}
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], exits=[exit_row('EPP1', 1, 'Destino Test', voucher=5)],
            headers=headers,
        ))
        assert parsed.problems == []
        assert parsed.sheets[SHEET_EXITS].rows[0].values['destination'] == 'Destino Test'

    def test_sheet_titles_are_matched_by_normalized_name(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 1)],
            sheet_names={SHEET_CATALOG: 'matriz de recursos ', SHEET_ENTRIES: 'Ingresos'},
        ))
        assert SHEET_CATALOG in parsed.sheets and SHEET_ENTRIES in parsed.sheets

    def test_header_is_found_below_a_warning_row(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 4)], header_offset=1,
        ))
        entries = parsed.sheets[SHEET_ENTRIES]
        assert entries.header_row == 2 and entries.rows[0].row == 3
        assert parsed.problems == []

    def test_inflated_dimensions_do_not_hang_the_reader(self):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 1)],
            exits=[exit_row('EPP1', 1, 'Destino Test')], ghost_rows=True,
        )
        started = time.monotonic()
        parsed = parser.parse_workbook(data)
        assert time.monotonic() - started < 10
        assert len(parsed.sheets[SHEET_ENTRIES].rows) == 1
        assert parsed.sheets[SHEET_ENTRIES].last_row == 2

    def test_rows_with_only_formula_columns_filled_are_blank(self):
        # N°, DESCRIPCIÓN, UOM and LOCACIÓN are VLOOKUP formulas in the real workbook: a row that
        # has only those is not data.
        ghost = [5, None, None, None, 'DESCRIPCION', None, 'EA', 'PISO 2', None, None, None, None]
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 1), ghost, ghost],
        ))
        assert len(parsed.sheets[SHEET_ENTRIES].rows) == 1

    def test_more_than_the_row_cap_is_rejected(self, monkeypatch):
        monkeypatch.setattr(parser, 'MAX_DATA_ROWS', 20)
        rows = [entry_row('EPP1', 1) for _ in range(21)]
        with pytest.raises(ImportFileError) as exc:
            parser.parse_workbook(build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=rows))
        assert exc.value.code == 'too_many_rows'

    def test_exactly_the_row_cap_is_accepted(self, monkeypatch):
        monkeypatch.setattr(parser, 'MAX_DATA_ROWS', 20)
        rows = [entry_row('EPP1', 1) for _ in range(20)]
        parsed = parser.parse_workbook(build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=rows))
        assert len(parsed.sheets[SHEET_ENTRIES].rows) == 20

    def test_missing_catalog_sheet_is_a_blocker(self):
        parsed = parser.parse_workbook(build_workbook(entries=[entry_row('EPP1', 1)]))
        assert ('HOJA_FALTANTE', SHEET_CATALOG) in codes(parsed)
        assert parsed.catalog_sheet is None

    def test_missing_required_header_is_a_blocker(self):
        headers = {SHEET_ENTRIES: ['N°', 'FECHA', 'TAG', 'ITEM']}            # no quantity column
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[[1, None, None, 'EPP1']], headers=headers,
        ))
        assert ('CABECERA_FALTANTE', SHEET_ENTRIES) in codes(parsed)
        assert SHEET_ENTRIES not in parsed.sheets

    def test_summary_serves_as_catalog_when_matriz_is_absent(self):
        parsed = parser.parse_workbook(build_workbook(
            summary=[summary_row('EPP1', 'GUANTE', stock=3)], entries=[entry_row('EPP1', 3)],
        ))
        assert parsed.catalog_sheet == SHEET_SUMMARY
        assert [c for c, _ in codes(parsed)] == ['CATALOGO_DESDE_RESUMEN']

    def test_shipment_quantity_is_reported_as_ignored(self):
        parsed = parser.parse_workbook(build_workbook(catalog=[catalog_row('EPP1', 'X', shipment=40)]))
        assert ('SHIPMENT_QUANTITY_IGNORADA', SHEET_CATALOG) in codes(parsed)

    def test_text_cells_are_stripped_and_blank_text_is_none(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 1, location='PISO 2 ', tag='   ')],
        ))
        values = parsed.sheets[SHEET_ENTRIES].rows[0].values
        assert values['location'] == 'PISO 2' and values['tag'] is None


class TestFormulas:
    def test_formulas_are_never_evaluated_and_uncalculated_books_are_flagged(self):
        # The quantity cells are formulas that nobody calculated (book written by a script).
        rows = [entry_row('EPP1', '=2+3'), entry_row('EPP1', '=1+1'), entry_row('EPP1', 4)]
        parsed = parser.parse_workbook(build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=rows))
        assert [r.values['quantity'] for r in parsed.sheets[SHEET_ENTRIES].rows] == [None, None, 4]
        assert ('LIBRO_SIN_VALORES_CALCULADOS', SHEET_ENTRIES) in codes(parsed)

    def test_cached_formula_values_are_read_and_not_flagged(self):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', '=2+3'), entry_row('EPP1', '=1+1')],
        )
        sheet_part = _sheet_part(data, SHEET_ENTRIES)
        data = inject_cached_values(data, sheet_part, {'F2': 5, 'F3': 2})
        parsed = parser.parse_workbook(data)
        assert [r.values['quantity'] for r in parsed.sheets[SHEET_ENTRIES].rows] == [5, 2]
        assert 'LIBRO_SIN_VALORES_CALCULADOS' not in [c for c, _ in codes(parsed)]

    def test_the_formulas_pass_is_skipped_when_the_sheets_have_no_formulas(self, monkeypatch):
        calls = []
        real_load = parser.load_workbook

        def spy(*args, **kwargs):
            calls.append(kwargs.get('data_only'))
            return real_load(*args, **kwargs)

        monkeypatch.setattr(parser, 'load_workbook', spy)
        parser.parse_workbook(standard_workbook())
        assert calls == [True]                      # one load: the values pass only

    def test_the_formulas_pass_still_runs_when_there_are_formulas(self, monkeypatch):
        calls = []
        real_load = parser.load_workbook

        def spy(*args, **kwargs):
            calls.append(kwargs.get('data_only'))
            return real_load(*args, **kwargs)

        monkeypatch.setattr(parser, 'load_workbook', spy)
        parser.parse_workbook(build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', '=2+3')]))
        assert calls == [True, False]

    def test_a_formula_string_is_not_executed_as_text(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], exits=[exit_row('EPP1', 1, '=cmd|calc!A1', voucher=1)],
        ))
        # It is stored as an (uncalculated) formula -> empty, never a live value.
        assert parsed.sheets[SHEET_EXITS].rows[0].values['destination'] in (None, '=cmd|calc!A1')

    def test_external_link_parts_are_ignored(self):
        data = rewrite_zip(standard_workbook(), add={
            'xl/externalLinks/externalLink1.xml': (
                b'<?xml version="1.0"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
            ),
        })
        parsed = parser.parse_workbook(data)
        assert parsed.problems == [] and len(parsed.sheets[SHEET_ENTRIES].rows) == 2


class TestUnreadableFiles:
    def test_garbage_inside_a_valid_zip_is_reported_as_invalid_file(self):
        broken = rewrite_zip(standard_workbook(), replace={'xl/workbook.xml': b'<workbook><oops'})
        with pytest.raises(ImportFileError) as exc:
            parser.parse_workbook(broken)
        assert exc.value.code == 'ARCHIVO_INVALIDO'


def _sheet_part(data: bytes, canonical: str) -> str:
    """Part name of a sheet (sheets are written in SHEET_ORDER by the builder)."""
    present = [n for n in parser.SHEET_ORDER if n in {
        s for s in parser.parse_workbook(data).sheets
    }]
    return f'xl/worksheets/sheet{present.index(canonical) + 1}.xml'
