"""
SYSPCC-030 · reglas puras del seguimiento por ítem (`services/item_tracking.py`).

Sin base de datos salvo el cruce de la etapa contra `RQStatusChoices`. Cada regla del diseño
tiene su caso: prioridad del estado, seguimiento, faltante, fecha atendida, alertas y % de
atención del RQ.
"""
import datetime
from decimal import Decimal

import pytest

from apps.core.enums import RQStatusChoices
from apps.rq.services import item_tracking as rules
from apps.rq.services.item_tracking import (
    Alert, ItemFacts, ItemStatus, Tracking, classify_item, summarize_progress,
)

D = Decimal
DAY = datetime.date(2026, 10, 20)
LATER = datetime.date(2026, 10, 25)

TERMINAL_VOIDED = [
    'CANCELLED', 'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED', 'GM_REJECTED', 'COST_OVERRUN_REJECTED',
]


def facts(**kw):
    base = dict(
        quantity=D('10'), net_dispatched=D('0'), dispatch_rows=0, has_confirmed_link=True,
        is_off_catalog=False, override='', request_status='IN_STOCK',
    )
    base.update(kw)
    return ItemFacts(**base)


# ═════════════════════════ estado de un ítem vinculado ═════════════════════════

class TestLinkedItemStatus:
    @pytest.mark.parametrize('net, status', [
        ('0', ItemStatus.PENDING),
        ('3', ItemStatus.PARTIAL),
        ('9.999', ItemStatus.PARTIAL),
        ('10', ItemStatus.ATTENDED),
        ('12', ItemStatus.ATTENDED),      # entregó de más: sigue ATENDIDO
    ])
    def test_status_follows_the_net_delivered_quantity(self, net, status):
        result = classify_item(facts(net_dispatched=D(net), dispatch_rows=1 if net != '0' else 0))
        assert result.status == status
        assert result.tracking == Tracking.LINKED

    def test_attended_quantity_is_the_net_delivered_and_missing_the_rest(self):
        result = classify_item(facts(net_dispatched=D('4'), dispatch_rows=1))
        assert (result.attended, result.missing) == (D('4'), D('6'))

    def test_missing_is_never_negative(self):
        assert classify_item(facts(net_dispatched=D('12'), dispatch_rows=1)).missing == D('0')

    def test_reversals_below_zero_do_not_make_a_negative_attended_quantity(self):
        result = classify_item(facts(net_dispatched=D('-2'), dispatch_rows=2))
        assert result.attended == D('0')
        assert result.status == ItemStatus.PENDING

    def test_a_line_with_dispatch_rows_counts_as_linked_even_without_a_confirmed_link(self):
        # Registros históricos: el despacho existe aunque el vínculo no se confirmó.
        result = classify_item(facts(has_confirmed_link=False, net_dispatched=D('5'), dispatch_rows=1))
        assert result.tracking == Tracking.LINKED
        assert result.status == ItemStatus.PARTIAL

    def test_attended_date_is_the_last_delivery_only_when_attended(self):
        done = classify_item(facts(net_dispatched=D('10'), dispatch_rows=2, last_delivery_on=LATER))
        partial = classify_item(facts(net_dispatched=D('4'), dispatch_rows=1, last_delivery_on=LATER))
        assert done.attended_on == LATER
        assert partial.attended_on is None

    def test_a_fully_reversed_line_goes_back_to_pending_without_date(self):
        result = classify_item(facts(net_dispatched=D('0'), dispatch_rows=2, last_delivery_on=None))
        assert (result.status, result.attended_on) == (ItemStatus.PENDING, None)

    def test_zero_quantity_never_reads_as_attended(self):
        assert classify_item(facts(quantity=D('0'))).status == ItemStatus.PENDING


class TestUnlinkedAndProposedLinks:
    def test_no_link_and_no_off_catalog_is_unlinked_and_does_not_count(self):
        result = classify_item(facts(has_confirmed_link=False))
        assert result.tracking == Tracking.UNLINKED
        assert result.status == ItemStatus.UNLINKED
        assert result.progress is None
        assert result.missing is None

    def test_a_proposed_but_unconfirmed_link_is_still_unlinked(self):
        # `has_confirmed_link` es False hasta que Logística confirma: el stock no se mueve.
        assert classify_item(facts(has_confirmed_link=False)).status == ItemStatus.UNLINKED

    def test_unlinked_is_never_attended_by_the_request_status(self):
        result = classify_item(facts(has_confirmed_link=False, request_status='CLOSED'))
        assert result.status == ItemStatus.UNLINKED


class TestOffCatalog:
    def test_pending_before_the_request_is_delivered(self):
        result = classify_item(facts(has_confirmed_link=False, is_off_catalog=True,
                                     request_status='PO_GENERATED'))
        assert result.tracking == Tracking.OFF_CATALOG
        assert result.status == ItemStatus.PENDING
        assert (result.attended, result.missing) == (D('0'), D('10'))

    @pytest.mark.parametrize('status', [
        'DELIVERED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'CLOSED', 'CLAIM_IN_REVIEW',
    ])
    def test_attended_by_flow_once_the_request_passed_delivered(self, status):
        result = classify_item(facts(has_confirmed_link=False, is_off_catalog=True,
                                     request_status=status, delivered_on=DAY))
        assert result.status == ItemStatus.ATTENDED
        assert result.attended_by_flow is True
        assert (result.attended, result.missing) == (D('10'), D('0'))
        assert result.attended_on == DAY

    def test_a_claim_cycle_after_delivery_keeps_it_attended(self):
        # DELIVERED → CLAIM_IN_REVIEW → SUPPLIER_CLAIM_SENT: ya pasó por DELIVERED.
        result = classify_item(facts(has_confirmed_link=False, is_off_catalog=True,
                                     request_status='SUPPLIER_CLAIM_SENT', delivered_on=DAY))
        assert result.status == ItemStatus.ATTENDED

    def test_dispatched_to_site_is_not_yet_delivered(self):
        result = classify_item(facts(has_confirmed_link=False, is_off_catalog=True,
                                     request_status='DISPATCHED_TO_SITE'))
        assert result.status == ItemStatus.PENDING

    def test_off_catalog_never_raises_the_unlinked_alert(self):
        result = classify_item(facts(has_confirmed_link=False, is_off_catalog=True,
                                     request_status='PO_GENERATED'))
        assert Alert.UNLINKED not in result.alerts


# ═════════════════════════ prioridad de las reglas de estado ═════════════════════════

class TestStatusPriority:
    def test_discarded_beats_everything_even_a_voided_request(self):
        result = classify_item(facts(override='DESESTIMADO', request_status='CANCELLED',
                                     net_dispatched=D('10'), dispatch_rows=1))
        assert result.status == ItemStatus.DISCARDED
        assert result.missing == D('0')
        assert result.progress is None

    @pytest.mark.parametrize('status', TERMINAL_VOIDED)
    def test_voided_for_every_terminal_status_but_closed(self, status):
        result = classify_item(facts(request_status=status))
        assert result.status == ItemStatus.VOIDED
        assert result.missing == D('0')
        assert result.progress is None

    def test_closed_is_not_voided(self):
        result = classify_item(facts(request_status='CLOSED', net_dispatched=D('10'), dispatch_rows=1))
        assert result.status == ItemStatus.ATTENDED

    def test_voided_beats_stand_by(self):
        assert classify_item(facts(override='STAND_BY', request_status='CANCELLED')).status == ItemStatus.VOIDED

    def test_stand_by_while_attended_is_below_requested(self):
        result = classify_item(facts(override='STAND_BY', net_dispatched=D('4'), dispatch_rows=1))
        assert result.status == ItemStatus.STAND_BY
        assert result.missing == D('6')
        assert result.progress == D('0.4')          # cuenta, con su avance real

    def test_stand_by_with_nothing_delivered(self):
        assert classify_item(facts(override='STAND_BY')).status == ItemStatus.STAND_BY

    def test_stand_by_is_overridden_by_a_complete_delivery(self):
        result = classify_item(facts(override='STAND_BY', net_dispatched=D('10'), dispatch_rows=1))
        assert result.status == ItemStatus.ATTENDED

    def test_stand_by_applies_to_unlinked_and_off_catalog_lines_too(self):
        assert classify_item(facts(override='STAND_BY', has_confirmed_link=False)).status == ItemStatus.STAND_BY
        off = classify_item(facts(override='STAND_BY', has_confirmed_link=False, is_off_catalog=True))
        assert off.status == ItemStatus.STAND_BY


def test_voided_is_decided_by_is_terminal_and_not_by_the_name_suffix():
    """Todos los estados: ANULADO exactamente cuando Request.is_terminal y no es CLOSED."""
    from apps.rq.models import Request

    for status in RQStatusChoices.values:
        expected = Request(status=status).is_terminal and status != 'CLOSED'
        assert rules.is_voided_status(status) is expected, status
    assert {s for s in RQStatusChoices.values if rules.is_voided_status(s)} == set(TERMINAL_VOIDED)


# ═════════════════════════════════ alertas ═════════════════════════════════

class TestAlerts:
    def test_unlinked_alert_only_from_the_logistics_phase_on(self):
        early = classify_item(facts(has_confirmed_link=False, request_status='SUBMITTED'))
        validated = classify_item(facts(has_confirmed_link=False, request_status='VALIDATED'))
        assert Alert.UNLINKED not in early.alerts
        assert Alert.UNLINKED in validated.alerts

    def test_unlinked_alert_not_for_voided_or_discarded_lines(self):
        assert classify_item(facts(has_confirmed_link=False, request_status='CANCELLED')).alerts == ()
        assert classify_item(facts(has_confirmed_link=False, override='DESESTIMADO',
                                   request_status='VALIDATED')).alerts == ()

    @pytest.mark.parametrize('status', [
        'DISPATCHED_TO_SITE', 'DELIVERED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'CLOSED',
    ])
    def test_delivered_without_discount_when_dispatched_but_not_fully_out(self, status):
        result = classify_item(facts(request_status=status, net_dispatched=D('4'), dispatch_rows=1))
        assert Alert.DELIVERED_WITHOUT_DISCOUNT in result.alerts

    def test_delivered_without_discount_when_the_request_went_through_delivered_in_a_claim_cycle(self):
        result = classify_item(facts(request_status='SUPPLIER_CLAIM_SENT', delivered_on=DAY))
        assert Alert.DELIVERED_WITHOUT_DISCOUNT in result.alerts

    def test_no_delivery_alert_before_dispatch_or_when_fully_attended(self):
        assert classify_item(facts(request_status='IN_STOCK')).alerts == ()
        full = classify_item(facts(request_status='DELIVERED', net_dispatched=D('10'), dispatch_rows=1))
        assert full.alerts == ()

    def test_no_delivery_alert_with_an_override_off_catalog_or_unlinked(self):
        assert classify_item(facts(request_status='DELIVERED', override='STAND_BY')).alerts == ()
        off = classify_item(facts(request_status='DELIVERED', has_confirmed_link=False, is_off_catalog=True))
        assert Alert.DELIVERED_WITHOUT_DISCOUNT not in off.alerts

    def test_with_movements_on_a_voided_line_that_has_stock_out(self):
        result = classify_item(facts(request_status='CANCELLED', net_dispatched=D('3'), dispatch_rows=1))
        assert result.status == ItemStatus.VOIDED
        assert result.alerts == (Alert.WITH_MOVEMENTS,)

    def test_voided_line_without_movements_has_no_alert(self):
        assert classify_item(facts(request_status='CANCELLED')).alerts == ()

    def test_discrepancy_flag_is_an_alert(self):
        assert Alert.DISCREPANCY in classify_item(facts(has_discrepancy=True)).alerts

    def test_alerts_never_change_the_status(self):
        with_alert = classify_item(facts(request_status='DELIVERED', net_dispatched=D('4'), dispatch_rows=1))
        assert with_alert.status == ItemStatus.PARTIAL


# ═════════════════════════════ % de atención del RQ ═════════════════════════════

def _t(**kw):
    return classify_item(facts(**kw))


class TestRQProgress:
    def test_average_of_the_item_progress(self):
        progress = summarize_progress([
            _t(net_dispatched=D('10'), dispatch_rows=1),      # 1.0
            _t(net_dispatched=D('5'), dispatch_rows=1),       # 0.5
            _t(),                                             # 0.0
        ])
        assert progress.percent == 50.0
        assert (progress.items_total, progress.items_counted) == (3, 3)
        assert (progress.items_attended, progress.items_partial, progress.items_pending) == (1, 1, 1)

    def test_progress_is_capped_at_one_per_item(self):
        progress = summarize_progress([
            _t(net_dispatched=D('30'), dispatch_rows=1),      # 3.0 → 1.0
            _t(),                                             # 0.0
        ])
        assert progress.percent == 50.0

    def test_discarded_voided_and_unlinked_do_not_count(self):
        progress = summarize_progress([
            _t(net_dispatched=D('10'), dispatch_rows=1),
            _t(override='DESESTIMADO'),
            _t(has_confirmed_link=False),
        ])
        assert progress.percent == 100.0
        assert (progress.items_total, progress.items_counted) == (3, 1)
        assert (progress.items_discarded, progress.items_unlinked) == (1, 1)

    def test_voided_request_has_no_percent(self):
        progress = summarize_progress([_t(request_status='CANCELLED'), _t(request_status='CANCELLED')])
        assert progress.percent is None
        assert (progress.items_voided, progress.items_counted) == (2, 0)

    def test_stand_by_counts_as_pending_with_its_real_progress(self):
        progress = summarize_progress([_t(override='STAND_BY'), _t(net_dispatched=D('10'), dispatch_rows=1)])
        assert progress.percent == 50.0
        assert progress.items_stand_by == 1

    def test_off_catalog_counts_one_when_attended_zero_otherwise(self):
        done = _t(has_confirmed_link=False, is_off_catalog=True, request_status='DELIVERED')
        waiting = _t(has_confirmed_link=False, is_off_catalog=True, request_status='PO_GENERATED')
        assert summarize_progress([done]).percent == 100.0
        assert summarize_progress([waiting]).percent == 0.0

    def test_percent_has_one_decimal_rounded_half_up(self):
        thirds = summarize_progress([_t(net_dispatched=D('1'), dispatch_rows=1)])        # 0.1
        assert thirds.percent == 10.0
        mixed = summarize_progress([
            _t(net_dispatched=D('10'), dispatch_rows=1), _t(), _t(),
        ])
        assert mixed.percent == 33.3

    def test_no_items_means_no_percent(self):
        progress = summarize_progress([])
        assert progress.percent is None
        assert progress.items_total == 0

    def test_counts_are_reconcilable(self):
        progress = summarize_progress([
            _t(net_dispatched=D('10'), dispatch_rows=1), _t(net_dispatched=D('2'), dispatch_rows=1),
            _t(), _t(override='STAND_BY'), _t(has_confirmed_link=False), _t(override='DESESTIMADO'),
            _t(request_status='CANCELLED'),
        ])
        assert progress.items_total == 7 == sum([
            progress.items_attended, progress.items_partial, progress.items_pending,
            progress.items_stand_by, progress.items_unlinked, progress.items_discarded,
            progress.items_voided,
        ])


# ═════════════════════════ etapa y fase de cada estado ═════════════════════════

class TestStages:
    def test_every_request_status_has_a_stage(self):
        assert len(RQStatusChoices.values) == 47
        missing = [s for s in RQStatusChoices.values if s not in rules.STATUS_STAGE]
        assert missing == []

    def test_no_status_is_listed_in_two_stages(self):
        seen = {}
        for code, _label, statuses in rules._STAGE_TABLE:
            for status in statuses:
                assert status not in seen, f'{status} en {seen[status]} y {code}'
                seen[status] = code

    def test_the_stage_table_has_no_unknown_status(self):
        listed = {s for _c, _l, statuses in rules._STAGE_TABLE for s in statuses}
        assert listed <= set(RQStatusChoices.values)

    def test_stages_have_readable_spanish_labels(self):
        for stage in rules.STAGES:
            assert stage.label and stage.label[0].isupper(), stage

    def test_stage_filter_expands_to_its_statuses_and_unknown_code_to_none(self):
        assert set(rules.statuses_of_stage('POR_ENTREGAR')) == {'IN_STOCK', 'QUALITY_APPROVED'}
        assert rules.statuses_of_stage('NO_EXISTE') == ()

    def test_every_status_has_a_phase_but_cancelled(self):
        assert [s for s in RQStatusChoices.values if rules.phase_of(s) is None] == ['CANCELLED']
        assert {rules.phase_of(s) for s in RQStatusChoices.values if s != 'CANCELLED'} == {1, 2, 3, 4, 5}

    def test_an_unknown_status_never_breaks_the_master(self):
        assert rules.stage_of('LEGACY_STATE').code == 'DESCONOCIDA'
        assert rules.phase_of('LEGACY_STATE') is None

    @pytest.mark.parametrize('status, stage', [
        ('SUBMITTED', 'EN_VALIDACION'), ('GM_REVIEW', 'REVISION_GERENCIA'),
        ('VALIDATED', 'VERIFICACION_STOCK'), ('IN_STOCK', 'POR_ENTREGAR'),
        ('PO_GENERATED', 'ORDEN_COMPRA'), ('QUALITY_REJECTED', 'RECLAMO_PROVEEDOR'),
        ('DISPATCHED_TO_SITE', 'DESPACHADO'), ('DELIVERED', 'ENTREGADO'),
        ('CLAIM_IN_REVIEW', 'RECLAMO_USUARIO'), ('CLOSED', 'CERRADO'), ('CANCELLED', 'CANCELADO'),
    ])
    def test_representative_mappings(self, status, stage):
        assert rules.stage_of(status).code == stage


class TestGMApproval:
    @pytest.mark.parametrize('latest, code, kind', [
        (None, 'NO_APLICA', ''),
        ('GM_REVIEW', 'PENDIENTE', 'GM_REVIEW'),
        ('GM_APPROVED', 'APROBADO', 'GM_REVIEW'),
        ('GM_REJECTED', 'RECHAZADO', 'GM_REVIEW'),
        ('COST_OVERRUN_REVIEW', 'PENDIENTE', 'COST_OVERRUN'),
        ('COST_OVERRUN_APPROVED', 'APROBADO', 'COST_OVERRUN'),
        ('COST_OVERRUN_REJECTED', 'RECHAZADO', 'COST_OVERRUN'),
        ('VALIDATED', 'NO_APLICA', ''),
    ])
    def test_decision_from_the_latest_approval_status(self, latest, code, kind):
        assert rules.gm_approval_from_status(latest) == (code, kind)
