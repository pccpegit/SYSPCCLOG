import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCVProgress, { backoffDelay } from './useCVProgress';
import { getCVProgress } from '../api/hr';
import { progressResponse } from '../test/cvFixtures';

vi.mock('../api/hr', () => ({ getCVProgress: vi.fn() }));

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const httpError = (status, extra = {}) => ({ response: { status, data: {}, headers: {}, ...extra } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('useCVProgress', () => {
  it('consulta sin since la primera vez y luego usa server_time; mientras hay pendientes sondea cada 2 s', async () => {
    getCVProgress
      .mockResolvedValueOnce({ data: progressResponse({ total: 3, queued: 2, done: 1 }, { server_time: 'T1' }) })
      .mockResolvedValue({ data: progressResponse({ total: 3, queued: 1, done: 2 }, { server_time: 'T2' }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(getCVProgress).toHaveBeenCalledTimes(1);
    expect(getCVProgress.mock.calls[0][1]).toBeNull();
    expect(result.current.counts.done).toBe(1);
    await flush(1999);
    expect(getCVProgress).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(getCVProgress).toHaveBeenCalledTimes(2);
    expect(getCVProgress.mock.calls[1][1]).toBe('T1');
    expect(result.current.counts.done).toBe(2);
  });

  it('fusiona los items por id', async () => {
    getCVProgress
      .mockResolvedValueOnce({ data: progressResponse({ total: 2, queued: 2 }, { items: [{ id: 1, status: 'QUEUED' }, { id: 2, status: 'QUEUED' }] }) })
      .mockResolvedValue({ data: progressResponse({ total: 2, queued: 1, done: 1 }, { items: [{ id: 1, status: 'DONE', score: 90 }] }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    await flush(2000);
    expect(result.current.itemsById[1]).toMatchObject({ status: 'DONE', score: 90 });
    expect(result.current.itemsById[2]).toMatchObject({ status: 'QUEUED' });
  });

  it('asentado: sondea cada 10 s durante 6 sondeos y luego se detiene; refresh() lo reactiva', async () => {
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 2, done: 2 }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(getCVProgress).toHaveBeenCalledTimes(1);
    await flush(10000 * 6);
    expect(getCVProgress).toHaveBeenCalledTimes(7);
    await flush(60000);
    expect(getCVProgress).toHaveBeenCalledTimes(7);
    await act(async () => {
      result.current.refresh();
    });
    await flush();
    expect(getCVProgress).toHaveBeenCalledTimes(8);
  });

  it('pausa con la pestaña oculta y sondea de inmediato al volver', async () => {
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 2, queued: 1, done: 1 }) });
    renderHook(() => useCVProgress(5));
    await flush();
    expect(getCVProgress).toHaveBeenCalledTimes(1);
    act(() => setVisibility('hidden'));
    await flush(30000);
    expect(getCVProgress).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    await flush();
    expect(getCVProgress).toHaveBeenCalledTimes(2);
  });

  it('con errores aplica backoff, marca conexión perdida tras 3 y se recupera con un éxito', async () => {
    getCVProgress.mockRejectedValue(httpError(503));
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(result.current.connection).toBe('ok');
    await flush(3000); // 1.º reintento (~2 s)
    await flush(6000); // 2.º reintento (~4 s)
    expect(getCVProgress.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current.connection).toBe('lost');
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 1, queued: 1 }) });
    await flush(30000);
    expect(result.current.connection).toBe('ok');
  });

  it('el backoff crece, tiene tope de 30 s y respeta Retry-After', () => {
    const mid = () => 0.5; // sin jitter
    expect(backoffDelay(1, 0, mid)).toBe(2000);
    expect(backoffDelay(2, 0, mid)).toBe(4000);
    expect(backoffDelay(10, 0, mid)).toBe(30000);
    expect(backoffDelay(1, 7, mid)).toBe(7000);
  });

  it('404 detiene el sondeo y marca el análisis como no encontrado', async () => {
    getCVProgress.mockRejectedValue(httpError(404));
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(result.current.fatal).toBe('notfound');
    await flush(60000);
    expect(getCVProgress).toHaveBeenCalledTimes(1);
  });

  it('invalid_since reinicia el sondeo sin since', async () => {
    getCVProgress
      .mockResolvedValueOnce({ data: progressResponse({ total: 1, queued: 1 }, { server_time: 'T1' }) })
      .mockRejectedValueOnce({ response: { status: 400, data: { code: 'invalid_since' }, headers: {} } })
      .mockResolvedValue({ data: progressResponse({ total: 1, queued: 1 }) });
    renderHook(() => useCVProgress(5));
    await flush();
    await flush(2000);
    await flush(600);
    expect(getCVProgress.mock.calls[2][1]).toBeNull();
  });

  it('stalled sigue sondeando y expone el flag', async () => {
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 2, queued: 2 }, { stalled: true }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(result.current.stalled).toBe(true);
  });

  it('finishedEvent no aparece al abrir un análisis que ya estaba terminado', async () => {
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 2, done: 2 }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(result.current.finishedEvent).toBeNull();
  });

  it('finishedEvent aparece cuando se ve terminar una corrida en esta sesión', async () => {
    getCVProgress
      .mockResolvedValueOnce({ data: progressResponse({ total: 2, processing: 1, done: 1 }) })
      .mockResolvedValue({ data: progressResponse({ total: 2, done: 2 }) });
    const { result } = renderHook(() => useCVProgress(5));
    await flush();
    expect(result.current.finishedEvent).toBeNull();
    await flush(2000);
    expect(result.current.finishedEvent).toMatchObject({ counts: { done: 2 } });
  });

  it('limpia timers y cancela la petición al desmontar', async () => {
    getCVProgress.mockResolvedValue({ data: progressResponse({ total: 2, queued: 1, done: 1 }) });
    const { unmount } = renderHook(() => useCVProgress(5));
    await flush();
    unmount();
    await flush(20000);
    expect(getCVProgress).toHaveBeenCalledTimes(1);
  });

  it('no sondea si enabled es false', async () => {
    renderHook(() => useCVProgress(5, { enabled: false }));
    await flush(5000);
    expect(getCVProgress).not.toHaveBeenCalled();
  });
});
