import '@testing-library/jest-dom/vitest';

// jsdom keeps cookies for the lifetime of the module — reset between tests
// so a `csrftoken` set in one test file can't leak into the next.
afterEach(() => {
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });
});

// Node 22+ ships an experimental global `localStorage` (gated behind
// `--localstorage-file`; logs "ExperimentalWarning: localStorage is not
// available because --localstorage-file was not provided" the first time
// it's touched). That global's property descriptor already exists on
// globalThis before vitest-environment-jsdom sets up `window`, so it wins
// over jsdom's real Storage implementation — both bare `localStorage` and
// `window.localStorage` end up `undefined` instead of a working Storage.
// Discovered while writing SYSPCC-020's theme-persistence tests (the first
// in this repo to touch localStorage — grep confirmed zero prior usages),
// so it never surfaced before. Polyfill a minimal, real Web
// Storage-compatible object whenever the environment's own is missing or
// non-functional, so this and any future test can rely on `localStorage`
// working like it does in a real browser.
if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') {
  class MemoryStorage {
    constructor() { this._store = new Map(); }
    get length() { return this._store.size; }
    key(index) { return Array.from(this._store.keys())[index] ?? null; }
    getItem(key) { return this._store.has(String(key)) ? this._store.get(String(key)) : null; }
    setItem(key, value) { this._store.set(String(key), String(value)); }
    removeItem(key) { this._store.delete(String(key)); }
    clear() { this._store.clear(); }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}
