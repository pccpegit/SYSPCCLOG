import { describe, it, expect, vi, beforeEach } from 'vitest';
import client from './client';
import { getStockAvailability, searchRequestCatalog, STOCK_AVAILABILITY_TIMEOUT_MS, updateRequestItems } from './requests';

// SYSPCC-026 (QA ronda 1) — edges of the three client functions that complement requests.test.js.
vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: {} });
  client.patch.mockResolvedValue({ data: {} });
});

describe('searchRequestCatalog — bordes', () => {
  it.each([[undefined], [0], [1], [null]])('page=%s no se envía', (page) => {
    searchRequestCatalog('casco', { page });

    expect(client.get.mock.calls[0][1].params).toEqual({ search: 'casco' });
  });

  it('el texto viaja tal cual como parámetro (la codificación la hace el cliente HTTP, no se arma una URL a mano)', () => {
    searchRequestCatalog('100% & "algodón" ñ');

    const [url, config] = client.get.mock.calls[0];
    expect(url).toBe('/request-catalog/');
    expect(url).not.toContain('algod');
    expect(config.params.search).toBe('100% & "algodón" ñ');
  });

  it('sin opciones no manda señal (y no falla)', () => {
    searchRequestCatalog('casco');

    expect(client.get.mock.calls[0][1].signal).toBeUndefined();
  });

  it('devuelve la promesa del cliente y propaga el rechazo tal cual (el buscador distingue el 429 por response.status)', async () => {
    const failure = { response: { status: 429 } };
    client.get.mockRejectedValue(failure);

    await expect(searchRequestCatalog('casco')).rejects.toBe(failure);
  });
});

describe('getStockAvailability — bordes', () => {
  it('acepta el id como texto y no agrega parámetros', () => {
    getStockAvailability('42');

    expect(client.get).toHaveBeenCalledWith('/requests/42/stock-availability/', { timeout: STOCK_AVAILABILITY_TIMEOUT_MS });
  });

  it('propaga el rechazo', async () => {
    const failure = { response: { status: 404 } };
    client.get.mockRejectedValue(failure);

    await expect(getStockAvailability(42)).rejects.toBe(failure);
  });
});

describe('updateRequestItems — bordes', () => {
  it('no modifica la lista que recibe ni agrega claves al cuerpo', () => {
    const items = [{ item_id: 7, supply_source: 'STOCK' }];
    const snapshot = JSON.parse(JSON.stringify(items));

    updateRequestItems(42, items);

    expect(items).toEqual(snapshot);
    expect(Object.keys(client.patch.mock.calls[0][1])).toEqual(['items']);
  });

  it('propaga el 409 con su cuerpo, que la pantalla usa para explicar el motivo', async () => {
    const conflict = { response: { status: 409, data: { code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [3] } } };
    client.patch.mockRejectedValue(conflict);

    await expect(updateRequestItems(42, [])).rejects.toBe(conflict);
  });

  it('usa PATCH y no un método que pueda crear o reemplazar', () => {
    updateRequestItems(42, []);

    expect(client.patch).toHaveBeenCalledTimes(1);
    expect(client.post).not.toHaveBeenCalled();
  });
});
