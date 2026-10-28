import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveTheme,
  computeNextBoundaryMs,
  loadStoredTheme,
  saveStoredTheme,
  THEME_STORAGE_KEY,
  DEFAULT_AUTO_RANGE,
} from './theme';

// Pure-logic tests, no React/RTL — this is the piece SYSPCC-020's FASE 0
// handoff flagged as the most important to cover, including the
// midnight-wraparound edge cases for the "auto" schedule.

// Arbitrary fixed date, only hour/minute/second/ms matter for these tests.
function at(hour, minute = 0, second = 0, ms = 0) {
  return new Date(2026, 0, 15, hour, minute, second, ms);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('resolveTheme', () => {
  it("mode='light' siempre devuelve 'light', sin importar autoRange/hora", () => {
    expect(resolveTheme('light', DEFAULT_AUTO_RANGE, at(3))).toBe('light');
    expect(resolveTheme('light', DEFAULT_AUTO_RANGE, at(20))).toBe('light');
    expect(resolveTheme('light', null, at(20))).toBe('light');
  });

  it("mode='dark' siempre devuelve 'dark', sin importar autoRange/hora", () => {
    expect(resolveTheme('dark', DEFAULT_AUTO_RANGE, at(3))).toBe('dark');
    expect(resolveTheme('dark', DEFAULT_AUTO_RANGE, at(12))).toBe('dark');
    expect(resolveTheme('dark', null, at(12))).toBe('dark');
  });

  describe("mode='auto', rango normal (07:00–19:00 oscuro, start < end)", () => {
    const RANGE = { startHour: 7, startMinute: 0, endHour: 19, endMinute: 0 };

    it('antes del inicio → claro', () => {
      expect(resolveTheme('auto', RANGE, at(6, 59))).toBe('light');
      expect(resolveTheme('auto', RANGE, at(0, 0))).toBe('light');
    });

    it('exactamente en el borde de inicio → oscuro (inicio inclusivo)', () => {
      expect(resolveTheme('auto', RANGE, at(7, 0, 0, 0))).toBe('dark');
    });

    it('dentro del rango → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(12, 0))).toBe('dark');
      expect(resolveTheme('auto', RANGE, at(18, 59))).toBe('dark');
    });

    it('exactamente en el borde de fin → claro (fin exclusivo)', () => {
      expect(resolveTheme('auto', RANGE, at(19, 0, 0, 0))).toBe('light');
    });

    it('después del fin → claro', () => {
      expect(resolveTheme('auto', RANGE, at(19, 1))).toBe('light');
      expect(resolveTheme('auto', RANGE, at(23, 59))).toBe('light');
    });
  });

  describe("mode='auto', rango con wraparound de medianoche (19:00–07:00 oscuro, default)", () => {
    const RANGE = DEFAULT_AUTO_RANGE;

    it('exactamente en el borde de inicio (19:00) → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(19, 0, 0, 0))).toBe('dark');
    });

    it('después del inicio, antes de medianoche → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(19, 1))).toBe('dark');
      expect(resolveTheme('auto', RANGE, at(23, 59))).toBe('dark');
    });

    it('justo después de medianoche → oscuro (el wraparound sigue activo)', () => {
      expect(resolveTheme('auto', RANGE, at(0, 0, 0, 0))).toBe('dark');
      expect(resolveTheme('auto', RANGE, at(0, 1))).toBe('dark');
    });

    it('justo antes del borde de fin → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(6, 59))).toBe('dark');
    });

    it('exactamente en el borde de fin (07:00) → claro (fin exclusivo)', () => {
      expect(resolveTheme('auto', RANGE, at(7, 0, 0, 0))).toBe('light');
    });

    it('durante el día, lejos de ambos bordes → claro', () => {
      expect(resolveTheme('auto', RANGE, at(7, 1))).toBe('light');
      expect(resolveTheme('auto', RANGE, at(12, 0))).toBe('light');
      expect(resolveTheme('auto', RANGE, at(18, 59))).toBe('light');
    });

    it('autoRange null/undefined cae al DEFAULT_AUTO_RANGE (mismo comportamiento)', () => {
      expect(resolveTheme('auto', null, at(20, 0))).toBe('dark');
      expect(resolveTheme('auto', undefined, at(12, 0))).toBe('light');
    });
  });

  describe("mode='auto', minutos no-cero en los bordes (wraparound 19:30–07:15)", () => {
    const RANGE = { startHour: 19, startMinute: 30, endHour: 7, endMinute: 15 };

    it('un minuto antes del inicio exacto → claro', () => {
      expect(resolveTheme('auto', RANGE, at(19, 29))).toBe('light');
    });

    it('exactamente en el minuto de inicio → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(19, 30, 0, 0))).toBe('dark');
    });

    it('un minuto antes del fin exacto → oscuro', () => {
      expect(resolveTheme('auto', RANGE, at(7, 14))).toBe('dark');
    });

    it('exactamente en el minuto de fin → claro', () => {
      expect(resolveTheme('auto', RANGE, at(7, 15, 0, 0))).toBe('light');
    });
  });
});

describe('computeNextBoundaryMs', () => {
  const HOUR = 60 * 60 * 1000;

  describe('rango normal (07:00–19:00, start < end)', () => {
    const RANGE = { startHour: 7, startMinute: 0, endHour: 19, endMinute: 0 };

    it('antes del inicio → próximo borde es el inicio de hoy', () => {
      expect(computeNextBoundaryMs(RANGE, at(5, 0))).toBe(2 * HOUR);
    });

    it('dentro del rango → próximo borde es el fin de hoy', () => {
      expect(computeNextBoundaryMs(RANGE, at(10, 0))).toBe(9 * HOUR);
    });

    it('después del fin → próximo borde es el inicio de mañana', () => {
      expect(computeNextBoundaryMs(RANGE, at(20, 0))).toBe(11 * HOUR);
    });

    it('exactamente en el borde de inicio → el propio instante no cuenta, próximo es el fin de hoy', () => {
      expect(computeNextBoundaryMs(RANGE, at(7, 0, 0, 0))).toBe(12 * HOUR);
    });

    it('respeta precisión de milisegundos, no solo minutos', () => {
      expect(computeNextBoundaryMs(RANGE, at(6, 59, 59, 500))).toBe(500);
    });
  });

  describe('rango con wraparound de medianoche (19:00–07:00, default)', () => {
    const RANGE = DEFAULT_AUTO_RANGE;

    it('antes del inicio (de día) → próximo borde es el inicio de hoy', () => {
      expect(computeNextBoundaryMs(RANGE, at(10, 0))).toBe(9 * HOUR);
    });

    it('después del inicio (de noche) → próximo borde es el fin de mañana', () => {
      expect(computeNextBoundaryMs(RANGE, at(20, 0))).toBe(11 * HOUR);
    });

    it('después de medianoche, antes del fin → próximo borde es el fin de hoy', () => {
      expect(computeNextBoundaryMs(RANGE, at(3, 0))).toBe(4 * HOUR);
    });
  });

  it('rango degenerado (start === end) cae a un día completo en vez de un timeout de 0ms', () => {
    const RANGE = { startHour: 9, startMinute: 0, endHour: 9, endMinute: 0 };
    expect(computeNextBoundaryMs(RANGE, at(9, 0, 0, 0))).toBe(24 * HOUR);
  });
});

describe('loadStoredTheme', () => {
  it('clave ausente en localStorage → defaults (auto, rango 19:00–07:00)', () => {
    expect(loadStoredTheme()).toEqual({ mode: 'auto', autoRange: DEFAULT_AUTO_RANGE });
  });

  it('JSON corrupto → defaults', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{esto no es json válido');
    expect(loadStoredTheme()).toEqual({ mode: 'auto', autoRange: DEFAULT_AUTO_RANGE });
  });

  it('shape completamente válido se devuelve intacto', () => {
    const range = { startHour: 20, startMinute: 15, endHour: 6, endMinute: 45 };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ version: 1, mode: 'dark', autoRange: range }));
    expect(loadStoredTheme()).toEqual({ mode: 'dark', autoRange: range });
  });

  it('mode arbitrario/inválido degrada solo el mode a "auto", conservando un autoRange válido', () => {
    const range = { startHour: 1, startMinute: 2, endHour: 3, endMinute: 4 };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ version: 1, mode: 'neon', autoRange: range }));
    expect(loadStoredTheme()).toEqual({ mode: 'auto', autoRange: range });
  });

  it.each([
    ['startHour fuera de rango (24)', { startHour: 24, startMinute: 0, endHour: 7, endMinute: 0 }],
    ['startHour negativo (-1)', { startHour: -1, startMinute: 0, endHour: 7, endMinute: 0 }],
    ['startMinute fuera de rango (60)', { startHour: 19, startMinute: 60, endHour: 7, endMinute: 0 }],
    ['endHour fuera de rango (99)', { startHour: 19, startMinute: 0, endHour: 99, endMinute: 0 }],
    ['endMinute fuera de rango (60)', { startHour: 19, startMinute: 0, endHour: 7, endMinute: 60 }],
    ['startHour de tipo string ("19")', { startHour: '19', startMinute: 0, endHour: 7, endMinute: 0 }],
    ['startMinute de tipo string ("0")', { startHour: 19, startMinute: '0', endHour: 7, endMinute: 0 }],
    ['startHour no-entero (19.5)', { startHour: 19.5, startMinute: 0, endHour: 7, endMinute: 0 }],
    ['endMinute no-entero (0.5)', { startHour: 19, startMinute: 0, endHour: 7, endMinute: 0.5 }],
    ['autoRange null', null],
    ['autoRange no es un objeto (string)', 'no-es-un-objeto'],
    ['autoRange le falta un campo', { startHour: 19, startMinute: 0, endHour: 7 }],
  ])('autoRange inválido (%s) degrada a DEFAULT_AUTO_RANGE, mode válido se conserva', (_label, badRange) => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ version: 1, mode: 'dark', autoRange: badRange }));
    expect(loadStoredTheme()).toEqual({ mode: 'dark', autoRange: DEFAULT_AUTO_RANGE });
  });

  it('localStorage.getItem lanzando (ej. incógnito estricto) → defaults, sin propagar la excepción', () => {
    // Spy on the live `localStorage` instance directly rather than
    // `Storage.prototype` — robust whether the test environment is using a
    // real jsdom Storage or the in-memory polyfill from test/setup.js.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('acceso denegado');
    });
    expect(() => loadStoredTheme()).not.toThrow();
    expect(loadStoredTheme()).toEqual({ mode: 'auto', autoRange: DEFAULT_AUTO_RANGE });
  });
});

describe('saveStoredTheme', () => {
  it('persiste { version, mode, autoRange } y devuelve true en éxito', () => {
    const range = { startHour: 21, startMinute: 0, endHour: 6, endMinute: 0 };
    const ok = saveStoredTheme({ mode: 'dark', autoRange: range });

    expect(ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY))).toEqual({
      version: 1,
      mode: 'dark',
      autoRange: range,
    });
  });

  it('devuelve false y no lanza si localStorage.setItem falla (ej. cuota excedida)', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    let ok;
    expect(() => { ok = saveStoredTheme({ mode: 'light', autoRange: DEFAULT_AUTO_RANGE }); }).not.toThrow();
    expect(ok).toBe(false);
  });
});
