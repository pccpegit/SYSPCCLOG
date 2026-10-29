"""
SYSPCC-025 · QA ronda 2 — entradas hostiles que nunca deben terminar en 500, y defectos nuevos.

* Los tests "DEFECTO QA-n" describen el comportamiento CORRECTO de algo que hoy está roto: fallan a
  propósito (sin ``xfail``) y pasan solos cuando se corrige la producción. La numeración continúa la
  de la ronda 1 (QA-1 a QA-13).
* ``TestNoServerErrors`` es un barrido sistemático: cada campo de cada endpoint de escritura recibe
  una lista de valores basura y cada parámetro de consulta de cada lectura también. La regla es una
  sola: una respuesta 5xx (o un 429 por el propio barrido) es un fallo.
"""
import copy
import io
from datetime import timedelta
from unittest import mock

import openpyxl
import pytest
from django.utils import timezone
from pypdf import PdfReader

from apps.warehouse.models import InventoryImport, InventoryImportStatus, InventoryMovement

from .import_workbooks import (
    D1, D2, build_workbook, catalog_row, entry_row, exit_row, standard_workbook, summary_row,
)
from .qa_support import IMPORTS, INVENTORY, MOVEMENTS, snapshot_database, tolerant_client, upload

pytestmark = pytest.mark.django_db

BASE = '/api/v1/warehouse/'
HUGE = 10 ** 30                   # no cabe ni en un BIGINT
BIGINT_PLUS_ONE = 2 ** 63


@pytest.fixture(autouse=True)
def _quiet_side_effects(monkeypatch):
    """No PDF upload task, and no per-minute limit: a sweep sends hundreds of requests."""
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setattr(
        SimpleRateThrottle, 'THROTTLE_RATES',
        {**SimpleRateThrottle.THROTTLE_RATES, 'user': '1000000/min', 'warehouse_lookup': '1000000/min',
         'warehouse_import': '1000000/hour'},
    )
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def client(central_warehouse):
    return tolerant_client(central_warehouse)


def _error_text(response):
    return response.content[:160]


def _unique_book(n):
    """A small coherent workbook that differs per ``n`` (so every one can be uploaded and confirmed)."""
    code = f'EPPQ{n:04d}'
    return build_workbook(
        catalog=[catalog_row(code, 'ITEM Q')],
        entries=[entry_row(code, 5, D1)],
        exits=[exit_row(code, 1, 'Persona Prueba', voucher=n, when=D2)],
        summary=[summary_row(code, 'ITEM Q', entries=5, exits=1, stock=4)],
    )


# ---------------------------------------------------------------------------
# Defectos concretos
# ---------------------------------------------------------------------------

class TestIdsBeyondTheDatabaseRangeAreRejectedNotCrashed:
    """
    Un id que no cabe en un entero de 64 bits (o el valor ``1e30`` que alguien teclea en un JSON)
    llega al ORM como parámetro y revienta en el driver. Otros endpoints del módulo ya lo cubren
    (``_parse_int_param``, ``ExistingIdField``); estos tres no.
    """

    def _preview(self, client):
        response = upload(client, standard_workbook())
        assert response.status_code == 201, response.content
        return response.json()

    def _confirm(self, client, preview, **overrides):
        body = {'expected_plan_digest': preview['plan_digest'], 'project_map': {'ON PLANT': None},
                'accept_warnings': True, 'accept_skipped_rows': True}
        body.update(overrides)
        return client.post(f"{IMPORTS}{preview['id']}/confirm/", body, format='json')

    @pytest.mark.parametrize('value', [HUGE, BIGINT_PLUS_ONE, -HUGE])
    def test_defect_qa14_confirm_with_an_absurd_project_id_is_a_400(self, client, value):
        """DEFECTO QA-14: ``project_map: {"ON PLANT": 10**30}`` => OverflowError => 500 (la importación queda sin confirmar)."""
        preview = self._preview(client)
        before = snapshot_database()
        response = self._confirm(client, preview, project_map={'ON PLANT': value})
        assert response.status_code == 400, (response.status_code, _error_text(response))
        assert snapshot_database() == before
        assert InventoryImport.objects.get().status == InventoryImportStatus.PREVIEWED

    @pytest.mark.parametrize('value', [HUGE, BIGINT_PLUS_ONE])
    def test_defect_qa14_confirm_with_an_absurd_worker_id_is_a_400(self, client, value):
        """DEFECTO QA-14: ``destination_map: {key: 10**30}`` => 500 en ``Personal.objects.filter(pk__in=...)``."""
        preview = self._preview(client)
        key = preview['unmatched_destinations'][0]['key']
        before = snapshot_database()
        response = self._confirm(client, preview, destination_map={key: value})
        assert response.status_code == 400, (response.status_code, _error_text(response))
        assert snapshot_database() == before
        assert InventoryImport.objects.get().status == InventoryImportStatus.PREVIEWED

    @pytest.mark.parametrize('value', [HUGE, BIGINT_PLUS_ONE, -HUGE])
    def test_defect_qa15_assign_locations_with_an_absurd_item_id_is_a_400(self, client, epp_item, value):
        """DEFECTO QA-15: ``assignments[].inventory`` es un IntegerField sin cota => 500 en el ``select_for_update``."""
        before = snapshot_database()
        response = client.post(BASE + 'inventory/assign-locations/', {
            'assignments': [{'inventory': epp_item.pk, 'location': 'F3-2'}, {'inventory': value, 'location': 'A1-1'}],
        }, format='json')
        assert response.status_code == 400, (response.status_code, _error_text(response))
        assert snapshot_database() == before                       # todo o nada: ni el ítem válido cambió
        epp_item.refresh_from_db()
        assert epp_item.location == ''

    @pytest.mark.parametrize('project_id', ['abc', '1.5', '-1', '', str(HUGE), '\x00', '😀'])
    def test_defect_qa16_check_stock_with_a_junk_project_is_not_a_crash(self, client, epp_item, project_id):
        """DEFECTO QA-16 (preexistente): ``check-stock/?project_id=abc`` filtra ``project_id='abc'`` => ValueError => 500."""
        response = client.get(BASE + 'inventory/check-stock/', {'descriptions': 'guante', 'project_id': project_id})
        assert response.status_code in (200, 400), (response.status_code, _error_text(response))
        if response.status_code == 200:
            assert response.json()[0]['matched_product'] == epp_item.product_code


class TestConfirmDigestIsComparedSafely:
    @pytest.mark.parametrize('digest', ['😀', 'ñandú', 'é' * 64, '\u0000', 'abc‮def'])
    def test_defect_qa17_a_non_ascii_digest_is_a_conflict_not_a_crash(self, client, digest):
        """
        DEFECTO QA-17: ``hmac.compare_digest`` lanza ``TypeError`` con un ``str`` no ASCII, y el
        serializador solo limita el largo. Un digest ajeno debe ser 409 ``plan_changed`` (o 400).
        """
        preview = upload(client, standard_workbook()).json()
        before = snapshot_database()
        response = client.post(f"{IMPORTS}{preview['id']}/confirm/", {
            'expected_plan_digest': digest, 'project_map': {'ON PLANT': None},
            'accept_warnings': True, 'accept_skipped_rows': True,
        }, format='json')
        assert response.status_code in (400, 409), (response.status_code, _error_text(response))
        assert snapshot_database() == before
        assert InventoryImport.objects.get().status == InventoryImportStatus.PREVIEWED


class TestOperationalDateIsWhatTheExportsShow:
    """
    SYSPCC-025 cambió la fecha de un movimiento a ``movement_date`` (la del vale físico, que puede ser
    anterior al registro). El Excel "normal" de movimientos y el PDF de un movimiento suelto siguen
    imprimiendo ``created_at`` (la hora de registro, en UTC).
    """

    @pytest.fixture
    def backdated(self, client, epp_item):
        past = timezone.localdate() - timedelta(days=20)
        response = client.post(MOVEMENTS + 'entry/', {
            'inventory': epp_item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'movement_date': past.isoformat(),
        }, format='json')
        assert response.status_code == 201, response.content
        movement = InventoryMovement.objects.get()
        assert movement.movement_date == past and movement.created_at.date() != past
        return movement

    def test_defect_qa18_the_plain_movements_export_shows_the_operational_date(self, client, backdated):
        """DEFECTO QA-18: la columna Fecha de ``movements/export/`` sale de ``created_at`` (p. ej. 29/10 00:14 UTC)."""
        response = client.get(MOVEMENTS + 'export/')
        assert response.status_code == 200
        sheet = openpyxl.load_workbook(io.BytesIO(response.content)).active
        header = [c.value for c in sheet[1]]
        row = [c.value for c in sheet[2]]
        shown = str(row[header.index('Fecha')])
        assert backdated.movement_date.strftime('%d/%m/%Y') in shown, shown

    def test_defect_qa19_the_pdf_of_a_single_movement_shows_the_operational_date(self, client, backdated):
        """DEFECTO QA-19: ``movements/{id}/pdf/`` imprime ``created_at``; el PDF del vale de grupo sí usa ``movement_date``."""
        response = client.get(f'{MOVEMENTS}{backdated.pk}/pdf/')
        assert response.status_code == 200
        text = ' '.join(' '.join(page.extract_text() or '' for page in PdfReader(io.BytesIO(response.content)).pages).split())
        assert backdated.movement_date.strftime('%d/%m/%Y') in text

    def test_the_excel_pcc_layout_does_show_the_operational_date(self, client, backdated):
        """Control: el formato de su libro (INGRESOS/EGRESOS) ya usa la fecha operativa."""
        response = client.get(MOVEMENTS + 'export/', {'layout': 'excel_pcc'})
        assert response.status_code == 200
        book = openpyxl.load_workbook(io.BytesIO(response.content))
        sheet = book['INGRESOS']
        header = [str(c.value or '').strip().upper() for c in sheet[1]]
        value = sheet[2][header.index('FECHA')].value
        assert getattr(value, 'date', lambda: value)() == backdated.movement_date


class TestStockCannotOutgrowItsColumn:
    """
    ``InventoryStock.quantity`` es ``DECIMAL(12, 3)``: el máximo es 999 999 999,999. Cada fila de un
    movimiento se valida contra ese tope, pero la SUMA de ingresos no: pasarse deja la fila de stock
    ilegible (``decimal.InvalidOperation`` al leerla en SQLite) o revienta el COMMIT (``numeric field
    overflow`` en PostgreSQL). En ambos casos hoy se responde 201 o 500 en lugar de un 400 claro.
    """

    @pytest.fixture
    def nearly_full(self, make_item):
        return make_item('LYP000001', 'LÍQUIDO', 'LT', stock='999999999')

    def test_defect_qa22_an_entry_that_overflows_the_stock_column_is_a_400_and_changes_nothing(
        self, client, nearly_full,
    ):
        """DEFECTO QA-22: ``entry/`` con 5 LT sobre 999 999 999 LT responde 201 y deja el stock en 1 000 000 004."""
        before = snapshot_database()
        response = client.post(MOVEMENTS + 'entry/', {
            'inventory': nearly_full.pk, 'quantity': '5', 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
        }, format='json')
        assert response.status_code == 400, (response.status_code, _error_text(response))
        assert snapshot_database() == before
        assert client.get(INVENTORY).status_code == 200               # the catalog is still readable

    def test_defect_qa22_a_batch_entry_that_overflows_the_stock_column_is_a_400(self, client, nearly_full):
        before = snapshot_database()
        response = client.post(MOVEMENTS + 'batch-entry/', {
            'items': [{'inventory': nearly_full.pk, 'quantity': '3'}, {'inventory': nearly_full.pk, 'quantity': '4'}],
            'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
        }, format='json')
        assert response.status_code == 400, (response.status_code, _error_text(response))
        assert snapshot_database() == before

    def test_defect_qa22_an_import_whose_rows_add_up_past_the_column_is_refused(self, client):
        """Dos filas válidas de 999 999 999 LT: el plan no avisa y la confirmación escribe un stock inexpresable."""
        book = build_workbook(
            catalog=[catalog_row('LYP000002', 'LÍQUIDO', unit='LT')],
            entries=[entry_row('LYP000002', '999999999', D1), entry_row('LYP000002', '999999999', D1, po='OTRA')],
        )
        preview = upload(client, book)
        assert preview.status_code == 201, preview.content
        before = snapshot_database()
        response = client.post(f"{IMPORTS}{preview.json()['id']}/confirm/", {
            'expected_plan_digest': preview.json()['plan_digest'], 'project_map': {},
            'accept_warnings': True, 'accept_skipped_rows': True,
        }, format='json')
        assert response.status_code in (400, 409), (response.status_code, _error_text(response))
        assert snapshot_database() == before
        assert client.get(INVENTORY).status_code == 200


# ---------------------------------------------------------------------------
# Barrido: ningún valor basura produce un 5xx
# ---------------------------------------------------------------------------

JUNK = [
    None, '', ' ', 'abc', -1, 0, HUGE, -HUGE, BIGINT_PLUS_ONE, 1.5, [], {}, True, 'x' * 600, '\x00', '😀', 'NaN',
    'Infinity', '1e999', '2026-02-30', '9999-12-31', '0001-01-01', [1], {'a': 1}, "'; DROP TABLE x;--",
]


def _paths(body):
    paths = [(key,) for key in body]
    for key, value in body.items():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            paths += [(key, 0, inner) for inner in value[0]]
        if isinstance(value, dict):
            paths += [(key, inner) for inner in value]
    return paths


def _sweep(client, method, url, body):
    """Replace every field (and the first line item) by every junk value; return the offending requests."""
    offenders = []
    for path in _paths(body):
        for junk in JUNK:
            data = copy.deepcopy(body)
            node = data
            for step in path[:-1]:
                node = node[step]
            node[path[-1]] = junk
            response = getattr(client, method)(url, data, format='json')
            if response.status_code >= 500 or response.status_code == 429:
                offenders.append((path, repr(junk)[:24], response.status_code))
    return offenders


def _write_bodies(item, person, project):
    today = timezone.localdate().isoformat()
    return {
        'entry': ('post', MOVEMENTS + 'entry/', {
            'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'source_type': 'PURCHASE',
            'supplier_name': 's', 'invoice_number': 'F1', 'notes': 'n', 'movement_date': today, 'po_number': 'P',
            'guide_number': 'G', 'internal_transfer': 'x', 'project': project.pk}),
        'exit': ('post', MOVEMENTS + 'exit/', {
            'inventory': item.pk, 'quantity': 1, 'warehouse': 'CENTRAL', 'destination_type': 'EMPLOYEE',
            'destination_detail': 'Persona Prueba', 'notes': 'n', 'movement_date': today, 'voucher_number': 'V1',
            'destination_personal': person.pk, 'project': project.pk}),
        'batch-entry': ('post', MOVEMENTS + 'batch-entry/', {
            'items': [{'inventory': item.pk, 'quantity': 1, 'notes': 'n', 'tag': 't'}], 'warehouse': 'CENTRAL',
            'source_type': 'PURCHASE', 'movement_date': today, 'po_number': 'P', 'guide_number': 'G',
            'supplier_name': 's', 'invoice_number': 'F'}),
        'batch-exit': ('post', MOVEMENTS + 'batch-exit/', {
            'items': [{'inventory': item.pk, 'quantity': 1, 'notes': 'n'}], 'warehouse': 'CENTRAL',
            'destination_type': 'EMPLOYEE', 'destination_detail': 'Persona Prueba', 'movement_date': today,
            'voucher_number': 'V2', 'destination_personal': person.pk}),
        'epp-delivery': ('post', MOVEMENTS + 'epp-delivery/', {
            'warehouse': 'CENTRAL', 'voucher_number': 'V3', 'movement_date': today,
            'recipient': {'personal': person.pk, 'name': '', 'internal': ''},
            'items': [{'inventory': item.pk, 'quantity': 1, 'notes': 'n'}], 'internal_transfer': 'x', 'notes': 'n',
            'project': project.pk, 'allow_duplicate_voucher': True}),
        'link-personal': ('post', MOVEMENTS + 'link-personal/', {
            'destination_key': 'persona prueba', 'personal': person.pk}),
        'assign-locations': ('post', BASE + 'inventory/assign-locations/', {
            'assignments': [{'inventory': item.pk, 'location': 'A1-1'}]}),
        'inventory-create': ('post', INVENTORY, {
            'product_code': 'NEW1', 'description': 'd', 'unit': 'EA', 'category': 'c', 'item_type': 'EPP',
            'brand': 'b', 'model_name': 'm', 'location': 'A1-1', 'min_stock': 1, 'order_number': 'o',
            'purchase_order_ref': 'p', 'packing_list': 'pl', 'size': 'L', 'floor': 2, 'observation': 'o',
            'project': project.pk}),
        'inventory-patch': ('patch', f'{INVENTORY}{item.pk}/', {
            'description': 'd2', 'unit': 'EA', 'location': 'A1-1', 'min_stock': 1, 'floor': 2, 'size': 'L',
            'project': project.pk}),
    }


class TestNoServerErrors:
    @pytest.mark.parametrize('endpoint', [
        'entry', 'exit', 'batch-entry', 'batch-exit', 'epp-delivery', 'link-personal', 'assign-locations',
        'inventory-create', 'inventory-patch',
    ])
    def test_write_endpoints_survive_junk_in_every_field(self, client, epp_item, make_personal, project, endpoint):
        method, url, body = _write_bodies(epp_item, make_personal(), project)[endpoint]
        offenders = _sweep(client, method, url, body)
        assert not offenders, offenders

    @pytest.mark.parametrize('field', ['expected_plan_digest', 'project_map', 'destination_map',
                                       'accept_warnings', 'accept_skipped_rows'])
    def test_confirm_survives_junk_in_every_field(self, client, field):
        """Un libro y una vista previa NUEVOS por valor basura: tras una confirmación válida el reenvío ya no valida nada."""
        offenders = []
        for n, junk in enumerate(JUNK, start=1):
            preview = upload(client, _unique_book(n))
            assert preview.status_code == 201, preview.content
            preview = preview.json()
            body = {'expected_plan_digest': preview['plan_digest'], 'project_map': {'ON PLANT': None},
                    'destination_map': {}, 'accept_warnings': True, 'accept_skipped_rows': True}
            body[field] = junk
            response = client.post(f"{IMPORTS}{preview['id']}/confirm/", body, format='json')
            if response.status_code >= 500 or response.status_code == 429:
                offenders.append((field, repr(junk)[:24], response.status_code))
        assert not offenders, offenders

    @pytest.mark.parametrize('endpoint,params', [
        ('inventory/', ['search', 'category', 'item_type', 'location', 'floor', 'project', 'low_stock', 'has_stock',
                        'ordering', 'page', 'page_size', 'no_page', 'size', 'location_status', 'pending_location']),
        ('inventory/movement-summary/', ['search', 'category', 'floor', 'project', 'date_from', 'date_to',
                                         'warehouse', 'ordering', 'page', 'page_size', 'only_with_movement',
                                         'only_zero_stock', 'no_page']),
        ('inventory/movement-summary/export/', ['date_from', 'date_to', 'include_movements', 'warehouse', 'project',
                                                'category', 'floor', 'search']),
        ('inventory/{item}/kardex/', ['date_from', 'date_to', 'warehouse', 'movement_type', 'page']),
        ('inventory/check-stock/', ['descriptions']),
        ('movements/', ['search', 'movement_type', 'warehouse', 'project', 'inventory', 'date_from', 'date_to',
                        'supplier', 'qty_min', 'qty_max', 'voucher_number', 'no_voucher', 'destination_personal',
                        'destination', 'has_date', 'unlinked_destination', 'import_batch', 'ordering', 'page',
                        'page_size']),
        ('movements/export/', ['search', 'movement_type', 'warehouse', 'project', 'inventory', 'date_from',
                               'date_to', 'qty_min', 'qty_max', 'layout', 'voucher_number', 'destination_personal',
                               'import_batch', 'destination', 'supplier']),
        ('personal-lookup/', ['search']),
        ('imports/', ['status', 'page', 'page_size']),
    ])
    def test_read_endpoints_survive_junk_in_every_query_parameter(self, client, epp_item, endpoint, params):
        url = BASE + endpoint.replace('{item}', str(epp_item.pk))
        values = ['', ' ', 'abc', '-1', '0', str(HUGE), str(BIGINT_PLUS_ONE), '1.5', 'NaN', '\x00', '😀', 'x' * 400,
                  '2026-02-30', '9999-12-31', 'true', 'null', '[]', '%', '_', "'", 'A1-1']
        offenders = []
        for name in params:
            for value in values:
                response = client.get(url, {name: value})
                if response.status_code >= 500 or response.status_code == 429:
                    offenders.append((name, value[:20], response.status_code))
        assert not offenders, offenders

    @pytest.mark.parametrize('sub', ['', 'problems/', 'problems/export/'])
    def test_import_detail_endpoints_survive_junk_in_every_query_parameter(self, client, sub):
        preview = upload(client, standard_workbook()).json()
        offenders = []
        for name in ('severity', 'sheet', 'code', 'page', 'page_size', 'q'):
            for value in ['', 'abc', '-1', '0', str(HUGE), '\x00', '😀', 'x' * 400, 'blocker,error', ',,,']:
                response = client.get(f"{IMPORTS}{preview['id']}/{sub}", {name: value})
                if response.status_code >= 500 or response.status_code == 429:
                    offenders.append((name, value[:20], response.status_code))
        assert not offenders, offenders

    @pytest.mark.parametrize('field', ['warehouse', 'update_existing'])
    def test_upload_survives_junk_in_the_form_fields(self, client, field):
        offenders = []
        for value in ['', 'abc', 'CENTRAL ', 'central', '\x00', 'x' * 500, 'maybe', '2', '😀']:
            response = upload(client, standard_workbook(), **{field: value})
            if response.status_code >= 500 or response.status_code == 429:
                offenders.append((field, value[:20], response.status_code))
        assert not offenders, offenders
