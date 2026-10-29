import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, screen } from '@testing-library/react';
import { ToastProvider } from '../context/ToastContext';
import useFileDownload from './useFileDownload';
import * as download from '../utils/download';

// SYSPCC-025 · QA ronda 1 — descarga de archivos con estado «en curso» y aviso de error.

vi.mock('../utils/download', async () => {
  const actual = await vi.importActual('../utils/download');
  return { ...actual, downloadResponse: vi.fn() };
});

const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  download.downloadResponse.mockResolvedValue('archivo.xlsx');
});

describe('useFileDownload', () => {
  it('descarga, devuelve true y deja de estar ocupado', async () => {
    const { result } = renderHook(() => useFileDownload(), { wrapper });
    const request = vi.fn().mockResolvedValue({});
    let ok;
    await act(async () => { ok = await result.current.run(request, 'respaldo.xlsx'); });
    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(download.downloadResponse).toHaveBeenCalledWith(expect.anything(), 'respaldo.xlsx');
    expect(result.current.busy).toBe(false);
  });

  it('si falla devuelve false, avisa con el mensaje y libera el estado', async () => {
    download.downloadResponse.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useFileDownload(), { wrapper });
    let ok;
    await act(async () => { ok = await result.current.run(() => Promise.resolve(), 'x.xlsx', 'No se pudo exportar.'); });
    expect(ok).toBe(false);
    expect(await screen.findByText('No se pudo exportar.')).toBeInTheDocument();
    expect(result.current.busy).toBe(false);
  });

  it('usa un mensaje de respaldo en español', async () => {
    download.downloadResponse.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useFileDownload(), { wrapper });
    await act(async () => { await result.current.run(() => Promise.resolve(), 'x.xlsx'); });
    expect(await screen.findByText('No se pudo descargar el archivo. Intente nuevamente.')).toBeInTheDocument();
  });

  it('ignora un segundo clic mientras la descarga sigue en curso', async () => {
    let finish;
    download.downloadResponse.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useFileDownload(), { wrapper });
    const request = vi.fn().mockResolvedValue({});
    let first;
    let second;
    await act(async () => {
      first = result.current.run(request, 'a.xlsx');
      second = await result.current.run(request, 'a.xlsx');
    });
    expect(second).toBe(false);
    expect(result.current.busy).toBe(true);
    await act(async () => { finish('a.xlsx'); await first; });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('tras un fallo permite descargar de nuevo', async () => {
    download.downloadResponse.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('a.xlsx');
    const { result } = renderHook(() => useFileDownload(), { wrapper });
    await act(async () => { await result.current.run(() => Promise.resolve(), 'a.xlsx'); });
    let ok;
    await act(async () => { ok = await result.current.run(() => Promise.resolve(), 'a.xlsx'); });
    expect(ok).toBe(true);
  });
});
