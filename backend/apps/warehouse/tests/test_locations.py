"""SYSPCC-025 — layout de ubicaciones: {Pabellón}{Sección}-{Nivel} (formato oficial intacto)."""
import re

import pytest

from apps.warehouse.services import locations


@pytest.mark.parametrize('value,expected', [
    ('F3-2', 'F3-2'),
    ('b3-2', 'B3-2'),
    (' A7-5 ', 'A7-5'),
    ('K6-1', 'K6-1'),
    ('C4-3', 'C4-3'),
])
def test_valid_locations_are_normalized(value, expected):
    assert locations.parse_location(value).code == expected


@pytest.mark.parametrize('value', [
    'F9-7',    # sección y nivel inexistentes
    'Z1-1',    # pabellón inexistente
    'A3-6',    # nivel fuera de 1-5
    'A8-1',    # A tiene 7 secciones
    'C5-1',    # C tiene 4 secciones
    'A0-1',    # sección 0
    'A03-1',   # ceros a la izquierda
    'PISO 2',  # piso sin pabellón no es ubicación exacta
    'A3',      # sin nivel
    '',
    None,
    'B-3-2',
])
def test_invalid_locations_are_rejected(value):
    assert locations.parse_location(value) is None
    assert locations.is_valid_location(value) is False


def test_validate_location_raises_es_pe_message():
    with pytest.raises(ValueError, match='no existe en el layout del almacén'):
        locations.validate_location('F9-7')


def test_floor_of_pavilion():
    assert {locations.floor_of(p) for p in 'ABCDE'} == {1}
    assert {locations.floor_of(p) for p in 'FGHIJK'} == {2}


def test_documented_section_counts_for_pavilions_a_to_e():
    assert [locations.LAYOUT_SECTIONS[p] for p in 'ABCDE'] == [7, 7, 4, 4, 6]


@pytest.mark.parametrize('raw,floor', [
    ('PISO 2', 2), ('PISO 2 ', 2), ('piso  1', 1), ('Piso 1', 1),
    ('PISO 3', None), ('PISO', None), ('F3-2', None), (None, None), (2, None),
])
def test_parse_floor_label(raw, floor):
    assert locations.parse_floor_label(raw) == floor


def test_location_status_and_display():
    assert locations.location_status('F3-2', 2) == locations.EXACT
    assert locations.location_status('', 2) == locations.FLOOR_ONLY
    assert locations.location_status('', None) == locations.NONE
    # legacy free text is not an exact location
    assert locations.location_status('Estante A-3', None) == locations.NONE
    assert locations.location_status('Estante A-3', 2) == locations.FLOOR_ONLY
    assert locations.location_display('F3-2', 2) == 'F3-2'
    assert locations.location_display('', 2) == 'PISO 2'
    assert locations.location_display('', None) == ''


def test_db_regex_agrees_with_parser_for_every_cell_of_the_layout():
    regex = re.compile(locations.db_exact_location_regex())
    for pavilion, sections in locations.LAYOUT_SECTIONS.items():
        for section in range(0, sections + 3):
            for level in range(0, 7):
                code = f'{pavilion}{section}-{level}'
                assert bool(regex.match(code)) == locations.is_valid_location(code), code


def test_layout_payload_shape():
    payload = locations.layout_payload()
    assert [f['floor'] for f in payload['floors']] == [1, 2]
    assert [p['code'] for p in payload['floors'][0]['pavilions']] == list('ABCDE')
    assert [p['code'] for p in payload['floors'][1]['pavilions']] == list('FGHIJK')
    assert payload['levels'] == [1, 2, 3, 4, 5]
    assert payload['pattern']
