"""
SLA (Service Level Agreement) calculator.
Computes fecha_estimada_entrega based on acquisition type and validation date.
"""

from datetime import date, timedelta
from apps.core.enums import AcquisitionTypeChoices


# Default SLA configuration (days from validation to expected delivery)
# These are the midpoint values; the DB-stored config is the authoritative source.
SLA_DEFAULTS: dict[str, dict] = {
    AcquisitionTypeChoices.COMPRA_LOCAL: {
        'min_days': 1,
        'max_days': 3,
    },
    AcquisitionTypeChoices.COMPRA_FORANEA: {
        'min_days': 5,
        'max_days': 7,
    },
    AcquisitionTypeChoices.IMPORTACION: {
        'min_days': 14,
        'max_days': 56,  # 2-8 weeks
    },
    AcquisitionTypeChoices.FABRICACION: {
        'min_days': 7,
        'max_days': 15,
        'max_extended_days': 22,  # +7 extension
    },
    AcquisitionTypeChoices.ALQUILER: {
        'min_days': 3,
        'max_days': 15,
    },
    AcquisitionTypeChoices.CALIBRACION: {
        'min_days': 7,
        'max_days': 10,
    },
}


class SLACalculator:
    """
    Calculates estimated delivery dates based on acquisition type.
    Uses the AcquisitionTypeConfig table if available, falls back to defaults.
    """

    @classmethod
    def calculate_estimated_delivery(
        cls,
        acquisition_type: str,
        from_date: date | None = None,
        use_max: bool = False,
    ) -> date:
        """
        Calculate the estimated delivery date.

        Args:
            acquisition_type: One of AcquisitionTypeChoices values.
            from_date: Base date (defaults to today). Typically the validation date.
            use_max: If True, use max_days; otherwise use the midpoint.

        Returns:
            Estimated delivery date.
        """
        if from_date is None:
            from_date = date.today()

        config = cls._get_config(acquisition_type)

        if use_max:
            days = config['max_days']
        else:
            # Use midpoint (ceil of average)
            days = (config['min_days'] + config['max_days'] + 1) // 2

        return from_date + timedelta(days=days)

    @classmethod
    def get_sla_days(cls, acquisition_type: str) -> dict:
        """Return the min/max/extended days for an acquisition type."""
        return cls._get_config(acquisition_type)

    @classmethod
    def _get_config(cls, acquisition_type: str) -> dict:
        """
        Try to load config from DB first, fall back to hardcoded defaults.
        """
        try:
            from apps.rq.models import AcquisitionTypeConfig
            db_config = AcquisitionTypeConfig.objects.filter(type=acquisition_type).first()
            if db_config:
                return {
                    'min_days': db_config.min_days,
                    'max_days': db_config.max_days,
                    'max_extended_days': db_config.max_extended_days,
                }
        except Exception:
            pass

        return SLA_DEFAULTS.get(acquisition_type, {'min_days': 7, 'max_days': 14})
