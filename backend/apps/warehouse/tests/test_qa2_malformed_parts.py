"""
SYSPCC-025 · QA ronda 2 — libros con un contenedor ZIP sano pero con el XML de adentro roto.

``inspect_zip`` valida el contenedor (rutas, tamaños, DTD, macros), pero un libro puede pasarlo y traer
una hoja truncada, un ``workbook.xml`` que no es XML, una hoja referida que no existe o una parte vacía.
Regla única: la subida responde 400 ``ARCHIVO_INVALIDO`` (el archivo no es un libro legible), nunca 500,
y no escribe nada. Un 500 aquí deja al almacenero sin saber que el archivo está dañado.

Los libros son SINTÉTICOS; ningún valor sale del libro real.
"""
import io
import zipfile

import pytest

from apps.warehouse.models import InventoryImport

from .import_workbooks import standard_workbook
from .qa_support import snapshot_database, tolerant_client, upload

pytestmark = pytest.mark.django_db

SHEET = 'xl/worksheets/sheet1.xml'


def rewrite(data: bytes, *, replace=None, drop=()) -> bytes:
    """Copy of the archive with some parts replaced and some removed."""
    replace = replace or {}
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.filename in drop:
                continue
            dst.writestr(info.filename, replace.get(info.filename, src.read(info.filename)))
    return out.getvalue()


BROKEN = {
    'sheet truncated mid-tag': ({SHEET: b'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"'}, ()),
    'sheet is not xml': ({SHEET: b'esto no es xml'}, ()),
    'sheet part is empty': ({SHEET: b''}, ()),
    'workbook.xml is not xml': ({'xl/workbook.xml': b'\x00\x01\x02 basura'}, ()),
    'workbook.xml is empty': ({'xl/workbook.xml': b''}, ()),
    'workbook rels is not xml': ({'xl/_rels/workbook.xml.rels': b'<<<<'}, ()),
    'workbook rels missing': ({}, ('xl/_rels/workbook.xml.rels',)),
    'content types is not xml': ({'[Content_Types].xml': b'no es xml'}, ()),
    'styles is not xml': ({'xl/styles.xml': b'<styleSheet'}, ()),
}


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


@pytest.mark.parametrize('case', list(BROKEN), ids=list(BROKEN))
def test_a_workbook_with_broken_xml_inside_is_a_400_and_writes_nothing(client, case):
    replace, drop = BROKEN[case]
    broken = rewrite(standard_workbook(), replace=replace, drop=drop)
    before = snapshot_database()

    response = upload(client, broken)

    assert response.status_code == 400, (case, response.status_code, response.content[:160])
    assert response.json().get('code') == 'ARCHIVO_INVALIDO', response.content[:160]
    assert snapshot_database() == before
    assert not InventoryImport.objects.exists()


def test_a_sheet_whose_part_is_missing_is_simply_absent_and_the_preview_says_so(client):
    """openpyxl skips a sheet it cannot find: the sheet is not read and the summary does not list it."""
    response = upload(client, rewrite(standard_workbook(), drop=(SHEET,)))
    assert response.status_code == 201, response.content[:160]
    sheets = response.json()['summary']['sheets']
    assert 'MATRIZ DE RECURSOS' not in sheets and {'INGRESOS', 'EGRESOS'} <= set(sheets)


def test_a_workbook_without_a_styles_part_is_still_readable(client):
    """Styles are cosmetic for the importer: a missing part must not cost the user the whole file."""
    assert upload(client, rewrite(standard_workbook(), drop=('xl/styles.xml',))).status_code == 201


def test_the_untouched_workbook_is_still_accepted(client):
    """Control: the same helper without breaking anything yields a normal preview."""
    assert upload(client, rewrite(standard_workbook())).status_code == 201
