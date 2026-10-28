import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  resolveTheme,
  computeNextBoundaryMs,
  loadStoredTheme,
  saveStoredTheme,
} from '../utils/theme';

// Same pattern as AuthContext/ToastContext: createContext(null) + a hook
// that throws outside the provider.
const ThemeContext = createContext(null);

// How long the `.theme-transitioning` class stays on <html> after a theme
// change — long enough for the CSS transitions in index.css to finish,
// short enough that it isn't paid on every render (see Decisión 1 in the
// SYSPCC-020 handoff: no permanent global transition, tables are large).
const TRANSITION_MS = 250;

/**
 * Applies `theme` to <html class="dark">, only pulsing the transition class
 * when the resolved theme actually changed (avoids re-triggering it on
 * every visibilitychange/focus re-evaluation when nothing moved).
 */
function applyThemeClass(theme, lastThemeRef, transitionTimeoutRef) {
  const root = document.documentElement;
  const changed = lastThemeRef.current !== theme;
  lastThemeRef.current = theme;

  if (changed) {
    root.classList.add('theme-transitioning');
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(() => {
      root.classList.remove('theme-transitioning');
      transitionTimeoutRef.current = null;
    }, TRANSITION_MS);
  }

  root.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }) {
  // Loaded once, synchronously, on first render — the anti-FOUC script in
  // index.html already applied `.dark` (or not) before React even mounted
  // using the exact same algorithm (utils/theme.js resolveTheme), so this
  // is just React catching up to what's already on screen, not a first paint.
  const storedRef = useRef(null);
  if (storedRef.current === null) storedRef.current = loadStoredTheme();
  const stored = storedRef.current;

  const [mode, setModeState] = useState(stored.mode);
  const [autoRange, setAutoRangeState] = useState(stored.autoRange);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(stored.mode, stored.autoRange));

  // Mirrors resolvedTheme without causing re-renders — read/written from
  // inside effects and timeouts.
  const lastThemeRef = useRef(resolvedTheme);
  const transitionTimeoutRef = useRef(null);

  // Re-evaluate resolvedTheme whenever mode/autoRange change, and — only in
  // 'auto' mode — schedule a single setTimeout to the next start/end
  // boundary instead of polling (Decisión 4). Background tabs/suspended
  // machines can clamp or pause timers, so also re-evaluate on
  // visibilitychange/focus as a safety net.
  useEffect(() => {
    const evaluate = () => {
      const theme = resolveTheme(mode, autoRange);
      applyThemeClass(theme, lastThemeRef, transitionTimeoutRef);
      setResolvedTheme(theme);
    };

    evaluate();

    if (mode !== 'auto') return undefined;

    let boundaryTimeout = null;

    const scheduleNext = () => {
      if (boundaryTimeout) clearTimeout(boundaryTimeout);
      const ms = computeNextBoundaryMs(autoRange);
      boundaryTimeout = setTimeout(() => {
        evaluate();
        scheduleNext();
      }, ms);
    };

    const handleWake = () => {
      // The tab may have been backgrounded/suspended long enough for the
      // scheduled timeout to have been clamped — re-evaluate immediately
      // and re-anchor the schedule from "now" rather than waiting for a
      // possibly-stale timer to fire.
      evaluate();
      scheduleNext();
    };

    scheduleNext();
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      if (boundaryTimeout) clearTimeout(boundaryTimeout);
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluate/scheduleNext are re-created intentionally each run from mode/autoRange
  }, [mode, autoRange]);

  // Cleanup the transition-class timer on unmount — survives StrictMode's
  // dev-time double-invoke because it's a ref, not component state.
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
  }, []);

  // Each setter returns the localStorage write result (from saveStoredTheme)
  // so callers — namely AppearanceTab in SettingsPage — can surface a toast
  // if persistence silently failed (e.g. strict private browsing). The
  // theme itself still applies in-memory for the rest of the session even
  // when the write fails; only the "remember this" part is at risk.
  const setMode = useCallback((nextMode) => {
    setModeState(nextMode);
    return saveStoredTheme({ mode: nextMode, autoRange });
  }, [autoRange]);

  const setAutoRange = useCallback((nextRange) => {
    setAutoRangeState(nextRange);
    return saveStoredTheme({ mode, autoRange: nextRange });
  }, [mode]);

  // Decisión 2: the header toggle always forces a manual override, even
  // when the current mode is 'auto' — it flips to the opposite of whatever
  // is showing right now and leaves 'auto' behind. Configuración reflects
  // this because it reads the same persisted `mode`.
  const toggleTheme = useCallback(() => {
    const nextMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setModeState(nextMode);
    return saveStoredTheme({ mode: nextMode, autoRange });
  }, [resolvedTheme, autoRange]);

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, toggleTheme, autoRange, setAutoRange }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
