// SYSPCC-029 — reglas y textos puros de la pantalla de picking / entregas parciales de un RQ.
// Los mensajes son es-PE. La validación definitiva la hace el servidor: esto solo da feedback rápido
// y traduce los códigos de error de negocio a frases accionables.
import { ROLE_LABELS } from '../data/constants';
import { extractCodedDetail, extractFieldErrors } from './apiErrors';
import { formatISODate, formatQty, isIntegerUnit, localISODate, validateQuantity } from './almacen';

export const NOTES_MAX_LENGTH = 300;
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 300;

/** Estados del RQ en la etapa de almacén, con el texto que ve el usuario. */
export const RQ_STAGE_LABELS = {
  IN_STOCK: 'Stock disponible — pendiente despacho',
  QUALITY_APPROVED: 'Calidad aprobada — pendiente despacho',
  DISPATCHED_TO_SITE: 'Despachado — pendiente actualizar registros',
  DELIVERED: 'Entregado — pendiente confirmar en almacén',
};

/** Por qué una línea no se puede entregar desde el almacén (`blocked_reason`). */
export const BLOCK_REASON_LABELS = {
  COMPLETE: 'Línea completa: no queda nada por entregar.',
  NO_STOCK: 'Sin stock disponible en Almacén Central.',
  PROPOSED: 'Producto propuesto: Logística debe confirmar el vínculo con el catálogo.',
  OFF_CATALOG: 'Fuera de catálogo: no se entrega desde el almacén.',
  UNLINKED: 'Sin vincular al catálogo: Logística debe asociarlo a un producto.',
};

export const ITEM_STATUS_LABELS = { PENDING: 'Pendiente', PARTIAL: 'Parcial', COMPLETE: 'Completo' };

/** Nombre del rol para mostrar (o el código si no hay etiqueta). */
export const roleName = (role) => ROLE_LABELS[role] ?? role;

/** «Almacén Central, Jefe Logístico» a partir de códigos de rol. */
export const roleList = (roles) => (roles ?? []).map(roleName).join(', ');

/** `PISO 1` -> `Piso 1`; el servidor entrega la ubicación oficial tal cual está en el catálogo. */
function titleCaseFloor(text) {
  const t = String(text ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}

/** @returns {{ exact: boolean, text: string }} ubicación a mostrar de una línea del picking. */
export function pickingLocation(item) {
  const product = item?.product;
  if (!product) return { exact: false, text: 'Sin producto de catálogo' };
  if (product.location_status === 'EXACT' && product.location) {
    return { exact: true, text: product.location };
  }
  if (product.location_status === 'FLOOR_ONLY' && product.location) {
    return { exact: false, text: `${titleCaseFloor(product.location)} — pendiente de ubicar` };
  }
  return { exact: false, text: 'Sin ubicación — pendiente de ubicar' };
}

/** Normaliza lo tecleado: espacios fuera y coma decimal -> punto. */
export const normalizeQty = (raw) => String(raw ?? '').trim().replace(',', '.');

/** `min_date` del servidor (ISO, con o sin hora) -> `AAAA-MM-DD`, o '' si no es una fecha. */
export function toISODate(value) {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

const minDateMessage = (minDate) => `La fecha no puede ser anterior al ${formatISODate(minDate)}.`;

const hasMoreThanThreeDecimals = (text) => /\.\d{4,}$/.test(text);

/**
 * Error de la cantidad tecleada para una línea (cadena vacía si es válida o está en blanco).
 * Una línea en blanco o en 0 simplemente no se entrega.
 */
export function validateLineQuantity(raw, item) {
  const text = normalizeQty(raw);
  if (text === '' || Number(text) === 0) return '';
  const base = validateQuantity(text, item.unit);
  if (base) return base;
  if (hasMoreThanThreeDecimals(text)) return 'Use como máximo 3 decimales.';
  const max = Number(item.max_deliverable);
  if (!Number.isFinite(max) || max <= 0) return 'Esta línea no se puede entregar ahora.';
  if (Number(text) > max) return `No puede superar ${qtyWithUnit(item.max_deliverable, item.unit)}.`;
  return '';
}

/** Líneas a enviar: solo las entregables con cantidad > 0, en el orden del picking. */
export function buildDeliveryLines(items, quantities) {
  const lines = [];
  for (const item of items) {
    if (!item.can_deliver) continue;
    const text = normalizeQty(quantities[item.id]);
    if (text !== '' && Number(text) > 0) lines.push({ request_item_id: item.id, quantity: text });
  }
  return lines;
}

/**
 * Valida el formulario de entrega completo.
 * @returns {{ lineErrors: object, fieldErrors: object, hasLines: boolean, valid: boolean }}
 */
export function validateDeliveryForm({ items, quantities, date, notes, minDate = '', today = localISODate() }) {
  const lineErrors = {};
  for (const item of items) {
    if (!item.can_deliver) continue;
    const error = validateLineQuantity(quantities[item.id], item);
    if (error) lineErrors[item.id] = error;
  }
  const fieldErrors = {};
  if (date && date > today) fieldErrors.movement_date = 'La fecha no puede ser futura.';
  else if (date && minDate && date < minDate) fieldErrors.movement_date = minDateMessage(minDate);
  if (String(notes ?? '').length > NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Las notas admiten hasta ${NOTES_MAX_LENGTH} caracteres.`;
  }
  const hasLines = buildDeliveryLines(items, quantities).length > 0;
  return {
    lineErrors,
    fieldErrors,
    hasLines,
    valid: hasLines && Object.keys(lineErrors).length === 0 && Object.keys(fieldErrors).length === 0,
  };
}

/** Valida el motivo (y la fecha opcional) de una anulación. */
export function validateReason(reason, date, today = localISODate(), minDate = '') {
  const errors = {};
  const text = String(reason ?? '').trim();
  if (text.length < REASON_MIN_LENGTH) errors.reason = `Indique el motivo (mínimo ${REASON_MIN_LENGTH} caracteres).`;
  else if (text.length > REASON_MAX_LENGTH) errors.reason = `El motivo admite hasta ${REASON_MAX_LENGTH} caracteres.`;
  if (date && date > today) errors.movement_date = 'La fecha no puede ser futura.';
  else if (date && minDate && date < minDate) errors.movement_date = minDateMessage(minDate);
  return errors;
}

// ── Errores del servidor ─────────────────────────────────────────────────────

const CODE_FALLBACKS = {
  INVALID_STATE: 'El requerimiento ya no está en una etapa que admita esta operación. Actualice la pantalla.',
  RQ_NOT_REVERSIBLE_STATE: 'La entrega ya no se puede anular en este estado; corríjalo con el ciclo de reclamo.',
  INTEGRITY_CONFLICT: 'No se pudo guardar porque otro cambio se cruzó con este. Actualice la pantalla e intente de nuevo.',
  INVALID_DATE: 'La fecha indicada no es válida para esta operación.',
  DUPLICATE_DELIVERY: 'Esta entrega ya se registró hace unos segundos. Revise el historial del requerimiento.',
  ALREADY_REVERSED: 'Esta entrega ya fue anulada.',
  NOT_REVERSIBLE: 'Esta entrega no se puede anular.',
  REVERSE_FAILED: 'No se pudo anular la entrega y no se modificó nada. Intente de nuevo.',
  VOUCHER_NUMBER_CONFLICT: 'Otro usuario registró un movimiento al mismo tiempo. Intente de nuevo.',
  DELIVERY_NOT_FOUND: 'La entrega ya no existe. Actualice la pantalla.',
  ROLE_NOT_ALLOWED: 'Su rol no puede realizar esta operación.',
  INVALID_ITEM: 'Alguna línea no pertenece a este requerimiento. Actualice la pantalla.',
  DELIVERY_LINES_INVALID: 'Revise las líneas marcadas: no se pudo registrar la entrega.',
};

const LINE_CODE_FALLBACKS = {
  ITEM_NOT_LINKED: 'La línea no está vinculada a un producto del catálogo confirmado.',
  ITEM_OFF_CATALOG: 'La línea está fuera de catálogo y no se entrega desde el almacén.',
  EXCEEDS_REMAINING: 'La cantidad supera lo pendiente de la línea.',
  INSUFFICIENT_STOCK: 'No hay stock suficiente en Almacén Central.',
};

/** Códigos tras los cuales conviene recargar el picking (el estado real cambió). */
export const REFRESH_CODES = new Set([
  'INVALID_STATE', 'RQ_NOT_REVERSIBLE_STATE', 'ALREADY_REVERSED', 'NOT_REVERSIBLE', 'DELIVERY_LINES_INVALID',
]);

/**
 * Traduce un error de `deliver` / `reverse` a lo que la pantalla necesita.
 * @returns {{ code: string, message: string, lineErrors: object, fieldErrors: object, refresh: boolean, minDate: string }}
 */
export function describeDeliveryError(err) {
  const base = { code: '', message: '', lineErrors: {}, fieldErrors: {}, refresh: false, minDate: '' };
  if (!err?.response) {
    return { ...base, message: 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.' };
  }
  const { status, data } = err.response;
  if (status === 429) {
    return { ...base, message: 'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.' };
  }
  const code = data && typeof data === 'object' && typeof data.code === 'string' ? data.code : '';
  const out = { ...base, code, refresh: REFRESH_CODES.has(code) };

  if (code === 'DELIVERY_LINES_INVALID') {
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const line of lines) {
      if (line?.request_item_id == null) continue;
      out.lineErrors[line.request_item_id] = typeof line.message === 'string' && line.message.trim()
        ? line.message
        : LINE_CODE_FALLBACKS[line.code] ?? CODE_FALLBACKS.DELIVERY_LINES_INVALID;
    }
    const n = Object.keys(out.lineErrors).length;
    out.message = n > 0
      ? `No se registró la entrega: ${n === 1 ? 'hay 1 línea con problemas' : `hay ${n} líneas con problemas`}. Corríjalas y vuelva a intentar.`
      : extractCodedDetail(err, CODE_FALLBACKS.DELIVERY_LINES_INVALID);
    return out;
  }
  if (code === 'INVALID_ITEM') {
    for (const id of Array.isArray(data.item_ids) ? data.item_ids : []) {
      out.lineErrors[id] = 'Esta línea no pertenece a este requerimiento.';
    }
    out.message = extractCodedDetail(err, CODE_FALLBACKS.INVALID_ITEM);
    return out;
  }
  if (code === 'INVALID_DATE') {
    out.minDate = toISODate(data.min_date);
    out.message = extractCodedDetail(
      err,
      out.minDate ? minDateMessage(out.minDate) : CODE_FALLBACKS.INVALID_DATE,
    );
    out.fieldErrors.movement_date = out.message;
    return out;
  }
  if (code === 'DUPLICATE_DELIVERY') {
    // La entrega ya está guardada: hay que recargar para que el usuario la vea en el historial.
    out.message = extractCodedDetail(err, CODE_FALLBACKS.DUPLICATE_DELIVERY);
    out.refresh = true;
    return out;
  }
  if (status === 400) {
    // Validación DRF: { error, status_code, detail: { campo: [..] }, code }.
    const fields = extractFieldErrors(err);
    if (Object.keys(fields).length > 0) {
      out.fieldErrors = fields;
      out.message = 'Revise los datos marcados en el formulario.';
      return out;
    }
  }
  if (code && CODE_FALLBACKS[code]) {
    out.message = extractCodedDetail(err, CODE_FALLBACKS[code]);
    return out;
  }
  const fallback = status === 403
    ? 'No tiene permiso para esta operación.'
    : status === 404
      ? 'El requerimiento o la entrega ya no existe. Actualice la pantalla.'
      : 'No se pudo completar la operación. Intente nuevamente.';
  out.message = extractCodedDetail(err, fallback);
  return out;
}

// ── Salida vinculada a un RQ (SYSPCC-041) ────────────────────────────────────

/**
 * Selección inicial al cargar el picking de un RQ en la pantalla de Salida: cada línea entregable
 * viene marcada y con la cantidad sugerida = lo máximo que se puede entregar ahora
 * (`min(pendiente, stock central)`). Las no entregables quedan fuera.
 * @returns {Record<number, { include: boolean, quantity: string }>}
 */
export function initRqSelection(items) {
  const selection = {};
  for (const item of items ?? []) {
    if (!item.can_deliver) continue;
    const quantity = maxQtyText(item);
    selection[item.id] = { include: quantity !== '', quantity };
  }
  return selection;
}

/** Tras recargar el picking conserva lo que el usuario ya marcó/tecleó; las líneas nuevas arrancan sugeridas. */
export function mergeRqSelection(items, previous) {
  const fresh = initRqSelection(items);
  const merged = {};
  for (const id of Object.keys(fresh)) merged[id] = previous?.[id] ?? fresh[id];
  return merged;
}

/**
 * Error de la cantidad de una línea INCLUIDA (vacío si es válida). Distingue lo pendiente del stock
 * para dar un mensaje accionable; la validación definitiva la hace el servidor.
 */
export function validateRqEntryQuantity(raw, item) {
  const text = normalizeQty(raw);
  if (text === '') return 'Indique la cantidad a entregar.';
  const base = validateQuantity(text, item.unit);
  if (base) return base;
  if (hasMoreThanThreeDecimals(text)) return 'Use como máximo 3 decimales.';
  const qty = Number(text);
  const remaining = Number(item.remaining);
  if (Number.isFinite(remaining) && qty > remaining) {
    return `No puede superar lo pendiente: ${qtyWithUnit(item.remaining, item.unit)}.`;
  }
  const stock = Number(item.available_central);
  if (item.available_central != null && Number.isFinite(stock) && qty > stock) {
    return `Stock insuficiente en Almacén Central. Disponible: ${qtyWithUnit(item.available_central, item.unit)}.`;
  }
  return validateLineQuantity(text, item);
}

/**
 * Valida la selección de líneas de la Salida con RQ.
 * @returns {{ lineErrors: Record<number,string>, lines: {request_item_id:number, quantity:string}[], valid: boolean }}
 */
export function validateRqSelection(items, selection) {
  const lineErrors = {};
  const lines = [];
  for (const item of items ?? []) {
    const state = selection[item.id];
    if (!item.can_deliver || !state?.include) continue;
    const error = validateRqEntryQuantity(state.quantity, item);
    if (error) lineErrors[item.id] = error;
    else lines.push({ request_item_id: item.id, quantity: normalizeQty(state.quantity) });
  }
  return { lineErrors, lines, valid: lines.length > 0 && Object.keys(lineErrors).length === 0 };
}

/** Mensaje al fallar la carga inicial del picking. */
export function describePickingLoadError(err) {
  if (!err?.response) {
    return { code: '', message: 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.' };
  }
  const { status, data } = err.response;
  const code = data && typeof data === 'object' && typeof data.code === 'string' ? data.code : '';
  if (status === 404) return { code: 'NOT_FOUND', message: 'El requerimiento no existe o no tiene acceso a él.' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'No tiene permiso para ver el picking de este requerimiento.' };
  if (status === 409 && code === 'INVALID_STATE') {
    return {
      code,
      message: 'Este requerimiento ya no está en la etapa de almacén, por eso no tiene lista de picking.',
    };
  }
  return { code, message: 'No se pudo cargar el picking del requerimiento. Intente de nuevo.' };
}

/** Texto con unidad: «12 EA». */
export function qtyWithUnit(value, unit) {
  return `${formatQty(value)}${unit ? ` ${unit}` : ''}`;
}

/** Cantidad máxima como texto para el campo («Completar con lo disponible»). */
export function maxQtyText(item) {
  const max = Number(item.max_deliverable);
  if (!Number.isFinite(max) || max <= 0) return '';
  return isIntegerUnit(item.unit) ? String(Math.floor(max)) : String(Number(max.toFixed(3)));
}
