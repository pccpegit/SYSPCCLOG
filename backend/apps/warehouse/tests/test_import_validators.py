"""
SYSPCC-025 — importer: validación por fila frente a celdas numéricas extremas o no finitas.

Un libro es entrada hostil: ``1E+30`` tecleado por error, ``<v>1E999</v>`` fabricado a mano o un número de
40 dígitos nunca deben terminar en un 500; la fila se omite con un motivo que no cita la celda.
"""
from decimal import Decimal

import pytest
from rest_framework import serializers

from apps.warehouse.services.imports import validators
from apps.warehouse.services.imports.validators import (
    EntryRowSerializer, ExcelText, QuantityField, number_as_text, validate_row,
)

MAX = Decimal('999999999.999')


def run(field, value):
    return field.run_validation(value)


def code_of(exc_info) -> str:
    return exc_info.value.detail[0].code


class TestQuantityField:
    HOSTILE = [
        1e30, 1e300, 10 ** 40, 10 ** 30, '9' * 30, '9' * 5000, '1' + '0' * 28, Decimal('1E+30'), Decimal('1E+999999'),
        float('inf'), float('-inf'), float('nan'), Decimal('Infinity'), Decimal('NaN'), Decimal('-1E+30'),
        '١٢٣x', '²',
    ]

    @pytest.mark.parametrize('value', HOSTILE, ids=lambda v: repr(v)[:18])
    def test_extreme_or_non_finite_values_are_an_invalid_quantity_not_an_exception(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            run(QuantityField(), value)
        assert code_of(exc) == 'CANTIDAD_INVALIDA'

    @pytest.mark.parametrize('allow_zero', [True, False])
    def test_the_summary_columns_get_the_same_protection(self, allow_zero):
        with pytest.raises(serializers.ValidationError) as exc:
            run(QuantityField(required_quantity=False, allow_zero=allow_zero), 1e30)
        assert code_of(exc) == 'CANTIDAD_INVALIDA'

    def test_the_largest_quantity_the_column_holds_is_accepted(self):
        assert run(QuantityField(), '999999999.999') == MAX
        assert run(QuantityField(), Decimal('999999999.999')) == MAX

    @pytest.mark.parametrize('value', ['999999999.9991', '1000000000', 1000000000, 1e9 + 0.001])
    def test_anything_above_it_is_rejected(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            run(QuantityField(), value)
        assert code_of(exc) == 'CANTIDAD_INVALIDA'

    @pytest.mark.parametrize('value, expected', [(3, '3'), (2.5, '2.5'), ('0.001', '0.001'), (Decimal('7'), '7')])
    def test_ordinary_values_still_work(self, value, expected):
        assert format(run(QuantityField(), value), 'f').rstrip('0').rstrip('.') == expected.rstrip('0').rstrip('.')


class TestNumberAsText:
    @pytest.mark.parametrize('value', [float('inf'), float('-inf'), float('nan')])
    def test_non_finite_numbers_have_no_text_form(self, value):
        with pytest.raises(serializers.ValidationError) as exc:
            number_as_text(value)
        assert code_of(exc) == 'FILA_INVALIDA'

    @pytest.mark.parametrize('value, decimals, expected', [
        (120.0, None, '120'), (1.02, 2, '1.02'), (1.1, 2, '1.10'), (7, None, '7'), ('24003-13', None, '24003-13'),
    ])
    def test_ordinary_numbers_are_unchanged(self, value, decimals, expected):
        assert number_as_text(value, decimals) == expected

    def test_a_text_field_reports_an_infinite_cell_as_an_invalid_row(self):
        with pytest.raises(serializers.ValidationError) as exc:
            run(ExcelText(max_length=50, label='El PO'), float('inf'))
        assert code_of(exc) == 'FILA_INVALIDA'

    def test_a_huge_finite_float_is_too_long_for_a_text_field_not_a_crash(self):
        with pytest.raises(serializers.ValidationError) as exc:
            run(ExcelText(max_length=50, label='El PO'), 1e300)
        assert code_of(exc) == 'FILA_INVALIDA'


class TestValidateRow:
    def row(self, **overrides):
        values = {
            'date': None, 'tag': None, 'product_code': 'EPP000001', 'quantity': 5, 'location': None,
            'po_number': None, 'guide_number': None, 'internal_transfer': None, 'observation': None,
        }
        values.update(overrides)
        return values

    def test_a_valid_row_is_returned_clean(self):
        data, errors = validate_row(EntryRowSerializer, self.row())
        assert errors == [] and data['quantity'] == Decimal('5')

    @pytest.mark.parametrize('field, value', [
        ('quantity', 1e30), ('quantity', 10 ** 40), ('po_number', float('inf')), ('guide_number', float('nan')),
    ])
    def test_hostile_cells_become_a_row_error(self, field, value):
        data, errors = validate_row(EntryRowSerializer, self.row(**{field: value}))
        assert data is None and errors

    @pytest.mark.parametrize('exc_type', [ArithmeticError, OverflowError, ValueError, TypeError, ZeroDivisionError])
    def test_an_unexpected_failure_inside_a_serializer_is_a_generic_row_error(self, exc_type, monkeypatch, app_logs):
        secret = 'Nombre Inventado Prueba'

        def boom(self, *args, **kwargs):
            raise exc_type(f'celda con {secret}')

        monkeypatch.setattr(EntryRowSerializer, 'is_valid', boom)
        data, errors = validate_row(EntryRowSerializer, self.row())
        assert data is None
        assert errors == [('FILA_INVALIDA', 'La fila contiene un valor que no se puede procesar.')]
        # the message of the exception (it may quote a cell) never reaches the log; the type does
        assert secret not in app_logs.dump()
        assert exc_type.__name__ in app_logs.dump()

    def test_a_programming_error_of_another_kind_is_not_swallowed(self, monkeypatch):
        def boom(self, *args, **kwargs):
            raise KeyError('bug')

        monkeypatch.setattr(EntryRowSerializer, 'is_valid', boom)
        with pytest.raises(KeyError):
            validate_row(EntryRowSerializer, self.row())

    def test_the_module_uses_the_problem_catalog_codes(self):
        assert 'FILA_INVALIDA' in validators.PROBLEM_CODES and 'CANTIDAD_INVALIDA' in validators.PROBLEM_CODES
