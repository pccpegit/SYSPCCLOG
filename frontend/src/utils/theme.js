// Pure, framework-free theme resolution logic — shared contract with two
// consumers that must never drift apart:
//   1. The anti-FOUC inline <script> in `frontend/index.html` (runs before
//      React loads, can't import this module, so it re-implements the same
//      algorithm in plain JS). If you change the resolution rules here,
//      mirror the change there too.
//   2. `frontend/src/context/ThemeContext.jsx`, which imports these
//      functions directly.
//
// Kept dependency-free (no React) so it can be unit-tested in isolation,
// including the midnight-wraparound edge cases for the "auto" schedule.

export const THEME_STORAGE_KEY = 'syspcc.theme.v1';

export const DEFAULT_AUTO_RANGE = { startHour: 19, startMinute: 0, endHour: 7, endMinute: 0 };

const DEFAULT_MODE = 'auto';
const VALID_MODES = ['light', 'dark', 'auto'];

/**
 * Resolves the effective theme ('light' | 'dark') for a given mode.
 *
 * For mode === 'auto', compares the current time-of-day (in minutes) against
 * `autoRange`. Handles the range "wrapping" across midnight (e.g. dark from
 * 19:00 to 07:00, where startHour > endHour) as well as the normal case
 * (start < end) — see Decisión 4 in the SYSPCC-020 handoff.
 *
 * Mirrors (in minute precision, not ms) the inline script in index.html —
 * keep both in sync.
 */
export function resolveTheme(mode, autoRange, now = new Date()) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';

  const range = autoRange ?? DEFAULT_AUTO_RANGE;
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = range.startHour * 60 + range.startMinute;
  const end = range.endHour * 60 + range.endMinute;

  const isDark = start > end
    ? (mins >= start || mins < end)   // wraps across midnight
    : (mins >= start && mins < end);  // same-day range

  return isDark ? 'dark' : 'light';
}

/** Milliseconds elapsed since local midnight for `date`. */
function msSinceMidnight(date) {
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000
    + date.getMilliseconds();
}

function boundaryMsOfDay(hour, minute) {
  return (hour * 60 + minute) * 60 * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds until the next start/end boundary of `autoRange`, strictly
 * in the future relative to `now`. Used to schedule a single `setTimeout`
 * to the next crossing instead of polling with `setInterval` — see
 * Decisión 4. Considers today's and tomorrow's boundaries so it's correct
 * regardless of whether the range wraps midnight.
 */
export function computeNextBoundaryMs(autoRange, now = new Date()) {
  const range = autoRange ?? DEFAULT_AUTO_RANGE;
  const startMs = boundaryMsOfDay(range.startHour, range.startMinute);
  const endMs = boundaryMsOfDay(range.endHour, range.endMinute);
  const nowMs = msSinceMidnight(now);

  const candidates = [startMs, endMs, startMs + DAY_MS, endMs + DAY_MS];
  const future = candidates.map((ms) => ms - nowMs).filter((diff) => diff > 0);

  // Degenerate range (start === end): no real boundary exists — fall back
  // to a full day so callers don't schedule a zero/near-zero timeout loop.
  if (future.length === 0) return DAY_MS;
  return Math.min(...future);
}

function isValidAutoRange(range) {
  return (
    !!range &&
    Number.isInteger(range.startHour) && range.startHour >= 0 && range.startHour <= 23 &&
    Number.isInteger(range.startMinute) && range.startMinute >= 0 && range.startMinute <= 59 &&
    Number.isInteger(range.endHour) && range.endHour >= 0 && range.endHour <= 23 &&
    Number.isInteger(range.endMinute) && range.endMinute >= 0 && range.endMinute <= 59
  );
}

/**
 * Reads `{ mode, autoRange }` from localStorage under THEME_STORAGE_KEY.
 * Defensive by design: missing key, corrupt JSON, an unavailable
 * `localStorage` (strict private-browsing), or a malformed shape all fall
 * back to the safe defaults below instead of throwing.
 */
export function loadStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { mode: DEFAULT_MODE, autoRange: DEFAULT_AUTO_RANGE };

    const data = JSON.parse(raw);
    const mode = VALID_MODES.includes(data?.mode) ? data.mode : DEFAULT_MODE;
    const autoRange = isValidAutoRange(data?.autoRange) ? data.autoRange : DEFAULT_AUTO_RANGE;
    return { mode, autoRange };
  } catch {
    return { mode: DEFAULT_MODE, autoRange: DEFAULT_AUTO_RANGE };
  }
}

/**
 * Persists `{ mode, autoRange }` under THEME_STORAGE_KEY, versioned so a
 * future shape change can migrate old values instead of guessing. Returns
 * `false` (instead of throwing) if `localStorage` is unavailable or full,
 * so callers can decide whether to surface that to the user.
 */
export function saveStoredTheme({ mode, autoRange }) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ version: 1, mode, autoRange }));
    return true;
  } catch {
    return false;
  }
}
