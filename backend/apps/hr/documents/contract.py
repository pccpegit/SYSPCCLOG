"""Contract (CONTRACT) document type: schema, validation, prefill, context.

Naming rule: API / snapshot / serializer keys are English. The Jinja context
keys that RR. HH. writes in the Word template are SPANISH snake_case without
accents (decision of SYSPCC-022). The English -> Spanish mapping lives in ONE
place: `VARIABLES` below (each VariableSpec carries its `field`).

Everything derived (amount in words, long dates, term in months) is computed
here, never by the AI.
"""

import calendar
import re
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.hr.documents.formatters import (
    long_date_es,
    money_fmt,
    money_to_words_es,
    short_date_es,
)
from apps.hr.documents.registry import DocumentTypeSpec, FieldSpec, VariableSpec
from apps.hr.enums import ContractType, Currency, FixedTermModality, PaymentFrequency
from apps.hr.services.assistant_schemas import ContractExtraction

MARITAL_STATUS_CHOICES = (
    ('SOLTERO', 'Soltero/a'),
    ('CASADO', 'Casado/a'),
    ('DIVORCIADO', 'Divorciado/a'),
    ('VIUDO', 'Viudo/a'),
    ('CONVIVIENTE', 'Conviviente'),
)
_MARITAL_LABELS = dict(MARITAL_STATUS_CHOICES)

DEFAULT_NATIONALITY = 'Peruana'
DEFAULT_PROBATION_MONTHS = 3

_DNI_RE = re.compile(r'^\d{8}$')
_FOREIGN_ID_RE = re.compile(r'^[A-Za-z0-9]{9,12}$')


# ---------------------------------------------------------------- date utils

def today_lima() -> date:
    return timezone.localdate()


def term_months(start: date, end: date) -> int:
    """Whole months between start and end (end inclusive)."""
    end1 = end + timedelta(days=1)
    months = (end1.year - start.year) * 12 + (end1.month - start.month)
    if end1.day < start.day:
        months -= 1
    return max(months, 0)


def end_date_from_months(start: date, months: int) -> date:
    """start + N months - 1 day (contracts count the start day)."""
    total = start.month - 1 + months
    year, month = start.year + total // 12, total % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day) - timedelta(days=1)


# ------------------------------------------------------------- validation

class ContractDataSerializer(serializers.Serializer):
    worker_full_name = serializers.CharField(max_length=255)
    worker_dni = serializers.CharField(max_length=20)
    worker_nationality = serializers.CharField(max_length=60, required=False, allow_blank=True)
    worker_marital_status = serializers.ChoiceField(
        choices=[c[0] for c in MARITAL_STATUS_CHOICES], required=False, allow_blank=True
    )
    worker_birth_date = serializers.DateField(required=False, allow_null=True)
    worker_address = serializers.CharField(max_length=400)
    position = serializers.CharField(max_length=200)
    job_description = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    work_location = serializers.CharField(max_length=200)
    contract_type = serializers.ChoiceField(choices=ContractType.choices)
    fixed_term_modality = serializers.ChoiceField(
        choices=FixedTermModality.choices, required=False, allow_blank=True, allow_null=True
    )
    fixed_term_cause = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=2000
    )
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    gross_salary = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0.01'), coerce_to_string=False
    )
    currency = serializers.ChoiceField(choices=Currency.choices)
    payment_frequency = serializers.ChoiceField(choices=PaymentFrequency.choices)
    work_schedule = serializers.CharField(max_length=200)
    probation_months = serializers.IntegerField(min_value=0, max_value=12)
    issue_date = serializers.DateField()

    def validate_worker_dni(self, value):
        value = value.strip()
        if not (_DNI_RE.match(value) or _FOREIGN_ID_RE.match(value)):
            raise serializers.ValidationError(
                'Documento inválido: usa 8 dígitos (DNI) o 9 a 12 caracteres alfanuméricos (CE/pasaporte).'
            )
        return value

    def validate(self, attrs):
        errors = {}
        ctype = attrs.get('contract_type')
        start = attrs.get('start_date')
        end = attrs.get('end_date')
        partial = bool(self.partial)

        if ctype == ContractType.FIXED_TERM:
            if not partial:
                if not attrs.get('fixed_term_modality'):
                    errors['fixed_term_modality'] = ['La modalidad es obligatoria en contratos a plazo fijo.']
                if not (attrs.get('fixed_term_cause') or '').strip():
                    errors['fixed_term_cause'] = ['La causa objetiva es obligatoria en contratos a plazo fijo.']
                if not end:
                    errors['end_date'] = ['La fecha de fin es obligatoria en contratos a plazo fijo.']
        elif ctype == ContractType.INDEFINITE:
            if attrs.get('fixed_term_modality'):
                errors['fixed_term_modality'] = ['No aplica en contratos a plazo indeterminado.']
            if (attrs.get('fixed_term_cause') or '').strip():
                errors['fixed_term_cause'] = ['No aplica en contratos a plazo indeterminado.']
            if end:
                errors['end_date'] = ['No aplica en contratos a plazo indeterminado.']

        if start and end and 'end_date' not in errors and end <= start:
            errors['end_date'] = ['La fecha de fin debe ser posterior a la fecha de inicio.']

        birth = attrs.get('worker_birth_date')
        if birth and start:
            age = start.year - birth.year - ((start.month, start.day) < (birth.month, birth.day))
            if age < 18:
                errors['worker_birth_date'] = ['El trabajador debe ser mayor de edad a la fecha de inicio.']

        probation = attrs.get('probation_months')
        if (
            ctype == ContractType.FIXED_TERM and start and end and probation is not None
            and 'end_date' not in errors and probation > term_months(start, end)
        ):
            errors['probation_months'] = ['El período de prueba no puede exceder la duración del contrato.']

        if errors:
            raise serializers.ValidationError(errors)
        return attrs


def _jsonable(validated: dict) -> dict:
    out = {}
    for key, value in validated.items():
        if isinstance(value, date):
            out[key] = value.isoformat()
        elif isinstance(value, Decimal):
            out[key] = f'{value:.2f}'
        elif value is None:
            out[key] = None
        else:
            out[key] = value.strip() if isinstance(value, str) else value
    return out


def _apply_defaults(raw: dict) -> dict:
    data = {k: v for k, v in raw.items() if k != 'company'}
    if not (data.get('worker_nationality') or '').strip():
        data['worker_nationality'] = DEFAULT_NATIONALITY
    data.setdefault('currency', Currency.PEN)
    data.setdefault('payment_frequency', PaymentFrequency.MONTHLY)
    if data.get('probation_months') in (None, ''):
        data['probation_months'] = DEFAULT_PROBATION_MONTHS
    if not data.get('issue_date'):
        data['issue_date'] = today_lima().isoformat()
    # Empty strings from forms behave as "not provided" for optional typed fields
    for key in ('end_date', 'worker_birth_date', 'fixed_term_modality'):
        if data.get(key) == '':
            data[key] = None
    return data


def normalize_contract_data(raw: dict, *, partial: bool = False):
    """Validate + normalize contract data. Returns (clean_json_dict, warnings).

    Raises rest_framework ValidationError with `{field: [messages]}`.
    `partial=True` (assistant) skips required checks and defaults.
    """
    data = dict(raw) if partial else _apply_defaults(raw)
    ser = ContractDataSerializer(data=data, partial=partial)
    ser.is_valid(raise_exception=True)
    clean = _jsonable(ser.validated_data)
    return clean, contract_warnings(clean)


def contract_warnings(clean: dict) -> list:
    warnings = []
    try:
        salary = Decimal(str(clean.get('gross_salary')))
        minimum = Decimal(str(settings.HR_MIN_WAGE))
    except Exception:  # noqa: BLE001 - defensive: warnings must never break a response
        return warnings
    if clean.get('currency') == Currency.PEN and salary < minimum:
        warnings.append(
            f'El sueldo ({money_fmt(salary)}) es menor a la remuneración mínima vital '
            f'vigente ({money_fmt(minimum)}).'
        )
    return warnings


# --------------------------------------------------------------- prefill

def prefill_contract_from_personal(personal):
    """Non-sensitive-by-design prefill: no bank/CCI/AFP/children/sizes."""
    data, sources = {}, {}

    def put(key, value):
        if value not in (None, ''):
            data[key] = value
            sources[key] = 'personal'

    put('worker_full_name', personal.apellidos_nombres)
    put('worker_dni', personal.dni)
    put('worker_marital_status', personal.estado_civil)
    put('worker_birth_date', personal.fecha_nacimiento.isoformat() if personal.fecha_nacimiento else None)
    address_parts = [
        personal.direccion_residencia, personal.distrito_residencia,
        personal.provincia_residencia, personal.departamento_residencia,
    ]
    put('worker_address', ', '.join(p.strip() for p in address_parts if p and p.strip()))
    put('position', personal.puesto)
    location = personal.proyecto.name if personal.proyecto_id else personal.sede
    put('work_location', location)
    put('start_date', personal.fecha_ingreso.isoformat() if personal.fecha_ingreso else None)
    if personal.salario and personal.salario > 0:
        put('gross_salary', f'{personal.salario:.2f}')
    return data, sources


# --------------------------------------------------------------- context

def build_contract_context(data: dict, company: dict, reference_number: str | None = None) -> dict:
    """Spanish Jinja context for the template. Every registered variable is
    always present (empty string when not applicable)."""
    start = date.fromisoformat(data['start_date'])
    end = date.fromisoformat(data['end_date']) if data.get('end_date') else None
    issue = date.fromisoformat(data['issue_date'])
    birth = date.fromisoformat(data['worker_birth_date']) if data.get('worker_birth_date') else None
    salary = Decimal(str(data['gross_salary']))
    currency = data.get('currency') or Currency.PEN
    is_fixed = data.get('contract_type') == ContractType.FIXED_TERM
    modality = data.get('fixed_term_modality') or ''
    company = company or {}

    return {
        # trabajador
        'nombre_trabajador': data['worker_full_name'],
        'dni_trabajador': data['worker_dni'],
        'nacionalidad_trabajador': data.get('worker_nationality') or DEFAULT_NATIONALITY,
        'estado_civil_trabajador': _MARITAL_LABELS.get(data.get('worker_marital_status') or '', ''),
        'fecha_nacimiento_trabajador': short_date_es(birth),
        'domicilio_trabajador': data['worker_address'],
        # contrato
        'cargo': data['position'],
        'funciones': data.get('job_description') or '',
        'lugar_trabajo': data['work_location'],
        'tipo_contrato': str(ContractType(data['contract_type']).label),
        'es_plazo_fijo': is_fixed,
        'modalidad_plazo_fijo': str(FixedTermModality(modality).label) if modality else '',
        'causa_plazo_fijo': data.get('fixed_term_cause') or '',
        'fecha_inicio': short_date_es(start),
        'fecha_inicio_larga': long_date_es(start),
        'fecha_fin': short_date_es(end),
        'fecha_fin_larga': long_date_es(end),
        'plazo_meses': str(term_months(start, end)) if end else '',
        'sueldo': money_fmt(salary, currency),
        'sueldo_numero': f'{salary:.2f}',
        'sueldo_en_letras': money_to_words_es(salary, currency),
        'moneda': str(Currency(currency).label),
        'frecuencia_pago': str(PaymentFrequency(data['payment_frequency']).label).lower(),
        'jornada_laboral': data['work_schedule'],
        'meses_periodo_prueba': str(data['probation_months']),
        'fecha_suscripcion': short_date_es(issue),
        'fecha_suscripcion_larga': long_date_es(issue),
        'numero_documento': reference_number or '',
        # empresa
        'empresa_razon_social': company.get('name', ''),
        'empresa_ruc': company.get('ruc', ''),
        'empresa_domicilio': company.get('address', ''),
        'representante_nombre': company.get('legal_rep_name', ''),
        'representante_dni': company.get('legal_rep_dni', ''),
        'representante_cargo': company.get('legal_rep_title', ''),
        'representante_poderes': company.get('legal_rep_powers', ''),
    }


def sample_contract_data() -> dict:
    """Valid sample used for the trial render of an uploaded template."""
    return {
        'worker_full_name': 'PÉREZ GARCÍA, ANA', 'worker_dni': '12345678',
        'worker_nationality': 'Peruana', 'worker_marital_status': 'SOLTERO',
        'worker_birth_date': '1995-04-12', 'worker_address': 'Av. Ejemplo 123, Lima',
        'position': 'Asistente Administrativo', 'job_description': 'Funciones de ejemplo.',
        'work_location': 'Oficina Central', 'contract_type': 'FIXED_TERM',
        'fixed_term_modality': 'NECESIDAD_MERCADO', 'fixed_term_cause': 'Causa objetiva de ejemplo.',
        'start_date': '2026-11-01', 'end_date': '2027-04-30', 'gross_salary': '2000.00',
        'currency': 'PEN', 'payment_frequency': 'MONTHLY', 'work_schedule': '48 horas semanales',
        'probation_months': 3, 'issue_date': '2026-10-30',
    }


# ------------------------------------------------------------- registry

def _choices(choices):
    return tuple((v, str(l)) for v, l in choices)


FIELDS = (
    FieldSpec('worker_full_name', 'Nombre completo del trabajador', 'string', True, source='personal',
              question='¿Cuál es el nombre completo del trabajador?'),
    FieldSpec('worker_dni', 'DNI / documento de identidad', 'string', True, source='personal',
              help='8 dígitos (DNI) o 9 a 12 caracteres (CE/pasaporte).',
              question='¿Cuál es el DNI del trabajador?'),
    FieldSpec('worker_nationality', 'Nacionalidad', 'string', default=DEFAULT_NATIONALITY),
    FieldSpec('worker_marital_status', 'Estado civil', 'choice', source='personal',
              choices=_choices(MARITAL_STATUS_CHOICES)),
    FieldSpec('worker_birth_date', 'Fecha de nacimiento', 'date', source='personal'),
    FieldSpec('worker_address', 'Domicilio', 'string', True, source='personal',
              question='¿Cuál es el domicilio del trabajador?'),
    FieldSpec('position', 'Cargo', 'string', True, source='personal', question='¿Cuál es el cargo?'),
    FieldSpec('job_description', 'Funciones del cargo', 'text',
              help='Lo redacta RR. HH.; el asistente no lo inventa.'),
    FieldSpec('work_location', 'Lugar de trabajo', 'string', True, source='personal',
              question='¿Cuál es el lugar de trabajo (obra o sede)?'),
    FieldSpec('contract_type', 'Tipo de contrato', 'choice', True,
              choices=_choices(ContractType.choices),
              question='¿El contrato es a plazo indeterminado o a plazo fijo?'),
    FieldSpec('fixed_term_modality', 'Modalidad de plazo fijo', 'choice', required_when='contract_type=FIXED_TERM',
              choices=_choices(FixedTermModality.choices),
              question='¿Qué modalidad de contrato a plazo fijo corresponde?'),
    FieldSpec('fixed_term_cause', 'Causa objetiva', 'text', required_when='contract_type=FIXED_TERM',
              help='Obligatoria por ley en contratos a plazo fijo; la escribe RR. HH.',
              question='¿Cuál es la causa objetiva del contrato a plazo fijo?'),
    FieldSpec('start_date', 'Fecha de inicio', 'date', True, source='personal',
              question='¿Cuál es la fecha de inicio?'),
    FieldSpec('end_date', 'Fecha de fin', 'date', required_when='contract_type=FIXED_TERM',
              question='¿Cuál es la fecha de fin del contrato?'),
    FieldSpec('gross_salary', 'Sueldo bruto', 'decimal', True, source='personal',
              question='¿Cuál es el sueldo bruto?'),
    FieldSpec('currency', 'Moneda', 'choice', True, choices=_choices(Currency.choices), default='PEN'),
    FieldSpec('payment_frequency', 'Frecuencia de pago', 'choice', True,
              choices=_choices(PaymentFrequency.choices), default='MONTHLY'),
    FieldSpec('work_schedule', 'Jornada de trabajo', 'string', True,
              help='Ej.: 48 horas semanales.', question='¿Cuál es la jornada de trabajo?'),
    FieldSpec('probation_months', 'Período de prueba (meses)', 'integer', True,
              default=DEFAULT_PROBATION_MONTHS, help='Entre 0 y 12.'),
    FieldSpec('issue_date', 'Fecha de suscripción', 'date', True, default='today', help='Por defecto, hoy.'),
)

VARIABLES = (
    VariableSpec('nombre_trabajador', 'Nombre del trabajador', 'trabajador', 'worker_full_name', True),
    VariableSpec('dni_trabajador', 'DNI del trabajador', 'trabajador', 'worker_dni', True),
    VariableSpec('nacionalidad_trabajador', 'Nacionalidad', 'trabajador', 'worker_nationality'),
    VariableSpec('estado_civil_trabajador', 'Estado civil', 'trabajador', 'worker_marital_status'),
    VariableSpec('fecha_nacimiento_trabajador', 'Fecha de nacimiento (dd/mm/aaaa)', 'trabajador', 'worker_birth_date'),
    VariableSpec('domicilio_trabajador', 'Domicilio', 'trabajador', 'worker_address'),
    VariableSpec('cargo', 'Cargo', 'contrato', 'position', True),
    VariableSpec('funciones', 'Funciones del cargo', 'contrato', 'job_description'),
    VariableSpec('lugar_trabajo', 'Lugar de trabajo', 'contrato', 'work_location'),
    VariableSpec('tipo_contrato', 'Tipo de contrato (texto)', 'contrato', 'contract_type'),
    VariableSpec('es_plazo_fijo', 'Verdadero si es a plazo fijo (para {%p if es_plazo_fijo %})', 'contrato', 'contract_type'),
    VariableSpec('modalidad_plazo_fijo', 'Modalidad de plazo fijo', 'contrato', 'fixed_term_modality'),
    VariableSpec('causa_plazo_fijo', 'Causa objetiva', 'contrato', 'fixed_term_cause'),
    VariableSpec('fecha_inicio', 'Fecha de inicio (dd/mm/aaaa)', 'contrato', 'start_date'),
    VariableSpec('fecha_inicio_larga', 'Fecha de inicio (1 de noviembre de 2026)', 'contrato', 'start_date'),
    VariableSpec('fecha_fin', 'Fecha de fin (dd/mm/aaaa)', 'contrato', 'end_date'),
    VariableSpec('fecha_fin_larga', 'Fecha de fin (larga)', 'contrato', 'end_date'),
    VariableSpec('plazo_meses', 'Duración en meses', 'derivada'),
    VariableSpec('sueldo', 'Sueldo con moneda (S/ 2,000.00)', 'contrato', 'gross_salary', True),
    VariableSpec('sueldo_numero', 'Sueldo solo número (2000.00)', 'contrato', 'gross_salary'),
    VariableSpec('sueldo_en_letras', 'Sueldo en letras (DOS MIL Y 00/100 SOLES)', 'derivada'),
    VariableSpec('moneda', 'Moneda (texto)', 'contrato', 'currency'),
    VariableSpec('frecuencia_pago', 'Frecuencia de pago (mensual/quincenal)', 'contrato', 'payment_frequency'),
    VariableSpec('jornada_laboral', 'Jornada de trabajo', 'contrato', 'work_schedule'),
    VariableSpec('meses_periodo_prueba', 'Meses de período de prueba', 'contrato', 'probation_months'),
    VariableSpec('fecha_suscripcion', 'Fecha de suscripción (dd/mm/aaaa)', 'contrato', 'issue_date'),
    VariableSpec('fecha_suscripcion_larga', 'Fecha de suscripción (larga)', 'contrato', 'issue_date'),
    VariableSpec('numero_documento', 'Número de documento (vacío en borrador)', 'derivada'),
    VariableSpec('empresa_razon_social', 'Razón social de la empresa', 'empresa'),
    VariableSpec('empresa_ruc', 'RUC de la empresa', 'empresa'),
    VariableSpec('empresa_domicilio', 'Domicilio de la empresa', 'empresa'),
    VariableSpec('representante_nombre', 'Representante legal: nombre', 'empresa'),
    VariableSpec('representante_dni', 'Representante legal: DNI', 'empresa'),
    VariableSpec('representante_cargo', 'Representante legal: cargo', 'empresa'),
    VariableSpec('representante_poderes', 'Representante legal: poderes', 'empresa'),
)

CONTRACT_SPEC = DocumentTypeSpec(
    key='CONTRACT',
    label='Contrato de trabajo',
    prefix='CT',
    default_slug='contrato-trabajo',
    fields=FIELDS,
    variables=VARIABLES,
    normalize=normalize_contract_data,
    build_context=build_contract_context,
    prefill=prefill_contract_from_personal,
    sample_data=sample_contract_data,
    extraction_model=ContractExtraction,
    filename_prefix='Contrato',
)
