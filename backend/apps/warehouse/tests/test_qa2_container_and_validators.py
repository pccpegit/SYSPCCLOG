"""
SYSPCC-025 · QA ronda 2 — ramas de error del contenedor .xlsx y de la validación por celda que la
medición de cobertura dejó sin probar.

* "DEFECTO QA-n": comportamiento correcto de algo que hoy está roto; falla a propósito (sin ``xfail``) y
  pasa solo cuando se corrige la producción. La numeración continúa la de las rondas anteriores.
* El resto son ramas de error: archivo comprimido corrupto, entradas ZIP repetidas, partes en UTF-16,
  archivo cuyo tamaño declarado miente, hojas sin cabecera reconocible y los valores de celda que el
  validador debe rechazar (booleanos, fechas en columnas de texto, series de fecha fuera de rango...).

Todos los libros son SINTÉTICOS; ningún nombre ni valor sale del libro real.
"""
import io
import struct
import warnings
import zipfile
from datetime import date, datetime, timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from openpyxl.utils.datetime import to_excel
from rest_framework import serializers

from apps.warehouse.models import InventoryImport
from apps.warehouse.services.imports import parser
from apps.warehouse.services.imports.errors import ImportFileError
from apps.warehouse.services.imports.parser import SHEET_ENTRIES
from apps.warehouse.services.imports.validators import (
    CodeField, ExcelDateField, ExcelText, QuantityField, number_as_text, validate_row,
)

from .import_workbooks import build_workbook, catalog_row, entry_row, rewrite_zip, standard_workbook
from .qa_support import snapshot_database, tolerant_client, upload as post_upload

XLSX = parser.XLSX_CONTENT_TYPE


def upload_file(data, name='libro.xlsx', content_type=XLSX):
    return SimpleUploadedFile(name, data, content_type=content_type)


def codes(parsed):
    return [(p.code, p.sheet) for p in parsed.problems]


# ---------------------------------------------------------------------------
# Contenedor .xlsx: archivos que no son lo que dicen ser
# ---------------------------------------------------------------------------

def corrupt_deflate_stream(data: bytes, part: str) -> bytes:
    """Same archive, but the compressed bytes of ``part`` are garbage (the ZIP directory is intact)."""
    info = zipfile.ZipFile(io.BytesIO(data)).getinfo(part)
    offset = info.header_offset
    name_length, extra_length = struct.unpack('<HH', data[offset + 26:offset + 30])
    start = offset + 30 + name_length + extra_length
    bad = bytearray(data)
    for index in range(start + 2, start + min(info.compress_size, 14)):
        bad[index] ^= 0xFF
    return bytes(bad)


def stored_with_wrong_crc(data: bytes) -> bytes:
    """Archive without compression where one byte of a sheet no longer matches the CRC in the directory."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as dst:
        for info in src.infolist():
            dst.writestr(info.filename, src.read(info.filename))
    raw = bytearray(out.getvalue())
    position = raw.find(b'<sheetData')
    assert position > 0, 'no sheetData found in the stored archive'
    raw[position + 3] = ord('X')
    return bytes(raw)


def with_duplicate_part(data: bytes, part: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            dst.writestr(info.filename, src.read(info.filename))
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')                     # zipfile warns about the repeated name
            dst.writestr(part, src.read(part))
    return out.getvalue()


CORRUPTIBLE_PARTS = ['xl/worksheets/sheet1.xml', 'xl/workbook.xml', '[Content_Types].xml']


class TestContainerErrors:
    @pytest.mark.parametrize('part', CORRUPTIBLE_PARTS)
    def test_defect_qa33_a_corrupt_compressed_part_is_a_rejected_file_not_a_crash(self, part):
        """
        DEFECTO QA-33: ``inspect_zip`` atrapa ``BadZipFile``/``EOFError``/``OSError``... pero un flujo
        deflate dañado dentro del libro lanza ``zlib.error`` (no es ``OSError``) al leer la parte para
        buscar DTD, y la excepción sube sin traducir: la subida responde 500 en vez de ARCHIVO_INVALIDO.
        """
        bad = corrupt_deflate_stream(standard_workbook(), part)
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload_file(bad))
        assert exc.value.code == 'ARCHIVO_INVALIDO'

    @pytest.mark.django_db
    @pytest.mark.parametrize('part', CORRUPTIBLE_PARTS)
    def test_defect_qa33_the_upload_endpoint_answers_400_for_a_corrupt_compressed_part(self, central_warehouse, part):
        """DEFECTO QA-33 (desde la API): el cliente ve un 500 y no sabe que el archivo está dañado."""
        client = tolerant_client(central_warehouse)
        before = snapshot_database()
        response = post_upload(client, corrupt_deflate_stream(standard_workbook(), part))
        assert response.status_code == 400, (response.status_code, response.content[:160])
        assert response.json().get('code') == 'ARCHIVO_INVALIDO'
        assert snapshot_database() == before
        assert not InventoryImport.objects.exists()

    def test_a_stored_part_whose_crc_does_not_match_is_rejected(self):
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload_file(stored_with_wrong_crc(standard_workbook())))
        assert exc.value.code == 'ARCHIVO_INVALIDO'

    @pytest.mark.parametrize('part', ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    def test_an_archive_that_repeats_a_part_name_is_rejected(self, part):
        """Two entries with one name: which one a reader sees depends on the reader, so none is accepted."""
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload_file(with_duplicate_part(standard_workbook(), part)))
        assert exc.value.code == 'ARCHIVO_INVALIDO'

    @pytest.mark.parametrize('bom, label', [(b'\xff\xfe', 'little endian'), (b'\xfe\xff', 'big endian')])
    def test_a_utf16_xml_part_is_rejected_because_the_dtd_scan_cannot_read_it(self, bom, label):
        payload = bom + '<a/>'.encode('utf-16-le' if label == 'little endian' else 'utf-16-be')
        evil = rewrite_zip(standard_workbook(), add={'xl/customXml/item1.xml': payload})
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(upload_file(evil))
        assert 'XML' in exc.value.message

    def test_the_size_limit_does_not_trust_the_declared_size(self):
        """A stream that declares no size (or a small one) is still cut at the limit after reading it."""

        class NoSizeUpload(io.BytesIO):
            name = 'libro.xlsx'
            content_type = ''

        stream = NoSizeUpload(b'PK\x03\x04' + b'0' * (parser.MAX_UPLOAD_BYTES + 10))
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(stream)
        assert exc.value.code == 'file_too_large'

    def test_a_file_of_exactly_the_limit_is_read_not_refused_as_too_big(self):
        class NoSizeUpload(io.BytesIO):
            name = 'libro.xlsx'
            content_type = ''

        stream = NoSizeUpload(b'PK\x03\x04' + b'0' * (parser.MAX_UPLOAD_BYTES - 4))
        with pytest.raises(ImportFileError) as exc:
            parser.inspect_upload(stream)
        assert exc.value.code == 'ARCHIVO_INVALIDO'              # not a workbook, but not "too big" either


class TestSheetsWithoutAHeader:
    def test_a_sheet_whose_first_rows_say_nothing_recognisable_is_reported_not_guessed(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[['uno', 'dos', 'tres']],
            headers={SHEET_ENTRIES: ['zzz', 'yyy', 'xxx']},
        ))
        assert ('CABECERA_FALTANTE', SHEET_ENTRIES) in codes(parsed)
        assert SHEET_ENTRIES not in parsed.sheets

    def test_a_sheet_with_no_rows_at_all_is_reported_not_a_crash(self):
        parsed = parser.parse_workbook(build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[], headers={SHEET_ENTRIES: []},
        ))
        assert SHEET_ENTRIES not in parsed.sheets
        assert any(sheet == SHEET_ENTRIES for _, sheet in codes(parsed))


# ---------------------------------------------------------------------------
# Validación por celda
# ---------------------------------------------------------------------------

def code_of(exc_info) -> str:
    return exc_info.value.detail[0].code


class TestNumberAsText:
    def test_a_boolean_cell_is_text_not_a_number(self):
        assert number_as_text(True) == 'True'

    def test_a_text_cell_passes_through(self):
        assert number_as_text('PO-77') == 'PO-77'

    @pytest.mark.parametrize('value, decimals, expected', [
        (120.0, None, '120'), (1.1, 2, '1.10'), (1.02, 2, '1.02'), (1.234, 2, '1.234'), (2.5, None, '2.5'),
    ])
    def test_floats_lose_the_stray_zero_and_keep_the_fixed_decimals(self, value, decimals, expected):
        assert number_as_text(value, decimals) == expected


class TestExcelText:
    @pytest.mark.parametrize('value', [date(2026, 10, 5), datetime(2026, 10, 5, 8, 30)])
    def test_a_date_in_a_text_column_is_an_invalid_row(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelText(max_length=50, label='La OC').run_validation(value)
        assert code_of(exc) == 'FILA_INVALIDA'

    def test_text_over_the_limit_is_rejected_without_quoting_the_cell(self):
        secret = 'Apellido Inventado, Nombre Test ' * 10
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelText(max_length=20, label='El destino').run_validation(secret)
        assert code_of(exc) == 'FILA_INVALIDA'
        assert 'Apellido' not in str(exc.value.detail)

    def test_blank_text_is_an_empty_string(self):
        assert ExcelText(max_length=5).run_validation('   ') == ''

    def test_a_numeric_cell_keeps_the_requested_decimals(self):
        assert ExcelText(decimals=2).run_validation(1.1) == '1.10'


class TestCodeField:
    @pytest.mark.parametrize('value', [date(2026, 10, 5), datetime(2026, 10, 5)])
    def test_a_date_is_not_an_item_code(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            CodeField().run_validation(value)
        assert code_of(exc) == 'FILA_INVALIDA'

    def test_a_code_over_fifty_characters_is_rejected(self):
        with pytest.raises(serializers.ValidationError) as exc:
            CodeField().run_validation('E' * 51)
        assert code_of(exc) == 'FILA_INVALIDA'

    def test_fifty_characters_are_accepted(self):
        assert CodeField().run_validation('e' * 50) == 'E' * 50

    @pytest.mark.parametrize('value', ['=SUMA(A1)', '+1', '-1', '@cmd'])
    def test_a_code_that_would_be_a_formula_in_an_export_is_rejected(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            CodeField().run_validation(value)
        assert code_of(exc) == 'FILA_INVALIDA'

    @pytest.mark.parametrize('value', [None, '', '   '])
    def test_an_empty_code_is_item_vacio(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            CodeField().run_validation(value)
        assert code_of(exc) == 'ITEM_VACIO'

    def test_spaces_and_case_are_normalised(self):
        assert CodeField().run_validation('  epp000001 ') == 'EPP000001'
        assert CodeField().run_validation(123456.0) == '123456'


class TestQuantityFieldBranches:
    @pytest.mark.parametrize('value', [True, False, date(2026, 10, 5), datetime(2026, 10, 5), [3], {'q': 3}, ('3',)])
    def test_cells_that_are_not_numbers_are_an_invalid_quantity(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            QuantityField().run_validation(value)
        assert code_of(exc) == 'CANTIDAD_INVALIDA'

    @pytest.mark.parametrize('value', ['1.0001', '-1', '0', '1,5', '1e3', ' ', 'tres', '1.2.3'])
    def test_text_that_is_not_a_plain_positive_number_is_invalid_or_empty(self, value):
        field = QuantityField()
        with pytest.raises(serializers.ValidationError) as exc:
            field.run_validation(value)
        assert code_of(exc) in ('CANTIDAD_INVALIDA', 'CANTIDAD_VACIA')

    def test_zero_is_valid_only_where_the_summary_allows_it(self):
        assert QuantityField(required_quantity=False, allow_zero=True).run_validation(0) == 0
        with pytest.raises(serializers.ValidationError):
            QuantityField(required_quantity=False, allow_zero=False).run_validation(0)

    def test_an_empty_optional_quantity_is_none_and_a_required_one_is_cantidad_vacia(self):
        assert QuantityField(required_quantity=False).run_validation(None) is None
        with pytest.raises(serializers.ValidationError) as exc:
            QuantityField().run_validation(None)
        assert code_of(exc) == 'CANTIDAD_VACIA'


class TestExcelDateField:
    today = staticmethod(timezone.localdate)

    def test_a_date_cell_is_taken_as_is(self):
        assert ExcelDateField().run_validation(date(2026, 10, 5)) == date(2026, 10, 5)
        assert ExcelDateField().run_validation(datetime(2026, 10, 5, 23, 59)) == date(2026, 10, 5)

    @pytest.mark.parametrize('text', ['2026-10-05', '05/10/2026', '05-10-2026', ' 05/10/26 '])
    def test_the_accepted_text_formats(self, text):
        assert ExcelDateField().run_validation(text) == date(2026, 10, 5)

    def test_an_excel_serial_number_is_converted(self):
        assert ExcelDateField().run_validation(to_excel(date(2026, 10, 5))) == date(2026, 10, 5)
        assert ExcelDateField().run_validation(float(to_excel(date(2026, 10, 5))) + 0.75) == date(2026, 10, 5)

    @pytest.mark.parametrize('value', [5, 36525, 73051, 1e9, -3])
    def test_a_serial_number_outside_2000_2099_is_invalid(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelDateField().run_validation(value)
        assert code_of(exc) == 'FECHA_INVALIDA'

    @pytest.mark.parametrize('value', [True, False, ['2026-10-05'], {'d': 1}, b'2026-10-05'])
    def test_cells_of_other_types_are_an_invalid_date(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelDateField().run_validation(value)
        assert code_of(exc) == 'FECHA_INVALIDA'

    @pytest.mark.parametrize('text', ['ayer', '30/02/2026', '2026-13-01', '31/04/2026', '00/00/0000', '5 de octubre'])
    def test_text_that_is_not_a_date_is_invalid(self, text):
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelDateField().run_validation(text)
        assert code_of(exc) == 'FECHA_INVALIDA'

    @pytest.mark.parametrize('value', [date(1999, 12, 31), date(2100, 1, 1), date(1, 1, 1), '31/12/1999'])
    def test_a_year_outside_2000_2099_is_invalid(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelDateField().run_validation(value)
        assert code_of(exc) == 'FECHA_INVALIDA'

    def test_tomorrow_is_a_future_date_and_today_is_fine(self):
        today = self.today()
        assert ExcelDateField().run_validation(today) == today
        with pytest.raises(serializers.ValidationError) as exc:
            ExcelDateField().run_validation(today + timedelta(days=1))
        assert code_of(exc) == 'FECHA_FUTURA'

    @pytest.mark.parametrize('value', [None, '', '   '])
    def test_an_empty_cell_is_none_for_the_planner_to_report(self, value):
        assert ExcelDateField().run_validation(value) is None


class TestValidateRowFallbackCode:
    """A built-in DRF error (not one of the importer's problem codes) is reported as FILA_INVALIDA."""

    class Plain(serializers.Serializer):
        number = serializers.IntegerField()

    def test_a_framework_error_code_becomes_fila_invalida(self):
        clean, errors = validate_row(self.Plain, {'number': 'abc'})
        assert clean is None
        assert [code for code, _ in errors] == ['FILA_INVALIDA']

    def test_a_missing_required_field_becomes_fila_invalida(self):
        clean, errors = validate_row(self.Plain, {})
        assert clean is None
        assert [code for code, _ in errors] == ['FILA_INVALIDA']

    def test_a_valid_row_has_no_errors(self):
        clean, errors = validate_row(self.Plain, {'number': '7'})
        assert clean == {'number': 7} and errors == []
