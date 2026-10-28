import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useEta from './useEta';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useEta', () => {
  it('muestra "Calculando…" hasta tener 3 listos y 20 s, y luego una estimación estable', async () => {
    const { result, rerender } = renderHook(({ counts }) => useEta(counts), {
      initialProps: { counts: { queued: 40, processing: 0, done: 0, failed: 0 } },
    });
    expect(result.current.text).toBe('Calculando el tiempo…');
    rerender({ counts: { queued: 36, processing: 0, done: 4, failed: 0 } });
    await tick(10000);
    expect(result.current.text).toBe('Calculando el tiempo…'); // < 20 s
    await tick(10000); // 20 s, 4 listos => 5 s por CV x 36 = 180 s
    expect(result.current.text).toBe('Faltan unos 3 min');
    await tick(10000); // 30 s => 270 s en bruto, pero sube como máximo 20 %: 216 s
    expect(result.current.seconds).toBeCloseTo(216, 5);
    expect(result.current.text).toBe('Faltan unos 4 min');
  });

  it('se actualiza como máximo cada 10 s y no sube más de 20 % entre actualizaciones', async () => {
    const { result, rerender } = renderHook(({ counts }) => useEta(counts), {
      initialProps: { counts: { queued: 20, processing: 0, done: 0, failed: 0 } },
    });
    rerender({ counts: { queued: 10, processing: 0, done: 10, failed: 0 } });
    await tick(20000); // 20 s / 10 listos * 10 pendientes = 20 s
    expect(result.current.seconds).toBe(20);
    await tick(10000); // 30 s en bruto, pero sube como máximo 20 %
    expect(result.current.seconds).toBeCloseTo(24, 5);
    await tick(5000); // aún no toca actualizar (cada 10 s)
    expect(result.current.seconds).toBeCloseTo(24, 5);
    await tick(5000);
    expect(result.current.seconds).toBeCloseTo(28.8, 5);
  });

  it('sin pendientes no hay estimación', async () => {
    const { result } = renderHook(() => useEta({ queued: 0, processing: 0, done: 5, failed: 0 }));
    await tick(30000);
    expect(result.current.seconds).toBeNull();
  });
});
