// SYSPCC-036: detection and one-shot recovery for failed lazy-chunk loads.
//
// After a new deployment the hashed chunk names change; a tab that was open
// before it asks for a chunk that no longer exists (404) and the dynamic
// import() rejects. Browsers word that error differently.

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chrome / Edge / Firefox (Vite)
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Loading chunk [\w-]+ failed/i, // webpack-style
  /Loading CSS chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const message = typeof error === 'string' ? error : error.message ?? '';
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

export const CHUNK_RELOAD_KEY = 'syspcc:chunk-reload-at';
// If we already reloaded this recently and it failed again, the problem is not
// a stale deployment (offline, server down): show the message instead of looping.
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * Reloads the page once for a stale-chunk error. Returns true if it triggered
 * the reload, false if it already did within the window (or storage is
 * unavailable, in which case reloading blindly could loop).
 */
export function reloadOnceForChunkError(now = Date.now()) {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    if (last && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
