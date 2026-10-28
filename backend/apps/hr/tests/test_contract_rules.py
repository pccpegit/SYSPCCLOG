"""Contract data rules, es-PE formatters, date maths, prefill and context (SYSPCC-022, FASE 4)."""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.exceptions import ValidationError

from apps.hr.documents.contract import (
    build_contract_context,
    contract_warnings,
    end_date_from_months,
    normalize_contract_data,
    prefill_contract_from_personal,
    sample_contract_data,
    term_months,
    today_lima,
)
from apps.hr.documents.formatters import long_date_es, money_fmt, money_to_words_es, short_date_es


def base(**over):
    data = {
        'worker_full_name': 'Ana Pérez', 'worker_dni': '12345678',
        'worker_address': 'Av. Siempre Viva 123', 'position': 'Asistente',
        'work_location': 'Oficina Central', 'contract_type': 'INDEFINITE',
        'start_date': '2026-11-01', 'gross_salary': '2000.00', 'work_schedule': '48 horas semanales',
    }
    data.update(over)
    return data


def fixed(**over):
    fields = {
        'contract_type': 'FIXED_TERM', 'fixed_term_modality': 'NECESIDAD_MERCADO',
        'fixed_term_cause': 'Aumento de producción', 'end_date': '2027-04-30',
    }
    fields.update(over)
    return base(**fields)


def errors_of(raw, **kw):
    with pytest.raises(ValidationError) as exc:
        normalize_contract_data(raw, **kw)
    return exc.value.detail


# ------------------------------------------------------------- money in words
class TestSalaryInWords:
    @pytest.mark.parametrize('amount,expected', [
        ('2000', 'DOS MIL Y 00/100 SOLES'),
        ('2000.00', 'DOS MIL Y 00/100 SOLES'),
        ('2500.50', 'DOS MIL QUINIENTOS Y 50/100 SOLES'),
        ('1', 'UN Y 00/100 SOL'),
        ('0.05', 'CERO Y 05/100 SOLES'),
        ('1130', 'MIL CIENTO TREINTA Y 00/100 SOLES'),
    ])
    def test_known_amounts(self, amount, expected):
        assert money_to_words_es(Decimal(amount)) == expected

    def test_thousands_and_cents(self):
        assert money_to_words_es(Decimal('15000.99')) == 'QUINCE MIL Y 99/100 SOLES'

    def test_millions(self):
        assert money_to_words_es(Decimal('1000000')) == 'UN MILLÓN Y 00/100 SOLES'
        assert money_to_words_es(Decimal('2500000.00')) == 'DOS MILLONES QUINIENTOS MIL Y 00/100 SOLES'

    def test_apocope_before_noun(self):
        assert money_to_words_es(Decimal('101')) == 'CIENTO UN Y 00/100 SOLES'
        assert money_to_words_es(Decimal('31')) == 'TREINTA Y UN Y 00/100 SOLES'

    def test_twenty_one_has_accent(self):
        assert money_to_words_es(Decimal('21')) == 'VEINTIÚN Y 00/100 SOLES'

    def test_twenty_one_inside_thousands_and_millions(self):
        assert money_to_words_es(Decimal('21000')) == 'VEINTIÚN MIL Y 00/100 SOLES'
        assert money_to_words_es(Decimal('121000')) == 'CIENTO VEINTIÚN MIL Y 00/100 SOLES'
        assert money_to_words_es(Decimal('21000000')) == 'VEINTIÚN MILLONES Y 00/100 SOLES'
        assert money_to_words_es(Decimal('2021')) == 'DOS MIL VEINTIÚN Y 00/100 SOLES'
        assert money_to_words_es(Decimal('31000')) == 'TREINTA Y UN MIL Y 00/100 SOLES'

    def test_rounding_half_up_never_banker(self):
        # 2000.005 -> 2000.01 (ROUND_HALF_UP); banker's rounding would give 2000.00
        assert money_to_words_es(Decimal('2000.005')) == 'DOS MIL Y 01/100 SOLES'
        assert money_to_words_es(Decimal('1999.995')) == 'DOS MIL Y 00/100 SOLES'

    def test_float_input_goes_through_str_not_binary_repr(self):
        assert money_to_words_es(2000.1) == 'DOS MIL Y 10/100 SOLES'  # Decimal(2000.1) would be 2000.0999...

    def test_usd_currency_and_plural(self):
        assert money_to_words_es(Decimal('1'), 'USD') == 'UN Y 00/100 DÓLAR AMERICANO'
        assert money_to_words_es(Decimal('1500'), 'USD') == 'MIL QUINIENTOS Y 00/100 DÓLARES AMERICANOS'

    def test_unknown_currency_falls_back_to_soles(self):
        assert money_to_words_es(Decimal('10'), 'EUR').endswith('SOLES')

    def test_money_fmt_rounding_and_thousands(self):
        assert money_fmt(Decimal('2000')) == 'S/ 2,000.00'
        assert money_fmt(Decimal('1234567.895')) == 'S/ 1,234,567.90'
        assert money_fmt(Decimal('99.5'), 'USD') == 'US$ 99.50'


# ------------------------------------------------------------------ dates
class TestDates:
    @pytest.mark.parametrize('month,name', [
        (1, 'enero'), (2, 'febrero'), (3, 'marzo'), (4, 'abril'), (5, 'mayo'), (6, 'junio'),
        (7, 'julio'), (8, 'agosto'), (9, 'septiembre'), (10, 'octubre'), (11, 'noviembre'), (12, 'diciembre'),
    ])
    def test_long_date_all_months(self, month, name):
        assert long_date_es(date(2026, month, 5)) == f'5 de {name} de 2026'

    def test_long_date_no_zero_padding_none_and_year_end(self):
        assert long_date_es(date(2026, 11, 1)) == '1 de noviembre de 2026'
        assert long_date_es(date(2026, 12, 31)) == '31 de diciembre de 2026'
        assert long_date_es(None) == ''

    def test_long_date_ignores_os_locale(self):
        import locale

        previous = locale.setlocale(locale.LC_TIME)
        try:
            try:
                locale.setlocale(locale.LC_TIME, 'en_US.UTF-8')
            except locale.Error:
                pass
            assert long_date_es(date(2026, 3, 9)) == '9 de marzo de 2026'
        finally:
            locale.setlocale(locale.LC_TIME, previous)

    def test_short_date(self):
        assert short_date_es(date(2026, 1, 9)) == '09/01/2026'
        assert short_date_es(None) == ''

    @pytest.mark.parametrize('start,months,end', [
        (date(2026, 11, 1), 6, date(2027, 4, 30)),
        (date(2026, 1, 1), 12, date(2026, 12, 31)),
        (date(2026, 11, 15), 1, date(2026, 12, 14)),
        (date(2026, 1, 31), 1, date(2026, 2, 27)),  # day clamped to month length, minus one day
    ])
    def test_end_date_from_months(self, start, months, end):
        assert end_date_from_months(start, months) == end

    @pytest.mark.parametrize('start,end,months', [
        (date(2026, 11, 1), date(2027, 4, 30), 6),
        (date(2026, 1, 1), date(2026, 12, 31), 12),
        (date(2026, 11, 1), date(2026, 11, 30), 1),
        (date(2026, 11, 1), date(2026, 11, 15), 0),
        (date(2026, 11, 15), date(2026, 12, 14), 1),
    ])
    def test_term_months(self, start, end, months):
        assert term_months(start, end) == months

    def test_term_months_never_negative(self):
        assert term_months(date(2026, 11, 1), date(2026, 10, 1)) == 0

    def test_today_lima_is_a_date(self):
        assert isinstance(today_lima(), date)


# ------------------------------------------------------------- validation
class TestRequiredAndDefaults:
    def test_indefinite_minimum_payload_is_valid_and_defaults_applied(self):
        clean, warnings = normalize_contract_data(base())
        assert clean['worker_nationality'] == 'Peruana'
        assert clean['currency'] == 'PEN' and clean['payment_frequency'] == 'MONTHLY'
        assert clean['probation_months'] == 3
        assert clean['issue_date'] == today_lima().isoformat()
        assert clean['gross_salary'] == '2000.00'  # string, not float
        assert warnings == []

    @pytest.mark.parametrize('field', [
        'worker_full_name', 'worker_dni', 'worker_address', 'position', 'work_location',
        'contract_type', 'start_date', 'gross_salary', 'work_schedule',
    ])
    def test_each_required_field(self, field):
        raw = base()
        raw.pop(field)
        assert field in errors_of(raw)

    @pytest.mark.parametrize('field', ['worker_full_name', 'position', 'work_location', 'work_schedule'])
    def test_blank_strings_are_rejected(self, field):
        assert field in errors_of(base(**{field: '   '}))

    def test_values_are_trimmed(self):
        clean, _ = normalize_contract_data(base(position='  Asistente  ', worker_dni=' 12345678 '))
        assert clean['position'] == 'Asistente' and clean['worker_dni'] == '12345678'

    def test_unknown_keys_are_dropped_from_the_snapshot(self):
        clean, _ = normalize_contract_data(base(is_superuser=True, company={'name': 'EVIL'}, extra='x'))
        assert 'is_superuser' not in clean and 'company' not in clean and 'extra' not in clean

    def test_empty_strings_for_optional_typed_fields_mean_not_provided(self):
        clean, _ = normalize_contract_data(base(end_date='', worker_birth_date='', fixed_term_modality=''))
        assert clean['end_date'] is None and clean['worker_birth_date'] is None

    @pytest.mark.parametrize('field,value', [
        ('start_date', '01/11/2026'), ('start_date', '2026-13-01'), ('start_date', 'pronto'),
        ('issue_date', '2026-02-30'), ('worker_birth_date', 'ayer'),
        ('contract_type', 'TEMPORAL'), ('currency', 'EUR'), ('payment_frequency', 'WEEKLY'),
        ('worker_marital_status', 'CASADA'), ('probation_months', 'tres'),
    ])
    def test_invalid_formats_and_choices(self, field, value):
        assert field in errors_of(base(**{field: value}))

    def test_max_lengths(self):
        assert 'worker_full_name' in errors_of(base(worker_full_name='A' * 256))
        assert 'worker_address' in errors_of(base(worker_address='A' * 401))
        assert 'position' in errors_of(base(position='A' * 201))


class TestDni:
    @pytest.mark.parametrize('value', ['12345678', 'A12345678', '123456789012', 'ab3456789'])
    def test_valid_documents(self, value):
        clean, _ = normalize_contract_data(base(worker_dni=value))
        assert clean['worker_dni'] == value

    @pytest.mark.parametrize('value', ['1234567', 'ABCDEFGH', '1234567A', '1234567890123', '12-345-678', ''])
    def test_invalid_documents(self, value):
        assert 'worker_dni' in errors_of(base(worker_dni=value))

    def test_eight_digits_with_spaces_inside_rejected(self):
        assert 'worker_dni' in errors_of(base(worker_dni='1234 5678'))


class TestSalary:
    def test_decimal_precision_is_exact_no_float_drift(self):
        clean, _ = normalize_contract_data(base(gross_salary=2000.1))
        assert clean['gross_salary'] == '2000.10'
        clean, _ = normalize_contract_data(base(gross_salary='0.30'))
        assert clean['gross_salary'] == '0.30'

    def test_string_with_one_decimal_is_padded(self):
        assert normalize_contract_data(base(gross_salary='2000.5'))[0]['gross_salary'] == '2000.50'

    @pytest.mark.parametrize('value', ['0', '0.00', '-1', '-2000'])
    def test_zero_and_negative_rejected(self, value):
        assert 'gross_salary' in errors_of(base(gross_salary=value))

    def test_more_than_two_decimals_rejected_not_silently_rounded(self):
        assert 'gross_salary' in errors_of(base(gross_salary='2000.005'))

    def test_too_many_digits_rejected(self):
        assert 'gross_salary' in errors_of(base(gross_salary='12345678901'))  # 11 digits, max_digits=10
        assert normalize_contract_data(base(gross_salary='99999999.99'))[0]['gross_salary'] == '99999999.99'

    @pytest.mark.parametrize('value', ['abc', 'NaN', 'Infinity', '1,5', None, ''])
    def test_non_numeric_rejected_without_500(self, value):
        assert 'gross_salary' in errors_of(base(gross_salary=value))


class TestMinimumWageWarning:
    """The minimum wage is a WARNING, never a blocking error (design FASE 0)."""

    def test_below_minimum_is_a_warning(self, settings):
        settings.HR_MIN_WAGE = Decimal('1130.00')
        clean, warnings = normalize_contract_data(base(gross_salary='900'))
        assert clean['gross_salary'] == '900.00'
        assert len(warnings) == 1 and 'remuneración mínima vital' in warnings[0]

    def test_equal_to_minimum_has_no_warning(self, settings):
        settings.HR_MIN_WAGE = Decimal('1130.00')
        assert normalize_contract_data(base(gross_salary='1130.00'))[1] == []

    def test_one_cent_below_minimum_warns(self, settings):
        settings.HR_MIN_WAGE = Decimal('1130.00')
        assert len(normalize_contract_data(base(gross_salary='1129.99'))[1]) == 1

    def test_usd_is_not_compared_with_the_pen_minimum(self, settings):
        settings.HR_MIN_WAGE = Decimal('1130.00')
        assert normalize_contract_data(base(gross_salary='500', currency='USD'))[1] == []

    def test_min_wage_as_string_setting_is_supported(self, settings):
        settings.HR_MIN_WAGE = '1500'
        assert len(contract_warnings({'gross_salary': '1000.00', 'currency': 'PEN'})) == 1

    def test_corrupt_setting_or_data_never_breaks_a_response(self, settings):
        settings.HR_MIN_WAGE = 'no-es-numero'
        assert contract_warnings({'gross_salary': '1000.00', 'currency': 'PEN'}) == []
        assert contract_warnings({'gross_salary': None}) == []


class TestFixedTermRules:
    def test_valid_fixed_term(self):
        clean, _ = normalize_contract_data(fixed())
        assert clean['end_date'] == '2027-04-30'

    def test_fixed_term_requires_end_modality_and_cause_individually(self):
        raw = fixed()
        for field in ('end_date', 'fixed_term_modality', 'fixed_term_cause'):
            incomplete = {k: v for k, v in raw.items() if k != field}
            assert field in errors_of(incomplete), field

    def test_whitespace_only_cause_is_missing(self):
        assert 'fixed_term_cause' in errors_of(fixed(fixed_term_cause='   '))

    def test_end_equal_to_start_rejected(self):
        assert 'end_date' in errors_of(fixed(end_date='2026-11-01'))

    def test_end_before_start_rejected(self):
        assert 'end_date' in errors_of(fixed(end_date='2026-10-31'))

    def test_one_day_contract_after_start_is_ok(self):
        clean, _ = normalize_contract_data(fixed(end_date='2026-11-02', probation_months=0))
        assert clean['end_date'] == '2026-11-02'

    @pytest.mark.parametrize('extra', [
        {'end_date': '2027-04-30'},
        {'fixed_term_modality': 'OCASIONAL'},
        {'fixed_term_cause': 'Alguna causa'},
    ])
    def test_indefinite_rejects_fixed_term_fields(self, extra):
        errs = errors_of(base(**extra))
        assert set(errs) & {'end_date', 'fixed_term_modality', 'fixed_term_cause'}

    def test_unknown_modality_rejected(self):
        assert 'fixed_term_modality' in errors_of(fixed(fixed_term_modality='INVENTADA'))

    def test_all_modalities_accepted(self):
        from apps.hr.enums import FixedTermModality

        for value in FixedTermModality.values:
            assert normalize_contract_data(fixed(fixed_term_modality=value))[0]['fixed_term_modality'] == value


class TestAgeAndProbation:
    def test_minor_rejected_at_start_date(self):
        assert 'worker_birth_date' in errors_of(base(worker_birth_date='2010-01-01'))

    def test_turns_18_on_start_date_is_accepted_day_before_is_not(self):
        assert normalize_contract_data(base(worker_birth_date='2008-11-01'))[0]
        assert 'worker_birth_date' in errors_of(base(worker_birth_date='2008-11-02'))

    @pytest.mark.parametrize('months,ok', [(0, True), (12, True), (13, False), (-1, False)])
    def test_probation_bounds(self, months, ok):
        if ok:
            assert normalize_contract_data(base(probation_months=months))[0]['probation_months'] == months
        else:
            assert 'probation_months' in errors_of(base(probation_months=months))

    def test_probation_cannot_exceed_fixed_term_duration(self):
        # 2026-11-01 .. 2026-12-31 = 2 months
        assert 'probation_months' in errors_of(fixed(end_date='2026-12-31', probation_months=3))
        assert normalize_contract_data(fixed(end_date='2026-12-31', probation_months=2))

    def test_probation_zero_is_kept_not_replaced_by_default(self):
        assert normalize_contract_data(base(probation_months=0))[0]['probation_months'] == 0

    def test_probation_omitted_gets_default_three(self):
        assert normalize_contract_data(base())[0]['probation_months'] == 3


class TestPartialMode:
    def test_partial_skips_required_checks(self):
        clean, _ = normalize_contract_data({'position': 'Cajera'}, partial=True)
        assert clean == {'position': 'Cajera'}

    def test_partial_still_validates_present_fields(self):
        assert 'worker_dni' in errors_of({'worker_dni': '12'}, partial=True)

    def test_partial_indefinite_with_end_date_still_fails(self):
        assert 'end_date' in errors_of({'contract_type': 'INDEFINITE', 'end_date': '2027-01-01'}, partial=True)


# ----------------------------------------------------------------- prefill
class TestPrefill:
    def test_prefill_maps_only_non_sensitive_fields(self, db, project):
        from apps.core.models import Personal

        p = Personal.objects.create(
            dni='11223344', apellidos_nombres='QUISPE MAMANI, LUIS', puesto='Maestro de obra',
            salario=Decimal('2500.5'), fecha_ingreso=date(2026, 11, 1), proyecto=project,
            direccion_residencia='Jr. Cusco 10', distrito_residencia='Miraflores',
            provincia_residencia='Lima', departamento_residencia='Lima',
            numero_cuenta='999-888', fecha_nacimiento=date(1990, 5, 20),
        )
        data, sources = prefill_contract_from_personal(p)
        assert data['worker_full_name'] == 'QUISPE MAMANI, LUIS'
        assert data['worker_dni'] == '11223344'
        assert data['gross_salary'] == '2500.50'
        assert data['start_date'] == '2026-11-01'
        assert data['work_location'] == project.name
        assert data['worker_address'] == 'Jr. Cusco 10, Miraflores, Lima, Lima'
        assert data['worker_birth_date'] == '1990-05-20'
        assert set(sources.values()) == {'personal'} and set(sources) == set(data)
        assert '999-888' not in str(data)
        for forbidden in ('numero_cuenta', 'cci', 'banco', 'sistema_pensiones', 'hijos'):
            assert forbidden not in data

    def test_empty_and_zero_values_are_not_prefilled(self, db):
        from apps.core.models import Personal

        p = Personal.objects.create(dni='55667788', apellidos_nombres='SOTO, ANA', salario=Decimal('0'))
        data, _ = prefill_contract_from_personal(p)
        assert 'gross_salary' not in data and 'worker_address' not in data and 'start_date' not in data

    def test_site_is_used_when_there_is_no_project(self, db):
        from apps.core.models import Personal

        p = Personal.objects.create(dni='55667799', apellidos_nombres='SOTO, LUZ', sede='Sede Arequipa')
        assert prefill_contract_from_personal(p)[0]['work_location'] == 'Sede Arequipa'

    def test_address_skips_blank_parts(self, db):
        from apps.core.models import Personal

        p = Personal.objects.create(
            dni='55667700', apellidos_nombres='SOTO, RUTH', direccion_residencia='Av. Sol 5',
            distrito_residencia='  ', departamento_residencia='Cusco',
        )
        assert prefill_contract_from_personal(p)[0]['worker_address'] == 'Av. Sol 5, Cusco'


# ----------------------------------------------------------------- context
class TestContext:
    COMPANY = {'name': 'ACME SAC', 'ruc': '20111111111', 'address': 'Av. X 1', 'legal_rep_name': 'REP',
               'legal_rep_dni': '1', 'legal_rep_title': 'Gerente', 'legal_rep_powers': 'Poderes'}

    def _ctx(self, raw, ref=None, company=None):
        clean, _ = normalize_contract_data(raw)
        return build_contract_context(clean, self.COMPANY if company is None else company, ref)

    def test_derived_values_are_computed_by_code(self):
        ctx = self._ctx(fixed(), ref='CT-2026-0001')
        assert ctx['sueldo'] == 'S/ 2,000.00'
        assert ctx['sueldo_numero'] == '2000.00'
        assert ctx['sueldo_en_letras'] == 'DOS MIL Y 00/100 SOLES'
        assert ctx['fecha_inicio_larga'] == '1 de noviembre de 2026'
        assert ctx['fecha_fin_larga'] == '30 de abril de 2027'
        assert ctx['fecha_inicio'] == '01/11/2026'
        assert ctx['plazo_meses'] == '6'
        assert ctx['es_plazo_fijo'] is True
        assert ctx['numero_documento'] == 'CT-2026-0001'
        assert ctx['empresa_razon_social'] == 'ACME SAC'

    def test_indefinite_has_empty_fixed_term_variables(self):
        ctx = self._ctx(base())
        assert ctx['es_plazo_fijo'] is False
        for key in ('fecha_fin', 'fecha_fin_larga', 'plazo_meses', 'modalidad_plazo_fijo', 'causa_plazo_fijo'):
            assert ctx[key] == ''

    def test_draft_has_empty_document_number(self):
        assert self._ctx(base())['numero_documento'] == ''

    def test_every_registered_variable_is_always_present_and_scalar(self):
        from apps.hr.documents.contract import VARIABLES

        for raw in (base(), fixed()):
            ctx = self._ctx(raw, company={})
            for var in VARIABLES:
                assert var.name in ctx, var.name
                assert isinstance(ctx[var.name], (str, bool)), var.name

    def test_context_without_company_yields_empty_strings(self):
        ctx = self._ctx(base(), company={})
        assert ctx['empresa_ruc'] == '' and ctx['representante_nombre'] == ''

    def test_usd_contract_context(self):
        ctx = self._ctx(base(currency='USD', gross_salary='1500'))
        assert ctx['sueldo'] == 'US$ 1,500.00'
        assert ctx['sueldo_en_letras'].endswith('DÓLARES AMERICANOS')

    def test_biweekly_label_and_marital_status(self):
        ctx = self._ctx(base(payment_frequency='BIWEEKLY', worker_marital_status='CASADO'))
        assert ctx['frecuencia_pago'] == 'quincenal'
        assert ctx['estado_civil_trabajador'] == 'Casado/a'

    def test_sample_data_is_valid(self):
        clean, _ = normalize_contract_data(sample_contract_data())
        assert clean['contract_type'] == 'FIXED_TERM'
