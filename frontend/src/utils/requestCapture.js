// ============================================================
// requestCapture.js — SYSPCC-026: pure logic of the "Nuevo Requerimiento" lines.
//
// Each line is picked from the warehouse catalog (`product`) or marked
// "fuera de catálogo" on purpose (services, items that never go through the
// warehouse). The UI never lets a line be sent with neither, and every line
// carries its "Fuente". The backend stays the authority (it validates again);
// this module only gives the form immediate, specific feedback.
// ============================================================

import { extractErrorMessage } from './apiErrors';
import { proposeItemSource } from '../data/requestCapture';

export const MSG_PICK_PRODUCT =
  'Seleccione un producto del catálogo o márquelo como fuera de catálogo.';
export const MSG_DESCRIBE_OFF_CATALOG = 'Describa el ítem fuera de catálogo.';
export const MSG_PICK_SOURCE = 'Seleccione la fuente del ítem.';
export const MSG_NO_ITEMS =
  'Agregue al menos un ítem: elija un producto del catálogo o márquelo como fuera de catálogo.';
export const MSG_QUANTITY = 'Ingrese la cantidad (mayor que 0).';

// Client-only keys of the lines. A monotonic counter (not `Date.now() + Math.random()`):
// a double keeps only ~4096 distinct fractions per millisecond at today's epoch and the form
// builds its 5 initial rows in the same millisecond, so ~0.24 % of page loads started with two
// rows sharing a key (typing in one filled its twin, deleting one deleted both). The prefix
// changes on every module (re)load so a hot reload cannot hand out a key already in use.
const KEY_PREFIX = Date.now().toString(36);
let keySeq = 0;

/** A fresh, empty line. `id` is a client-only key, unique for the life of the page. */
export function newCaptureItem() {
  keySeq += 1;
  return {
    id:                     `${KEY_PREFIX}-${keySeq}`,
    mode:                   'catalog', // 'catalog' | 'off_catalog'
    product:                null,      // { id, product_code, description, unit, category, available }
    searchText:             '',        // text typed in the search box and not picked yet
    descripcion:            '',
    unidad:                 'UND',
    cantidad:               '',
    stockAlmacenObra:       0,
    stockAlmacenPrincipal:  0,
    xAtender:               '',
    xAtenderManual:         false,
    presupuestadoAdicional: 'P',
    rfiFwo:                 '',
    estatusGuia:            '',
    comentarios:            '',
    itemSource:             '',
    itemSourceProposed:     false,     // true while the value came from the product category
  };
}

/** 'LINKED' (catalog product picked), 'OFF_CATALOG' (marked and described) or null. */
export function getItemResolution(item) {
  if (item.mode === 'catalog' && item.product) return 'LINKED';
  if (item.mode === 'off_catalog' && item.descripcion.trim()) return 'OFF_CATALOG';
  return null;
}

/** True when the user did anything on the line (so it can no longer be silently ignored). */
export function isItemTouched(item) {
  return Boolean(
    item.product
    || item.searchText.trim()
    || item.mode === 'off_catalog'
    || item.descripcion.trim()
    || String(item.cantidad).trim() !== ''
    || item.comentarios.trim()
    || item.rfiFwo.trim()
    || item.itemSource
    || Number(item.stockAlmacenObra) > 0
    || Number(item.stockAlmacenPrincipal) > 0
    || item.xAtenderManual,
  );
}

/** Returns the line with the catalog product linked (replaces any previous choice). */
export function applyProduct(item, product) {
  let { itemSource, itemSourceProposed } = item;
  // A source picked by hand wins; one that was only proposed follows the product.
  if (!itemSource || itemSourceProposed) {
    itemSource = proposeItemSource(product.category);
    itemSourceProposed = Boolean(itemSource);
  }
  return {
    ...item,
    mode: 'catalog',
    product,
    searchText: '',
    descripcion: product.description,
    unidad: product.unit,
    itemSource,
    itemSourceProposed,
  };
}

/** Back to an empty "search the catalog" line (keeps quantities and notes). */
export function clearProduct(item) {
  return {
    ...item,
    mode: 'catalog',
    product: null,
    searchText: '',
    descripcion: '',
    unidad: 'UND',
    itemSource: item.itemSourceProposed ? '' : item.itemSource,
    itemSourceProposed: false,
  };
}

/** Marks / unmarks the line as off-catalog. Either way the product link is dropped. */
export function setOffCatalog(item, enabled) {
  return {
    ...item,
    mode: enabled ? 'off_catalog' : 'catalog',
    product: null,
    searchText: '',
    descripcion: '',
    unidad: 'UND',
    itemSource: item.itemSourceProposed ? '' : item.itemSource,
    itemSourceProposed: false,
  };
}

/** A source chosen by hand. */
export function setItemSource(item, value) {
  return { ...item, itemSource: value, itemSourceProposed: false };
}

/** True when the quantity typed on the line is a number greater than 0. */
export function hasValidQuantity(item) {
  const quantity = parseFloat(item.cantidad);
  return Number.isFinite(quantity) && quantity > 0;
}

/**
 * Checks the lines of the form.
 *
 * - Untouched lines are ignored (the form starts with 5 blank rows).
 * - A touched line needs a catalog product or an off-catalog description,
 *   and a source.
 * - A resolved line also needs a quantity greater than 0 (a blank one would be
 *   created with 0 units and stay "pending" forever in the follow-up).
 * - At least one resolved line is required.
 *
 * `issues` lists the same problems as `messages` but structured, so the form can
 * link each message to the control that fixes it.
 *
 * @returns {{
 *   valid: boolean,
 *   resolvedCount: number,
 *   byItem: Record<string, { product?: string, source?: string, quantity?: string }>,
 *   messages: string[],
 *   issues: Array<{ itemId: string|null, field: 'product'|'source'|'quantity'|null, message: string }>,
 * }}
 */
export function validateCaptureItems(items) {
  const byItem = {};
  const messages = [];
  const issues = [];
  let resolvedCount = 0;

  items.forEach((item, idx) => {
    if (!isItemTouched(item)) return;
    const problems = {};
    const resolution = getItemResolution(item);

    if (resolution) {
      resolvedCount += 1;
      if (!hasValidQuantity(item)) problems.quantity = MSG_QUANTITY;
    } else if (item.mode === 'off_catalog') {
      problems.product = MSG_DESCRIBE_OFF_CATALOG;
    } else {
      problems.product = MSG_PICK_PRODUCT;
    }
    if (!item.itemSource) problems.source = MSG_PICK_SOURCE;

    // Reading order of the row: product, quantity, source.
    const ordered = ['product', 'quantity', 'source'].filter((field) => problems[field]);
    if (ordered.length > 0) {
      byItem[item.id] = problems;
      ordered.forEach((field) => {
        const message = `Ítem ${idx + 1}: ${problems[field]}`;
        messages.push(message);
        issues.push({ itemId: item.id, field, message });
      });
    }
  });

  if (resolvedCount === 0 && messages.length === 0) {
    messages.push(MSG_NO_ITEMS);
    issues.push({ itemId: null, field: null, message: MSG_NO_ITEMS });
  }

  return {
    valid: messages.length === 0,
    resolvedCount,
    byItem,
    messages,
    issues,
  };
}

/**
 * Builds `items` for POST /requests/. Only resolved lines are sent.
 * `supply_source` is deliberately absent: logistics decides it at the stock
 * check. The declared central stock goes out as `stock_almacen_central` (the
 * old `stock_almacen_principal` key does not exist in the API and was dropped).
 *
 * @param {Array} items form lines
 * @param {(item) => number|string} calcXAtender computes the "X Atender" column
 */
export function buildItemsPayload(items, calcXAtender) {
  return items
    .filter((item) => getItemResolution(item))
    .map((item, idx) => {
      const linked = getItemResolution(item) === 'LINKED';
      return {
        line_number:             idx + 1,
        description:             linked ? item.product.description : item.descripcion.trim(),
        unit:                    linked ? item.product.unit : item.unidad,
        quantity:                parseFloat(item.cantidad) || 0,
        stock_almacen_obra:      parseFloat(item.stockAlmacenObra) || 0,
        stock_almacen_central:   parseFloat(item.stockAlmacenPrincipal) || 0,
        x_atender:               parseFloat(calcXAtender(item)) || 0,
        presupuestado_adicional: item.presupuestadoAdicional,
        rfi_fwo:                 item.rfiFwo,
        comentarios:             item.comentarios,
        item_source:             item.itemSource,
        ...(linked ? { inventory_item: item.product.id } : { is_off_catalog: true }),
      };
    });
}

// Every key `buildItemsPayload` sends, named the way the form names it. A key that is not here is
// never shown as a code identifier: the message simply names the ítem without a field.
const ITEM_FIELD_LABELS = {
  line_number:             'Número de ítem',
  description:             'Descripción',
  unit:                    'Unidad',
  quantity:                'Cantidad',
  stock_almacen_obra:      'Stock almacén obra',
  stock_almacen_central:   'Stock almacén central',
  x_atender:               'X atender',
  presupuestado_adicional: 'P/A',
  rfi_fwo:                 'RFI/FWO',
  comentarios:             'Comentarios',
  item_source:             'Fuente',
  inventory_item:          'Producto',
  is_off_catalog:          'Fuera de catálogo',
};

/** "Ítem 3 (Cantidad): …" — the field in parentheses only when it has a name the user knows. */
function formatItemError(row, field, message) {
  const label = Object.hasOwn(ITEM_FIELD_LABELS, field) ? ITEM_FIELD_LABELS[field] : null;
  return `Ítem ${row}${label ? ` (${label})` : ''}: ${message}`;
}

/**
 * Form row numbers (1-based, counting blank rows like the rest of the form does) of the lines
 * `buildItemsPayload` sends, in the same order. The server reports an error by its position in
 * that payload, which skips the blank rows; this maps it back to the "Ítem N" the user sees.
 */
export function payloadRowNumbers(items) {
  const rows = [];
  items.forEach((item, idx) => {
    if (getItemResolution(item)) rows.push(idx + 1);
  });
  return rows;
}

function firstMessage(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/**
 * Field-aware message for a failed POST /requests/: names the ítem and field of
 * a 400 on `items` and the area, otherwise falls back to the generic extractor.
 *
 * @param {Error} err
 * @param {string} fallback
 * @param {number[]} [rowNumbers] `payloadRowNumbers(items)` of what was sent: maps the position
 *        the server reports to the row number of the form (default: the position itself)
 */
export function extractCreateErrorMessage(err, fallback, rowNumbers) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const areaMsg = firstMessage(detail.requesting_area);
    if (areaMsg) return `Área del RQ: ${areaMsg}`;

    if (Array.isArray(detail.items)) {
      for (let i = 0; i < detail.items.length; i += 1) {
        const entry = detail.items[i];
        if (entry && typeof entry === 'object') {
          for (const [field, value] of Object.entries(entry)) {
            const msg = firstMessage(value);
            if (msg) return formatItemError(rowNumbers?.[i] ?? i + 1, field, msg);
          }
        }
      }
      const generic = firstMessage(detail.items);
      if (generic) return generic;
    } else if (detail.items && typeof detail.items === 'object') {
      // An error of the list as a whole (more than 200 lines, or none), not of one line: DRF
      // reports it under `non_field_errors`.
      const listError = firstMessage(detail.items.non_field_errors);
      if (listError) return listError;
    }
  }
  return extractErrorMessage(err, fallback);
}

// ── SYSPCC-031: borradores ───────────────────────────────────────────────────────────────────────

/** Fixed rows the form shows when it starts (a loaded draft is padded up to this many). */
export const MIN_FORM_ROWS = 5;

const numberOrBlank = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

/**
 * Lines of the form from the lines of a saved draft (`GET /requests/{id}/` -> `items`).
 * A line linked to the catalog shows its product (code/description/unit come flat from the
 * API; the central stock is not part of the detail, so it shows "—"); a quantity of 0 (not
 * decided yet) comes back as an empty box. The result always has at least `MIN_FORM_ROWS` rows.
 */
export function itemsFromDraft(apiItems = []) {
  const rows = apiItems.map((api) => {
    const base = newCaptureItem();
    const linked = api.inventory_item != null;
    const stockObra = parseFloat(api.stock_almacen_obra) || 0;
    const stockCentral = parseFloat(api.stock_almacen_central) || 0;
    return {
      ...base,
      mode: !linked && api.is_off_catalog ? 'off_catalog' : 'catalog',
      product: linked
        ? {
            id: api.inventory_item,
            product_code: api.inventory_item_code ?? '',
            description: api.inventory_item_description ?? api.description ?? '',
            unit: api.inventory_item_unit ?? api.unit ?? '',
            category: '',
            available: null,
          }
        : null,
      descripcion: api.description ?? '',
      unidad: api.unit || 'UND',
      cantidad: numberOrBlank(api.quantity),
      stockAlmacenObra: stockObra,
      stockAlmacenPrincipal: stockCentral,
      presupuestadoAdicional: api.presupuestado_adicional || 'P',
      rfiFwo: api.rfi_fwo ?? '',
      comentarios: api.comentarios ?? '',
      itemSource: api.item_source ?? '',
    };
  });
  while (rows.length < MIN_FORM_ROWS) rows.push(newCaptureItem());
  return rows;
}

/** How many touched lines `buildItemsPayload` leaves out because they are not resolved yet. */
export function countUnresolvedTouched(items) {
  return items.filter((item) => isItemTouched(item) && !getItemResolution(item)).length;
}

/**
 * Every message of a 400 from `POST /requests/{id}/submit/` (or from saving a draft), flat and
 * ready for a list: the server sends `detail: { field: [messages] }` (the lines as "Ítem N: ...").
 * Falls back to the single generic message when the body has no field messages.
 */
export function extractSubmitErrorMessages(err, fallback) {
  const detail = err?.response?.data?.detail;
  const out = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) out.push(value);
    else if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === 'object') Object.values(value).forEach(push);
  };
  if (detail && typeof detail === 'object') push(detail);
  if (out.length > 0) return out;
  return [extractErrorMessage(err, fallback)];
}
