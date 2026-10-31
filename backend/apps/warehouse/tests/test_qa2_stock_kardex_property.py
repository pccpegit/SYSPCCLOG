"""
SYSPCC-025 · QA ronda 2 — invariantes de stock y kardex bajo secuencias aleatorias.

La ronda 1 fijó los invariantes con escenarios escritos a mano. Aquí se mezclan TODAS las vías de
escritura (ingreso, egreso, lotes con líneas repetidas, entrega de EPP, ajustes, transferencias
internas e importación del libro) en secuencias reproducibles (semilla fija) y, después de cada
operación y al final, se comprueba:

* el stock no es negativo en ninguna fila (una operación rechazada no deja rastro);
* kardex por ítem = resumen de movimiento = suma de ``InventoryStock`` = suma firmada de los
  movimientos calculada aquí, sin usar el código de producción (inventario, almacén por almacén);
* el export del resumen suma lo mismo.

Un fallo imprime la semilla y la operación, así que se reproduce con ese solo parámetro.
"""
import io
import random
from datetime import timedelta
from decimal import Decimal
from itertools import count
from unittest import mock

import openpyxl
import pytest
from django.utils import timezone

from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock
from apps.warehouse.services import movements as svc

from .import_workbooks import D1, build_workbook, catalog_row, entry_row, exit_row
from .qa_support import INVENTORY, MOVEMENTS, confirm, snapshot_database, tolerant_client, upload

pytestmark = pytest.mark.django_db

SUMMARY = INVENTORY + 'movement-summary/'
SEEDS = list(range(10))
OPERATIONS_PER_SEED = 70
WAREHOUSES = ['CENTRAL', 'SITE', 'OFFICE']
_vouchers = count(1)


@pytest.fixture(autouse=True)
def _no_pdf_task(monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    # ~700 requests in a few seconds from one user: the per-minute limit is not what is tested here
    monkeypatch.setattr(
        SimpleRateThrottle, 'THROTTLE_RATES',
        {**SimpleRateThrottle.THROTTLE_RATES, 'user': '1000000/min', 'warehouse_import': '1000000/hour'},
    )
    with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
        yield


@pytest.fixture
def items(make_item):
    return [
        make_item('EPP000001', 'GUANTE T: L', 'EA'),
        make_item('EPP000002', 'CASCO', 'EA'),
        make_item('LYPCC0001', 'LIQUIDO', 'LT', category='Otros', item_type='MATERIAL'),
        make_item('TMT0001', 'TELA', 'M2', category='Otros', item_type='MATERIAL'),
    ]


def _qty(rng, item):
    if item.unit in ('LT', 'M2'):
        return rng.choice(['0.25', '0.5', '1', '1.75', '3', '12.5', '40'])
    return rng.choice(['1', '1', '2', '3', '5', '8', '13', '0.5', '2.5'])     # 0.5 / 2.5 must be refused for EA


def _when(rng):
    # None => today (Lima); otherwise a day in the last two weeks (never future)
    return rng.choice([None, None, (timezone.localdate() - timedelta(days=rng.randint(0, 14))).isoformat()])


def _op_entry(rng, client, items, person_name):
    item = rng.choice(items)
    body = {'inventory': item.pk, 'quantity': _qty(rng, item), 'warehouse': rng.choice(WAREHOUSES),
            'source_type': rng.choice(['PURCHASE', 'RETURN', 'TRANSFER_IN'])}
    when = _when(rng)
    if when:
        body['movement_date'] = when
    return 'entry', client.post(MOVEMENTS + 'entry/', body, format='json')


def _op_exit(rng, client, items, person_name):
    item = rng.choice(items)
    body = {'inventory': item.pk, 'quantity': _qty(rng, item), 'warehouse': rng.choice(WAREHOUSES),
            'destination_type': rng.choice(['EMPLOYEE', 'PROJECT', 'DEPARTMENT']), 'destination_detail': person_name}
    when = _when(rng)
    if when:
        body['movement_date'] = when
    return 'exit', client.post(MOVEMENTS + 'exit/', body, format='json')


def _lines(rng, items):
    # the same item may repeat: the stock check must add the lines up
    return [{'inventory': (it := rng.choice(items)).pk, 'quantity': _qty(rng, it)} for _ in range(rng.randint(1, 3))]


def _op_batch_entry(rng, client, items, person_name):
    return 'batch-entry', client.post(MOVEMENTS + 'batch-entry/', {
        'items': _lines(rng, items), 'warehouse': rng.choice(WAREHOUSES), 'source_type': 'PURCHASE',
    }, format='json')


def _op_batch_exit(rng, client, items, person_name):
    return 'batch-exit', client.post(MOVEMENTS + 'batch-exit/', {
        'items': _lines(rng, items), 'warehouse': rng.choice(WAREHOUSES), 'destination_type': 'EMPLOYEE',
        'destination_detail': person_name,
    }, format='json')


def _op_epp(rng, client, items, person_name):
    return 'epp-delivery', client.post(MOVEMENTS + 'epp-delivery/', {
        'warehouse': rng.choice(WAREHOUSES), 'voucher_number': f'QA-{next(_vouchers)}',
        'movement_date': timezone.localdate().isoformat(), 'recipient': {'name': person_name},
        'items': _lines(rng, items),
    }, format='json')


def _op_transfer(rng, client, items, person_name):
    item = rng.choice(items)
    return 'transfer-out', client.post(MOVEMENTS + 'exit/', {
        'inventory': item.pk, 'quantity': _qty(rng, item), 'warehouse': 'CENTRAL',
        'destination_type': 'TRANSFER_OUT', 'destination_detail': 'ALM - PRIMER PISO',
        'internal_transfer': '2do piso -> 1er piso',
    }, format='json')


OPERATIONS = [_op_entry, _op_entry, _op_exit, _op_exit, _op_exit, _op_batch_entry, _op_batch_exit,
              _op_batch_exit, _op_epp, _op_epp, _op_transfer]


def _adjust(rng, items, user):
    """Adjustments go through the service (there is no endpoint): + or - some units."""
    item = rng.choice(items)
    delta = Decimal(rng.choice(['1', '-1', '2', '-3', '0.5', '-0.5'] if item.unit != 'EA' else ['1', '-1', '2', '-3']))
    try:
        svc.register_adjustment(item, delta, rng.choice(WAREHOUSES), None, 'conteo', user,
                                movement_date=timezone.localdate())
    except ValueError:
        return 'adjust-refused', 400
    return 'adjust', 201


_imports = count(1)


def _import_book(rng, client, user):
    """A small workbook of its own items, with undated rows, applied through the real API."""
    n = next(_imports)
    code = f'EPP9{n:05d}'
    exits = [exit_row(code, rng.randint(1, 4), f'Persona Importada {n}', voucher=f'IMP-{n}', when=D1)]
    data = build_workbook(
        catalog=[catalog_row(code, f'ITEM IMPORTADO {n}')],
        entries=[entry_row(code, rng.randint(5, 9), D1), entry_row(code, 2, None)],
        exits=exits,
    )
    first = upload(client, data)
    if first.status_code != 201:
        return 'import-upload', first.status_code
    done = confirm(client, first.json(), project_map={})
    return 'import', done.status_code


def _all_stock_is_non_negative():
    negative = list(InventoryStock.objects.filter(quantity__lt=0).values_list('inventory__product_code', 'quantity'))
    assert not negative, negative


def _signed_sum(inventory, warehouse):
    """Sum of the movements written independently of the production kardex helper."""
    total = Decimal('0')
    for m in InventoryMovement.objects.filter(inventory=inventory, warehouse=warehouse):
        if m.movement_type == 'ENTRY':
            total += m.quantity
        elif m.movement_type == 'EXIT':
            total -= m.quantity
        elif m.movement_type == 'ADJUSTMENT':
            total += m.quantity if m.source_type == 'ADJUSTMENT' else -m.quantity
    return total


def _stock(inventory, warehouse):
    return sum(
        (s.quantity for s in InventoryStock.objects.filter(inventory=inventory, warehouse_type=warehouse)),
        Decimal('0'),
    )


@pytest.mark.parametrize('seed', SEEDS)
def test_random_operations_never_break_stock_or_kardex(seed, central_warehouse, items):
    rng = random.Random(seed)
    client = tolerant_client(central_warehouse)
    person_name = 'Persona Aleatoria Prueba'
    accepted = refused = 0

    # a starting stock so exits have something to take (through the real service, like production)
    for item in items:
        for warehouse in WAREHOUSES:
            svc.register_entry_batch(
                items_data=[{'inventory_id': item.pk, 'quantity': 20}], warehouse=warehouse, project_id=None,
                source_type='PURCHASE', supplier_name='', invoice_number='', notes='',
                registered_by=central_warehouse, movement_date=timezone.localdate() - timedelta(days=30),
            )

    for step in range(OPERATIONS_PER_SEED):
        before = snapshot_database()
        if rng.random() < 0.08:
            name, status = _import_book(rng, client, central_warehouse)
        elif rng.random() < 0.12:
            name, status = _adjust(rng, items, central_warehouse)
        else:
            name, response = rng.choice(OPERATIONS)(rng, client, items, person_name)
            status = response.status_code
        context = f'seed={seed} step={step} op={name} status={status}'
        assert status < 500, context
        _all_stock_is_non_negative()
        if status >= 400:
            refused += 1
            assert snapshot_database() == before, f'a refused operation left a trace: {context}'
        else:
            accepted += 1

    assert accepted > 20 and refused > 3, f'the sequence must exercise both outcomes (ok={accepted}, no={refused})'

    # -- final reconciliation -------------------------------------------------------------------
    all_items = list(Inventory.objects.all())
    for item in all_items:
        for warehouse in WAREHOUSES:
            assert _signed_sum(item, warehouse) == _stock(item, warehouse), (
                f'seed={seed} {item.product_code}/{warehouse}: movements do not add up to the stock'
            )

    summary = client.get(SUMMARY, {'no_page': 'true'})
    assert summary.status_code == 200, summary.content
    rows = {r['product_code']: r for r in summary.json()['results']}
    for item in all_items:
        total = sum((_stock(item, w) for w in WAREHOUSES), Decimal('0'))
        row = rows[item.product_code]
        assert row['closing_stock'] == row['current_stock'] == float(total), f'seed={seed} {item.product_code}'
        assert row['initial_stock'] + row['entries'] - row['exits'] == pytest.approx(row['closing_stock'])

        card = client.get(f'{INVENTORY}{item.pk}/kardex/')
        assert card.status_code == 200, card.content
        card = card.json()
        assert card['closing_stock'] == float(total), f'seed={seed} kardex of {item.product_code}'
        if card['movements']:
            assert card['movements'][-1]['balance_after'] == pytest.approx(float(total))
        assert card['opening_stock'] + sum(m['delta'] for m in card['movements']) == pytest.approx(float(total))

    assert summary.json()['meta']['totals']['closing'] == pytest.approx(
        float(sum((_stock(i, w) for i in all_items for w in WAREHOUSES), Decimal('0'))),
    )


@pytest.mark.parametrize('seed', [0, 1, 2])
def test_the_exported_workbook_closes_with_the_same_stock_as_the_database(seed, central_warehouse, items):
    """The Excel the warehouse prints (STOCK ACTUAL column) is the same number the screens show."""
    rng = random.Random(100 + seed)
    client = tolerant_client(central_warehouse)
    for item in items:
        svc.register_entry_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 30}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name='', invoice_number='', notes='', registered_by=central_warehouse,
            movement_date=timezone.localdate() - timedelta(days=20),
        )
    for _ in range(40):
        rng.choice(OPERATIONS)(rng, client, items, 'Persona Aleatoria Prueba')

    response = client.get(SUMMARY + 'export/', {'include_movements': 'true'})
    assert response.status_code == 200
    book = openpyxl.load_workbook(io.BytesIO(response.content))
    sheet = book['RESUMEN DE MOVIMIENTO']
    header = [str(c.value or '').strip().upper() for c in sheet[1]]
    code_col, stock_col = header.index('ITEM'), header.index('STOCK ACTUAL')
    exported = {row[code_col]: row[stock_col] for row in sheet.iter_rows(min_row=2, values_only=True) if row[code_col]}
    for item in items:
        total = sum((_stock(item, w) for w in WAREHOUSES), Decimal('0'))
        assert float(exported[item.product_code]) == pytest.approx(float(total)), item.product_code
