import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useCVConfig from './useCVConfig';
import { getCVConfig } from '../api/hr';
import { cvConfig } from '../test/cvFixtures';

vi.mock('../api/hr', () => ({ getCVConfig: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('useCVConfig', () => {
  it('empieza cargando y expone la configuración', async () => {
    getCVConfig.mockResolvedValue({ data: cvConfig({ simulated: true, provider: 'fake' }) });
    const { result } = renderHook(() => useCVConfig());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config.simulated).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it('si falla marca error (sin configuración) y reload() lo recupera', async () => {
    getCVConfig.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ data: cvConfig() });
    const { result } = renderHook(() => useCVConfig());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.config).toBeNull();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(result.current.isError).toBe(false);
  });

  it('si una recarga falla conserva la última configuración buena', async () => {
    getCVConfig.mockResolvedValueOnce({ data: cvConfig() }).mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useCVConfig());
    await waitFor(() => expect(result.current.config).not.toBeNull());
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.config.enabled).toBe(true);
  });

  it('no actualiza el estado si se desmonta antes de la respuesta', async () => {
    let resolve;
    getCVConfig.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { result, unmount } = renderHook(() => useCVConfig());
    unmount();
    resolve({ data: cvConfig() });
    await Promise.resolve();
    expect(result.current.config).toBeNull();
  });
});
