"""
SYSPCC-009 fix #1: SLACalculator._get_config must not silently swallow
every exception with a bare `except Exception: pass`.

Expected behavior after the fix:
  - OperationalError/ProgrammingError (DB down, migration missing) -> logged
    as a warning (expected/recoverable), falls back to SLA_DEFAULTS.
  - Any other unexpected exception -> logged via logger.exception (with
    stack trace), still falls back to SLA_DEFAULTS instead of crashing the
    caller (calculate_estimated_delivery is on the RQ-creation critical path).

Note on caplog: `config/settings/base.py` sets `propagate=False` for the
'apps' logger namespace, so pytest's default caplog handler (attached to the
root logger) never sees records emitted by `apps.*` loggers. We attach
caplog's handler directly to the module logger instead of relying on
propagation to root.
"""
import contextlib
import logging
from unittest import mock

import pytest
from django.db import OperationalError, ProgrammingError

from apps.core.enums import AcquisitionTypeChoices
from apps.rq.services.sla_calculator import SLA_DEFAULTS, SLACalculator

MODULE_LOGGER_NAME = 'apps.rq.services.sla_calculator'


@contextlib.contextmanager
def _capture(caplog, level=logging.WARNING):
    logger = logging.getLogger(MODULE_LOGGER_NAME)
    previous_level = logger.level
    logger.setLevel(level)
    logger.addHandler(caplog.handler)
    try:
        yield
    finally:
        logger.removeHandler(caplog.handler)
        logger.setLevel(previous_level)


@pytest.mark.django_db
class TestSLACalculatorConfigErrorHandling:
    def test_operational_error_logs_warning_and_falls_back_to_defaults(self, caplog):
        expected = SLA_DEFAULTS[AcquisitionTypeChoices.COMPRA_LOCAL]

        with mock.patch(
            'apps.rq.models.AcquisitionTypeConfig.objects.filter',
            side_effect=OperationalError('connection refused'),
        ):
            with _capture(caplog):
                config = SLACalculator._get_config(AcquisitionTypeChoices.COMPRA_LOCAL)

        assert config == expected
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert any('sla_calculator.config_unavailable' in r.getMessage() for r in warnings)
        # No exception (stack trace) noise for an expected/recoverable error.
        assert not any(r.levelno >= logging.ERROR for r in caplog.records)

    def test_programming_error_logs_warning_and_falls_back_to_defaults(self, caplog):
        expected = SLA_DEFAULTS[AcquisitionTypeChoices.COMPRA_FORANEA]

        with mock.patch(
            'apps.rq.models.AcquisitionTypeConfig.objects.filter',
            side_effect=ProgrammingError('relation "rq_acquisitiontypeconfig" does not exist'),
        ):
            with _capture(caplog):
                config = SLACalculator._get_config(AcquisitionTypeChoices.COMPRA_FORANEA)

        assert config == expected
        assert any(
            'sla_calculator.config_unavailable' in r.getMessage() for r in caplog.records
        )

    def test_unexpected_error_logs_exception_and_falls_back_to_defaults(self, caplog):
        """Last-barrier branch: anything not OperationalError/ProgrammingError."""
        expected = SLA_DEFAULTS[AcquisitionTypeChoices.IMPORTACION]

        with mock.patch(
            'apps.rq.models.AcquisitionTypeConfig.objects.filter',
            side_effect=ValueError('unexpected'),
        ):
            with _capture(caplog):
                config = SLACalculator._get_config(AcquisitionTypeChoices.IMPORTACION)

        assert config == expected
        exc_records = [r for r in caplog.records if r.exc_info is not None]
        assert any('sla_calculator.config_lookup_failed' in r.getMessage() for r in exc_records)

    def test_no_error_still_falls_back_to_defaults_when_no_db_row(self):
        """Baseline: no exception, just no matching DB row -> defaults (unchanged behavior)."""
        expected = SLA_DEFAULTS[AcquisitionTypeChoices.ALQUILER]
        config = SLACalculator._get_config(AcquisitionTypeChoices.ALQUILER)
        assert config == expected

    def test_calculate_estimated_delivery_does_not_raise_when_db_unavailable(self):
        """End-to-end: the public API used at RQ-creation time must not crash."""
        with mock.patch(
            'apps.rq.models.AcquisitionTypeConfig.objects.filter',
            side_effect=OperationalError('connection refused'),
        ):
            result = SLACalculator.calculate_estimated_delivery(
                AcquisitionTypeChoices.COMPRA_LOCAL
            )
        assert result is not None
