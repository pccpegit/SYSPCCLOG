"""
SYSPCC-026 (Fase 1, revisión) — `report_rq_stock_gaps`: vínculos de catálogo sin confirmar.

El solicitante puede PROPONER un producto del catálogo al crear el RQ; solo Logística lo
CONFIRMA (`inventory_item_confirmed_at`). El motor todavía usa la FK propuesta al recibir y
despachar (la Fase 3 lo corrige), así que antes de desplegar hay que poder listar esos
ítems. Este módulo prueba esa sección: qué entra, qué no, la salida de texto y JSON, las
banderas `--include-terminal` / `--fail-on-unconfirmed`, que solo lee y que las consultas no
crecen con el número de RQs.
"""
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.core.enums import RQStatusChoices
from apps.rq.models import Request, RequestItem
from apps.rq.services.request_items import update_request_items
from apps.rq.services.stock_diagnostics import TERMINAL_STATUSES, unconfirmed_catalog_links
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    ops_rq,
)

pytestmark = pytest.mark.django_db


def _run(*args, verbosity=1):
    out = StringIO()
    call_command('report_rq_stock_gaps', *args, stdout=out, verbosity=verbosity)
    return out.getvalue()


def _unconfirmed(*args):
    return json.loads(_run('--json', *args))['unconfirmed_links']


def _numbers(*args):
    return [row['rq_number'] for row in _unconfirmed(*args)['rows']]


@pytest.fixture
def helmet():
    return make_inventory('EPP-0001', 'Casco de seguridad blanco')


# ── qué entra y qué no ────────────────────────────────────────────────────────

class TestSelection:
    def test_a_proposed_link_without_stamp_is_listed(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        (row,) = _unconfirmed()['rows']
        assert (row['rq_number'], row['line_number'], row['product_code']) == (
            ops_rq.rq_number, 1, 'EPP-0001',
        )
        assert row['status'] == RQStatusChoices.SUBMITTED
        assert row['flow'] == 'OPERATIONS'

    def test_the_scope_is_the_project_in_operations_and_the_department_in_administration(
        self, ops_rq, adm_rq, helmet, project, department,
    ):
        make_item(ops_rq, 1, inventory_item=helmet)
        make_item(adm_rq, 1, inventory_item=helmet)

        scopes = {r['rq_number']: r['scope_code'] for r in _unconfirmed()['rows']}
        assert scopes == {ops_rq.rq_number: project.code, adm_rq.rq_number: department.code}

    def test_a_confirmed_link_is_not_listed(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet, inventory_item_confirmed_at=timezone.now())

        assert _unconfirmed()['rows'] == []

    def test_a_line_without_product_is_not_listed(self, ops_rq):
        make_item(ops_rq, 1)

        assert _unconfirmed()['rows'] == []

    def test_an_off_catalog_line_is_not_listed(self, ops_rq):
        make_item(ops_rq, 1, is_off_catalog=True)

        assert _unconfirmed()['rows'] == []

    def test_only_the_unconfirmed_lines_of_a_request_are_listed(self, ops_rq, helmet):
        gloves = make_inventory('EPP-0002', 'Guantes de cuero')
        make_item(ops_rq, 1, inventory_item=helmet, inventory_item_confirmed_at=timezone.now())
        make_item(ops_rq, 2, inventory_item=gloves)
        make_item(ops_rq, 3)

        rows = _unconfirmed()['rows']
        assert [(r['line_number'], r['product_code']) for r in rows] == [(2, 'EPP-0002')]

    def test_seeded_links_count_as_unconfirmed_on_purpose(self, ops_rq, helmet):
        """ORM/seed/admin writes never stamp: nobody reviewed them, so they are listed."""
        RequestItem.objects.create(
            request=ops_rq, line_number=1, description='Casco', quantity=1, unit='UND',
            inventory_item=helmet,
        )

        assert len(_unconfirmed()['rows']) == 1

    def test_a_link_confirmed_through_the_service_leaves_the_list(self, ops_rq, helmet, logistics_supervisor):
        Request.objects.filter(pk=ops_rq.pk).update(status=RQStatusChoices.VALIDATED)
        line = make_item(ops_rq, 1, inventory_item=helmet)
        assert len(_unconfirmed()['rows']) == 1

        update_request_items(
            Request.objects.get(pk=ops_rq.pk),
            [{'item_id': line.pk, 'inventory_item': helmet}],
            logistics_supervisor,
        )

        assert _unconfirmed()['rows'] == []


# ── RQs abiertos vs terminales ────────────────────────────────────────────────

class TestTerminalRequests:
    def test_terminal_statuses_follow_the_model(self):
        """No second copy of the list: it is derived from `Request.is_terminal`."""
        assert TERMINAL_STATUSES == {
            'CLOSED', 'CANCELLED', 'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED',
            'GM_REJECTED', 'COST_OVERRUN_REJECTED',
        }
        for status in RQStatusChoices.values:
            assert (status in TERMINAL_STATUSES) == Request(status=status).is_terminal

    @pytest.mark.parametrize('status', sorted(TERMINAL_STATUSES))
    def test_terminal_requests_are_left_out_by_default(self, project, requester, helmet, status):
        rq = make_request(number='RQ-T-1', requester=requester, project=project, status=status)
        make_item(rq, 1, inventory_item=helmet)

        assert _unconfirmed()['rows'] == []

    @pytest.mark.parametrize('status', sorted(TERMINAL_STATUSES))
    def test_include_terminal_adds_them(self, project, requester, helmet, status):
        rq = make_request(number='RQ-T-1', requester=requester, project=project, status=status)
        make_item(rq, 1, inventory_item=helmet)

        result = _unconfirmed('--include-terminal')
        assert [r['rq_number'] for r in result['rows']] == ['RQ-T-1']
        assert result['summary']['include_terminal'] is True

    @pytest.mark.parametrize('status', [
        s for s in RQStatusChoices.values if s not in TERMINAL_STATUSES
    ])
    def test_every_open_status_is_listed(self, project, requester, helmet, status):
        """QUALITY_REJECTED is not terminal (claim cycle): its lines can still move stock."""
        rq = make_request(number='RQ-O-1', requester=requester, project=project, status=status)
        make_item(rq, 1, inventory_item=helmet)

        assert _numbers() == ['RQ-O-1']


# ── resumen y formato ─────────────────────────────────────────────────────────

class TestSummaryAndOutput:
    def test_summary_counts_items_requests_flows_and_statuses(self, ops_rq, adm_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)
        make_item(ops_rq, 2, inventory_item=helmet)
        make_item(adm_rq, 1, inventory_item=helmet)

        summary = _unconfirmed()['summary']
        assert summary['total_items'] == 3
        assert summary['total_requests'] == 2
        assert summary['by_flow'] == {'ADMINISTRATIVE': 1, 'OPERATIONS': 2}
        assert summary['by_status'] == {'SUBMITTED': 3}
        assert summary['include_terminal'] is False

    def test_json_keeps_the_existing_keys_and_adds_one(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        payload = json.loads(_run('--json'))
        assert set(payload) == {'rows', 'summary', 'unconfirmed_links'}
        assert set(payload['unconfirmed_links']) == {'rows', 'summary'}

    def test_json_row_has_no_personal_data(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        (row,) = _unconfirmed()['rows']
        assert set(row) == {
            'item_id', 'request_id', 'rq_number', 'flow', 'status', 'scope_code', 'line_number',
            'description', 'quantity', 'unit', 'product_code', 'product_description',
        }

    def test_text_says_ok_when_there_is_nothing(self):
        output = _run()

        assert 'Vínculos de catálogo propuestos y SIN confirmar' in output
        assert 'OK: no hay ítems con producto de catálogo sin confirmar en RQs abiertos' in output

    def test_text_lists_the_lines_and_explains_the_risk(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet, description='Casco blanco clase E')

        output = _run()
        assert '1 ítems en 1 RQs' in output
        assert ops_rq.rq_number in output and 'EPP-0001' in output and 'Casco blanco clase E' in output
        assert 'solo honrará vínculos confirmados' in output
        assert 'OPERATIONS: 1' in output

    def test_text_scope_changes_with_include_terminal(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        assert '(RQs abiertos (no terminales))' in _run()
        assert '(todos los RQs)' in _run('--include-terminal')

    def test_limit_cuts_the_table_but_not_the_summary(self, ops_rq, helmet):
        for n in range(1, 4):
            make_item(ops_rq, n, inventory_item=helmet)

        output = _run('--limit', '1')
        assert '3 ítems en 1 RQs' in output
        assert '... y 2 ítems más' in output
        assert '... y 2 ítems más' not in _run('--limit', '0')

    def test_the_r1_section_is_still_printed_when_the_new_one_has_rows(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        output = _run()
        assert 'OK: no hay RQs OPS con proyecto despachados sin movimiento' in output
        assert output.index('despachados sin movimiento') < output.index('SIN confirmar')


# ── banderas de salida ────────────────────────────────────────────────────────

class TestExitFlags:
    def test_fail_on_unconfirmed_raises_with_a_proposed_link(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        with pytest.raises(CommandError, match='sin confirmar por Logística'):
            _run('--fail-on-unconfirmed')

    def test_fail_on_unconfirmed_is_quiet_when_everything_is_confirmed(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet, inventory_item_confirmed_at=timezone.now())

        assert 'OK: no hay ítems con producto de catálogo sin confirmar' in _run('--fail-on-unconfirmed')

    def test_fail_on_unconfirmed_ignores_terminal_requests_unless_asked(self, project, requester, helmet):
        rq = make_request(
            number='RQ-T-1', requester=requester, project=project, status=RQStatusChoices.CLOSED,
        )
        make_item(rq, 1, inventory_item=helmet)

        _run('--fail-on-unconfirmed')
        with pytest.raises(CommandError):
            _run('--fail-on-unconfirmed', '--include-terminal')

    def test_fail_on_findings_still_means_only_r1(self, ops_rq, helmet):
        """The old flag keeps its meaning: unconfirmed links do not trip it."""
        make_item(ops_rq, 1, inventory_item=helmet)

        assert 'SIN confirmar' in _run('--fail-on-findings')


# ── solo lectura y consultas ──────────────────────────────────────────────────

class TestReadOnlyAndCost:
    def test_the_query_only_selects(self, ops_rq, helmet):
        make_item(ops_rq, 1, inventory_item=helmet)

        with CaptureQueriesContext(connection) as queries:
            unconfirmed_catalog_links()

        assert queries.captured_queries
        assert all(q['sql'].lstrip().upper().startswith('SELECT') for q in queries.captured_queries)

    def test_the_command_writes_nothing(self, ops_rq, helmet):
        line = make_item(ops_rq, 1, inventory_item=helmet)
        before = RequestItem.objects.filter(pk=line.pk).values().get()

        _run('--include-terminal')

        assert RequestItem.objects.filter(pk=line.pk).values().get() == before

    def test_it_is_one_query_however_many_requests_there_are(self, project, requester, helmet):
        def count_for(n_requests):
            Request.objects.all().delete()
            for n in range(n_requests):
                rq = make_request(number=f'RQ-C-{n}', requester=requester, project=project)
                make_item(rq, 1, inventory_item=helmet)
                make_item(rq, 2, inventory_item=helmet)
            with CaptureQueriesContext(connection) as queries:
                result = unconfirmed_catalog_links()
            assert result['summary']['total_items'] == n_requests * 2
            return len(queries.captured_queries)

        assert count_for(2) == count_for(8) == 1
