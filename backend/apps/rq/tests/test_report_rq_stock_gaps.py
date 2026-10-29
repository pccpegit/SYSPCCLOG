"""
SYSPCC-026 · Fase 0 — `report_rq_stock_gaps` (evidencia del bug R1, SOLO LECTURA).

Cubre: qué RQs entran al reporte y cuáles no, cada indicio, JSON, `-v 2`,
`--fail-on-findings`, que el comando no escribe, y una prueba de punta a punta que
ejecuta el motor real para reproducir R1 y comprobar que el diagnóstico lo detecta.
"""
import datetime
import json
from decimal import Decimal
from io import StringIO

import pytest
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.enums import (
    AcquisitionTypeChoices,
    ApprovalActionChoices,
    RQFlowChoices,
    RQStatusChoices,
    RoleChoices,
)
from apps.core.models import UserRole
from apps.rq.models import Approval, Request, RequestItem
from apps.rq.services.stock_diagnostics import (
    VERDICT_NO_DISPATCH_APPROVAL,
    VERDICT_NO_FK_LINK,
    VERDICT_OTHER_CAUSE,
    VERDICT_POOL_INSUFFICIENT,
    VERDICT_R1_PROBABLE,
)
from apps.rq.services.workflow_engine import WorkflowEngine
from apps.warehouse.models import (
    Inventory,
    InventoryStock,
    MovementGroup,
    WarehouseDispatch,
)

User = get_user_model()
pytestmark = pytest.mark.django_db


# ── helpers ────────────────────────────────────────────────────────────────────

def _inventory(code='CEM-001', unit='UND'):
    return Inventory.objects.create(product_code=code, description=f'Producto {code}', unit=unit)


def _stock(inventory, qty, project=None, warehouse='CENTRAL'):
    return InventoryStock.objects.create(
        inventory=inventory, warehouse_type=warehouse, project=project, quantity=Decimal(str(qty)),
    )


def _ops_rq(number, project, requester, status=RQStatusChoices.DISPATCHED_TO_SITE, items=()):
    """RQ OPS. `items`: lista de (inventory|None, cantidad)."""
    rq = Request.objects.create(
        rq_number=number,
        flow=RQFlowChoices.OPERATIONS,
        project=project,
        requested_by=requester,
        status=status,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )
    for line, (inventory, qty) in enumerate(items, start=1):
        RequestItem.objects.create(
            request=rq, line_number=line, description=f'Ítem {line}', quantity=Decimal(str(qty)),
            unit='UND', inventory_item=inventory,
        )
    return rq


def _dispatched_approval(rq, user):
    return Approval.objects.create(
        request=rq, action=ApprovalActionChoices.DISPATCHED, performed_by=user,
        role=RoleChoices.CENTRAL_WAREHOUSE,
        previous_status=RQStatusChoices.IN_STOCK, new_status=RQStatusChoices.DISPATCHED_TO_SITE,
    )


def _run(*args, verbosity=1):
    out = StringIO()
    call_command('report_rq_stock_gaps', *args, stdout=out, verbosity=verbosity)
    return out.getvalue()


def _rows(*args):
    return {r['rq_number']: r for r in json.loads(_run('--json', *args))['rows']}


# ── qué RQs entran al reporte ─────────────────────────────────────────────────

class TestSelection:
    def test_empty_database_reports_ok(self):
        output = _run()
        assert 'SOLO LECTURA' in output
        assert 'OK: no hay RQs OPS con proyecto despachados sin movimiento' in output

    def test_dispatched_rq_without_movement_is_reported(self, project, requester):
        rq = _ops_rq('RQ-A', project, requester, items=[(_inventory(), 5)])
        _dispatched_approval(rq, requester)
        assert 'RQ-A' in _rows()

    def test_rq_with_warehouse_dispatch_is_excluded(self, project, requester):
        rq = _ops_rq('RQ-A', project, requester, items=[(_inventory(), 5)])
        _dispatched_approval(rq, requester)
        WarehouseDispatch.objects.create(
            request=rq, dispatched_by=requester, origin='CENTRAL', dispatch_number='D-1',
        )
        assert _rows() == {}

    def test_rq_with_automatic_exit_group_is_excluded(self, project, requester):
        # El movimiento SÍ ocurrió (aunque falte el WarehouseDispatch): no es "sin movimiento".
        rq = _ops_rq('RQ-A', project, requester, items=[(_inventory(), 5)])
        _dispatched_approval(rq, requester)
        MovementGroup.objects.create(
            group_number='EXIT-0001', movement_type='EXIT', warehouse='CENTRAL',
            notes=f'Despacho automático RQ {rq.rq_number}', registered_by=requester,
        )
        assert _rows() == {}

    def test_exit_group_of_another_rq_does_not_hide_this_one(self, project, requester):
        rq = _ops_rq('RQ-A', project, requester, items=[(_inventory(), 5)])
        _dispatched_approval(rq, requester)
        MovementGroup.objects.create(
            group_number='EXIT-0001', movement_type='EXIT', warehouse='CENTRAL',
            notes='Despacho automático RQ RQ-OTRO', registered_by=requester,
        )
        assert 'RQ-A' in _rows()

    def test_administrative_rq_is_excluded(self, department, department_requester):
        rq = Request.objects.create(
            rq_number='RQ-ADM', flow=RQFlowChoices.ADMINISTRATIVE, department=department,
            requested_by=department_requester, status=RQStatusChoices.DELIVERED,
            acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
            fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
        )
        RequestItem.objects.create(request=rq, line_number=1, description='x', quantity=1, unit='UND')
        _dispatched_approval(rq, department_requester)
        assert _rows() == {}

    def test_ops_rq_without_project_is_excluded(self, requester):
        rq = _ops_rq('RQ-SINPROY', None, requester, items=[(_inventory(), 5)])
        _dispatched_approval(rq, requester)
        assert _rows() == {}

    def test_not_yet_dispatched_rq_is_excluded(self, project, requester):
        _ops_rq('RQ-A', project, requester, status=RQStatusChoices.IN_STOCK, items=[(_inventory(), 5)])
        assert _rows() == {}

    def test_rq_without_items_is_excluded(self, project, requester):
        rq = _ops_rq('RQ-A', project, requester)
        _dispatched_approval(rq, requester)
        assert _rows() == {}

    @pytest.mark.parametrize('status', [
        RQStatusChoices.DISPATCHED_TO_SITE, RQStatusChoices.DELIVERED,
        RQStatusChoices.CLAIM_IN_REVIEW, RQStatusChoices.USER_CONFORMITY, RQStatusChoices.CLOSED,
    ])
    def test_post_dispatch_status_without_approval_is_reported_apart(self, project, requester, status):
        _ops_rq('RQ-SEED', project, requester, status=status, items=[(_inventory(), 5)])
        row = _rows()['RQ-SEED']
        assert row['verdict'] == VERDICT_NO_DISPATCH_APPROVAL
        assert row['has_dispatch_approval'] is False


# ── indicios ───────────────────────────────────────────────────────────────────

class TestVerdicts:
    def _dispatched(self, project, requester, inventory, qty):
        rq = _ops_rq('RQ-A', project, requester, items=[(inventory, qty)])
        _dispatched_approval(rq, requester)
        return rq

    def test_r1_probable_when_pool_has_stock_but_project_row_does_not(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)                       # pool central cubre
        self._dispatched(project, requester, inv, 5)
        row = _rows()['RQ-A']
        assert row['verdict'] == VERDICT_R1_PROBABLE
        item = row['items'][0]
        assert (item['requested'], item['pool_quantity'], item['project_row_quantity']) == ('5.000', '10.000', None)

    def test_r1_probable_when_project_row_exists_but_is_empty(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)
        _stock(inv, 0, project=project)       # fila del proyecto agotada: tampoco cubre lo pedido
        self._dispatched(project, requester, inv, 5)
        assert _rows()['RQ-A']['verdict'] == VERDICT_R1_PROBABLE

    def test_pool_insufficient_when_central_pool_does_not_cover(self, project, requester):
        inv = _inventory()
        _stock(inv, 2)
        self._dispatched(project, requester, inv, 5)
        assert _rows()['RQ-A']['verdict'] == VERDICT_POOL_INSUFFICIENT

    def test_other_cause_when_project_row_would_have_covered(self, project, requester):
        inv = _inventory()
        _stock(inv, 10, project=project)
        self._dispatched(project, requester, inv, 5)
        assert _rows()['RQ-A']['verdict'] == VERDICT_OTHER_CAUSE

    def test_no_fk_link_when_no_item_has_inventory_item(self, project, requester):
        self._dispatched(project, requester, None, 5)
        row = _rows()['RQ-A']
        assert row['verdict'] == VERDICT_NO_FK_LINK
        assert (row['items_total'], row['items_linked']) == (1, 0)

    def test_r1_wins_over_other_items_with_other_outcomes(self, project, requester):
        covered, short = _inventory('A-1'), _inventory('B-1')
        _stock(covered, 10)
        _stock(short, 1)
        rq = _ops_rq('RQ-A', project, requester, items=[(short, 5), (covered, 5)])
        _dispatched_approval(rq, requester)
        assert _rows()['RQ-A']['verdict'] == VERDICT_R1_PROBABLE

    def test_summary_counts_by_verdict(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)
        for n in ('RQ-1', 'RQ-2'):
            rq = _ops_rq(n, project, requester, items=[(inv, 5)])
            _dispatched_approval(rq, requester)
        _ops_rq('RQ-3', project, requester, items=[(None, 1)])  # sin aprobación DISPATCHED
        summary = json.loads(_run('--json'))['summary']
        assert summary['total_requests'] == 3
        assert summary['r1_evidence_requests'] == 2
        assert summary['by_verdict'][VERDICT_R1_PROBABLE] == 2
        assert summary['by_verdict'][VERDICT_NO_DISPATCH_APPROVAL] == 1


# ── opciones de salida ────────────────────────────────────────────────────────

class TestOutputOptions:
    def _setup_r1(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)
        rq = _ops_rq('RQ-A', project, requester, items=[(inv, 5)])
        _dispatched_approval(rq, requester)

    def test_text_report_lists_rq_and_verdict(self, project, requester):
        self._setup_r1(project, requester)
        output = _run()
        assert 'RQ-A' in output and VERDICT_R1_PROBABLE in output
        assert project.code in output

    def test_verbosity_2_shows_item_evidence(self, project, requester):
        self._setup_r1(project, requester)
        assert 'pedido 5' not in _run()
        verbose = _run(verbosity=2)
        assert 'línea 1 CEM-001: pedido 5' in verbose
        assert 'pool central 10' in verbose

    def test_json_is_the_only_output(self, project, requester):
        self._setup_r1(project, requester)
        payload = json.loads(_run('--json'))
        assert payload['rows'][0]['dispatch_approved_at']  # ISO 8601
        assert payload['rows'][0]['project_code'] == project.code

    def test_limit_truncates_the_table_not_the_summary(self, project, requester):
        for i in range(3):
            rq = _ops_rq(f'RQ-{i}', project, requester, items=[(None, 1)])
            _dispatched_approval(rq, requester)
        output = _run('--limit', '1')
        assert 'despachados sin movimiento: 3' in output
        assert '... y 2 RQs más' in output

    def test_dry_run_flag_is_accepted(self, project, requester):
        self._setup_r1(project, requester)
        assert 'RQ-A' in _run('--dry-run')

    def test_fail_on_findings_raises_only_with_r1_evidence(self, project, requester):
        rq = _ops_rq('RQ-X', project, requester, items=[(None, 1)])
        _dispatched_approval(rq, requester)
        assert 'RQ-X' in _run('--fail-on-findings')  # SIN_VINCULO_FK no cuenta como evidencia de R1

        self._setup_r1(project, requester)
        with pytest.raises(CommandError, match='indicio de R1'):
            _run('--fail-on-findings')


# ── solo lectura ──────────────────────────────────────────────────────────────

class TestReadOnly:
    def test_command_never_writes(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)
        rq = _ops_rq('RQ-A', project, requester, items=[(inv, 5)])
        _dispatched_approval(rq, requester)
        before = (
            Request.objects.count(), RequestItem.objects.count(), Approval.objects.count(),
            WarehouseDispatch.objects.count(), MovementGroup.objects.count(),
            sorted(InventoryStock.objects.values_list('pk', 'quantity')),
        )

        with CaptureQueriesContext(connection) as ctx:
            _run()
            _run('--json')
            _run(verbosity=2)

        statements = [q['sql'].lstrip().upper() for q in ctx.captured_queries]
        assert statements
        writes = [s[:60] for s in statements if not s.startswith(('SELECT', 'WITH'))]
        assert writes == [], f'el comando ejecutó sentencias que no son de lectura: {writes}'
        assert before == (
            Request.objects.count(), RequestItem.objects.count(), Approval.objects.count(),
            WarehouseDispatch.objects.count(), MovementGroup.objects.count(),
            sorted(InventoryStock.objects.values_list('pk', 'quantity')),
        )

    def test_query_count_does_not_grow_with_the_number_of_rqs(self, project, requester):
        inv = _inventory()
        _stock(inv, 100)

        def make(n):
            for i in range(n):
                rq = _ops_rq(f'RQ-{n}-{i}', project, requester, items=[(inv, 1), (inv, 2)])
                _dispatched_approval(rq, requester)

        make(2)
        with CaptureQueriesContext(connection) as small:
            _run('--json')
        make(10)
        with CaptureQueriesContext(connection) as large:
            _run('--json')
        assert len(large) == len(small)


# ── punta a punta con el motor real ───────────────────────────────────────────

class TestR1IsFixedByTheRealEngine:
    """
    SYSPCC-028: R1 corregido. Antes (Fase 0) esta clase caracterizaba el bug: DISPATCHED con
    stock en el pool dejaba el RQ "despachado" sin WarehouseDispatch ni descuento y el
    diagnóstico lo marcaba R1_PROBABLE. Ahora el despacho descuenta del pool y el RQ ya no
    aparece en el reporte; el reporte sigue sirviendo para los despachos HISTÓRICOS.
    """

    @pytest.fixture
    def central_warehouse_user(self, db):
        user = User.objects.create_user(username='central_wh', password='TestPass2026!')
        UserRole.objects.create(user=user, role=RoleChoices.CENTRAL_WAREHOUSE, is_primary=True)
        return user

    @staticmethod
    def _confirmed_rq(number, project, requester, inv, qty):
        rq = _ops_rq(number, project, requester, status=RQStatusChoices.IN_STOCK, items=[(inv, qty)])
        RequestItem.objects.filter(request=rq).update(inventory_item_confirmed_at=timezone.now())
        return rq

    def test_dispatch_with_pool_stock_now_discounts_and_leaves_the_report(
        self, project, requester, central_warehouse_user,
    ):
        inv = _inventory()
        _stock(inv, 10)  # el stock está en el pool central (project=None)
        rq = self._confirmed_rq('RQ-R1', project, requester, inv, 3)

        WorkflowEngine(rq, central_warehouse_user, RoleChoices.CENTRAL_WAREHOUSE).execute(
            action=ApprovalActionChoices.DISPATCHED, comments='despacho de prueba',
        )

        rq.refresh_from_db()
        assert rq.status == RQStatusChoices.DISPATCHED_TO_SITE
        assert WarehouseDispatch.objects.filter(request=rq).exists()
        assert InventoryStock.objects.get(inventory=inv, project=None).quantity == Decimal('7')
        assert 'RQ-R1' not in _rows()
        assert not InventoryStock.objects.filter(inventory=inv, project=project).exists()

    def test_unconfirmed_link_still_moves_nothing_and_the_report_shows_it(
        self, project, requester, central_warehouse_user,
    ):
        inv = _inventory()
        _stock(inv, 10)
        rq = _ops_rq('RQ-SINCONF', project, requester, status=RQStatusChoices.IN_STOCK, items=[(inv, 3)])

        WorkflowEngine(rq, central_warehouse_user, RoleChoices.CENTRAL_WAREHOUSE).execute(
            action=ApprovalActionChoices.DISPATCHED, comments='despacho de prueba',
        )

        rq.refresh_from_db()
        assert rq.status == RQStatusChoices.DISPATCHED_TO_SITE        # el RQ avanza igual
        assert not WarehouseDispatch.objects.filter(request=rq).exists()
        assert InventoryStock.objects.get(inventory=inv, project=None).quantity == Decimal('10')

        row = _rows()['RQ-SINCONF']
        assert row['has_dispatch_approval'] is True
        assert (row['items_linked'], row['items_confirmed'], row['would_move_now']) == (1, 0, False)
        assert row['items'][0]['link_confirmed'] is False

    def test_confirmed_item_is_reported_as_moving_now(self, project, requester):
        inv = _inventory()
        _stock(inv, 10)
        rq = self._confirmed_rq('RQ-HIST', project, requester, inv, 3)
        rq.status = RQStatusChoices.DISPATCHED_TO_SITE
        rq.save(update_fields=['status'])  # histórico: despachado antes del arreglo, sin documento

        row = _rows()['RQ-HIST']
        assert (row['items_confirmed'], row['would_move_now']) == (1, True)
        assert row['items'][0]['link_confirmed'] is True
