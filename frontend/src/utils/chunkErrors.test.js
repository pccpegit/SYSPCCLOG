import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isChunkLoadError,
  reloadOnceForChunkError,
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
} from './chunkErrors';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/Page-abc.js',
    'error loading dynamically imported module: https://x/assets/Page-abc.js',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
  ])('reconoce "%s"', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('reconoce el nombre ChunkLoadError', () => {
    const e = new Error('x');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it('no confunde otros errores', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadOnceForChunkError', () => {
  let reload;
  const realLocation = window.location;

  beforeEach(() => {
    window.sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    vi.restoreAllMocks();
  });

  it('recarga la primera vez y deja la marca', () => {
    expect(reloadOnceForChunkError(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1000000');
  });

  it('no vuelve a recargar dentro de la ventana (evita el bucle)', () => {
    reloadOnceForChunkError(1_000_000);
    expect(reloadOnceForChunkError(1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('puede recargar de nuevo pasada la ventana (otro despliegue en la misma sesión)', () => {
    reloadOnceForChunkError(1_000_000);
    expect(reloadOnceForChunkError(1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('si sessionStorage falla no recarga (podría ciclar)', () => {
    const realStorage = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    try {
      expect(reloadOnceForChunkError()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      if (realStorage) Object.defineProperty(window, 'sessionStorage', realStorage);
    }
  });
});
