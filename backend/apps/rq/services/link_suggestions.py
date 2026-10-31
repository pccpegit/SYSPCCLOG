"""
SYSPCC-026 · Fase 0/1 — Sugerencias de vínculo RQ ↔ catálogo. SOLO LECTURA.

Para los ítems de RQ que no tienen producto de catálogo (`inventory_item`) ni la marca
"fuera de catálogo" (`is_off_catalog`) propone, SIN APLICAR NADA, a qué producto del
almacén podrían corresponder. Quien decide es Logística, en la verificación de stock
(`update-items`), que además deja el sello de confirmación.

Por qué existe: la Fase 3 hará que el motor mueva stock solo con vínculos confirmados y
elimine el match difuso actual (`description__icontains` / primera palabra de la
descripción). Antes de activarla hay que vincular los RQs en vuelo, y para eso se necesita
una lista de candidatos que NO repita esa adivinanza.

Regla de oro: coincidencia EXACTA, nunca parcial.

* CODIGO_EXACTO: una palabra completa de la descripción del ítem es el `product_code` de un
  producto (sin distinguir mayúsculas). "CEM-001 Cemento" propone CEM-001; "CEM-0010" no
  propone CEM-001 y "Cemento" no propone un producto con código "CEM". Los códigos de menos
  de `MIN_CODE_LENGTH` caracteres no se usan: una palabra corta coincidiría por azar.
* DESCRIPCION_EXACTA: la descripción completa del ítem es la del producto, ignorando
  mayúsculas, tildes y espacios repetidos. "Casco" no propone "Casco de seguridad blanco".

Si la evidencia apunta a más de un producto (dos códigos en la misma descripción, dos
productos con la misma descripción, o un código y una descripción que no coinciden entre
sí) el resultado es AMBIGUO y se listan los candidatos: nunca se elige uno.

Solo ejecuta SELECT: dos consultas en total (ítems y catálogo), sin importar cuántos RQs
haya, y no llama a ningún servicio de escritura.
"""
from collections import defaultdict

from apps.rq.models import RequestItem
from apps.rq.services.request_catalog import strip_combining_marks
from apps.rq.services.stock_diagnostics import TERMINAL_STATUSES
from apps.warehouse.models import Inventory

MIN_CODE_LENGTH = 3

BASIS_CODE = 'CODIGO_EXACTO'
BASIS_DESCRIPTION = 'DESCRIPCION_EXACTA'

STATUS_SUGGESTED = 'SUGERIDO'
STATUS_AMBIGUOUS = 'AMBIGUO'
STATUS_NO_MATCH = 'SIN_COINCIDENCIA'

# Puntuación que rodea a un código al escribirlo en una frase: "(CEM-001)", "CEM-001,".
# Los guiones, puntos y barras NO se recortan: forman parte de muchos códigos.
_EDGE_PUNCTUATION = ' \t\r\n,;:()[]{}"\'¿?¡!'


def normalize_text(text) -> str:
    """Minúsculas, sin tildes y con los espacios colapsados (para comparar, nunca para mostrar)."""
    if not isinstance(text, str):
        return ''
    return ' '.join(strip_combining_marks(text).casefold().split())


def code_tokens(text) -> set:
    """
    Palabras completas de `text` que podrían ser un código de producto, normalizadas.

    Se parte por espacios y se recorta la puntuación de los bordes de cada palabra; no se
    parte por guiones ni puntos porque forman parte de los códigos. Un punto al final puede
    ser el de la oración ("pedir CEM-001.") o parte del código ("TUB."): se prueban ambas
    lecturas, sin que eso permita ninguna coincidencia parcial.
    """
    if not isinstance(text, str):
        return set()
    tokens = set()
    for raw in text.split():
        token = normalize_text(raw.strip(_EDGE_PUNCTUATION))
        for variant in {token, token.rstrip('.')}:
            if len(variant) >= MIN_CODE_LENGTH:
                tokens.add(variant)
    return tokens


class _CatalogIndex:
    """El catálogo en memoria, indexado por código y por descripción normalizados."""

    def __init__(self):
        # Listas, no un producto: `product_code` es único solo sin normalizar, así que "ab-1"
        # y "AB-1" son dos productos con el mismo código normalizado y no se elige uno.
        self.by_code = defaultdict(list)
        self.by_description = defaultdict(list)
        # Sin `.iterator()`: en PostgreSQL abre un cursor del lado del servidor, que no
        # funciona detrás de un pooler en modo transacción (el pool de DigitalOcean) y aquí no ahorra nada,
        # porque el catálogo se indexa completo en memoria de todas formas.
        for inv in Inventory.objects.only('id', 'product_code', 'description', 'unit'):
            code = normalize_text(inv.product_code)
            if len(code) >= MIN_CODE_LENGTH:
                self.by_code[code].append(inv)
            description = normalize_text(inv.description)
            if description:
                self.by_description[description].append(inv)


def _candidate(inv):
    return {
        'inventory_id': inv.pk,
        'product_code': inv.product_code,
        'description': inv.description,
        'unit': inv.unit,
    }


def _evaluate(item, catalog):
    """(status, basis, [Inventory]) para un ítem."""
    by_code = {
        inv.pk: inv
        for token in code_tokens(item.description)
        for inv in catalog.by_code.get(token, [])
    }
    by_description = {
        inv.pk: inv for inv in catalog.by_description.get(normalize_text(item.description), [])
    }

    if by_code and by_description:
        # Código y descripción tienen que apuntar al MISMO producto; si no, hay que mirarlo.
        if set(by_code) == set(by_description) and len(by_code) == 1:
            return STATUS_SUGGESTED, BASIS_CODE, list(by_code.values())
        merged = {**by_code, **by_description}
        return STATUS_AMBIGUOUS, BASIS_CODE, list(merged.values())
    if by_code:
        status = STATUS_SUGGESTED if len(by_code) == 1 else STATUS_AMBIGUOUS
        return status, BASIS_CODE, list(by_code.values())
    if by_description:
        status = STATUS_SUGGESTED if len(by_description) == 1 else STATUS_AMBIGUOUS
        return status, BASIS_DESCRIPTION, list(by_description.values())
    return STATUS_NO_MATCH, '', []


def suggest_catalog_links(*, include_terminal=False, rq_number=None):
    """
    Sugerencias para los ítems sin producto de catálogo ni marca de fuera de catálogo.

    Args:
        include_terminal: también RQs cerrados, cancelados y rechazados (histórico).
        rq_number: limita a un RQ (coincidencia exacta del número).

    Returns:
        {'rows': [...], 'summary': {...}}. Los `rows` van ordenados por RQ y línea.
    """
    items = (
        RequestItem.objects
        .filter(inventory_item__isnull=True, is_off_catalog=False)
        .select_related('request__project', 'request__department')
        .order_by('request__rq_number', 'line_number')
    )
    if not include_terminal:
        items = items.exclude(request__status__in=TERMINAL_STATUSES)
    if rq_number:
        items = items.filter(request__rq_number=rq_number)

    items = list(items)
    catalog = _CatalogIndex() if items else None

    rows = []
    counts = defaultdict(int)
    requests_seen = set()
    for item in items:
        status, basis, matches = _evaluate(item, catalog)
        req = item.request
        scope = req.project or req.department
        counts[status] += 1
        requests_seen.add(req.pk)
        rows.append({
            'item_id': item.pk,
            'request_id': req.pk,
            'rq_number': req.rq_number,
            'flow': req.flow,
            'request_status': req.status,
            'scope_code': scope.code if scope else '',
            'line_number': item.line_number,
            'description': item.description,
            'quantity': item.quantity,
            'unit': item.unit,
            'status': status,
            'basis': basis,
            'candidates': [_candidate(inv) for inv in matches],
            # Unidad distinta a la del catálogo = señal de que quizá no es el mismo producto.
            'unit_mismatch': bool(matches) and all(
                normalize_text(inv.unit) != normalize_text(item.unit) for inv in matches
            ),
        })

    summary = {
        'include_terminal': include_terminal,
        'total_items': len(rows),
        'total_requests': len(requests_seen),
        'suggested': counts[STATUS_SUGGESTED],
        'ambiguous': counts[STATUS_AMBIGUOUS],
        'no_match': counts[STATUS_NO_MATCH],
    }
    return {'rows': rows, 'summary': summary}

