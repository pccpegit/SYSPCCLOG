import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCVUpload, { makeBatches } from './useCVUpload';
import { uploadCVFiles } from '../api/hr';

vi.mock('../api/hr', () => ({ uploadCVFiles: vi.fn() }));

const entry = (n, size = 100) => {
  const file = new File(['x'], `cv${n}.pdf`);
  Object.defineProperty(file, 'size', { value: size });
  return { id: `e${n}`, file };
};
const entries = (n) => Array.from({ length: n }, (_, i) => entry(i + 1));
const ok = (batchFiles) => ({ data: { accepted: batchFiles.map((f, i) => ({ id: i, original_name: f.name })), duplicates: [], rejected: [] } });

beforeEach(() => vi.clearAllMocks());

describe('makeBatches', () => {
  it('corta por cantidad (<= batch_size) y por 40 MB', () => {
    expect(makeBatches(entries(60), 25).map((b) => b.length)).toEqual([25, 25, 10]);
    const big = [entry(1, 30 * 1024 * 1024), entry(2, 30 * 1024 * 1024), entry(3, 1)];
    expect(makeBatches(big, 25).map((b) => b.length)).toEqual([1, 2]);
    expect(makeBatches([], 25)).toEqual([]);
  });
});

describe('useCVUpload', () => {
  it('sube en tandas, informa el estado de cada archivo y el avance', async () => {
    uploadCVFiles.mockImplementation(async (id, files) => {
      const r = ok(files);
      if (files.some((f) => f.name === 'cv2.pdf')) {
        r.data.accepted = r.data.accepted.filter((a) => a.original_name !== 'cv2.pdf');
        r.data.duplicates = [{ original_name: 'cv2.pdf', duplicate_of: 9 }];
      }
      if (files.some((f) => f.name === 'cv3.pdf')) {
        r.data.accepted = r.data.accepted.filter((a) => a.original_name !== 'cv3.pdf');
        r.data.rejected = [{ original_name: 'cv3.pdf', code: 'pdf_encrypted', detail: 'El PDF tiene contraseña.' }];
      }
      return r;
    });
    const { result } = renderHook(() => useCVUpload(5));
    const states = {};
    let summary;
    await act(async () => {
      summary = await result.current.upload(entries(5), { batchSize: 2, onEntry: (id, patch) => { states[id] = patch; } });
    });
    expect(uploadCVFiles).toHaveBeenCalledTimes(3);
    expect(states.e1.state).toBe('uploaded');
    expect(states.e2.state).toBe('duplicate');
    expect(states.e3).toMatchObject({ state: 'rejected', detail: 'El PDF tiene contraseña.' });
    expect(summary).toMatchObject({ uploaded: 3, duplicates: 1, rejected: 1, failed: 0, aborted: false, fatal: null });
    expect(result.current.uploading).toBe(false);
    expect(result.current.sent).toBe(5);
  });

  it('reintenta una vez ante un error de red y si vuelve a fallar marca el lote como fallido', async () => {
    uploadCVFiles.mockRejectedValue({ message: 'Network Error' });
    const { result } = renderHook(() => useCVUpload(5));
    const states = {};
    let summary;
    await act(async () => {
      summary = await result.current.upload(entries(2), { batchSize: 25, onEntry: (id, patch) => { states[id] = patch; } });
    });
    expect(uploadCVFiles).toHaveBeenCalledTimes(2);
    expect(summary.failed).toBe(2);
    expect(states.e1.state).toBe('failed');
    expect(states.e1.detail).toMatch(/no hay conexión/i);
  });

  it('un error de negocio (409/429) no se reintenta y corta el resto como fatal', async () => {
    uploadCVFiles.mockRejectedValue({ response: { status: 429, data: { code: 'daily_limit_reached', detail: 'Hoy llegaste al límite.' } } });
    const { result } = renderHook(() => useCVUpload(5));
    const states = {};
    let summary;
    await act(async () => {
      summary = await result.current.upload(entries(60), { batchSize: 25, onEntry: (id, patch) => { states[id] = patch; } });
    });
    expect(summary.fatal).toMatchObject({ code: 'daily_limit_reached', message: 'Hoy llegaste al límite.' });
    expect(summary.failed).toBe(0);
    expect(states.e1.state).toBe('pending'); // se puede volver a intentar mañana
    expect(uploadCVFiles.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('"Detener" aborta: lo ya subido queda, lo pendiente vuelve a pendiente', async () => {
    let calls = 0;
    uploadCVFiles.mockImplementation((id, files, { signal }) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(ok(files));
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }));
      });
    });
    const { result } = renderHook(() => useCVUpload(5));
    const states = {};
    let promise;
    await act(async () => {
      promise = result.current.upload(entries(3), { batchSize: 1, onEntry: (id, patch) => { states[id] = patch; } });
      await Promise.resolve();
    });
    await act(async () => {
      result.current.stop();
      await promise;
    });
    const summary = await promise;
    expect(summary.aborted).toBe(true);
    expect(summary.uploaded).toBe(1);
    expect(states.e1.state).toBe('uploaded');
    expect(states.e2.state).toBe('pending');
  });
});
