import { vi } from 'vitest';

/**
 * Some Node/jsdom combinations expose no usable `localStorage`. The CV module
 * only uses it as a convenience (try/catch), but tests that exercise it install
 * this in-memory stand-in.
 */
export function installMemoryLocalStorage() {
  const data = new Map();
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}
