"""
Matching of free-text destinations ("USUARIO/DESTINO") against ``core.Personal``.

Rules (SYSPCC-025): never fuzzy. A destination is linked automatically only when
exactly ONE worker has the same set of name tokens (accent-insensitive,
order-insensitive). Two or more -> ambiguous (not linked). None -> no match.

Names are personal data: callers must never log them. Only counts and keys of
already-normalized text may travel to responses that the user is entitled to see.
"""
import unicodedata
from collections import defaultdict
from dataclasses import dataclass

MATCHED = 'matched'
AMBIGUOUS = 'ambiguous'
NONE = 'none'


def _tokens(name) -> list[str]:
    if not isinstance(name, str):
        return []
    decomposed = unicodedata.normalize('NFKD', name)
    stripped = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = ''.join(ch if ch.isalnum() else ' ' for ch in stripped.lower())
    return sorted(cleaned.split())


def normalize_name(name) -> str:
    """Accent-insensitive, lower-case, alphanumeric tokens sorted and joined."""
    return ' '.join(_tokens(name))


# Public alias: the "destination key" used by the link-personal endpoint.
destination_key = normalize_name


@dataclass(frozen=True)
class MatchResult:
    status: str
    personal_id: int | None = None
    candidates: int = 0


class PersonalIndex:
    """In-memory index normalized-name -> Personal ids (built once per request/import)."""

    def __init__(self, rows=None):
        self._by_key: dict[str, list[int]] = defaultdict(list)
        if rows is None:
            from apps.core.models import Personal

            rows = Personal.objects.values_list('id', 'apellidos_nombres')
        for pk, full_name in rows:
            key = normalize_name(full_name)
            if key:
                self._by_key[key].append(pk)

    def match(self, name) -> MatchResult:
        key = normalize_name(name)
        if not key:
            return MatchResult(NONE, None, 0)
        ids = self._by_key.get(key, [])
        if len(ids) == 1:
            return MatchResult(MATCHED, ids[0], 1)
        if len(ids) > 1:
            return MatchResult(AMBIGUOUS, None, len(ids))
        return MatchResult(NONE, None, 0)
