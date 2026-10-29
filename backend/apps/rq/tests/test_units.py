"""
SYSPCC-026: normalization and equivalence of units of measure (apps/rq/services/units.py).

Used by the stock-availability report to decide whether a quantity on an RQ line can be
compared with the stock of its catalog product. Pure functions: no database.
"""
import pytest

from apps.rq.services.units import normalize_unit, units_equivalent


class TestNormalizeUnit:
    @pytest.mark.parametrize('raw', [
        'EA', 'ea', 'UND', 'und', 'Und.', 'UNID', 'unid.', 'UNIDAD', 'Unidad', 'U', 'u',
        'PZA', 'pza.', 'PIEZA', 'Pieza', 'UNIDADES', 'Piezas', 'PZAS', '  und  ', 'UND.',
    ])
    def test_every_piece_spelling_folds_into_one(self, raw):
        assert normalize_unit(raw) == 'UND'

    @pytest.mark.parametrize('raw,expected', [
        ('kg', 'KG'), ('Kg.', 'KG'), ('m', 'M'), ('M2', 'M2'), ('m 2', 'M 2'),
        ('gln', 'GLN'), ('  par ', 'PAR'), ('Caja', 'CAJA'), ('GLB', 'GLB'),
    ])
    def test_other_units_only_lose_case_dots_and_extra_spaces(self, raw, expected):
        assert normalize_unit(raw) == expected

    def test_accents_are_dropped_in_any_form(self):
        assert normalize_unit('Caja Ñ') == 'CAJA N'
        assert normalize_unit('Piéza') == 'UND'          # decomposed acute accent on a real word
        assert normalize_unit('Millár') == 'MILLAR'

    @pytest.mark.parametrize('raw', [None, 5, 2.5, [], {}, b'und'])
    def test_anything_that_is_not_text_is_blank(self, raw):
        assert normalize_unit(raw) == ''

    def test_a_blank_is_blank(self):
        assert normalize_unit('') == ''
        assert normalize_unit('   ') == ''

    def test_single_letter_u_is_the_piece_but_other_letters_are_not(self):
        assert normalize_unit('U') == 'UND'
        assert normalize_unit('L') == 'L'


class TestUnitsEquivalent:
    @pytest.mark.parametrize('left,right', [
        ('UND', 'EA'), ('EA', 'PZA'), ('Unidad', 'pieza'), ('U', 'unid.'), ('KG', 'kg'), ('M', 'm.'),
    ])
    def test_same_unit_written_differently(self, left, right):
        assert units_equivalent(left, right) is True

    @pytest.mark.parametrize('left,right', [
        ('KG', 'TN'), ('M', 'CM'), ('M2', 'M3'), ('UND', 'PAR'), ('UND', 'CJA'), ('GLN', 'L'),
        ('ROLLO', 'M'), ('MLL', 'UND'),
    ])
    def test_different_units_are_never_converted(self, left, right):
        assert units_equivalent(left, right) is False

    def test_equivalence_is_symmetric(self):
        for left, right in [('EA', 'UND'), ('KG', 'TN'), ('', 'UND')]:
            assert units_equivalent(left, right) is units_equivalent(right, left)

    def test_two_blank_units_are_equal_but_a_blank_next_to_a_real_unit_is_not(self):
        assert units_equivalent('', '') is True
        assert units_equivalent(None, '') is True
        assert units_equivalent('', 'UND') is False
        assert units_equivalent('UND', None) is False
