// ============================================================
// requestCapture.js — SYSPCC-026: vocabulary of the RQ capture screens.
//
// Mirrors apps/core/enums.py (RequestingAreaChoices, ItemSourceChoices) and the
// link/coverage vocabulary of GET /requests/{id}/stock-availability/. The labels
// are the Spanish ones the backend sends as `*_display`; they are repeated here
// only to fill the <select>s before any RQ exists.
// ============================================================

/** Functional area of the company that raises the RQ (Request.requesting_area). */
export const REQUESTING_AREAS = [
  { value: 'OP',  label: 'Operaciones (OP)' },
  { value: 'QC',  label: 'Control de Calidad (QC)' },
  { value: 'HSE', label: 'Seguridad y Salud (HSE)' },
  { value: 'ADM', label: 'Administración (ADM)' },
];

/** Product family of a line (RequestItem.item_source) — the "Fuente" column. */
export const ITEM_SOURCES = [
  { value: 'EPP',          label: 'EPP' },
  { value: 'HERRAMIENTAS', label: 'Herramientas' },
  { value: 'MATERIALES',   label: 'Materiales' },
  { value: 'EQUIPOS',      label: 'Equipos' },
  { value: 'FORMATERIA',   label: 'Formatería' },
  { value: 'CONSUMIBLES',  label: 'Consumibles' },
  { value: 'UNIDADES',     label: 'Unidades' },
  { value: 'UTILES',       label: 'Útiles' },
  { value: 'GASES',        label: 'Gases' },
];

export const NO_AREA_LABEL = 'Sin área';

/**
 * Most lines one RQ can carry. Mirrors MAX_REQUEST_ITEMS of apps/rq/serializers/request.py: the
 * server answers a 400 above it, so the form stops adding rows here instead of letting the person
 * fill hundreds of them and fail at the end.
 */
export const MAX_REQUEST_ITEMS = 200;

/** Longest RFI / FWO reference of a line. Mirrors RequestItem.rfi_fwo (max_length=50). */
export const RFI_FWO_MAX_LENGTH = 50;

const AREA_LABELS = Object.fromEntries(REQUESTING_AREAS.map((a) => [a.value, a.label]));
const SOURCE_LABELS = Object.fromEntries(ITEM_SOURCES.map((s) => [s.value, s.label]));

/** Label of a requesting_area code; prefers the backend's `*_display` when sent. */
export function requestingAreaLabel(value, display) {
  if (display) return display;
  return AREA_LABELS[value] ?? NO_AREA_LABEL;
}

/** Label of an item_source code; prefers the backend's `*_display` when sent. */
export function itemSourceLabel(value, display) {
  if (display) return display;
  return SOURCE_LABELS[value] ?? '';
}

/**
 * Proposes the "Fuente" of a line from the category of the catalog product.
 * Today the warehouse catalog only distinguishes 'EPP' and 'Otros' (SYSPCC-025),
 * so only EPP can be inferred; anything else is left for the user to choose.
 */
export function proposeItemSource(category) {
  return String(category ?? '').trim().toUpperCase() === 'EPP' ? 'EPP' : '';
}

/**
 * How a line of a saved RQ relates to the warehouse catalog.
 * Returns { kind: 'LINKED' | 'OFF_CATALOG' | 'UNLINKED', label }.
 */
export function describeItemLink(item) {
  if (item?.inventory_item) {
    const code = item.inventory_item_code;
    return { kind: 'LINKED', label: code ? `Vinculado a ${code}` : 'Vinculado al catálogo' };
  }
  if (item?.is_off_catalog) return { kind: 'OFF_CATALOG', label: 'Fuera de catálogo' };
  return { kind: 'UNLINKED', label: 'Sin vincular' };
}
