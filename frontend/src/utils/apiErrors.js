// SYSPCC-018 — helpers to normalize DRF error responses.
//
// Most SYSPCC endpoints raise a DRF ValidationError, which the backend's
// `custom_exception_handler` wraps uniformly as
// `{ error: true, status_code, detail, code? }`, where `detail` is either a
// string, a list of strings, or a field-keyed object. A few views (notably
// `POST /users/me/change-password/`'s manual `old_password` check) return a
// plain `Response({...})` that skips the handler entirely, so the field
// dict lands at the top level instead of under `detail`. These helpers
// handle every shape so page components don't have to know which one a
// given endpoint uses.

/**
 * Returns a { field: message } map for rendering inline form errors.
 * Safe to call on any Axios error — returns {} if nothing recognizable.
 */
export function extractFieldErrors(err) {
  const data = err?.response?.data;
  if (!data || typeof data !== 'object') return {};

  const src =
    data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)
      ? data.detail
      : data;

  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === 'error' || key === 'status_code' || key === 'code' || key === 'detail') continue;
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

/** Best-effort single human-readable message, for a toast or banner. */
export function extractErrorMessage(err, fallback = 'Ocurrió un error inesperado. Intente nuevamente.') {
  const data = err?.response?.data;
  // A reverse proxy (502/504, nginx 413) answers an HTML page or plain text, which axios hands
  // over as a STRING. Walking its characters below would show "<" in a toast, so anything that
  // is not an object means "Django did not write this": use the fallback.
  if (!data || typeof data !== 'object') return fallback;

  if (typeof data.detail === 'string') return data.detail;

  if (Array.isArray(data.detail) && data.detail.length) {
    return typeof data.detail[0] === 'string' ? data.detail[0] : fallback;
  }

  if (data.detail && typeof data.detail === 'object') {
    const first = Object.values(data.detail)[0];
    const msg = Array.isArray(first) ? first[0] : first;
    if (typeof msg === 'string') return msg;
  }

  // Unwrapped shape — e.g. change-password's manual old_password Response.
  for (const value of Object.values(data)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }

  return fallback;
}

/**
 * The server's own sentence for a coded error (`{ detail: '...', code: '...' }`), or `fallback`.
 * Unlike `extractErrorMessage` it NEVER falls back to scanning the other keys, so a coded error
 * that arrives without `detail` cannot put its machine `code` ("ITEMS_ALREADY_RECEIVED") on screen.
 */
export function extractCodedDetail(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}
