import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';
import { THEME_STORAGE_KEY, DEFAULT_AUTO_RANGE } from '../utils/theme';

function wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function renderTheme() {
  return renderHook(() => useTheme(), { wrapper });
}

function at(hour, minute = 0) {
  return new Date(2026, 0, 15, hour, minute, 0, 0);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'theme-transitioning');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'theme-transitioning');
});

describe('ThemeProvider / useTheme — persistencia en localStorage', () => {
  it('al montar, carga mode y autoRange ya guardados en localStorage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'dark', autoRange: DEFAULT_AUTO_RANGE,
    }));

    const { result } = renderTheme();

    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(result.current.autoRange).toEqual(DEFAULT_AUTO_RANGE);
  });

  it('setMode actualiza el estado en memoria y persiste el nuevo modo en localStorage', () => {
    const { result } = renderTheme();

    act(() => { result.current.setMode('dark'); });

    expect(result.current.mode).toBe('dark');
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
    expect(stored.mode).toBe('dark');
  });

  it('setAutoRange actualiza el estado en memoria y persiste el nuevo rango en localStorage', () => {
    const { result } = renderTheme();
    const newRange = { startHour: 20, startMinute: 0, endHour: 6, endMinute: 30 };

    act(() => { result.current.setAutoRange(newRange); });

    expect(result.current.autoRange).toEqual(newRange);
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
    expect(stored.autoRange).toEqual(newRange);
  });

  it('setMode/setAutoRange devuelven el boolean de éxito de saveStoredTheme', () => {
    const { result } = renderTheme();

    let ok;
    act(() => { ok = result.current.setMode('light'); });
    expect(ok).toBe(true);
  });

  it('si localStorage.setItem falla, setMode igual actualiza el estado en memoria pero retorna false', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const { result } = renderTheme();

    let ok;
    act(() => { ok = result.current.setMode('dark'); });

    expect(ok).toBe(false);
    expect(result.current.mode).toBe('dark'); // applied in-memory for the rest of the session anyway
  });
});

describe('ThemeProvider / useTheme — toggleTheme fuerza salida de auto', () => {
  it('con mode="auto" y resolvedTheme claro, toggleTheme cambia a mode="dark" (el opuesto)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10, 0)); // 10:00 — claro bajo el rango default (oscuro 19:00–07:00)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'auto', autoRange: DEFAULT_AUTO_RANGE,
    }));

    const { result } = renderTheme();
    expect(result.current.mode).toBe('auto');
    expect(result.current.resolvedTheme).toBe('light');

    act(() => { result.current.toggleTheme(); });

    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
    expect(stored.mode).toBe('dark');
  });

  it('con mode="auto" y resolvedTheme oscuro, toggleTheme cambia a mode="light" (el opuesto)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 0)); // 20:00 — oscuro bajo el rango default
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'auto', autoRange: DEFAULT_AUTO_RANGE,
    }));

    const { result } = renderTheme();
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => { result.current.toggleTheme(); });

    expect(result.current.mode).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('toggleTheme también funciona en modo manual, simplemente invierte el tema actual', () => {
    const { result } = renderTheme();
    act(() => { result.current.setMode('light'); });

    act(() => { result.current.toggleTheme(); });
    expect(result.current.mode).toBe('dark');

    act(() => { result.current.toggleTheme(); });
    expect(result.current.mode).toBe('light');
  });
});

describe('ThemeProvider — aplica/quita la clase dark en <html>', () => {
  it('agrega la clase dark cuando el tema resuelto es oscuro, y la quita en claro', () => {
    // Seed a deterministic starting mode — with an empty localStorage the
    // default mode is 'auto', whose resolvedTheme (and therefore the
    // initial dark-class state) would otherwise depend on the real wall
    // clock the test happens to run at.
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'light', autoRange: DEFAULT_AUTO_RANGE,
    }));
    const { result } = renderTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => { result.current.setMode('dark'); });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => { result.current.setMode('light'); });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('ThemeProvider — fallback ante localStorage corrupto o no disponible', () => {
  it('con JSON corrupto en localStorage, arranca en los defaults saneados (auto, rango 19–07)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{esto no es json');

    const { result } = renderTheme();

    expect(result.current.mode).toBe('auto');
    expect(result.current.autoRange).toEqual(DEFAULT_AUTO_RANGE);
  });

  it('con localStorage.getItem lanzando, arranca en los defaults sin romper el render', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('no disponible');
    });

    const { result } = renderTheme();

    expect(result.current.mode).toBe('auto');
    expect(result.current.autoRange).toEqual(DEFAULT_AUTO_RANGE);
  });
});

describe('ThemeProvider — cleanup de timers, incluida supervivencia a StrictMode', () => {
  it('en mode="auto" agenda un único setTimeout al próximo borde y lo limpia por completo al desmontar, incluso bajo StrictMode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10, 0));

    function strictWrapper({ children }) {
      return <StrictMode><ThemeProvider>{children}</ThemeProvider></StrictMode>;
    }
    const { result, unmount } = renderHook(() => useTheme(), { wrapper: strictWrapper });

    // StrictMode double-invokes the effect (mount → cleanup → mount) in dev;
    // if cleanup didn't clearTimeout properly, this would be 2 (or more)
    // instead of exactly 1 surviving boundary timeout.
    expect(result.current.mode).toBe('auto');
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('en mode="light"/"dark" (sin schedule de borde) no deja timers colgando al desmontar', () => {
    vi.useFakeTimers();
    // Explicit manual mode, not the default 'auto' — no boundary setTimeout
    // should be scheduled at all in this case (Decisión 4 only applies to
    // 'auto').
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'dark', autoRange: DEFAULT_AUTO_RANGE,
    }));
    const { unmount } = renderHook(() => useTheme(), { wrapper });
    // TRANSITION_MS cleanup timer only fires on an actual theme change, and
    // the initial mount doesn't count as a change (see applyThemeClass) —
    // so nothing should be scheduled yet.
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ThemeProvider — re-evaluación en visibilitychange/focus (red de seguridad)', () => {
  it('re-evalúa resolvedTheme al disparar visibilitychange, sin esperar a que el setTimeout agendado dispare', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 0)); // 20:00 — oscuro
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'auto', autoRange: DEFAULT_AUTO_RANGE,
    }));

    const { result } = renderTheme();
    expect(result.current.resolvedTheme).toBe('dark');

    // Simulate the machine/tab waking up well past the light boundary
    // without the originally-scheduled timeout ever firing (e.g. the OS
    // suspended the tab and clamped it) — visibilitychange is the safety
    // net described in Decisión 4.
    act(() => {
      vi.setSystemTime(new Date(2026, 0, 16, 8, 0, 0, 0)); // next day, 08:00 — claro
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.resolvedTheme).toBe('light');
  });

  it('re-evalúa resolvedTheme al disparar el evento focus en window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(3, 0)); // 03:00 — oscuro (dentro del wraparound)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1, mode: 'auto', autoRange: DEFAULT_AUTO_RANGE,
    }));

    const { result } = renderTheme();
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => {
      vi.setSystemTime(at(9, 0)); // 09:00 mismo día — claro
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current.resolvedTheme).toBe('light');
  });

  it('en mode="light"/"dark" (no-auto) no registra listeners de visibilitychange/focus que muten el tema', () => {
    const { result } = renderTheme();
    act(() => { result.current.setMode('light'); });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    // Nothing should have changed — mode is manual, unaffected by the
    // wake-up safety net that only applies to 'auto'.
    expect(result.current.mode).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });
});
