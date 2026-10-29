"""
Warehouse location layout — single source of truth (SYSPCC-025).

The official format is ``{Pabellón}{Sección}-{Nivel}`` (e.g. ``B3-2``), defined
by gerencia in CLAUDE.md ("Ciclo Operativo del Almacén") and NOT modified here:
this module only validates against it.

* Pavilions A-K. Floor 1 = A-E, floor 2 = F-K.
* Levels 1-5.
* Sections per pavilion: A=7, B=7, C=4, D=4, E=6 (CLAUDE.md). Pavilions F-K have
  no documented section count ("4 a 6" per the cycle definition); 6 is used as
  the upper bound. PENDING CONFIRMATION WITH THE WAREHOUSE (see SYSPCC-025).
  The "Contenedor" of pavilion B is not part of the format and is not supported.
"""
import re
from dataclasses import dataclass

# Pending confirmation with the warehouse for F-K (upper bound of "4 a 6").
LAYOUT_SECTIONS: dict[str, int] = {
    'A': 7, 'B': 7, 'C': 4, 'D': 4, 'E': 6,
    'F': 6, 'G': 6, 'H': 6, 'I': 6, 'J': 6, 'K': 6,
}
LEVELS: tuple[int, ...] = (1, 2, 3, 4, 5)
FLOOR_PAVILIONS: dict[int, str] = {1: 'ABCDE', 2: 'FGHIJK'}

LOCATION_RE = re.compile(r'^([A-K])([1-9]\d?)-([1-5])$')
# Public pattern (informative, for UI selects).
LOCATION_PATTERN = r'^[A-K]\d{1,2}-[1-5]$'

# Floor-only labels ("PISO 2", "piso 1 ") as they appear in the real workbook.
_FLOOR_LABEL_RE = re.compile(r'^PISO\s+([12])$', re.IGNORECASE)

EXACT = 'EXACT'
FLOOR_ONLY = 'FLOOR_ONLY'
NONE = 'NONE'


@dataclass(frozen=True)
class ParsedLocation:
    pavilion: str
    section: int
    level: int

    @property
    def code(self) -> str:
        return f'{self.pavilion}{self.section}-{self.level}'

    @property
    def floor(self) -> int:
        return floor_of(self.pavilion)


def floor_of(pavilion: str) -> int:
    """Floor (1 or 2) of a pavilion letter."""
    return 1 if pavilion.upper() in FLOOR_PAVILIONS[1] else 2


def normalize_location(value) -> str:
    """Strip + uppercase. Does not validate."""
    return (value or '').strip().upper() if isinstance(value, str) else ''


def parse_location(value) -> ParsedLocation | None:
    """Parse and range-check a location. ``None`` when it is not a valid one."""
    code = normalize_location(value)
    m = LOCATION_RE.match(code)
    if not m:
        return None
    pavilion, section, level = m.group(1), int(m.group(2)), int(m.group(3))
    if not 1 <= section <= LAYOUT_SECTIONS[pavilion]:
        return None
    return ParsedLocation(pavilion, section, level)


def is_valid_location(value) -> bool:
    return parse_location(value) is not None


def validate_location(value) -> ParsedLocation:
    """Return the parsed location or raise ``ValueError`` (es-PE message)."""
    parsed = parse_location(value)
    if parsed is None:
        shown = normalize_location(value) or str(value)
        raise ValueError(f'La ubicación {shown} no existe en el layout del almacén.')
    return parsed


def parse_floor_label(value) -> int | None:
    """``'PISO 2'`` / ``'piso 2 '`` -> 2 (collapses whitespace). ``None`` otherwise."""
    if not isinstance(value, str):
        return None
    m = _FLOOR_LABEL_RE.match(' '.join(value.split()))
    return int(m.group(1)) if m else None


def location_status(location, floor) -> str:
    """EXACT if the location is valid; FLOOR_ONLY if only the floor is known; else NONE."""
    if is_valid_location(location):
        return EXACT
    return FLOOR_ONLY if floor else NONE


def location_display(location, floor) -> str:
    """Exact location if valid; else 'PISO n' if the floor is known; else ''."""
    parsed = parse_location(location)
    if parsed:
        return parsed.code
    return f'PISO {floor}' if floor else ''


def db_exact_location_regex() -> str:
    """
    Regex (portable SQLite/PostgreSQL ``__regex``) matching exactly the valid
    locations of the layout, generated from ``LAYOUT_SECTIONS`` so filtering in
    the database and ``parse_location`` never disagree.
    """
    parts = []
    for pavilion, sections in LAYOUT_SECTIONS.items():
        alt = '|'.join(str(n) for n in range(1, sections + 1))
        parts.append(f'{pavilion}(?:{alt})')
    return '^(?:' + '|'.join(parts) + ')-[1-5]$'


def layout_payload() -> dict:
    """Payload for the UI selects (GET inventory/location-layout/)."""
    return {
        'floors': [
            {
                'floor': floor,
                'pavilions': [
                    {'code': p, 'sections': LAYOUT_SECTIONS[p]} for p in letters
                ],
            }
            for floor, letters in FLOOR_PAVILIONS.items()
        ],
        'levels': list(LEVELS),
        'pattern': LOCATION_PATTERN,
    }
