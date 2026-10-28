// SYSPCC-023 — formatos es-PE para el módulo de CVs.

const numberFmt = new Intl.NumberFormat('es-PE');
const dateFmt = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const formatNumber = (n) => numberFmt.format(Number(n) || 0);

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

/** USD with two decimals and a dot ("0.84"), as the backend prices are in US$. */
export function formatUsd(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`;
}

const pluralRules = new Intl.PluralRules('es');
/** plural(2, 'CV', 'CVs') -> "CVs". */
export const plural = (n, one, many) => (pluralRules.select(n) === 'one' ? one : many);

/** Accent/case-insensitive normalization for client-side search. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Seconds -> user text. < 60 s: "menos de 1 min"; < 20 min: minutes rounded up;
 * >= 20 min: multiples of 5.
 */
export function etaMinutes(seconds) {
  if (seconds == null) return null;
  if (seconds < 60) return 0;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 20) return minutes;
  return Math.ceil(minutes / 5) * 5;
}
