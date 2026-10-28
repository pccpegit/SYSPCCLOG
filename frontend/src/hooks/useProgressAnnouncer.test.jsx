import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useProgressAnnouncer from './useProgressAnnouncer';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useProgressAnnouncer', () => {
  it('no dice nada sin CVs ni antes del primer hito', async () => {
    const { result, rerender } = renderHook(({ c }) => useProgressAnnouncer(c), { initialProps: { c: { total: 0, done: 0, failed: 0 } } });
    await flush();
    expect(result.current).toBe('');
    rerender({ c: { total: 10, done: 1, failed: 0 } });
    await flush();
    expect(result.current).toBe('');
  });

  it('anuncia solo hitos de 25 %, 50 % y 75 %, respetando 15 s entre anuncios', async () => {
    const { result, rerender } = renderHook(({ c }) => useProgressAnnouncer(c), { initialProps: { c: { total: 8, done: 0, failed: 0 } } });
    rerender({ c: { total: 8, done: 2, failed: 0 } });
    await flush();
    expect(result.current).toBe('Van 2 de 8 listos.');
    rerender({ c: { total: 8, done: 4, failed: 0 } }); // 50 % pero solo pasaron 0 s
    await flush(5000);
    expect(result.current).toBe('Van 2 de 8 listos.');
    await flush(15000); // pasó la pausa; el siguiente cambio de conteo ya puede anunciar
    rerender({ c: { total: 8, done: 5, failed: 0 } });
    await flush();
    expect(result.current).toBe('Van 5 de 8 listos.');
  });

  it('un salto grande anuncia una sola vez (no un mensaje por hito cruzado)', async () => {
    const { result, rerender } = renderHook(({ c }) => useProgressAnnouncer(c), { initialProps: { c: { total: 10, done: 0, failed: 0 } } });
    rerender({ c: { total: 10, done: 8, failed: 0 } });
    await flush();
    expect(result.current).toBe('Van 8 de 10 listos.');
    rerender({ c: { total: 10, done: 8, failed: 0 } });
    await flush(20000);
    expect(result.current).toBe('Van 8 de 10 listos.'); // mismos hitos: sin repetir
  });

  it('avisa del primer error una sola vez', async () => {
    const { result, rerender } = renderHook(({ c }) => useProgressAnnouncer(c), { initialProps: { c: { total: 10, done: 0, failed: 0 } } });
    rerender({ c: { total: 10, done: 0, failed: 1 } });
    await flush();
    expect(result.current).toBe('Un CV tuvo problemas. Puedes reintentarlo después.');
    rerender({ c: { total: 10, done: 0, failed: 2 } });
    await flush(30000);
    expect(result.current).toBe('Un CV tuvo problemas. Puedes reintentarlo después.');
  });

  it('tolera counts indefinido', async () => {
    const { result } = renderHook(() => useProgressAnnouncer(undefined));
    await flush();
    expect(result.current).toBe('');
  });

  it('cuenta también los CVs con error: el hito llega aunque no haya "listos"', async () => {
    const { result, rerender } = renderHook(({ c }) => useProgressAnnouncer(c), { initialProps: { c: { total: 8, done: 0, failed: 0, cancelled: 0 } } });
    rerender({ c: { total: 8, done: 0, failed: 2, cancelled: 0 } }); // 2 de 8 resueltos = 25 %
    await flush();
    expect(result.current).toBe('Van 0 de 8 listos.');
  });

  it('al terminar anuncia el resumen final, también dentro de la pausa de 15 s', async () => {
    const { result, rerender } = renderHook(({ c, f }) => useProgressAnnouncer(c, f), {
      initialProps: { c: { total: 4, done: 1, failed: 0, cancelled: 0 }, f: null },
    });
    await flush();
    expect(result.current).toBe('Van 1 de 4 listos.'); // primer hito: abre la pausa de 15 s
    rerender({ c: { total: 4, done: 3, failed: 1, cancelled: 0 }, f: null }); // 100 %, pero dentro de la pausa
    await flush();
    expect(result.current).toBe('Van 1 de 4 listos.');
    rerender({ c: { total: 4, done: 3, failed: 1, cancelled: 0 }, f: { counts: { total: 4, done: 3, failed: 1 } } });
    await flush(); // 0 s después: la pausa de 15 s no aplica al final
    expect(result.current).toBe('Análisis terminado: 3 listos, 1 con error.');
  });
});
