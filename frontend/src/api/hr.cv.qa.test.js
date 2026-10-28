// QA ronda 1 (SYSPCC-023, iteración 2): rutas restantes del cliente de CVs, saneo de
// nombres descargados y liberación del blob.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from './client';
import * as hr from './hr';

if (!Blob.prototype.text) {
  Blob.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ['get', 'post', 'patch', 'delete'].forEach((m) => client[m].mockResolvedValue({ data: {}, headers: {} }));
});
afterEach(() => vi.useRealTimers());

describe('api/hr — rutas de lectura y acciones de CVs', () => {
  it.each([
    ['getCVConfig', [], 'get', '/hr/cv-analyses/config/'],
    ['getCVAnalysis', [5], 'get', '/hr/cv-analyses/5/'],
    ['getCVItem', [5, 9], 'get', '/hr/cv-analyses/5/items/9/'],
  ])('%s usa %s %s', (fn, args, method, url) => {
    hr[fn](...args);
    expect(client[method].mock.calls.at(-1)[0]).toBe(url);
  });

  it('la lista y los items pasan sus filtros como params', () => {
    hr.getCVAnalyses({ page_size: 50, search: 'obra' });
    expect(client.get).toHaveBeenLastCalledWith('/hr/cv-analyses/', { params: { page_size: 50, search: 'obra' } });
    hr.getCVItems(5, { ordering: '-score', page_size: 500 });
    expect(client.get).toHaveBeenLastCalledWith('/hr/cv-analyses/5/items/', { params: { ordering: '-score', page_size: 500 } });
  });

  it('getCVAnalysis y getCVItem reenvían la señal para poder cancelarse', () => {
    const signal = new AbortController().signal;
    hr.getCVAnalysis(5, { signal });
    expect(client.get).toHaveBeenLastCalledWith('/hr/cv-analyses/5/', { signal });
    hr.getCVItem(5, 9, { signal });
    expect(client.get).toHaveBeenLastCalledWith('/hr/cv-analyses/5/items/9/', { signal });
  });

  it('borrar un CV, borrar la convocatoria, reanudar y cancelar usan el verbo y la ruta del contrato', () => {
    hr.deleteCVItem(5, 9);
    expect(client.delete).toHaveBeenLastCalledWith('/hr/cv-analyses/5/items/9/');
    hr.deleteCVPosting(5);
    expect(client.delete).toHaveBeenLastCalledWith('/hr/cv-analyses/5/posting/');
    hr.resumeCVAnalysis(5);
    expect(client.post).toHaveBeenLastCalledWith('/hr/cv-analyses/5/resume/', {});
    hr.cancelCVAnalysis(5);
    expect(client.post).toHaveBeenLastCalledWith('/hr/cv-analyses/5/cancel/', {});
  });

  it('subir CVs y convocatoria no fija Content-Type (el navegador pone el boundary) y da tiempo a la subida', () => {
    hr.uploadCVFiles(5, [new File(['a'], 'a.pdf')], { onUploadProgress: () => {} });
    const [, , cfg] = client.post.mock.calls.at(-1);
    expect(cfg.headers['Content-Type']).toBeUndefined();
    expect(cfg.timeout).toBeGreaterThanOrEqual(120000);
    expect(typeof cfg.onUploadProgress).toBe('function');
    hr.uploadCVPosting(5, new File(['a'], 'c.pdf'));
    expect(client.post.mock.calls.at(-1)[2].headers['Content-Type']).toBeUndefined();
  });

  it('extractCVPosting no manda texto vacío (se lee el archivo guardado) y reenvía la señal', () => {
    const signal = new AbortController().signal;
    hr.extractCVPosting(5, { text: '', signal });
    const [, body, cfg] = client.post.mock.calls.at(-1);
    expect(body).toEqual({});
    expect(cfg.signal).toBe(signal);
    expect(cfg.timeout).toBeGreaterThan(40000); // más que el máximo del servidor
  });
});

describe('api/hr — descargas de CVs', () => {
  const reply = (disposition) => client.get.mockResolvedValue({ data: new Blob(['x']), headers: disposition ? { 'content-disposition': disposition } : {} });

  it.each([
    ['downloadCVOriginal', [5, 9], '/hr/cv-analyses/5/items/9/file/'],
    ['downloadCVPosting', [5], '/hr/cv-analyses/5/posting/file/'],
    ['downloadCVReport', [5, 9], '/hr/cv-analyses/5/items/9/report/'],
  ])('%s pide blob a %s y usa un nombre de respaldo si el servidor no manda uno', async (fn, args, url) => {
    reply(null);
    const out = await hr[fn](...args);
    expect(client.get).toHaveBeenLastCalledWith(url, { responseType: 'blob' });
    expect(out.filename).toBeTruthy();
    expect(out.blob).toBeInstanceOf(Blob);
  });

  it('un nombre malicioso en Content-Disposition (rutas, puntos iniciales, control) se sanea', async () => {
    reply('attachment; filename="../../etc/passwd"');
    expect((await hr.downloadCVOriginal(5, 9)).filename).toBe('etcpasswd');
    reply('attachment; filename="..\\..\\evil.exe"');
    expect((await hr.downloadCVReport(5, 9)).filename).toBe('evil.exe');
    reply("attachment; filename*=UTF-8''Reporte%20P%C3%A9rez.pdf");
    expect((await hr.downloadCVReport(5, 9)).filename).toBe('Reporte Pérez.pdf');
  });

  it('sanitizeFilename nunca devuelve vacío', () => {
    expect(hr.sanitizeFilename('....', 'respaldo')).toBe('respaldo');
    expect(hr.sanitizeFilename('', 'respaldo')).toBe('respaldo');
    expect(hr.sanitizeFilename(null, 'respaldo')).toBe('respaldo');
    expect(hr.sanitizeFilename('a\u0000b/c.pdf')).toBe('abc.pdf');
  });

  it('un error sin cuerpo JSON legible deja data en null y relanza el mismo error', async () => {
    const err = { response: { data: new Blob(['<html>502</html>']) } };
    client.get.mockRejectedValue(err);
    await expect(hr.downloadCVZip(5)).rejects.toBe(err);
    expect(err.response.data).toBeNull();
  });

  it('un error de red (sin response) se relanza intacto', async () => {
    const err = new Error('Network Error');
    client.get.mockRejectedValue(err);
    await expect(hr.downloadCVOriginal(5, 9)).rejects.toBe(err);
  });
});

describe('api/hr — saveBlob', () => {
  it('descarga con el nombre saneado y libera la URL tras 1 s (no antes)', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      expect(this.download).toBe('abc.pdf');
      expect(this.href).toContain('blob:fake');
    });
    hr.saveBlob(new Blob(['x']), '../abc.pdf');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull(); // el enlace temporal se retira
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
