import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadResponse, filenameFromDisposition, sanitizeFilename } from './download';

afterEach(() => vi.restoreAllMocks());

describe('filenameFromDisposition', () => {
  it('lee filename simple y entre comillas', () => {
    expect(filenameFromDisposition('attachment; filename="RESUMEN_MOVIMIENTO_2026-10-28.xlsx"', 'x.xlsx')).toBe('RESUMEN_MOVIMIENTO_2026-10-28.xlsx');
    expect(filenameFromDisposition('attachment; filename=inventario.xlsx', 'x.xlsx')).toBe('inventario.xlsx');
  });

  it('prefiere filename* codificado', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''vale%20n%C2%B01.pdf", 'x.pdf')).toBe('vale n°1.pdf');
  });

  it('usa el nombre de respaldo sin cabecera', () => {
    expect(filenameFromDisposition(undefined, 'respaldo.xlsx')).toBe('respaldo.xlsx');
  });

  it('neutraliza rutas y caracteres peligrosos', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd'.replace(/^\.+/, ''));
    expect(sanitizeFilename('a/b\\c:d.xlsx')).toBe('a_b_c_d.xlsx');
    expect(sanitizeFilename('', 'x.xlsx')).toBe('x.xlsx');
  });
});

describe('downloadResponse', () => {
  it('guarda el blob con el nombre del servidor y libera la URL', async () => {
    vi.useFakeTimers();
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['x']);

    const name = await downloadResponse(
      Promise.resolve({ data: blob, headers: { 'content-disposition': 'attachment; filename="r.xlsx"' } }),
      'otro.xlsx',
    );

    expect(name).toBe('r.xlsx');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
  });

  it('propaga el error de la petición', async () => {
    await expect(downloadResponse(Promise.reject(new Error('fallo')), 'x.xlsx')).rejects.toThrow('fallo');
  });
});
