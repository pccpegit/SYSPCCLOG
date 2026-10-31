"""
Units of measure as written on RQ lines and catalog products (SYSPCC-026).

Requesters and the warehouse catalog write the same unit in different ways ("UND",
"und.", "Unidad", "EA" from the SAP-style imports, "PZA"). Quantities can only be
compared when both sides are the same unit, so the stock-availability report asks
here whether two spellings are equivalent before comparing any number.

Only the "unit" family is folded together (a piece is a piece). Every other unit
(KG, M, GLB, PAR, ...) is compared by its normalized spelling: nothing is converted
(no KG <-> TN, no M <-> CM) because a silent conversion is worse than an explicit
"not comparable".
"""

import unicodedata

# Spellings that all mean "one piece". Compared after `normalize_unit`.
_UNIT_ALIASES = frozenset({
    'EA', 'UND', 'UNID', 'UNIDAD', 'U', 'PZA', 'PIEZA',
    # plurals people also type
    'UNDS', 'UNIDS', 'UNIDADES', 'PZAS', 'PIEZAS',
})
_CANONICAL_PIECE = 'UND'


def normalize_unit(raw) -> str:
    """
    Comparable form of a unit: upper case, no accents, no dots, spaces collapsed,
    with every "piece" spelling folded into one. Never meant to be displayed.
    Anything that is not text normalizes to ''.
    """
    if not isinstance(raw, str):
        return ''
    decomposed = unicodedata.normalize('NFD', raw)
    base = ''.join(ch for ch in decomposed if unicodedata.category(ch) != 'Mn')
    text = ' '.join(base.replace('.', ' ').upper().split())
    return _CANONICAL_PIECE if text in _UNIT_ALIASES else text


def units_equivalent(left, right) -> bool:
    """
    True when `left` and `right` are the same unit once normalized.

    Two blank units are equal (nothing declared on either side, nothing to contradict);
    a blank next to a real unit is not.
    """
    return normalize_unit(left) == normalize_unit(right)
