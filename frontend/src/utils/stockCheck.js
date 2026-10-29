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

import { extractErrorMessage } from './apiErrors';
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
 * @param {'FULL'|'PARTIAL'|'NONE'|null} [coverage] from stock-availability
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

/** { [item_id]: availabilityRow } */
export function indexAvailability(rows) {
  const out = {};
  (rows ?? []).forEach((row) => { out[row.item_id] = row; });
  return out;
}

/**
 * Suggested origin for a line from its coverage: 'stock' only when the pool
 * covers it entirely; partial stock suggests purchase (the whole RQ then goes
 * to purchase — an item is never split). Returns null when there is no data.
 */
export function suggestSupply(row) {
  if (!row) return null;
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

/** Spanish, action-oriented message for a failed update-items call. */
export function describeUpdateItemsError(err) {
  const status = err?.response?.status;
  if (!err?.response) {
    return 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.';
  }
  if (status === 409) {
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
