// `??` (not `||`) so an explicitly empty string survives: Vercel demo sets
// VITE_API_URL=/api/v1/ and VITE_BACKEND_URL='' for same-origin relative
// URLs through the vercel.json proxy. Vite env vars are always string or
// undefined, so `??` only falls back when the var is unset — local dev
// behavior (no .env override) is unchanged.
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1/';

/** Backend origin for serving media files (signatures, etc.) */
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
