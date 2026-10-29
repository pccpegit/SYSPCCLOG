"""
SYSPCC-029: `roles_for_action` solo LEE la tabla de transiciones de gerencia.

Garantías: devuelve exactamente el rol que `TRANSITIONS` exige para DISPATCHED en cada
(flujo, estado) de entrega, no inventa roles, ignora transiciones de sistema y no muta la tabla.
La protección del contenido de TRANSITIONS en sí es `test_workflow_snapshot.py` (no se toca).
"""
import copy

import pytest

from apps.core.enums import RoleChoices, RQFlowChoices, RQStatusChoices
from apps.rq.services.transition_roles import roles_for_action
from apps.rq.services.workflow_engine import TRANSITIONS

OPS = RQFlowChoices.OPERATIONS
ADM = RQFlowChoices.ADMINISTRATIVE


@pytest.mark.parametrize('flow, status, expected', [
    (OPS, RQStatusChoices.IN_STOCK, {RoleChoices.CENTRAL_WAREHOUSE}),
    (OPS, RQStatusChoices.QUALITY_APPROVED, {RoleChoices.LOGISTICS_COORDINATOR}),
    (ADM, RQStatusChoices.IN_STOCK, {RoleChoices.CENTRAL_WAREHOUSE}),
    (ADM, RQStatusChoices.QUALITY_APPROVED, {RoleChoices.LOGISTICS_SUPERVISOR}),
])
def test_dispatched_roles_come_from_the_transition_table(flow, status, expected):
    assert roles_for_action(flow, status, 'DISPATCHED') == frozenset(expected)


def test_it_is_the_table_not_a_copy():
    """Cada rol devuelto aparece en una fila real de TRANSITIONS para ese (flujo, estado)."""
    for flow in (OPS, ADM):
        for status in (RQStatusChoices.IN_STOCK, RQStatusChoices.QUALITY_APPROVED):
            rows = [
                t for t in TRANSITIONS
                if t['flow'] == flow and t['from_status'] == status and t['action'] == 'DISPATCHED'
            ]
            assert rows, 'la tabla debe definir DISPATCHED en este punto'
            assert roles_for_action(flow, status, 'DISPATCHED') == {str(t['required_role']) for t in rows}


@pytest.mark.parametrize('status', [
    RQStatusChoices.SUBMITTED, RQStatusChoices.VALIDATED, RQStatusChoices.DISPATCHED_TO_SITE,
    RQStatusChoices.DELIVERED, RQStatusChoices.CLOSED,
])
def test_no_dispatched_transition_means_no_roles(status):
    assert roles_for_action(OPS, status, 'DISPATCHED') == frozenset()


def test_unknown_action_has_no_roles():
    assert roles_for_action(OPS, RQStatusChoices.IN_STOCK, 'NO_SUCH_ACTION') == frozenset()


def test_system_transitions_and_roleless_rows_are_ignored():
    # VALIDATED is reached by a system chain with no human role: nothing to derive.
    system_rows = [t for t in TRANSITIONS if t.get('system_action')]
    assert system_rows
    for t in system_rows:
        flow = OPS if t['flow'] == '__ANY__' else t['flow']
        assert roles_for_action(flow, t['from_status'], t['action']) == frozenset()


def test_reading_does_not_mutate_the_table():
    before = copy.deepcopy(TRANSITIONS)
    for flow in (OPS, ADM):
        for status in RQStatusChoices.values:
            roles_for_action(flow, status, 'DISPATCHED')
    assert TRANSITIONS == before
