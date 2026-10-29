"""
SYSPCC-025 · QA ronda 2 — pruebas que la auditoría de seguridad (ronda 2) pidió al equipo de pruebas.

Cada "DEFECTO QA-n" describe el comportamiento CORRECTO de algo que hoy está roto o a medias (los
hallazgos 🟡-A, 🟡-B, 🟡-C y 🟢 del handoff); falla a propósito y pasa solo cuando se corrige la
producción. Nada sale del libro real: los libros son sintéticos y los nombres inventados.
"""
import io
import zipfile
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.warehouse.models import InventoryImport

from .import_workbooks import WORKER_A, standard_workbook
from .qa_support import IMPORTS, INVENTORY, MOVEMENTS, snapshot_database, tolerant_client, upload

pytestmark = pytest.mark.django_db

SST_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'


@pytest.fixture(autouse=True)
def _quiet_side_effects(monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setattr(
        SimpleRateThrottle, 'THROTTLE_RATES',
        {**SimpleRateThrottle.THROTTLE_RATES, 'user': '1000000/min', 'warehouse_import': '1000000/hour'},
    )
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


def _rewrite(data: bytes, transform) -> bytes:
    """Copy an xlsx passing every (name, bytes) through ``transform`` -> (name, bytes) | None."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            result = transform(info.filename, src.read(info.filename))
            if result is not None:
                dst.writestr(*result)
    return out.getvalue()


def _with_shared_strings_in(part_name: str, strings: int) -> bytes:
    """
    A valid workbook with an extra shared-string table of ``strings`` entries stored in ``part_name``
    and declared as such in ``[Content_Types].xml`` (openpyxl finds the table by content type, not by
    file name). The workbook's own cells are inline strings, so they do not depend on it.
    """
    table = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">'
        + '<si><t>x</t></si>' * strings + '</sst>'
    ).encode()
    override = f'<Override PartName="/{part_name}" ContentType="{SST_CONTENT_TYPE}"/></Types>'

    def transform(name, content):
        if name == '[Content_Types].xml':
            return name, content.decode().replace('</Types>', override).encode()
        return name, content

    book = _rewrite(standard_workbook(), transform)
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(book)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            dst.writestr(info.filename, src.read(info.filename))
        dst.writestr(part_name, table)
    return out.getvalue()


def _strings_openpyxl_would_load(book: bytes) -> int:
    """How many shared strings openpyxl itself loads from ``book`` (proves the construct is a real exposure)."""
    from openpyxl.reader.excel import ExcelReader

    reader = ExcelReader(io.BytesIO(book), read_only=True, data_only=True)
    reader.read_manifest()
    reader.read_strings()
    return len(reader.shared_strings)


def _with_doctype_in_a_renamed_sheet(extension: str = '.dat') -> bytes:
    """The INGRESOS sheet renamed to ``sheet2<ext>`` and carrying a DTD with an internal entity."""
    renamed = f'xl/worksheets/sheet2{extension}'

    def transform(name, content):
        if name == 'xl/worksheets/sheet2.xml':
            text = content.decode()
            head, _, rest = text.partition('?>')
            doc = f'{head}?>\n<!DOCTYPE worksheet [<!ENTITY nada "nada">]>{rest}'
            return renamed, doc.encode()
        if name in ('[Content_Types].xml', 'xl/_rels/workbook.xml.rels'):
            return name, content.decode().replace('worksheets/sheet2.xml', f'worksheets/sheet2{extension}').encode()
        return name, content

    return _rewrite(standard_workbook(), transform)


# ---------------------------------------------------------------------------
# 🟡-A: el tope de cadenas compartidas y el pre-escaneo de DTD no dependen del NOMBRE del archivo
# ---------------------------------------------------------------------------

class TestParserLimitsDoNotDependOnPartNames:
    def test_control_a_renamed_but_small_string_table_is_a_valid_book(self, client):
        """Control del test: el libro con la tabla de cadenas renombrada se lee bien si es pequeño."""
        book = _with_shared_strings_in('xl/tablaDeCadenas.xml', strings=10)
        assert _strings_openpyxl_would_load(book) == 10
        response = upload(client, book)
        assert response.status_code == 201, response.content

    def test_defect_qa25_a_huge_string_table_in_a_renamed_part_is_refused_like_the_standard_one(self, client):
        """
        DEFECTO QA-25 (🟡-A): el tope de 200 000 cadenas solo se aplica al archivo llamado
        ``sharedStrings.xml``; declarar la tabla en ``xl/tablaDeCadenas.xml`` lo esquiva (la auditoría midió
        +131 MB de RSS con 950 000 cadenas en un hilo de gunicorn).
        """
        book = _with_shared_strings_in('xl/tablaDeCadenas.xml', strings=210_000)
        assert _strings_openpyxl_would_load(book) == 210_000          # the exposure is real: openpyxl loads them all
        before = snapshot_database()
        response = upload(client, book)
        assert response.status_code == 400, (response.status_code, response.content[:160])
        assert response.json()['code'] == 'ARCHIVO_INVALIDO'
        assert snapshot_database() == before and InventoryImport.objects.count() == 0

    def test_the_standard_name_is_refused_too(self, client):
        """La otra mitad de la comparación: con el nombre estándar el mismo contenido SÍ se rechaza."""
        response = upload(client, _with_shared_strings_in('xl/sharedStrings.xml', strings=210_000))
        assert response.status_code == 400 and response.json()['code'] == 'ARCHIVO_INVALIDO'

    @pytest.mark.parametrize('extension', ['.xml', '.dat', '.bin', '.txt'])
    def test_a_dtd_in_a_sheet_renamed_to_another_extension_is_refused(self, client, extension):
        """
        Guardia (🟡-A): el pre-escaneo de ``<!DOCTYPE`` / ``<!ENTITY`` solo mira partes ``.xml``, ``.rels`` y
        ``.vml``; una hoja renombrada llega al parser sin pasar por él. Hoy lo frena lxml 6.1.3 (``ARCHIVO_INVALIDO``);
        esta prueba avisa si una actualización de lxml deja de hacerlo y se mantiene cuando se endurezca el pre-escaneo.
        """
        before = snapshot_database()
        response = upload(client, _with_doctype_in_a_renamed_sheet(extension))
        assert response.status_code == 400, (extension, response.status_code, response.content[:160])
        assert response.json()['code'] == 'ARCHIVO_INVALIDO'
        assert snapshot_database() == before


# ---------------------------------------------------------------------------
# 🟡-B: los lotes no tienen tope de líneas ni de observaciones
# ---------------------------------------------------------------------------

def _line(item, n=1):
    return {'inventory': item.pk, 'quantity': 1, 'notes': f'línea {n}'}


class TestBatchesAreBounded:
    def _bodies(self, item, lines):
        today = timezone.localdate().isoformat()
        return {
            'batch-entry': {'items': lines, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE'},
            'batch-exit': {'items': lines, 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
                           'destination_detail': 'Obra'},
            'epp-delivery': {'warehouse': 'CENTRAL', 'voucher_number': 'V-1', 'movement_date': today,
                             'recipient': {'name': 'Persona Prueba'}, 'items': lines},
        }

    @pytest.mark.parametrize('endpoint', ['batch-entry', 'batch-exit', 'epp-delivery'])
    @pytest.mark.parametrize('count', [201, 3000])
    def test_defect_qa26_too_many_lines_in_one_vale_is_a_400_and_writes_nothing(self, client, make_item, endpoint, count):
        """
        DEFECTO QA-26 (🟡-B): 3 000 líneas en un solo vale → 201 y una transacción larga con bloqueos de
        stock en el único worker (timeout 120 s). Un vale físico no pasa de unas decenas de ítems.
        """
        item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=100_000)
        before = snapshot_database()
        response = client.post(
            f'{MOVEMENTS}{endpoint}/', self._bodies(item, [_line(item, n) for n in range(count)])[endpoint],
            format='json',
        )
        assert response.status_code == 400, (endpoint, count, response.status_code, response.content[:160])
        assert snapshot_database() == before

    @pytest.mark.parametrize('endpoint', ['batch-entry', 'batch-exit', 'epp-delivery'])
    def test_a_normal_vale_of_fifty_lines_is_still_accepted(self, client, make_item, endpoint):
        """Control: el tope no puede romper un vale real (el libro real tiene vales de pocas líneas)."""
        item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=1000)
        response = client.post(
            f'{MOVEMENTS}{endpoint}/', self._bodies(item, [_line(item, n) for n in range(50)])[endpoint],
            format='json',
        )
        assert response.status_code == 201, (endpoint, response.status_code, response.content[:160])

    @pytest.mark.parametrize('endpoint', ['entry', 'exit', 'batch-entry', 'batch-exit', 'epp-delivery'])
    def test_defect_qa26_two_megabytes_of_notes_is_a_400(self, client, make_item, endpoint):
        """DEFECTO QA-26 (🟡-B): ``notes`` no tiene ``max_length``: 2 MB de observaciones → 201."""
        item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=100)
        today = timezone.localdate().isoformat()
        huge = 'x' * 2_000_000
        body = {
            'entry': {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', 'notes': huge},
            'exit': {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
                     'destination_detail': 'Obra', 'notes': huge},
            'batch-entry': {'items': [_line(item)], 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE', 'notes': huge},
            'batch-exit': {'items': [_line(item)], 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
                           'destination_detail': 'Obra', 'notes': huge},
            'epp-delivery': {'warehouse': 'CENTRAL', 'voucher_number': 'V-1', 'movement_date': today,
                             'recipient': {'name': 'Persona Prueba'}, 'items': [_line(item)], 'notes': huge},
        }[endpoint]
        before = snapshot_database()
        response = client.post(f'{MOVEMENTS}{endpoint}/', body, format='json')
        assert response.status_code == 400, (endpoint, response.status_code, response.content[:120])
        assert snapshot_database() == before


# ---------------------------------------------------------------------------
# 🟡-C: la previsualización vencida no debe seguir mostrando nombres de trabajadores
# ---------------------------------------------------------------------------

class TestExpiredPreviewsDoNotKeepNames:
    def _expire(self, import_id):
        InventoryImport.objects.filter(pk=import_id).update(expires_at=timezone.now() - timedelta(hours=1))

    def test_control_a_fresh_preview_shows_the_destinations_to_the_importer(self, client):
        preview = upload(client, standard_workbook()).json()
        assert WORKER_A.split(',')[0].upper() in client.get(f"{IMPORTS}{preview['id']}/").content.decode().upper()

    def test_defect_qa27_an_expired_preview_stops_returning_worker_names(self, client):
        """
        DEFECTO QA-27 (🟡-C): el libro y ``unmatched_destinations`` viven hasta que corre la purga de las
        03:00; una previsualización vencida (24 h) sigue devolviendo nombres a quien importa.
        """
        preview = upload(client, standard_workbook()).json()
        self._expire(preview['id'])
        body = client.get(f"{IMPORTS}{preview['id']}/").content.decode()
        assert WORKER_A.split(',')[0].upper() not in body.upper()
        assert 'Ccori'.upper() not in body.upper()

    def test_defect_qa27_creating_a_new_preview_purges_the_expired_ones(self, client):
        """Purga oportunista: no se depende de que Celery beat esté vivo (en la demo corre en modo eager, sin beat)."""
        old = upload(client, standard_workbook()).json()
        self._expire(old['id'])
        from .import_workbooks import build_workbook, catalog_row
        assert upload(client, build_workbook(catalog=[catalog_row('EPP9', 'OTRO')])).status_code == 201
        stale = InventoryImport.objects.get(pk=old['id'])
        assert not stale.file_bytes, 'the expired workbook (with worker names) is still stored'

    def test_an_expired_preview_cannot_be_confirmed(self, client):
        preview = upload(client, standard_workbook()).json()
        self._expire(preview['id'])
        response = client.post(f"{IMPORTS}{preview['id']}/confirm/", {
            'expected_plan_digest': preview['plan_digest'], 'project_map': {'ON PLANT': None},
            'accept_warnings': True, 'accept_skipped_rows': True}, format='json')
        assert response.status_code == 409 and response.json()['code'] == 'import_expired'
        assert InventoryImport.objects.get().status == 'EXPIRED'


# ---------------------------------------------------------------------------
# 🟢 sueltos: ordering con signos repetidos y fechas absurdas
# ---------------------------------------------------------------------------

class TestSmallFindings:
    @pytest.mark.parametrize('ordering', ['--product_code', '---closing_stock', '-', '--', '+product_code', '-,', ',-x'])
    def test_defect_qa28_weird_ordering_values_fall_back_to_the_code(self, client, make_item, ordering):
        """DEFECTO QA-28 (🟢): ``ordering=--product_code`` → ``lstrip('-')`` lo deja pasar la lista blanca y revienta con FieldError (500)."""
        make_item('EPP000002', 'B', 'EA', stock=1)
        make_item('EPP000001', 'A', 'EA', stock=1)
        response = client.get(INVENTORY + 'movement-summary/', {'no_page': 'true', 'ordering': ordering})
        assert response.status_code == 200, (ordering, response.status_code, response.content[:120])
        assert [r['product_code'] for r in response.json()['results']] == ['EPP000001', 'EPP000002']

    @pytest.mark.parametrize('bad_date', ['0001-01-01', '1999-12-31', '1900-06-15'])
    @pytest.mark.parametrize('endpoint', ['entry', 'exit', 'batch-entry', 'batch-exit', 'epp-delivery'])
    def test_defect_qa29_a_movement_date_before_the_year_2000_is_a_400(self, client, make_item, endpoint, bad_date):
        """
        DEFECTO QA-29 (🟢): ``movement_date`` solo se acota por arriba (no futura). Un 0001-01-01 se guarda
        y desordena el kardex; el importador ya exige 2000-2099.
        """
        item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)
        body = {
            'entry': {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE'},
            'exit': {'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
                     'destination_detail': 'Obra'},
            'batch-entry': {'items': [_line(item)], 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE'},
            'batch-exit': {'items': [_line(item)], 'warehouse': 'CENTRAL', 'destination_type': 'PROJECT',
                           'destination_detail': 'Obra'},
            'epp-delivery': {'warehouse': 'CENTRAL', 'voucher_number': 'V-1', 'recipient': {'name': 'Persona Prueba'},
                             'items': [_line(item)]},
        }[endpoint]
        body['movement_date'] = bad_date
        before = snapshot_database()
        response = client.post(f'{MOVEMENTS}{endpoint}/', body, format='json')
        assert response.status_code == 400, (endpoint, bad_date, response.status_code, response.content[:120])
        assert snapshot_database() == before

    @pytest.mark.parametrize('good_date', ['2000-01-01', '2026-01-15'])
    def test_a_plausible_past_date_is_still_accepted(self, client, make_item, good_date):
        item = make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)
        response = client.post(MOVEMENTS + 'entry/', {
            'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'movement_date': good_date,
        }, format='json')
        assert response.status_code == 201, response.content[:160]
