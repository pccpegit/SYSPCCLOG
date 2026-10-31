"""
Read-only catalog lookups for the RQ capture and stock-check screens (SYSPCC-026).

The warehouse owns the catalog (`warehouse.Inventory`) and the stock
(`warehouse.InventoryStock`); this module only READS them so the RQ side can
let a requester pick a product and let logistics see what is available. It
never writes to the warehouse and never exposes costs, exact locations or
supplier data.

Pool semantics
--------------
"Available" always means the CENTRAL pool: `InventoryStock` rows with
`warehouse_type=CENTRAL`, `project IS NULL` and `department IS NULL`. This is
the same pool the receiving flow (`_on_material_received`) feeds and the
warehouse ledger (SYSPCC-025) sums, so the number a requester sees matches what
the warehouse can actually hand out.
"""

import logging
import unicodedata
from decimal import Decimal

from django.db.models import Case, DecimalField, IntegerField, Q, Sum, Value, When
from django.db.models.functions import Coalesce

from apps.core.enums import WarehouseOriginChoices
from apps.warehouse.models import Inventory, InventoryStock

logger = logging.getLogger(__name__)

CATALOG_PAGE_SIZE = 20
CATALOG_MIN_SEARCH_LENGTH = 2
CATALOG_MAX_SEARCH_LENGTH = 100
CATALOG_MAX_SEARCH_TOKENS = 5

_QUANTITY = DecimalField(max_digits=14, decimal_places=3)
_ZERO = Value(Decimal('0'), output_field=_QUANTITY)


def _pool_rows_q(prefix: str = '') -> Q:
    """Q matching the CENTRAL pool rows; `prefix` is the relation path to InventoryStock."""
    return Q(**{
        f'{prefix}warehouse_type': WarehouseOriginChoices.CENTRAL,
        f'{prefix}project__isnull': True,
        f'{prefix}department__isnull': True,
    })


def normalize_search_term(raw) -> str:
    """
    Clean and bound a user-typed search term: control characters become spaces,
    whitespace is collapsed and the length is capped.

    Control characters must not reach the database: a NUL byte truncates a
    SQLite LIKE pattern to "%" (matching the whole catalog) and makes PostgreSQL
    reject the statement outright.
    """
    if not isinstance(raw, str):
        return ''
    printable = ''.join(ch if ch.isprintable() else ' ' for ch in raw)
    return ' '.join(printable.split())[:CATALOG_MAX_SEARCH_LENGTH]


def strip_combining_marks(text: str) -> str:
    """
    The base letters of `text`: decompose (NFD) and drop the combining marks (category Mn),
    so "ñ" becomes "n" and "n" + U+0303 becomes "n" too.

    One definition for the whole search: the length limit, the token filter and the
    regular expression must all see the SAME text. Counting the typed code points while
    matching on the base letters let a term of only combining marks (which has length >= 2
    and zero letters) turn into an empty pattern, and an empty regular expression matches
    every row.
    """
    return ''.join(
        ch for ch in unicodedata.normalize('NFD', text) if unicodedata.category(ch) != 'Mn'
    )


def search_words(raw) -> list:
    """
    The words that will really be searched for `raw`: cleaned (see normalize_search_term),
    without combining marks, and without the words that were nothing but marks (a stray
    accent typed after a space is not something to look for; it must not use up one of the
    CATALOG_MAX_SEARCH_TOKENS slots either). Not capped here: the caller caps the filters
    but still ranks on the whole term.
    """
    return strip_combining_marks(normalize_search_term(raw)).split()


# Letters that people type with or without a written accent. Each class lists both
# cases explicitly: PostgreSQL's case folding of non-ASCII letters depends on the
# database locale, so `~*` alone cannot be trusted with "Á" vs "á".
_ACCENT_CLASSES = {
    'a': 'aAáÁàÀâÂäÄãÃ',
    'e': 'eEéÉèÈêÊëË',
    'i': 'iIíÍìÌîÎïÏ',
    'o': 'oOóÓòÒôÔöÖõÕ',
    'u': 'uUúÚùÙûÛüÜ',
    'n': 'nNñÑ',
}


# Characters with a meaning in both regular-expression dialects (Python `re` and
# PostgreSQL's POSIX engine); only these are escaped, everything else is literal.
_REGEX_METACHARACTERS = frozenset('\\.^$*+?()[]{}|')


def accent_insensitive_pattern(text: str) -> str:
    """
    Regular expression (valid for Python `re`, used by SQLite, and for PostgreSQL's
    POSIX engine) matching `text` literally, ignoring case AND written accents:
    "proteccion" matches "Protección", "senal" matches "Señal" and vice versa.

    This replaces `unaccent`, which needs a PostgreSQL extension and does not exist
    in SQLite: the same pattern behaves identically in both. Regex metacharacters are
    escaped, so user text can never inject regex syntax, and the pattern is a plain
    sequence of single-character classes (no repetition, so no catastrophic
    backtracking).
    """
    # NFD splits "ñ" into "n" + a combining mark; dropping the marks leaves the base letter.
    base = strip_combining_marks(text)
    parts = []
    for ch in base:
        accents = _ACCENT_CLASSES.get(ch.lower())
        if accents:
            parts.append(f'[{accents}]')
        elif ch in _REGEX_METACHARACTERS:
            parts.append('\\' + ch)
        else:
            parts.append(ch)
    return ''.join(parts)


def search_catalog(raw_term):
    """
    Inventory products matching `raw_term`, annotated with `available` (CENTRAL pool).

    - Terms shorter than CATALOG_MIN_SEARCH_LENGTH return an empty queryset
      (the caller is a type-ahead; an empty box must not dump the catalog). The length
      is measured on what is actually searched, i.e. after cleaning and WITHOUT combining
      marks: "á" is one letter however the keyboard sent it, and a term of only
      accents is an empty term.
    - Every whitespace-separated token (at most CATALOG_MAX_SEARCH_TOKENS) must
      match the code or the description (substring, ignoring case and written
      accents), so "casco blanco" narrows instead of widening and "proteccion"
      finds "Protección auditiva".
    - Ordered by relevance (exact code, code prefix, description prefix, rest)
      and then by code, so the 20-row cap keeps the most likely matches.

    `%` and `_` are plain characters: the term is turned into an escaped regular
    expression (see accent_insensitive_pattern), never into a LIKE pattern.
    """
    words = search_words(raw_term)
    term = ' '.join(words)
    # Checked BEFORE any pattern is built: a pattern made of zero letters is the empty
    # regular expression, which matches every row of the catalog.
    if len(term) < CATALOG_MIN_SEARCH_LENGTH:
        return Inventory.objects.none()

    queryset = Inventory.objects.all()
    for word in words[:CATALOG_MAX_SEARCH_TOKENS]:
        pattern = accent_insensitive_pattern(word)
        queryset = queryset.filter(
            Q(product_code__iregex=pattern) | Q(description__iregex=pattern)
        )
    full_term = accent_insensitive_pattern(term)

    return (
        queryset
        .annotate(
            available=Coalesce(
                Sum('stocks__quantity', filter=_pool_rows_q('stocks__')),
                _ZERO,
                output_field=_QUANTITY,
            ),
            search_rank=Case(
                When(product_code__iregex=f'^{full_term}$', then=Value(0)),
                When(product_code__iregex=f'^{full_term}', then=Value(1)),
                When(description__iregex=f'^{full_term}', then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            ),
        )
        .order_by('search_rank', 'product_code')
    )


def central_pool_available(inventory_ids) -> dict:
    """
    {inventory_id: Decimal} with the CENTRAL pool quantity of each product.
    Products without stock rows are simply absent (callers default to 0).
    """
    ids = {i for i in inventory_ids if i}
    if not ids:
        return {}
    rows = (
        InventoryStock.objects
        .filter(_pool_rows_q(), inventory_id__in=ids)
        .values('inventory_id')
        .annotate(total=Sum('quantity'))
    )
    return {row['inventory_id']: row['total'] or Decimal('0') for row in rows}
