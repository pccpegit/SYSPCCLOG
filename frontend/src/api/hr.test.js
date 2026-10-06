import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from './client';
import * as hr from './hr';

// jsdom no implementa Blob.prototype.text() (los navegadores reales sí).
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

beforeEach(() => vi.clearAllMocks());

describe('api/hr — descargas por blob', () => {
  it('downloadDocument pide blob con el formato y toma el nombre de Content-Disposition', async () => {
    const blob = new Blob(['x']);
    client.get.mockResolvedValue({
      data: blob,
      headers: { 'content-disposition': 'attachment; filename="Contrato_Perez.docx"' },
    });
    const out = await hr.downloadDocument(7, 'pdf');
    expect(client.get).toHaveBeenCalledWith('/hr/documents/7/download/', { params: { format: 'pdf' }, responseType: 'blob' });
    expect(out).toEqual({ blob, filename: 'Contrato_Perez.docx' });
  });

  it('usa nombre por defecto si no hay Content-Disposition', async () => {
    client.get.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    expect((await hr.downloadDocument(7)).filename).toBe('documento-7.docx');
    expect((await hr.downloadTemplate(3)).filename).toBe('plantilla-3.docx');
  });

  it('decodifica filename* en UTF-8', async () => {
    client.get.mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': "attachment; filename*=UTF-8''Contrato%20P%C3%A9rez.docx" },
    });
    expect((await hr.downloadDocument(7)).filename).toBe('Contrato Pérez.docx');
  });

  it('error JSON entregado como Blob se re-lee y conserva code/detail', async () => {
    const body = JSON.stringify({ code: 'pdf_not_available', detail: 'No hay PDF.' });
    const error = { response: { status: 404, data: new Blob([body], { type: 'application/json' }) } };
    client.get.mockRejectedValue(error);
    await expect(hr.downloadDocument(7, 'pdf')).rejects.toBe(error);
    expect(error.response.data).toEqual({ code: 'pdf_not_available', detail: 'No hay PDF.' });
  });

  it('error con Blob no JSON deja data en null (sin romper)', async () => {
    const error = { response: { status: 500, data: new Blob(['<html>'], { type: 'text/html' }) } };
    client.get.mockRejectedValue(error);
    await expect(hr.downloadTemplate(3)).rejects.toBe(error);
    expect(error.response.data).toBeNull();
  });

  it('error de red sin response se propaga intacto', async () => {
    const error = new Error('Network Error');
    client.get.mockRejectedValue(error);
    await expect(hr.downloadDocument(7)).rejects.toBe(error);
  });
});

describe('api/hr — subida de plantilla', () => {
  it('envía FormData sin Content-Type y omite campos vacíos', async () => {
    client.post.mockResolvedValue({ data: {} });
    const file = new File(['x'], 'c.docx');
    await hr.uploadTemplate({ document_type: 'CONTRACT', name: 'N', slug: undefined, notes: '', file });
    const [url, body, config] = client.post.mock.calls[0];
    expect(url).toBe('/hr/templates/');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('name')).toBe('N');
    expect(body.has('slug')).toBe(false);
    expect(body.has('notes')).toBe(false);
    expect(body.get('file')).toBeInstanceOf(File);
    expect(config.headers['Content-Type']).toBeUndefined();
  });
});

describe('api/hr — saveBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.useRealTimers());

  it('hace click en un enlace temporal, lo retira y revoca la URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    hr.saveBlob(new Blob(['x']), 'a.docx');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    click.mockRestore();
  });

  it('revoca la URL tras ~1000 ms, no antes', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    hr.saveBlob(new Blob(['x']), 'a.docx');
    vi.advanceTimersByTime(999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    click.mockRestore();
  });

  it('sanea el nombre al guardar (sin rutas ni caracteres de control)', () => {
    let seen;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { seen = this.download; });
    hr.saveBlob(new Blob(['x']), '../../etc/pa\\ss\u0000wd.docx');
    expect(seen).toBe('etcpasswd.docx');
    click.mockRestore();
  });
});

describe('api/hr — sanitizeFilename', () => {
  it.each([
    ['../../x/y.docx', 'xy.docx'],
    ['a\\b\\c.pdf', 'abc.pdf'],
    ['bad\r\nname.docx', 'badname.docx'],
    ['.hidden.docx', 'hidden.docx'],
    ['Contrato Pérez.docx', 'Contrato Pérez.docx'],
  ])('%j -> %j', (input, out) => expect(hr.sanitizeFilename(input)).toBe(out));

  it('usa el fallback si queda vacío', () => {
    expect(hr.sanitizeFilename('///', 'doc.docx')).toBe('doc.docx');
    expect(hr.sanitizeFilename(undefined)).toBe('documento');
  });

  it('downloadDocument sanea el nombre de Content-Disposition', async () => {
    const client = (await import('./client')).default;
    vi.spyOn(client, 'get').mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="../../evil.docx"' },
    });
    expect((await hr.downloadDocument(1)).filename).toBe('evil.docx');
    client.get.mockRestore();
  });
});
