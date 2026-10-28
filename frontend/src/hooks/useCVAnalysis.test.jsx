import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useCVAnalysis from './useCVAnalysis';
import { getCVAnalysis } from '../api/hr';
import { analysisDetail } from '../test/cvFixtures';

vi.mock('../api/hr', () => ({ getCVAnalysis: vi.fn() }));

const httpError = (status, data = {}) => ({ response: { status, data } });

beforeEach(() => vi.clearAllMocks());

describe('useCVAnalysis', () => {
  it('carga el detalle y pasa de "loading" a "ready"', async () => {
    getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    const { result } = renderHook(() => useCVAnalysis(5));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.analysis.name).toMatch(/Residente/);
    expect(getCVAnalysis).toHaveBeenCalledWith(5, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([404, 403])('un %s se trata como "no encontrado" (no revela si existe)', async (status) => {
    getCVAnalysis.mockRejectedValue(httpError(status));
    const { result } = renderHook(() => useCVAnalysis(5));
    await waitFor(() => expect(result.current.status).toBe('notfound'));
    expect(result.current.analysis).toBeNull();
  });

  it('un error de red o 500 queda como "error" con un mensaje en español, y reload() lo recupera', async () => {
    getCVAnalysis.mockRejectedValueOnce(httpError(500)).mockResolvedValue({ data: analysisDetail() });
    const { result } = renderHook(() => useCVAnalysis(5));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeTruthy();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getCVAnalysis).toHaveBeenCalledTimes(2);
  });

  it('sin id queda inactivo y no pide nada', () => {
    const { result } = renderHook(() => useCVAnalysis(undefined));
    expect(result.current.status).toBe('idle');
    expect(getCVAnalysis).not.toHaveBeenCalled();
  });

  it('al cambiar de id no muestra el análisis anterior mientras llega el nuevo', async () => {
    getCVAnalysis.mockImplementation((id) => Promise.resolve({ data: analysisDetail({ id, name: `Análisis ${id}` }) }));
    const { result, rerender } = renderHook(({ id }) => useCVAnalysis(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.analysis?.name).toBe('Análisis 1'));
    getCVAnalysis.mockImplementation(() => new Promise(() => {})); // el 2 tarda
    rerender({ id: 2 });
    expect(result.current.status).toBe('loading');
    expect(result.current.analysis).toBeNull();
  });

  it('setAnalysis reemplaza el detalle sin volver a pedirlo', async () => {
    getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    const { result } = renderHook(() => useCVAnalysis(5));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setAnalysis(analysisDetail({ name: 'Nombre nuevo' })));
    expect(result.current.analysis.name).toBe('Nombre nuevo');
    expect(getCVAnalysis).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que llega tras desmontar o cancelarse no actualiza el estado', async () => {
    let reject;
    getCVAnalysis.mockImplementation(() => new Promise((_, rej) => { reject = rej; }));
    const { result, unmount } = renderHook(() => useCVAnalysis(5));
    unmount();
    reject({ code: 'ERR_CANCELED' });
    await Promise.resolve();
    expect(result.current.status).toBe('loading');
  });
});
