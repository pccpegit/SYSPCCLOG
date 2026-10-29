// ============================================================
// stockCheck.js — SYSPCC-026: pure logic of the logistics stock check.
//
// Built on GET /requests/{id}/stock-availability/ (per line: requested vs the
// CENTRAL pool net of what is owed to other RQs) and PATCH .../update-items/.
//
// Everything here is ADVISORY. The stock-check decision (`has_stock`) stays with
// logistics and the workflow does exactly the same as before: the warnings
// only ask for an explicit confirmation, they never block the transition.
// ============================================================

import { extractCodedDetail, extractErrorMessage } from './apiErrors';
import { formatQty } from './quantity';

/**
 * Vocabulary of the `coverage` hint — the ONE table behind both the badge (`describeCoverage`)
 * and the sentence under the figures, so a card can never say "Stock suficiente" in one place and
 * "Cubre todo" in another. `null` coverage = nothing to compare.
 */
export const COVERAGE_META = {
  FULL:    { label: 'Stock suficiente', tone: 'green',  hint: 'Lo disponible cubre lo solicitado.' },
  PARTIAL: { label: 'Stock parcial',    tone: 'yellow', hint: 'Lo disponible no alcanza para todo lo solicitado.' },
  NONE:    { label: 'Sin stock',        tone: 'red',    hint: 'No hay stock disponible de este producto.' },
  // The server could not compare the line with the pool because the units differ (it never
  // converts). Nothing is claimed about coverage; the row-specific sentence comes from
  // `describeUnitMismatch`.
  NOT_COMPARABLE: { label: 'Unidad distinta', tone: 'amber', hint: 'El stock está en otra unidad que la solicitada: compare a mano.' },
};

export const LINK_STATUS_LABELS = {
  LINKED:      'Vinculado al catálogo',
  OFF_CATALOG: 'Fuera de catálogo',
  UNLINKED:    'Sin vincular',
};

function coverageMeta(coverage) {
  return typeof coverage === 'string' && Object.hasOwn(COVERAGE_META, coverage) ? COVERAGE_META[coverage] : null;
}

/** "Stock parcial. Lo disponible no alcanza…" — the sentence under the figures; null when there is nothing to compare. */
export function describeCoverageSentence(coverage) {
  const meta = coverageMeta(coverage);
  return meta ? `${meta.label}. ${meta.hint}` : null;
}

/**
 * @param {'FULL'|'PARTIAL'|'NONE'|'NOT_COMPARABLE'|null} [coverage] from stock-availability
 * @param {'LINKED'|'OFF_CATALOG'|'UNLINKED'} [linkStatus]
 * @param {boolean} [loading] availability is still being fetched
 */
export function describeCoverage(coverage, linkStatus, loading = false) {
  const meta = coverageMeta(coverage);
  if (meta) return { tone: meta.tone, text: meta.label };
  if (linkStatus === 'UNLINKED') return { tone: 'amber', text: 'Sin vincular' };
  if (linkStatus === 'OFF_CATALOG') return { tone: 'gray', text: 'Fuera de catálogo' };
  if (loading) return { tone: 'gray', text: 'Consultando…' };
  return { tone: 'gray', text: 'Sin datos de stock' };
}

/**
 * True when the line is asked in a different unit than the product's stock (the server answers
 * `coverage: 'NOT_COMPARABLE'` + `unit_mismatch: true`). Either signal is enough: a row in that
 * state must never be read as covered, partial or empty.
 */
export function isUnitMismatch(row) {
  return Boolean(row) && (row.unit_mismatch === true || row.coverage === 'NOT_COMPARABLE');
}

/**
 * Unit the stock figures (available, committed, net) are written in: the PRODUCT's, not the line's
 * (`product_unit`, else the linked product's `unit`). Equivalent spellings (EA / UND) are not the
 * same text, so labelling the figures with the line's unit would be wrong whenever they differ.
 * The line's own unit is only a fallback when units are not in conflict.
 */
export function stockUnitOf(row) {
  if (!row) return '';
  const own = row.product_unit ?? row.inventory_item?.unit;
  if (own != null) return String(own).trim();
  return isUnitMismatch(row) ? '' : String(row.unit ?? '').trim();
}

/** "Unidad distinta: el stock está en EA y el RQ pide en CAJA." (blank units are spelled out). */
export function describeUnitMismatch(row) {
  const stockUnit = stockUnitOf(row);
  const askedUnit = String(row?.unit ?? '').trim();
  const stockPart = stockUnit ? `el stock está en ${stockUnit}` : 'el producto no tiene unidad definida';
  const askedPart = askedUnit ? `el RQ pide en ${askedUnit}` : 'el RQ no indica unidad';
  return `Unidad distinta: ${stockPart} y ${askedPart}.`;
}

/**
 * Sentence under the figures explaining how the net availability is reached, or '' when the pool
 * is not reduced. Only mentions what actually took stock: other RQs and/or the earlier lines of
 * this same RQ (a line only sees what the previous lines of the same product left).
 */
export function describeNetBreakdown(row) {
  if (!row || row.available_central == null || row.available_net == null) return '';
  if (row.available_central === row.available_net) return '';
  const unit = stockUnitOf(row);
  const withUnit = (value) => `${formatQty(value)}${unit ? ` ${unit}` : ''}`;
  const others = Number(row.committed_other_requests) > 0;
  const earlier = Number(row.committed_earlier_lines) > 0;
  const head = `Hay ${withUnit(row.available_central)} en el almacén central;`;
  if (others && earlier) {
    return `${head} ${withUnit(row.committed_other_requests)} están comprometidas con otros RQ y ${withUnit(row.committed_earlier_lines)} las toman los ítems anteriores de este RQ.`;
  }
  if (earlier) return `${head} los ítems anteriores de este RQ ya toman ${withUnit(row.committed_earlier_lines)}.`;
  return `${head} el resto está comprometido con otros RQ.`;
}

/** Stock part of the per-line summary that is written into the approval comment (the RQ history). */
export function summarizeAvailability(row) {
  if (isUnitMismatch(row)) {
    const stockUnit = stockUnitOf(row);
    return `unidad distinta: stock en ${stockUnit || 'sin unidad'}, RQ en ${String(row.unit ?? '').trim() || 'sin unidad'}`;
  }
  return row?.available_net != null ? `disponible neto: ${formatQty(row.available_net)}` : 'sin datos de stock';
}

/** { [item_id]: availabilityRow } */
export function indexAvailability(rows) {
  const out = {};
  (rows ?? []).forEach((row) => { out[row.item_id] = row; });
  return out;
}

/**
 * Suggested origin for a line from its coverage: 'stock' only when the pool
 * covers it entirely; partial stock suggests purchase (the whole RQ then goes
 * to purchase — an item is never split). Returns null when there is no data or
 * the units differ (nothing comparable to base a suggestion on).
 */
export function suggestSupply(row) {
  if (!row) return null;
  // Different units: there is no basis to suggest anything, the choice is explicitly logistics'.
  if (isUnitMismatch(row)) return null;
  return row.coverage === 'FULL' ? 'stock' : 'purchase';
}

/** The origin in effect: the user's explicit choice, else the suggestion, else null. */
export function effectiveSupply(itemId, choices, availabilityById) {
  return choices[itemId] ?? suggestSupply(availabilityById[itemId]);
}

/** Why a line is not fully covered by stock, or null when it is. */
export function describeCoverageGap(row) {
  if (!row) {
    return { reason: 'UNKNOWN', text: 'No se pudo consultar la disponibilidad de este ítem.' };
  }
  if (isUnitMismatch(row)) {
    return { reason: 'NOT_COMPARABLE', text: `${describeUnitMismatch(row)} No se pudo verificar la cobertura.` };
  }
  if (row.coverage === 'FULL') return null;
  if (row.coverage === 'PARTIAL') {
    return {
      reason: 'PARTIAL',
      text: `Stock parcial: hay ${formatQty(row.available_net)} de ${formatQty(row.requested)} ${row.unit} (faltan ${formatQty(row.shortfall)}).`,
    };
  }
  if (row.coverage === 'NONE') {
    return { reason: 'NONE', text: 'Sin stock disponible en el almacén central.' };
  }
  if (row.link_status === 'OFF_CATALOG') {
    return { reason: 'OFF_CATALOG', text: 'Fuera de catálogo: no pasa por el almacén.' };
  }
  return { reason: 'UNLINKED', text: 'Sin producto vinculado: no se puede verificar el stock.' };
}

/**
 * Lines marked "Atender de Stock" that the pool does not fully cover.
 * @returns {Array<{ itemId, line, description, reason, text }>}
 */
export function buildCoverageWarnings(items, choices, availabilityById) {
  const warnings = [];
  items.forEach((item, idx) => {
    if (effectiveSupply(item.id, choices, availabilityById) !== 'stock') return;
    const gap = describeCoverageGap(availabilityById[item.id]);
    if (!gap) return;
    warnings.push({
      itemId: item.id,
      line: item.line_number ?? idx + 1,
      description: item.description,
      reason: gap.reason,
      text: gap.text,
    });
  });
  return warnings;
}

/**
 * Body for PATCH update-items at confirmation time. The catalog link is saved
 * the moment it is picked, so here only the origin (STOCK/PURCHASE) and the
 * family ("Fuente") travel.
 *
 * `itemSources[id]` holds what the user picked in the list: undefined = untouched,
 * '' = "-- Sin fuente --" on purpose. Choosing nothing over a line that had a
 * family sends '' (the backend accepts it to clear it); otherwise the screen would
 * say "Sin fuente" while the server kept the old one.
 */
export function buildItemDecisions(items, choices, availabilityById, itemSources = {}) {
  return items.map((item) => {
    const origin = effectiveSupply(item.id, choices, availabilityById);
    const entry = {
      item_id: item.id,
      supply_source: origin === 'stock' ? 'STOCK' : 'PURCHASE',
    };
    const picked = itemSources[item.id];
    if (picked === undefined || picked === null) {
      if (item.item_source) entry.item_source = item.item_source;
    } else if (picked || item.item_source) {
      entry.item_source = picked;
    }
    return entry;
  });
}

/**
 * True when the catalog link of the line was proposed by the requester and
 * logistics has not confirmed it yet (`link_confirmed === false` in
 * stock-availability / the RQ line). Lines without the flag (older RQs, or an
 * API that does not send it) count as confirmed, and so do unlinked lines
 * (there is nothing to confirm).
 *
 * Advisory only: it never blocks the stock check.
 */
export function isLinkPending(item, row) {
  const kind = row?.link_status
    ?? (item?.inventory_item ? 'LINKED' : item?.is_off_catalog ? 'OFF_CATALOG' : 'UNLINKED');
  if (kind === 'UNLINKED') return false;
  const flag = typeof row?.link_confirmed === 'boolean' ? row.link_confirmed : item?.link_confirmed;
  return flag === false;
}

/**
 * update-items answers 200 even when some ids are not lines of this RQ (they
 * are reported in `ignored_item_ids` and never touched). For the stock check
 * that means the decisions were NOT all saved, so it counts as a failure.
 * @returns {string|null} error message, or null when everything was applied
 */
export function findUpdateItemsProblem(data) {
  const ignored = data?.ignored_item_ids;
  if (Array.isArray(ignored) && ignored.length > 0) {
    return 'Algunos ítems ya no pertenecen a este requerimiento. Actualice la página e intente de nuevo.';
  }
  return null;
}

/**
 * update-items refuses (409) to touch lines whose material already moved in the warehouse:
 *  - ITEMS_ALREADY_RECEIVED: a receipt exists, so the catalog product / "fuera de catálogo" cannot change;
 *  - ITEMS_ALREADY_DISPATCHED: a dispatch exists, so nothing about the line can change.
 * Both answer `{ detail, code, item_ids }`. The codes are compared literally (they are UPPERCASE,
 * like the other codes of this endpoint).
 */
export const LOCKED_ITEM_REASONS = {
  ITEMS_ALREADY_RECEIVED: 'RECEIVED',
  ITEMS_ALREADY_DISPATCHED: 'DISPATCHED',
};

/** What each locked line shows under its product. */
export const LOCKED_ITEM_LABELS = {
  RECEIVED: 'Ya se recibió en el almacén: su producto no se puede cambiar ni marcar como fuera de catálogo.',
  DISPATCHED: 'Ya tiene despachos del almacén: no se puede modificar.',
};

/**
 * @returns {{ reason: 'RECEIVED'|'DISPATCHED', itemIds: number[] } | null} null when the error is not
 *          one of the "line already moved" 409s.
 */
export function getLockedItems(err) {
  if (err?.response?.status !== 409) return null;
  const data = err.response.data;
  const code = data && typeof data === 'object' ? data.code : undefined;
  if (typeof code !== 'string' || !Object.hasOwn(LOCKED_ITEM_REASONS, code)) return null;
  const ids = Array.isArray(data.item_ids) ? data.item_ids.filter((id) => Number.isInteger(id)) : [];
  return { reason: LOCKED_ITEM_REASONS[code], itemIds: [...new Set(ids)] };
}

/** { [item_id]: 'RECEIVED'|'DISPATCHED' } to merge into the page's locked lines. */
export function lockedItemsFromError(err) {
  const locked = getLockedItems(err);
  if (!locked) return {};
  return Object.fromEntries(locked.itemIds.map((id) => [id, locked.reason]));
}

/** "2", "2 y 3", "1, 2 y 3" — the line numbers (as the user sees them) of the given ids. */
function joinLineNumbers(itemIds, items) {
  const byId = new Map((items ?? []).map((item, idx) => [item.id, item.line_number ?? idx + 1]));
  const numbers = [...new Set(itemIds.map((id) => byId.get(id)).filter((n) => n != null))].sort((a, b) => a - b);
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return String(numbers[0]);
  return `${numbers.slice(0, -1).join(', ')} y ${numbers[numbers.length - 1]}`;
}

const RECEIVED_FALLBACK = 'Algunos ítems ya fueron recibidos en el almacén y no se puede cambiar su producto de catálogo ni marcarlos como fuera de catálogo.';

/**
 * Spanish, action-oriented message for a failed update-items call.
 * @param {object} err
 * @param {Array<{id: number, line_number?: number}>} [items] the RQ lines, to name the affected ones
 */
export function describeUpdateItemsError(err, items) {
  const status = err?.response?.status;
  if (!err?.response) {
    return 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.';
  }
  if (status === 409) {
    const locked = getLockedItems(err);
    if (locked?.reason === 'RECEIVED') {
      const lines = joinLineNumbers(locked.itemIds, items);
      if (lines) {
        return locked.itemIds.length === 1
          ? `El ítem ${lines} ya fue recibido en el almacén: no se puede cambiar su producto ni marcarlo como fuera de catálogo.`
          : `Los ítems ${lines} ya fueron recibidos en el almacén: no se puede cambiar su producto ni marcarlos como fuera de catálogo.`;
      }
      return extractCodedDetail(err, RECEIVED_FALLBACK);
    }
    return extractErrorMessage(
      err,
      'Los ítems no se pueden modificar porque el requerimiento cambió. Actualice la página.',
    );
  }
  if (status === 403) return 'No tiene permiso para modificar los ítems de este requerimiento.';
  if (status === 404) return 'El requerimiento ya no existe o no está disponible. Actualice la página.';
  if (status === 429) return 'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.';
  if (status === 400) return extractErrorMessage(err, 'Los datos de los ítems no son válidos.');
  return extractErrorMessage(err, 'No se pudieron guardar los ítems. Intente nuevamente.');
}
