// SYSPCC-025 — reglas y formatos puros del módulo de almacén (sin React).
// Los mensajes de usuario están en español (es-PE); la validación definitiva
// siempre ocurre en el servidor, esto es solo para dar feedback inmediato.

/** Unidades que se cuentan en piezas enteras (misma regla que el backend). */
const INTEGER_UNITS = new Set(['EA', 'UND', 'PAR', 'JGO']);

export const MAX_BACKDATE_DAYS = 7;

export const isIntegerUnit = (unit) => INTEGER_UNITS.has(String(unit ?? '').trim().toUpperCase());

const pad = (n) => String(n).padStart(2, '0');

/** Fecha local en formato AAAA-MM-DD. */
export function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Suma `days` a una fecha AAAA-MM-DD (aritmética en UTC: sin saltos por horario de verano). */
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function daysBetweenISO(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** dd/mm/aaaa a partir de AAAA-MM-DD (sin pasar por Date: no hay corrimiento de zona horaria). */
export function formatISODate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Valida la fecha de un movimiento.
 * Devuelve `{ error, warning }`: `error` bloquea; `warning` solo avisa.
 */
export function validateMovementDate(value, today = localISODate()) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'Indique la fecha del movimiento.', warning: '' };
  }
  if (value > today) return { error: 'La fecha no puede ser futura.', warning: '' };
  if (daysBetweenISO(value, today) > MAX_BACKDATE_DAYS) {
    return { error: '', warning: 'La fecha es anterior a 7 días. Verifique antes de guardar.' };
  }
  return { error: '', warning: '' };
}

/** Mensaje de error de una cantidad (cadena vacía si es válida). */
export function validateQuantity(raw, unit) {
  const text = String(raw ?? '').trim();
  const number = Number(text);
  if (!text || !Number.isFinite(number) || number <= 0) return 'La cantidad debe ser mayor que 0.';
  if (isIntegerUnit(unit) && !Number.isInteger(number)) {
    return `La cantidad de ${String(unit).trim().toUpperCase()} debe ser un número entero.`;
  }
  return '';
}

export const stockShortageMessage = (code, available, requested) =>
  `Stock insuficiente para ${code}. Disponible: ${formatQty(available)}, solicitado: ${formatQty(requested)}.`;

/** Número con separador de miles (es-PE) y hasta 3 decimales. */
export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export const FLOOR_LABELS = { 1: '1er piso', 2: '2do piso' };
export const floorLabel = (floor) => FLOOR_LABELS[floor] ?? '';

/**
 * Stock disponible de un ítem en un almacén, en el pool sin proyecto (el mismo
 * alcance que descuentan las salidas del backend). Si el ítem no trae el detalle
 * de stocks se usa el total.
 */
export function availableStock(item, warehouse) {
  if (!item) return 0;
  if (!Array.isArray(item.stocks)) return Number(item.total_stock ?? 0);
  return item.stocks
    .filter((s) => s.warehouse_type === warehouse && !s.project_id && !s.department_id)
    .reduce((acc, s) => acc + Number(s.quantity ?? 0), 0);
}

/** Estado de ubicación para mostrar: exacta o pendiente (con el piso si se conoce). */
export function locationInfo(item) {
  const exact = item?.location_status === 'EXACT' && item?.location_display;
  if (exact) return { exact: true, code: item.location_display, floor: floorLabel(item.floor) };
  return { exact: false, code: '', floor: floorLabel(item?.floor) };
}

const LOCATION_RE = /^([A-Z])(\d{1,2})-([1-9])$/;
// Text that can still become a full location while it is being typed: «F», «F3», «F33», «F3-», «F33-».
const LOCATION_PREFIX_RE = /^[A-Z](\d{1,2}-?)?$/;

/** ¿Es un comienzo válido de código de ubicación (aún incompleto)? No lo es un código completo. */
export const isLocationPrefix = (text) => LOCATION_PREFIX_RE.test(String(text ?? '').trim().toUpperCase());

/** `F3-2` -> `{ pavilion: 'F', section: '3', level: '2' }` (vacío si no calza). */
export function splitLocation(code) {
  const m = LOCATION_RE.exec(String(code ?? '').trim().toUpperCase());
  return m ? { pavilion: m[1], section: m[2], level: m[3] } : { pavilion: '', section: '', level: '' };
}

/** 'none' (sin stock) | 'low' (bajo mínimo) | 'ok'. */
export function stockStatus(total, minStock) {
  const stock = Number(total ?? 0);
  const min = Number(minStock ?? 0);
  if (stock <= 0) return 'none';
  if (min > 0 && stock <= min) return 'low';
  return 'ok';
}

/** Quita acentos y pasa a minúsculas para comparar texto en búsquedas locales. */
export function foldText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Reglas de rol del módulo (UX: el backend valida igual y sin bypass). */
export const hasAnyRole = (userRoles, allowed) => allowed.some((role) => userRoles.includes(role));

/** Quita las claves con texto vacío o `undefined` (los campos opcionales no se envían). */
export function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')),
  );
}

let lineSeq = 0;
/** Identificador local estable para las líneas de un formulario. */
export const nextLineId = () => `line-${++lineSeq}`;

/**
 * Cantidad de campos con error de un formulario de movimiento. Cuenta los
 * mensajes del encabezado (`errors.movement_date`, …) y los de cada línea
 * (`errors.lines[id].item / .qty`); ignora valores vacíos.
 */
export function countErrors(errors) {
  if (!errors) return 0;
  return Object.entries(errors).reduce((total, [key, value]) => {
    if (key === 'lines') {
      return total + Object.values(value ?? {}).reduce((acc, line) => acc + countErrors(line), 0);
    }
    return total + (value ? 1 : 0);
  }, 0);
}

/**
 * Valida un código de ubicación escrito a mano (`F3-2`) contra el layout del
 * backend (única fuente de verdad: pabellones, secciones por pabellón, niveles).
 * Devuelve `{ code, error }`: `code` normalizado si es válido; `error` en
 * español si no. Texto vacío => ambos vacíos (no hay nada que validar todavía).
 * Con `floor` solo acepta pabellones de ese piso.
 */
export function checkLocationCode(text, layout, floor = null) {
  const raw = String(text ?? '').trim().toUpperCase();
  if (!raw) return { code: '', error: '' };
  const match = LOCATION_RE.exec(raw);
  if (!match) return { code: '', error: 'Use el formato Pabellón + Sección – Nivel, por ejemplo F3-2.' };
  const [, pavilionCode, section, level] = match;
  const floorNumber = floor ? Number(floor) : null;
  const pavilions = (layout?.floors ?? [])
    .filter((f) => !floorNumber || f.floor === floorNumber)
    .flatMap((f) => f.pavilions);
  const pavilion = pavilions.find((p) => p.code === pavilionCode);
  if (!pavilion) {
    return { code: '', error: `El pabellón ${pavilionCode} no existe${floorNumber ? ' en ese piso' : ' en el almacén'}.` };
  }
  const sectionNumber = Number(section);
  if (sectionNumber < 1 || sectionNumber > pavilion.sections) {
    return { code: '', error: `El pabellón ${pavilionCode} tiene secciones del 1 al ${pavilion.sections}.` };
  }
  const levels = layout?.levels ?? [1, 2, 3, 4, 5];
  if (!levels.includes(Number(level))) {
    return { code: '', error: `El nivel debe estar entre ${Math.min(...levels)} y ${Math.max(...levels)}.` };
  }
  return { code: `${pavilionCode}${sectionNumber}-${level}`, error: '' };
}
