"""
Excel export hardening helpers — SYSPCC-013 FIX 1 / FIX 2.

Shared across every `export`/`export_excel` action (administracion, core,
warehouse) so the CSV/Excel-formula-injection defense and the row-count cap
live in one place instead of being re-implemented per view.
"""
import logging

logger = logging.getLogger(__name__)

# Prefixes that Excel/LibreOffice/Google Sheets interpret as the start of a
# formula when a cell is opened. A free-text field (nombres, detalle, cargo,
# razon_social, description, ...) coming straight from user input must never
# reach a spreadsheet cell unescaped, or a value like `=cmd(...)` becomes a
# live formula the moment the file is opened (CSV/Excel injection).
_FORMULA_PREFIXES = ('=', '+', '-', '@')

# SYSPCC-013 FIX 2: hard cap on rows written into a single export workbook.
# Building the whole workbook in memory over an unbounded queryset risks OOM
# on a large table. We choose truncate-with-a-clear-warning over a 400 here:
# these exports are "download what matches my filters" reports consumed by
# office/warehouse staff, not paginated data APIs — silently refusing the
# whole download over a hard limit is a worse experience than handing back
# the first MAX_EXPORT_ROWS rows plus a visible notice to narrow the filters.
MAX_EXPORT_ROWS = 10000


def sanitize_excel_value(value):
    """
    Prefix a string value with a leading apostrophe if it starts with a
    character Excel/Sheets would interpret as a formula trigger.

    Non-string values are returned unchanged — only free-text fields need
    this; numbers/dates/decimals are never attacker-controlled formula
    payloads. Safe to call on every cell value unconditionally.
    """
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def truncate_for_export(queryset, *, max_rows: int | None = None):
    """
    Slice `queryset` to at most `max_rows` rows for an Excel export.

    `max_rows` defaults to the module-level `MAX_EXPORT_ROWS`, looked up at
    call time (not bound as a function-default) so tests can override it via
    `mock.patch('apps.core.utils.excel.MAX_EXPORT_ROWS', ...)` without every
    call site needing to thread the value through explicitly.

    Returns `(sliced_queryset, was_truncated)`. Callers should surface
    `was_truncated` to the user (e.g. as a leading warning row in the sheet)
    so a partial export is never mistaken for a complete one.
    """
    if max_rows is None:
        max_rows = MAX_EXPORT_ROWS
    total = queryset.count()
    if total > max_rows:
        logger.warning(
            'excel_export.truncated',
            extra={'total_rows': total, 'max_rows': max_rows},
        )
        return queryset[:max_rows], True
    return queryset, False
