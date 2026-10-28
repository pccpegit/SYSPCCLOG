import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useFilterAnnouncer from './useFilterAnnouncer';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useFilterAnnouncer', () => {
  it('no dice nada al montar', async () => {
    const { result } = renderHook(() => useFilterAnnouncer('all|', 'Mostrando 40 de 40 candidatos.'));
    await flush(2000);
    expect(result.current).toBe('');
  });

  it('anuncia una sola vez, tras la pausa, cuando cambian los filtros', async () => {
    const { result, rerender } = renderHook(({ k, m }) => useFilterAnnouncer(k, m), { initialProps: { k: 'all|', m: 'Mostrando 40 de 40 candidatos.' } });
    rerender({ k: 'all|a', m: 'Mostrando 12 de 40 candidatos.' });
    await flush(200);
    rerender({ k: 'all|an', m: 'Mostrando 5 de 40 candidatos.' });
    await flush(400);
    expect(result.current).toBe(''); // sigue escribiendo: nada todavía
    await flush(200);
    expect(result.current).toBe('Mostrando 5 de 40 candidatos.');
  });

  it('si solo cambian los datos con los mismos filtros, queda en silencio', async () => {
    const { result, rerender } = renderHook(({ k, m }) => useFilterAnnouncer(k, m), { initialProps: { k: 'FAILED|', m: 'Mostrando 1 de 4 candidatos.' } });
    rerender({ k: 'FAILED|', m: 'Mostrando 2 de 4 candidatos.' });
    await flush(2000);
    expect(result.current).toBe('');
  });

  it('limpia el temporizador al desmontar', async () => {
    const { result, rerender, unmount } = renderHook(({ k }) => useFilterAnnouncer(k, 'x'), { initialProps: { k: 'a' } });
    rerender({ k: 'b' });
    unmount();
    await flush(2000);
    expect(result.current).toBe('');
  });
});
