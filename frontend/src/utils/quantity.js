/**
 * Quantity helpers shared by the RQ screens.
 *
 * The API sends decimals as strings ("12.000"); these helpers parse and format
 * them for display only — never use the result to decide anything the backend
 * is the authority on.
 */

/** Parses a decimal string/number; returns null for null, undefined, '' or garbage. */
export function parseQty(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Decimals the API keeps for a quantity (DecimalField(…, decimal_places=3); the smallest valid one is 0.001). */
export const QTY_DECIMALS = 3;

/**
 * Up to 3 decimals with trailing zeros dropped ("12", "0.5", "0.125", "0.001"), "—" when there
 * is no figure. Rounding to 2 decimals would show 0.001 as "0.00" and 0.125 as "0.13" next to a
 * "Stock suficiente" badge. "." is the decimal separator of es-PE.
 */
export function formatQty(value) {
  const n = parseQty(value);
  if (n === null) return typeof value === 'string' && value !== '' ? value : '—';
  if (n % 1 === 0) return n.toFixed(0);
  // Number() drops the trailing zeros; String() of a value that went through toFixed(3) is
  // never in exponent form (it is 0 or at least 0.001), and "-0" becomes "0".
  return String(Number(n.toFixed(QTY_DECIMALS)));
}
