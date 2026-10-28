"""Company data printed in contracts, read from settings (env). Not a model
yet: evolve to an editable singleton when there is more than one legal entity."""

from django.conf import settings


def get_company_context() -> dict:
    return {
        'name': settings.HR_COMPANY_NAME,
        'ruc': settings.HR_COMPANY_RUC,
        'address': settings.HR_COMPANY_ADDRESS,
        'legal_rep_name': settings.HR_COMPANY_LEGAL_REP_NAME,
        'legal_rep_dni': settings.HR_COMPANY_LEGAL_REP_DNI,
        'legal_rep_title': settings.HR_COMPANY_LEGAL_REP_TITLE,
        'legal_rep_powers': settings.HR_COMPANY_LEGAL_REP_POWERS,
    }


# company key -> (template variable, label, blocks emission when empty and used)
COMPANY_FIELDS = {
    'name': ('empresa_razon_social', 'razón social', True),
    'ruc': ('empresa_ruc', 'RUC', True),
    'address': ('empresa_domicilio', 'domicilio de la empresa', False),
    'legal_rep_name': ('representante_nombre', 'nombre del representante legal', True),
    'legal_rep_dni': ('representante_dni', 'DNI del representante legal', False),
    'legal_rep_title': ('representante_cargo', 'cargo del representante legal', False),
    'legal_rep_powers': ('representante_poderes', 'poderes del representante legal', False),
}

DEMO_TEMPLATE_MARKER = 'MODELO DEMO'


def is_demo_template(template) -> bool:
    return DEMO_TEMPLATE_MARKER in (template.name or '') or DEMO_TEMPLATE_MARKER in (template.notes or '')


def missing_company_data(template) -> list:
    """[(key, label, blocking)] of company values that are empty AND used by
    the template (a template with the company text typed in Word needs none)."""
    used = set(template.detected_variables or [])
    company = get_company_context()
    return [
        (key, label, blocking)
        for key, (variable, label, blocking) in COMPANY_FIELDS.items()
        if variable in used and not (company.get(key) or '').strip()
    ]
