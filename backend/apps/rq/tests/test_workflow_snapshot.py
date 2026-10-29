"""
SYSPCC-026 · Fase 0 — Red de seguridad del flujo de gerencia (DO-NOT-MODIFY).

Los flujos OPERATIONS y ADMINISTRATIVE los define gerencia (CLAUDE.md, sección
"Workflows — DO NOT MODIFY"; PDF "FLUJOGRAMA DE ABASTECIMIENTO DE RQ's OPERACIONES
Rev.0 MAR2026"). Este módulo congela, como copia LITERAL escrita a mano, todo lo que
define ese flujo en el código:

  * cada entrada de `TRANSITIONS` (flujo, desde, acción, rol, hacia, ...);
  * los valores de `RQStatusChoices`, `ApprovalActionChoices`, `RoleChoices`
    y `RQFlowChoices`;
  * el conjunto de estados terminales de `Request.is_terminal`.

Regla de oro: los snapshots de abajo NO se derivan del código en runtime. Si se
generaran leyendo `TRANSITIONS`, el test pasaría siempre aunque alguien cambiara el
flujo. Por eso son literales: cualquier diferencia hace fallar la suite.

Si gerencia AUTORIZA un cambio de flujo, se actualiza el snapshot en el mismo PR, se
cita la autorización y el workflow-engineer lo revisa. Si no, se revierte el cambio.

Estas pruebas no tocan la base de datos (instancias de `Request` sin guardar).
"""
import copy

import pytest

from apps.core.enums import (
    ApprovalActionChoices,
    RQFlowChoices,
    RQStatusChoices,
    RoleChoices,
)
from apps.rq.models import Request
from apps.rq.services.workflow_engine import ANY, TRANSITIONS, WorkflowEngine

# ──────────────────────────────────────────────────────────────────────────────
# Mensajes
# ──────────────────────────────────────────────────────────────────────────────

_HEADER = (
    'Los flujos de gerencia están protegidos (DO-NOT-MODIFY). '
    'Los flujos OPERATIONS y ADMINISTRATIVE los define gerencia (CLAUDE.md, sección '
    '"Workflows — DO NOT MODIFY"): no se pueden agregar, quitar, reordenar ni modificar '
    'estados, transiciones, acciones ni roles sin autorización escrita de gerencia.'
)
_FOOTER = (
    'Si el cambio NO fue autorizado por gerencia: reviértelo. '
    'Si SÍ fue autorizado: actualiza el snapshot de este archivo en el mismo PR, cita la '
    'autorización y pide revisión al workflow-engineer.'
)


def _fail(title, lines):
    detail = '\n'.join(f'  - {line}' for line in lines)
    raise AssertionError(f'{_HEADER}\n{title}\n{detail}\n{_FOOTER}')


# ──────────────────────────────────────────────────────────────────────────────
# SNAPSHOT LITERAL — NO derivar del código. Escrito a mano desde CLAUDE.md.
# ──────────────────────────────────────────────────────────────────────────────

# Valor literal del centinela "cualquier flujo".
SNAPSHOT_ANY = '__ANY__'

_OPS = 'OPERATIONS'
_ADM = 'ADMINISTRATIVE'
_ALL = SNAPSHOT_ANY

# Columnas de cada entrada:
#   (flow, from_status, action, required_role, to_status, to_status_reject,
#    system_action, handler, conditional)
# El ORDEN de la lista también es parte del contrato: `_find_transition` devuelve la
# primera coincidencia, así que reordenar puede cambiar qué transición se resuelve.
SNAPSHOT_TRANSITIONS = [
    # ── Fase 1 · Solicitud ────────────────────────────────────────────────────
    (_ALL, 'DRAFT', 'SUBMITTED', 'REQUESTER', 'SUBMITTED', None, False, None, False),

    # ── OPS · Fase 2 · Validación técnica y presupuestal ──────────────────────
    (_OPS, 'SUBMITTED', 'TECHNICAL_APPROVED', 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', None, False, None, False),
    (_OPS, 'SUBMITTED', 'TECHNICAL_REJECTED', 'PROJECT_RESIDENT', 'TECHNICAL_REJECTED', None, False, None, False),
    (_OPS, 'TECHNICAL_APPROVED', 'BUDGET_CLASSIFIED', 'PROJECT_CONTROL', None, None, False, 'handle_ops_budget_classification', True),
    (_OPS, 'TECHNICAL_APPROVED', 'BUDGET_REJECTED', 'PROJECT_CONTROL', 'TECHNICAL_REJECTED', None, False, None, False),
    (_OPS, 'ADDITIONAL_REQ', 'TECHNICAL_APPROVED', 'PROJECT_RESIDENT', 'GM_REVIEW', None, False, None, False),
    (_OPS, 'ADDITIONAL_REQ', 'TECHNICAL_REJECTED', 'PROJECT_RESIDENT', 'TECHNICAL_REJECTED', None, False, None, False),
    (_OPS, 'GM_REVIEW', 'GM_APPROVED', 'GENERAL_MANAGER', 'GM_APPROVED', None, False, None, False),
    (_OPS, 'GM_REVIEW', 'GM_REJECTED', 'GENERAL_MANAGER', 'GM_REJECTED', None, False, None, False),
    (_OPS, 'WITHIN_PROPOSAL', 'VALIDATED', None, 'VALIDATED', None, True, None, False),
    (_OPS, 'GM_APPROVED', 'VALIDATED', None, 'VALIDATED', None, True, None, False),

    # ── ADM · Fase 2 · Validación administrativa ──────────────────────────────
    (_ADM, 'SUBMITTED', 'SUPERVISOR_APPROVED', 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', None, False, None, False),
    (_ADM, 'SUBMITTED', 'SUPERVISOR_REJECTED', 'DIRECT_SUPERVISOR', 'SUPERVISOR_REJECTED', None, False, None, False),
    (_ADM, 'SUPERVISOR_APPROVED', 'ADMIN_BUDGET_REVIEWED', 'ADMIN_MANAGER', None, None, False, 'handle_adm_budget_review', True),
    (_ADM, 'SUPERVISOR_APPROVED', 'ADMIN_BUDGET_REJECTED', 'ADMIN_MANAGER', 'SUPERVISOR_REJECTED', None, False, None, False),
    (_ADM, 'GM_REVIEW', 'GM_APPROVED', 'GENERAL_MANAGER', 'GM_APPROVED', None, False, None, False),
    (_ADM, 'GM_REVIEW', 'GM_REJECTED', 'GENERAL_MANAGER', 'GM_REJECTED', None, False, None, False),
    (_ADM, 'OUT_OF_ANNUAL_PLAN', 'SUPERVISOR_APPROVED', 'DIRECT_SUPERVISOR', 'GM_REVIEW', None, False, None, False),
    (_ADM, 'OUT_OF_ANNUAL_PLAN', 'SUPERVISOR_REJECTED', 'DIRECT_SUPERVISOR', 'SUPERVISOR_REJECTED', None, False, None, False),
    (_ADM, 'WITHIN_ANNUAL_PLAN', 'VALIDATED', None, 'VALIDATED', None, True, None, False),
    (_ADM, 'GM_APPROVED', 'VALIDATED', None, 'VALIDATED', None, True, None, False),

    # ── Fase 3 · Logística y compras ──────────────────────────────────────────
    (_OPS, 'VALIDATED', 'STOCK_CHECKED', 'LOGISTICS_COORDINATOR', None, None, False, 'handle_stock_check', True),
    (_ADM, 'VALIDATED', 'STOCK_CHECKED', 'LOGISTICS_SUPERVISOR', None, None, False, 'handle_stock_check', True),
    (_OPS, 'REQUIRES_PURCHASE', 'QUOTE_REQUESTED', 'LOGISTICS_COORDINATOR', 'QUOTING', None, False, None, False),
    (_ADM, 'REQUIRES_PURCHASE', 'QUOTE_REQUESTED', 'LOGISTICS_SUPERVISOR', 'QUOTING', None, False, None, False),
    (_OPS, 'QUOTING', 'QUOTE_COMPARED', 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARISON', None, False, None, False),
    (_OPS, 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', None, False, None, False),
    (_ADM, 'QUOTING', 'QUOTE_COMPARED', 'LOGISTICS_CHIEF', 'QUOTE_COMPARISON', None, False, None, False),
    (_ADM, 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'LOGISTICS_CHIEF', 'QUOTE_SELECTED', None, False, None, False),
    (_OPS, 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'PROJECT_CONTROL', 'QUOTE_COST_APPROVED', None, False, None, False),
    (_OPS, 'QUOTE_SELECTED', 'QUOTE_COST_REJECTED', 'PROJECT_CONTROL', 'COST_OVERRUN_REVIEW', None, False, None, False),
    (_ADM, 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'ADMIN_MANAGER', 'QUOTE_COST_APPROVED', None, False, None, False),
    (_ADM, 'QUOTE_SELECTED', 'QUOTE_COST_REJECTED', 'ADMIN_MANAGER', 'COST_OVERRUN_REVIEW', None, False, None, False),
    (_OPS, 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'LOGISTICS_COORDINATOR', 'PO_GENERATED', None, False, None, False),
    (_ADM, 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'LOGISTICS_SUPERVISOR', 'PO_GENERATED', None, False, None, False),
    (_OPS, 'COST_OVERRUN_APPROVED', 'PO_GENERATED', 'LOGISTICS_COORDINATOR', 'PO_GENERATED', None, False, None, False),
    (_ADM, 'COST_OVERRUN_APPROVED', 'PO_GENERATED', 'LOGISTICS_SUPERVISOR', 'PO_GENERATED', None, False, None, False),
    (_ALL, 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_APPROVED', 'GENERAL_MANAGER', 'COST_OVERRUN_APPROVED', None, False, None, False),
    (_ALL, 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_REJECTED', 'GENERAL_MANAGER', 'COST_OVERRUN_REJECTED', None, False, None, False),

    # ── OPS · Fase 4 · Recepción y entrega ────────────────────────────────────
    (_OPS, 'PO_GENERATED', 'RECEIVED', 'LOGISTICS_COORDINATOR', 'RECEIVING', None, False, None, False),
    (_OPS, 'IN_STOCK', 'DISPATCHED', 'CENTRAL_WAREHOUSE', 'DISPATCHED_TO_SITE', None, False, None, False),
    (_OPS, 'RECEIVING', 'QUALITY_APPROVED', 'LOGISTICS_COORDINATOR', 'QUALITY_APPROVED', None, False, None, False),
    (_OPS, 'RECEIVING', 'QUALITY_REJECTED', 'LOGISTICS_COORDINATOR', 'QUALITY_REJECTED', None, False, None, False),
    (_OPS, 'QUALITY_APPROVED', 'DISPATCHED', 'LOGISTICS_COORDINATOR', 'DISPATCHED_TO_SITE', None, False, None, False),
    # OPS · ciclo de reclamo al proveedor
    (_OPS, 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_SENT', None, False, None, False),
    (_OPS, 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_CLAIM_UPDATED', 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_PENDING', None, False, None, False),
    (_OPS, 'SUPPLIER_CLAIM_PENDING', 'SUPPLIER_REPLACEMENT_RECEIVED', 'LOGISTICS_COORDINATOR', 'SUPPLIER_REPLACEMENT_RECEIVED', None, False, None, False),
    (_OPS, 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_REPLACEMENT_RECEIVED', 'LOGISTICS_COORDINATOR', 'SUPPLIER_REPLACEMENT_RECEIVED', None, False, None, False),
    (_OPS, 'SUPPLIER_REPLACEMENT_RECEIVED', 'QUALITY_APPROVED', 'LOGISTICS_COORDINATOR', 'QUALITY_APPROVED', None, False, None, False),
    (_OPS, 'SUPPLIER_REPLACEMENT_RECEIVED', 'QUALITY_REJECTED', 'LOGISTICS_COORDINATOR', 'QUALITY_REJECTED', None, False, None, False),
    (_OPS, 'DISPATCHED_TO_SITE', 'WAREHOUSE_RECORDS_UPDATED', 'SITE_WAREHOUSE', 'DELIVERED', None, False, None, False),

    # ── ADM · Fase 4 · Recepción y entrega ────────────────────────────────────
    (_ADM, 'PO_GENERATED', 'RECEIVED', 'LOGISTICS_SUPERVISOR', 'RECEIVING', None, False, None, False),
    (_ADM, 'IN_STOCK', 'DISPATCHED', 'CENTRAL_WAREHOUSE', 'DELIVERED', None, False, None, False),
    (_ADM, 'RECEIVING', 'QUALITY_APPROVED', 'LOGISTICS_SUPERVISOR', 'QUALITY_APPROVED', None, False, None, False),
    (_ADM, 'RECEIVING', 'QUALITY_REJECTED', 'LOGISTICS_SUPERVISOR', 'QUALITY_REJECTED', None, False, None, False),
    (_ADM, 'QUALITY_APPROVED', 'DISPATCHED', 'LOGISTICS_SUPERVISOR', 'DISPATCHED_TO_SITE', None, False, None, False),
    (_ADM, 'DISPATCHED_TO_SITE', 'WAREHOUSE_RECORDS_UPDATED', 'CENTRAL_WAREHOUSE', 'DELIVERED', None, False, None, False),
    # ADM · ciclo de reclamo al proveedor (sin SUPPLIER_CLAIM_PENDING)
    (_ADM, 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'LOGISTICS_SUPERVISOR', 'SUPPLIER_CLAIM_SENT', None, False, None, False),
    (_ADM, 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_REPLACEMENT_RECEIVED', 'LOGISTICS_SUPERVISOR', 'SUPPLIER_REPLACEMENT_RECEIVED', None, False, None, False),
    (_ADM, 'SUPPLIER_REPLACEMENT_RECEIVED', 'QUALITY_APPROVED', 'LOGISTICS_SUPERVISOR', 'QUALITY_APPROVED', None, False, None, False),
    (_ADM, 'SUPPLIER_REPLACEMENT_RECEIVED', 'QUALITY_REJECTED', 'LOGISTICS_SUPERVISOR', 'QUALITY_REJECTED', None, False, None, False),
    (_ADM, 'DELIVERED', 'WAREHOUSE_RECORDS_UPDATED', 'CENTRAL_WAREHOUSE', 'WAREHOUSE_UPDATED', None, False, None, False),

    # ── Fase 5 · Conformidad y cierre ─────────────────────────────────────────
    (_OPS, 'DELIVERED', 'USER_CONFIRMED', 'REQUESTER', 'USER_CONFORMITY', None, False, None, False),
    (_OPS, 'DELIVERED', 'USER_CLAIMED', 'REQUESTER', 'CLAIM_IN_REVIEW', None, False, None, False),
    (_ADM, 'WAREHOUSE_UPDATED', 'USER_CONFIRMED', 'REQUESTER', 'USER_CONFORMITY', None, False, None, False),
    (_ADM, 'WAREHOUSE_UPDATED', 'USER_CLAIMED', 'REQUESTER', 'CLAIM_IN_REVIEW', None, False, None, False),
    (_OPS, 'CLAIM_IN_REVIEW', 'SUPPLIER_CLAIM_SENT', 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_SENT', None, False, None, False),
    (_ADM, 'CLAIM_IN_REVIEW', 'SUPPLIER_CLAIM_SENT', 'LOGISTICS_SUPERVISOR', 'SUPPLIER_CLAIM_SENT', None, False, None, False),
    (_OPS, 'USER_CONFORMITY', 'CLOSED', 'LOGISTICS_COORDINATOR', 'CLOSED', None, False, None, False),
    (_ADM, 'USER_CONFORMITY', 'CLOSED', 'LOGISTICS_SUPERVISOR', 'CLOSED', None, False, None, False),

    # ── Universal · cancelación desde cualquier estado no terminal ────────────
    # required_role=None: el motor NO verifica rol en CANCELLED (hallazgo reportado a
    # gerencia, pregunta 5 del handoff). Si gerencia define roles, se actualiza aquí.
    (_ALL, None, 'CANCELLED', None, 'CANCELLED', None, False, 'handle_cancellation', False),
]

# RQStatusChoices — 47 valores. CLAUDE.md habla de "43 estados": la cifra está
# desactualizada (ver hallazgos de la Fase 0). Los 10 marcados "(sin transición)" existen
# en el enum pero ninguna entrada de TRANSITIONS los usa (estados heredados del esquema).
SNAPSHOT_RQ_STATUSES = frozenset({
    # Fase 1
    'DRAFT', 'SUBMITTED',
    # Fase 2 · OPS
    'TECHNICAL_REVIEW',       # (sin transición)
    'TECHNICAL_APPROVED', 'TECHNICAL_REJECTED',
    'BUDGET_REVIEW',          # (sin transición)
    'WITHIN_PROPOSAL', 'ADDITIONAL_REQ',
    # Fase 2 · ADM
    'SUPERVISOR_REVIEW',      # (sin transición)
    'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED',
    'ADMIN_BUDGET_REVIEW',    # (sin transición)
    'WITHIN_ANNUAL_PLAN', 'OUT_OF_ANNUAL_PLAN',
    # Común · gerencia
    'GM_REVIEW', 'GM_APPROVED', 'GM_REJECTED',
    'VALIDATED',
    # Fase 3
    'STOCK_CHECK',            # (sin transición)
    'IN_STOCK', 'REQUIRES_PURCHASE', 'QUOTING', 'QUOTE_COMPARISON', 'QUOTE_SELECTED',
    'QUOTE_COST_APPROVED', 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_APPROVED',
    'COST_OVERRUN_REJECTED', 'PO_GENERATED',
    # Fase 4
    'RECEIVING',
    'QUALITY_CHECK',          # (sin transición)
    'QUALITY_APPROVED', 'QUALITY_REJECTED',
    'SUPPLIER_CLAIM_SENT', 'SUPPLIER_CLAIM_PENDING', 'SUPPLIER_REPLACEMENT_RECEIVED',
    'RECEPTION_CONFORMITY',   # (sin transición)
    'RECEPTION_CLAIM',        # (sin transición)
    'DISPATCHED_TO_SITE', 'DELIVERED',
    # Fase 5
    'WAREHOUSE_UPDATED', 'USER_CONFORMITY',
    'USER_CLAIM',             # (sin transición)
    'CLAIM_IN_REVIEW',
    'CLAIM_RESOLVED',         # (sin transición)
    'CLOSED', 'CANCELLED',
})

# ApprovalActionChoices — 37 valores. Sin transición en TRANSITIONS: RECEPTION_CONFIRMED,
# RECEPTION_CLAIMED, DELIVERED, CLAIM_RESOLVED.
SNAPSHOT_APPROVAL_ACTIONS = frozenset({
    'SUBMITTED',
    'TECHNICAL_APPROVED', 'TECHNICAL_REJECTED', 'BUDGET_CLASSIFIED', 'BUDGET_REJECTED',
    'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'ADMIN_BUDGET_REVIEWED',
    'ADMIN_BUDGET_REJECTED',
    'GM_APPROVED', 'GM_REJECTED', 'VALIDATED',
    'STOCK_CHECKED', 'QUOTE_REQUESTED', 'QUOTE_COMPARED', 'QUOTE_SELECTED',
    'QUOTE_COST_APPROVED', 'QUOTE_COST_REJECTED', 'COST_OVERRUN_APPROVED',
    'COST_OVERRUN_REJECTED', 'PO_GENERATED',
    'RECEIVED', 'QUALITY_APPROVED', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT',
    'SUPPLIER_CLAIM_UPDATED', 'SUPPLIER_REPLACEMENT_RECEIVED',
    'RECEPTION_CONFIRMED',    # (sin transición)
    'RECEPTION_CLAIMED',      # (sin transición)
    'DISPATCHED',
    'DELIVERED',              # (sin transición)
    'WAREHOUSE_RECORDS_UPDATED', 'USER_CONFIRMED', 'USER_CLAIMED',
    'CLAIM_RESOLVED',         # (sin transición)
    'CLOSED', 'CANCELLED',
})

# RoleChoices — 13 valores (CLAUDE.md: "Roles (13)"). PASAJES_MANAGER y HR_MANAGER son
# de módulos propios y no intervienen en el flujo de RQ.
SNAPSHOT_ROLES = frozenset({
    'REQUESTER', 'GENERAL_MANAGER', 'CENTRAL_WAREHOUSE',
    'PROJECT_RESIDENT', 'PROJECT_CONTROL', 'LOGISTICS_COORDINATOR', 'SITE_WAREHOUSE',
    'DIRECT_SUPERVISOR', 'ADMIN_MANAGER', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF',
    'PASAJES_MANAGER', 'HR_MANAGER',
})

SNAPSHOT_FLOWS = frozenset({'OPERATIONS', 'ADMINISTRATIVE'})

# Request.is_terminal. Ojo: QUALITY_REJECTED NO es terminal (pertenece al ciclo de reclamo).
SNAPSHOT_TERMINAL_STATUSES = frozenset({
    'CLOSED', 'CANCELLED',
    'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED', 'GM_REJECTED', 'COST_OVERRUN_REJECTED',
})

# Claves permitidas en cada diccionario de TRANSITIONS.
_REQUIRED_KEYS = frozenset({
    'flow', 'from_status', 'action', 'required_role', 'to_status', 'to_status_reject',
})
_OPTIONAL_KEYS = frozenset({'system_action', 'handler', 'conditional'})


# ──────────────────────────────────────────────────────────────────────────────
# Comparaciones (funciones puras: se prueban también con tablas mutadas)
# ──────────────────────────────────────────────────────────────────────────────

def _value(x):
    """Texto plano de un miembro de TextChoices (o el valor tal cual; None se conserva)."""
    return None if x is None else str(getattr(x, 'value', x))


def _normalize(t):
    """Una entrada de TRANSITIONS → tupla comparable con SNAPSHOT_TRANSITIONS."""
    return (
        _value(t['flow']),
        _value(t['from_status']),
        _value(t['action']),
        _value(t['required_role']),
        _value(t['to_status']),
        _value(t['to_status_reject']),
        bool(t.get('system_action', False)),
        t.get('handler'),
        bool(t.get('conditional', False)),
    )


def _describe(entry):
    flow, frm, action, role, to, to_reject, system, handler, conditional = entry
    extras = []
    if system:
        extras.append('automática')
    if conditional:
        extras.append('condicional')
    if handler:
        extras.append(f'handler={handler}')
    if to_reject is not None:
        extras.append(f'rechazo→{to_reject}')
    suffix = f' [{", ".join(extras)}]' if extras else ''
    return f'{flow} | {frm} --{action}--> {to} (rol: {role}){suffix}'


def _assert_transitions_match_snapshot(table, expected=SNAPSHOT_TRANSITIONS):
    actual = [_normalize(t) for t in table]
    if actual == list(expected):
        return

    def key(e):
        return (e[0], e[1], e[2])

    missing = [e for e in expected if e not in actual]
    extra = [a for a in actual if a not in expected]
    lines = []

    # Misma clave (flujo, desde, acción) pero distinto contenido → "modificada".
    missing_by_key = {key(e): e for e in missing}
    for a in list(extra):
        if key(a) in missing_by_key:
            old = missing_by_key.pop(key(a))
            extra.remove(a)
            missing.remove(old)
            lines.append(f'MODIFICADA: antes  {_describe(old)}')
            lines.append(f'            ahora  {_describe(a)}')
    lines.extend(f'QUITADA:   {_describe(e)}' for e in missing)
    lines.extend(f'AGREGADA:  {_describe(a)}' for a in extra)
    if not lines:
        # Mismas entradas, otro orden (o una entrada repetida).
        lines.append('Las transiciones son las mismas pero cambió su ORDEN o hay entradas repetidas '
                     '(el motor devuelve la primera coincidencia).')
    _fail(
        f'TRANSITIONS ya no coincide con el snapshot aprobado '
        f'(snapshot: {len(expected)} entradas, código: {len(actual)}):',
        lines,
    )


def _assert_values_match(label, actual_values, expected):
    actual = {_value(v) for v in actual_values}
    if actual == set(expected):
        return
    lines = []
    lines.extend(f'QUITADO:  {v}' for v in sorted(set(expected) - actual))
    lines.extend(f'AGREGADO: {v}' for v in sorted(actual - set(expected)))
    _fail(f'{label} ya no coincide con el snapshot aprobado '
          f'(snapshot: {len(expected)} valores, código: {len(actual)}):', lines)


def _terminal_statuses_in_code():
    """Estados que `Request.is_terminal` considera terminales, probando cada estado literal."""
    return {s for s in SNAPSHOT_RQ_STATUSES if Request(status=s).is_terminal}


def _engine(flow, status):
    """Motor sobre un Request SIN guardar: `_find_transition` solo lee flow/status."""
    return WorkflowEngine(Request(flow=flow, status=status), user=None, acting_role='')


# ──────────────────────────────────────────────────────────────────────────────
# 1. TRANSITIONS
# ──────────────────────────────────────────────────────────────────────────────

class TestTransitionsSnapshot:
    def test_any_sentinel_unchanged(self):
        assert ANY == SNAPSHOT_ANY, (
            f'{_HEADER}\nEl centinela "cualquier flujo" cambió de {SNAPSHOT_ANY!r} a {ANY!r}.\n{_FOOTER}'
        )

    def test_transitions_match_snapshot(self):
        _assert_transitions_match_snapshot(TRANSITIONS)

    def test_snapshot_has_71_entries(self):
        # Doble candado: si alguien edita el snapshot para "acomodar" un cambio, este
        # número obliga a dejar rastro explícito en el diff del PR.
        assert len(SNAPSHOT_TRANSITIONS) == 71

    def test_snapshot_is_self_consistent(self):
        keys = [(e[0], e[1], e[2]) for e in SNAPSHOT_TRANSITIONS]
        duplicated = sorted({k for k in keys if keys.count(k) > 1})
        assert not duplicated, f'Entradas duplicadas (flujo, desde, acción) en el snapshot: {duplicated}'
        for entry in SNAPSHOT_TRANSITIONS:
            assert len(entry) == 9, f'Entrada mal formada en el snapshot: {entry}'

    def test_transition_dicts_only_use_known_keys(self):
        allowed = _REQUIRED_KEYS | _OPTIONAL_KEYS
        problems = []
        for t in TRANSITIONS:
            keys = set(t)
            if keys - allowed:
                problems.append(f'{_describe(_normalize(t))}: claves nuevas {sorted(keys - allowed)}')
            if _REQUIRED_KEYS - keys:
                problems.append(f'{_describe(_normalize(t))}: faltan claves {sorted(_REQUIRED_KEYS - keys)}')
        if problems:
            _fail('Las entradas de TRANSITIONS usan una estructura distinta a la aprobada:', problems)

    def test_every_value_used_by_transitions_exists_in_enums(self):
        problems = []
        for t in TRANSITIONS:
            n = _normalize(t)
            where = _describe(n)
            if n[0] not in SNAPSHOT_FLOWS | {SNAPSHOT_ANY}:
                problems.append(f'{where}: flujo desconocido {n[0]!r}')
            for status in (n[1], n[4], n[5]):
                if status is not None and status not in SNAPSHOT_RQ_STATUSES:
                    problems.append(f'{where}: estado desconocido {status!r}')
            if n[2] not in SNAPSHOT_APPROVAL_ACTIONS:
                problems.append(f'{where}: acción desconocida {n[2]!r}')
            if n[3] is not None and n[3] not in SNAPSHOT_ROLES:
                problems.append(f'{where}: rol desconocido {n[3]!r}')
            if n[7] is not None and not callable(getattr(WorkflowEngine, n[7], None)):
                problems.append(f'{where}: el handler {n[7]!r} no existe en WorkflowEngine')
        if problems:
            _fail('TRANSITIONS referencia valores que no existen:', problems)

    def test_no_transition_leaves_a_terminal_status(self):
        offenders = [
            _describe(_normalize(t)) for t in TRANSITIONS
            if _value(t['from_status']) in SNAPSHOT_TERMINAL_STATUSES
        ]
        assert not offenders, (
            f'{_HEADER}\nSalen transiciones desde un estado terminal:\n  - ' + '\n  - '.join(offenders)
        )


class TestSnapshotDetectsChanges:
    """Prueba el propio guardia: una tabla alterada DEBE hacer fallar el snapshot."""

    def _mutated(self):
        return copy.deepcopy(TRANSITIONS)

    def test_unmodified_table_passes(self):
        _assert_transitions_match_snapshot(self._mutated())

    def test_changed_required_role_is_detected(self):
        table = self._mutated()
        table[1]['required_role'] = RoleChoices.GENERAL_MANAGER
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_transitions_match_snapshot(table)
        assert 'MODIFICADA' in str(exc.value)
        assert 'PROJECT_RESIDENT' in str(exc.value)

    def test_changed_target_status_is_detected(self):
        table = self._mutated()
        idx = next(i for i, t in enumerate(table)
                   if t['flow'] == RQFlowChoices.ADMINISTRATIVE
                   and t['from_status'] == RQStatusChoices.IN_STOCK)
        table[idx]['to_status'] = RQStatusChoices.DISPATCHED_TO_SITE  # ADM deja de ir directo a DELIVERED
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_transitions_match_snapshot(table)
        assert 'MODIFICADA' in str(exc.value)

    def test_removed_transition_is_detected(self):
        table = self._mutated()
        removed = table.pop(10)
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_transitions_match_snapshot(table)
        assert 'QUITADA' in str(exc.value)
        assert str(removed['action'].value) in str(exc.value)

    def test_added_transition_is_detected(self):
        table = self._mutated()
        table.append({
            'flow': RQFlowChoices.OPERATIONS,
            'from_status': RQStatusChoices.DELIVERED,
            'action': ApprovalActionChoices.CLOSED,
            'required_role': RoleChoices.REQUESTER,
            'to_status': RQStatusChoices.CLOSED,
            'to_status_reject': None,
        })
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_transitions_match_snapshot(table)
        assert 'AGREGADA' in str(exc.value)

    def test_reordered_transitions_are_detected(self):
        table = self._mutated()
        table[1], table[2] = table[2], table[1]
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_transitions_match_snapshot(table)
        assert 'ORDEN' in str(exc.value)

    def test_changed_handler_or_system_flag_is_detected(self):
        table = self._mutated()
        idx = next(i for i, t in enumerate(table) if t.get('handler') == 'handle_stock_check')
        table[idx]['handler'] = 'handle_quote_to_po'
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY'):
            _assert_transitions_match_snapshot(table)

        table = self._mutated()
        idx = next(i for i, t in enumerate(table) if t.get('system_action'))
        table[idx]['system_action'] = False
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY'):
            _assert_transitions_match_snapshot(table)


# ──────────────────────────────────────────────────────────────────────────────
# 2. Enums
# ──────────────────────────────────────────────────────────────────────────────

class TestEnumSnapshots:
    def test_rq_status_values_match_snapshot(self):
        _assert_values_match('RQStatusChoices', RQStatusChoices.values, SNAPSHOT_RQ_STATUSES)

    def test_approval_action_values_match_snapshot(self):
        _assert_values_match('ApprovalActionChoices', ApprovalActionChoices.values, SNAPSHOT_APPROVAL_ACTIONS)

    def test_role_values_match_snapshot(self):
        _assert_values_match('RoleChoices', RoleChoices.values, SNAPSHOT_ROLES)

    def test_flow_values_match_snapshot(self):
        _assert_values_match('RQFlowChoices', RQFlowChoices.values, SNAPSHOT_FLOWS)

    def test_enum_snapshot_sizes(self):
        assert (len(SNAPSHOT_RQ_STATUSES), len(SNAPSHOT_APPROVAL_ACTIONS),
                len(SNAPSHOT_ROLES), len(SNAPSHOT_FLOWS)) == (47, 37, 13, 2)

    def test_added_or_removed_value_is_detected(self):
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_values_match('RQStatusChoices', list(RQStatusChoices.values) + ['NEW_STATE'],
                                 SNAPSHOT_RQ_STATUSES)
        assert 'AGREGADO: NEW_STATE' in str(exc.value)

        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            _assert_values_match('RoleChoices', [r for r in RoleChoices.values if r != 'SITE_WAREHOUSE'],
                                 SNAPSHOT_ROLES)
        assert 'QUITADO:  SITE_WAREHOUSE' in str(exc.value)


# ──────────────────────────────────────────────────────────────────────────────
# 3. Request.is_terminal
# ──────────────────────────────────────────────────────────────────────────────

class TestTerminalStatusesSnapshot:
    def test_terminal_set_matches_snapshot(self):
        actual = _terminal_statuses_in_code()
        if actual != SNAPSHOT_TERMINAL_STATUSES:
            lines = [f'QUITADO:  {s}' for s in sorted(SNAPSHOT_TERMINAL_STATUSES - actual)]
            lines += [f'AGREGADO: {s}' for s in sorted(actual - SNAPSHOT_TERMINAL_STATUSES)]
            _fail('Request.is_terminal ya no coincide con el snapshot aprobado:', lines)

    def test_quality_rejected_is_not_terminal(self):
        # Pertenece al ciclo de reclamo al proveedor y debe poder re-entrar a QC.
        assert not Request(status=RQStatusChoices.QUALITY_REJECTED).is_terminal

    def test_changed_is_terminal_is_detected(self, monkeypatch):
        monkeypatch.setattr(Request, 'is_terminal', property(lambda self: False))
        with pytest.raises(AssertionError, match='DO-NOT-MODIFY') as exc:
            self.test_terminal_set_matches_snapshot()
        assert 'QUITADO:  CLOSED' in str(exc.value)


# ──────────────────────────────────────────────────────────────────────────────
# 4. Resolución real del motor (capa adicional al snapshot de la tabla)
# ──────────────────────────────────────────────────────────────────────────────

class TestEngineResolvesSnapshot:
    def test_find_transition_resolves_every_snapshot_entry_to_itself(self):
        """
        Para cada entrada del snapshot, `_find_transition` desde (flujo, estado) con esa acción
        devuelve exactamente esa entrada: ninguna queda tapada por otra anterior en la lista.
        """
        all_statuses = sorted(SNAPSHOT_RQ_STATUSES)
        problems = []
        for entry in SNAPSHOT_TRANSITIONS:
            flow, frm, action = entry[0], entry[1], entry[2]
            flows = sorted(SNAPSHOT_FLOWS) if flow == SNAPSHOT_ANY else [flow]
            statuses = all_statuses if frm is None else [frm]
            for fl in flows:
                for st in statuses:
                    found = _engine(fl, st)._find_transition(action)
                    got = _normalize(found) if found else None
                    if got != entry:
                        problems.append(
                            f'({fl}, {st}, {action}): esperado {_describe(entry)} · '
                            f'obtenido {_describe(got) if got else "ninguna transición"}'
                        )
        if problems:
            _fail('El motor no resuelve las transiciones del snapshot:', problems[:20])

    def test_cancellation_is_reachable_from_every_non_terminal_status_in_both_flows(self):
        problems = []
        for flow in sorted(SNAPSHOT_FLOWS):
            for status in sorted(SNAPSHOT_RQ_STATUSES - SNAPSHOT_TERMINAL_STATUSES):
                found = _engine(flow, status)._find_transition('CANCELLED')
                if found is None or _value(found['to_status']) != 'CANCELLED':
                    problems.append(f'{flow} | {status}: CANCELLED no es alcanzable')
        if problems:
            _fail('Regla universal rota: CANCELLED debe alcanzarse desde todo estado no terminal:', problems)

    def test_actions_are_not_resolved_in_the_other_flow(self):
        # Las acciones exclusivas de un flujo no deben resolverse en el otro.
        ops_only = [('SUBMITTED', 'TECHNICAL_APPROVED'), ('TECHNICAL_APPROVED', 'BUDGET_CLASSIFIED'),
                    ('SUPPLIER_CLAIM_SENT', 'SUPPLIER_CLAIM_UPDATED')]
        adm_only = [('SUBMITTED', 'SUPERVISOR_APPROVED'), ('SUPERVISOR_APPROVED', 'ADMIN_BUDGET_REVIEWED'),
                    ('DELIVERED', 'WAREHOUSE_RECORDS_UPDATED')]
        problems = []
        for st, action in ops_only:
            if _engine('ADMINISTRATIVE', st)._find_transition(action) is not None:
                problems.append(f'{action} desde {st} no debería existir en ADMINISTRATIVE')
        for st, action in adm_only:
            if _engine('OPERATIONS', st)._find_transition(action) is not None:
                problems.append(f'{action} desde {st} no debería existir en OPERATIONS')
        if problems:
            _fail('OPS y ADM dejaron de ser distintos:', problems)

    def test_in_stock_dispatch_differs_between_flows(self):
        ops = _engine('OPERATIONS', 'IN_STOCK')._find_transition('DISPATCHED')
        adm = _engine('ADMINISTRATIVE', 'IN_STOCK')._find_transition('DISPATCHED')
        assert (_value(ops['required_role']), _value(ops['to_status'])) == ('CENTRAL_WAREHOUSE', 'DISPATCHED_TO_SITE')
        assert (_value(adm['required_role']), _value(adm['to_status'])) == ('CENTRAL_WAREHOUSE', 'DELIVERED')
