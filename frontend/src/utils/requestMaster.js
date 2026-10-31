// SYSPCC-030 — helpers puros del Master de RQ: filtros <-> URL, parámetros de la API,
// fechas y cantidades de pantalla, y mensajes de error.

import { extractErrorMessage } from './apiErrors';
import { formatQty } from './quantity';
import {
  AREA_FILTER_OPTIONS, SOURCE_FILTER_OPTIONS, ITEM_STATUS_OPTIONS, STAGE_OPTIONS,
  PAGE_SIZES, DEFAULT_PAGE_SIZE, ITEM_ORDERING_FIELDS, SUMMARY_ORDERING_FIELDS, MAX_SEARCH_LENGTH,
} from '../data/requestMaster';

/** Id del botón que expande la fila de un ítem (el diálogo le devuelve el foco). */
export const rowToggleId = (itemId) => `master-row-toggle-${itemId}`;

/** Ids DOM de la pestaña y de su panel (aria-controls / aria-labelledby). */
export const tabDomId = (id) => `master-tab-${id}`;
export const panelDomId = (id) => `master-panel-${id}`;

export const TABS = { ITEM: 'item', RQ: 'rq' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d{1,9}$/;

const oneOf = (options) => (value) => (options.some((o) => o.value === value) ? value : '');
const isDate = (value) => (ISO_DATE.test(value) ? value : '');
const isId = (value) => (DIGITS.test(value) ? value : '');
const isFlag = (value) => (value === '1' ? '1' : '');

/** Filtros de la pantalla -> sanitizador de su valor en la URL (un valor inválido se descarta). */
const FILTER_SANITIZERS = {
  project: isId,
  area: oneOf(AREA_FILTER_OPTIONS),
  source: oneOf(SOURCE_FILTER_OPTIONS),
  item_status: oneOf(ITEM_STATUS_OPTIONS),
  stage: oneOf(STAGE_OPTIONS),
  approved_from: isDate,
  approved_to: isDate,
  attended_from: isDate,
  attended_to: isDate,
  with_shortage: isFlag,
  with_alerts: isFlag,
  search: (value) => value.trim().slice(0, MAX_SEARCH_LENGTH),
};

export const FILTER_KEYS = Object.keys(FILTER_SANITIZERS);

export const EMPTY_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, '']));

export function orderingFieldsFor(tab) {
  return tab === TABS.RQ ? SUMMARY_ORDERING_FIELDS : ITEM_ORDERING_FIELDS;
}

/** `?tab=rq&project=3&…` -> `{ tab, filters, ordering, page, pageSize }`, siempre con valores válidos. */
export function parseMasterSearch(searchParams) {
  const get = (key) => searchParams.get(key) ?? '';
  const tab = get('tab') === TABS.RQ ? TABS.RQ : TABS.ITEM;

  const filters = {};
  for (const key of FILTER_KEYS) filters[key] = FILTER_SANITIZERS[key](get(key));

  const rawOrdering = get('ordering');
  const field = rawOrdering.replace(/^-/, '');
  const ordering = orderingFieldsFor(tab).includes(field) ? rawOrdering : '';

  const page = Number.parseInt(get('page'), 10);
  const size = Number.parseInt(get('page_size'), 10);

  return {
    tab,
    filters,
    ordering,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** Inverso de `parseMasterSearch`: solo escribe lo que se aparta del valor por defecto. */
export function buildMasterSearch({ tab, filters, ordering, page, pageSize }) {
  const params = new URLSearchParams();
  if (tab === TABS.RQ) params.set('tab', TABS.RQ);
  for (const key of FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (ordering) params.set('ordering', ordering);
  if (page > 1) params.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('page_size', String(pageSize));
  return params;
}

/** Filtros de la pantalla -> parámetros de query de la API (sin vacíos; banderas como `true`). */
export function buildApiParams(filters, extra = {}) {
  const params = {};
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (!value) continue;
    params[key] = key === 'with_shortage' || key === 'with_alerts' ? 'true' : value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== '' && value !== null && value !== undefined) params[key] = value;
  }
  return params;
}

export function activeFilterCount(filters) {
  return FILTER_KEYS.filter((k) => filters[k]).length;
}

/** asc -> desc -> sin orden (vuelve al orden por defecto del servidor). */
export function nextOrdering(current, field) {
  if (current === field) return `-${field}`;
  if (current === `-${field}`) return '';
  return field;
}

export function ariaSortFor(ordering, field) {
  if (ordering === field) return 'ascending';
  if (ordering === `-${field}`) return 'descending';
  return 'none';
}

// ─── Presentación ──────────────────────────────────────────────────────────────

const LIMA_TZ = 'America/Lima';

/**
 * `dd/mm/aaaa`. Una fecha sola (`2026-10-01`) se corta como texto: `new Date()` la tomaría como UTC
 * y en Lima mostraría el día anterior. Un instante (`…T…Z`) se convierte a hora de Lima.
 */
export function formatMasterDate(value) {
  if (!value) return '—';
  const text = String(value);
  if (ISO_DATE.test(text)) {
    const [y, m, d] = text.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: LIMA_TZ,
  });
}

/** Cantidad del Master; `null` (ítem sin vincular) se muestra como «—». */
export function formatMasterQty(value) {
  return value === null || value === undefined ? '—' : formatQty(value);
}

/** 0–100 -> «42 %»; `null` (sin ítems contables) -> «—». */
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1)} %`;
}

export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

// ─── Errores ───────────────────────────────────────────────────────────────────

export const EXPORT_THROTTLED_MESSAGE =
  'Se hicieron demasiadas descargas seguidas. Espere un minuto e intente nuevamente.';

function readBlobText(blob) {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Con `responseType: 'blob'` el cuerpo del error llega como Blob: lo convierte a objeto. */
export async function normalizeBlobError(err) {
  const data = err?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await readBlobText(data));
      return { ...err, response: { ...err.response, data: parsed } };
    } catch {
      return { ...err, response: { ...err.response, data: undefined } };
    }
  }
  return err;
}

export async function describeExportError(err) {
  if (err?.response?.status === 429) return EXPORT_THROTTLED_MESSAGE;
  if (err?.response?.status === 403) return 'No tiene permiso para descargar el Master de RQ.';
  const normalized = await normalizeBlobError(err);
  if (normalized?.response?.status === 400) {
    return extractErrorMessage(normalized, 'Los filtros aplicados no son válidos. Revíselos e intente nuevamente.');
  }
  return 'No se pudo descargar el Master. Intente nuevamente.';
}

/** Mensaje de pantalla para un error al cargar el Master (la API ya devuelve texto en español). */
export function describeLoadError(err) {
  const status = err?.response?.status;
  if (status === 400) {
    return extractErrorMessage(err, 'Los filtros aplicados no son válidos. Revíselos e intente nuevamente.');
  }
  if (status === 403) return 'No tiene permiso para ver el Master de RQ.';
  if (status === 404) return 'La página solicitada ya no existe con los filtros actuales.';
  return 'No se pudo cargar el Master de RQ. Intente nuevamente.';
}

/** Mensaje del diálogo de Stand by / Desestimar según el código HTTP / `code` del servidor. */
export function describeOverrideError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (status === 409 && data?.code === 'REQUEST_TERMINAL') {
    return extractErrorMessage(err, 'El RQ ya está cerrado o cancelado: no admite cambios de seguimiento.');
  }
  if (status === 409) return extractErrorMessage(err, 'El RQ cambió de estado. Actualice la lista e intente nuevamente.');
  if (status === 403) return 'No tiene permiso para cambiar el seguimiento de este ítem.';
  if (status === 400) return extractErrorMessage(err, 'Revise el motivo e intente nuevamente.');
  if (status === 404) return 'El ítem ya no existe. Actualice la lista.';
  return 'No se pudo guardar el cambio. Intente nuevamente.';
}
