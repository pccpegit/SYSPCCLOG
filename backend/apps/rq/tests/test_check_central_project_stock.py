"""
SYSPCC-026 · Fase 0 — `check_central_project_stock` (diagnóstico de SOLO LECTURA).

Cubre: qué filas reporta y cuáles no, conteos, JSON, `--fail-on-findings`, `--limit`
y, sobre todo, que el comando nunca escribe (solo SELECT).
"""
import json
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.warehouse.models import Inventory, InventoryStock

pytestmark = pytest.mark.django_db


def _inventory(code, unit='UND', description=None):
    return Inventory.objects.create(
        product_code=code, description=description or f'Producto {code}', unit=unit,
    )


def _stock(inventory, qty, warehouse='CENTRAL', project=None, department=None):
    return InventoryStock.objects.create(
        inventory=inventory, warehouse_type=warehouse, project=project,
        department=department, quantity=Decimal(str(qty)),
    )


def _run(*args):
    out = StringIO()
    call_command('check_central_project_stock', *args, stdout=out)
    return out.getvalue()


def _snapshot_counts():
    return (Inventory.objects.count(), InventoryStock.objects.count(),
            sorted(InventoryStock.objects.values_list('pk', 'quantity')))


class TestWhichRowsAreReported:
    def test_empty_database_reports_ok(self):
        output = _run()
        assert 'SOLO LECTURA' in output
        assert 'OK: no hay filas CENTRAL atadas a proyecto ni departamento' in output

    def test_pool_rows_are_not_reported(self):
        _stock(_inventory('CEM-001'), 50)  # CENTRAL, project=None, department=None
        assert 'OK:' in _run()

    def test_central_row_with_project_is_reported_with_pool_quantity(self, project):
        inv = _inventory('CEM-001', description='Cemento Portland')
        _stock(inv, 40)                      # pool
        _stock(inv, 7, project=project)      # fila atada al proyecto
        output = _run()
        assert 'Filas CENTRAL atadas a proyecto/departamento: 1' in output
        assert 'CEM-001' in output
        assert f'PROY {project.code}' in output
        assert '40' in output  # cantidad del pool, para decidir el traspaso

    def test_central_row_with_department_is_reported(self, department):
        _stock(_inventory('PAP-001'), 3, department=department)
        output = _run()
        assert 'Filas CENTRAL atadas a proyecto/departamento: 1' in output
        assert f'DEPTO {department.code}' in output

    def test_non_central_warehouses_are_not_reported(self, project, department):
        inv = _inventory('CEM-001')
        _stock(inv, 5, warehouse='SITE', project=project)
        _stock(inv, 5, warehouse='OFFICE', department=department)
        assert 'OK:' in _run()

    def test_zero_and_positive_rows_are_counted_apart(self, project, other_project):
        inv_a, inv_b = _inventory('A-1'), _inventory('B-1')
        _stock(inv_a, 0, project=project)        # fila agotada o vacía
        _stock(inv_b, 12, project=project)
        _stock(inv_b, 4, project=other_project)
        data = json.loads(_run('--json'))['summary']
        assert data['total_rows'] == 3
        assert data['zero_rows'] == 1
        assert data['positive_rows'] == 2
        assert data['distinct_products'] == 2
        assert data['distinct_projects'] == 2

    def test_units_are_not_summed_across_different_measures(self, project):
        _stock(_inventory('K-1', unit='KG'), '2.500', project=project)
        _stock(_inventory('K-2', unit='KG'), '1.500', project=project)
        _stock(_inventory('U-1', unit='UND'), 10, project=project)
        units = json.loads(_run('--json'))['summary']['positive_units_by_unit']
        assert units == {'KG': '4.000', 'UND': '10.000'}


class TestOutputOptions:
    def test_json_is_the_only_output_and_serializes_decimals(self, project):
        _stock(_inventory('CEM-001'), '7.250', project=project)
        raw = _run('--json')
        payload = json.loads(raw)  # falla si hay texto extra fuera del JSON
        row = payload['rows'][0]
        assert row['product_code'] == 'CEM-001'
        assert row['quantity'] == '7.250'
        assert row['scope'] == 'PROJECT'
        assert row['pool_quantity'] is None  # no hay fila de pool para ese producto

    def test_limit_truncates_the_text_table_but_not_the_summary(self, project):
        for i in range(5):
            _stock(_inventory(f'P-{i}'), 1, project=project)
        output = _run('--limit', '2')
        assert 'Filas CENTRAL atadas a proyecto/departamento: 5' in output
        assert '... y 3 filas más' in output

    def test_dry_run_flag_is_accepted(self, project):
        _stock(_inventory('CEM-001'), 1, project=project)
        assert 'Filas CENTRAL atadas' in _run('--dry-run')

    def test_fail_on_findings_raises_when_there_are_rows(self, project):
        _stock(_inventory('CEM-001'), 1, project=project)
        with pytest.raises(CommandError, match='filas CENTRAL atadas'):
            _run('--fail-on-findings')

    def test_fail_on_findings_is_silent_when_clean(self):
        _stock(_inventory('CEM-001'), 1)  # solo pool
        assert 'OK:' in _run('--fail-on-findings')


class TestReadOnly:
    def test_command_never_writes(self, project, department):
        inv = _inventory('CEM-001')
        _stock(inv, 40)
        _stock(inv, 0, project=project)
        _stock(inv, 5, department=department)
        before = _snapshot_counts()

        with CaptureQueriesContext(connection) as ctx:
            _run()
            _run('--json')

        statements = [q['sql'].lstrip().upper() for q in ctx.captured_queries]
        assert statements, 'el comando debería haber consultado la base de datos'
        writes = [s[:60] for s in statements if not s.startswith(('SELECT', 'WITH'))]
        assert writes == [], f'el comando ejecutó sentencias que no son de lectura: {writes}'
        assert _snapshot_counts() == before
