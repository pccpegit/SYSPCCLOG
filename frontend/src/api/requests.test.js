import { describe, it, expect, vi, beforeEach } from 'vitest';
import client from './client';
import {
  createDraft,
  getAvailableActions,
  getStockAvailability,
  searchRequestCatalog,
  STOCK_AVAILABILITY_TIMEOUT_MS,
  submitDraft,
  updateRequestItems,
} from './requests';

// SYSPCC-026 — contratos de los endpoints de captura con catálogo.
vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: {} });
  client.patch.mockResolvedValue({ data: {} });
});

describe('searchRequestCatalog', () => {
  it('llama a GET /request-catalog/ con ?search= y la señal para poder cancelar', () => {
    const controller = new AbortController();

    searchRequestCatalog('casco', { signal: controller.signal });

    expect(client.get).toHaveBeenCalledWith('/request-catalog/', {
      params: { search: 'casco' },
      signal: controller.signal,
    });
  });

  it('sólo manda page cuando es mayor que 1', () => {
    searchRequestCatalog('casco');
    expect(client.get.mock.calls[0][1].params).toEqual({ search: 'casco' });

    searchRequestCatalog('casco', { page: 2 });
    expect(client.get.mock.calls[1][1].params).toEqual({ search: 'casco', page: 2 });
  });
});

describe('getStockAvailability', () => {
  it('llama a GET /requests/{id}/stock-availability/ con un tope de espera', () => {
    getStockAvailability(42);
    expect(client.get).toHaveBeenCalledWith('/requests/42/stock-availability/', { timeout: STOCK_AVAILABILITY_TIMEOUT_MS });
  });

  it('el tope existe y es razonable: el cliente axios no trae ninguno y la pantalla de logística espera esta respuesta', () => {
    // Without a timeout a hung query would keep "Confirmar" of the stock check blocked forever.
    expect(STOCK_AVAILABILITY_TIMEOUT_MS).toBe(15000);
    expect(client.get).not.toHaveBeenCalled();
    getStockAvailability(7);
    expect(client.get.mock.calls[0][1].timeout).toBeGreaterThan(0);
    expect(client.get.mock.calls[0][1].timeout).toBeLessThanOrEqual(30000);
  });
});

describe('updateRequestItems', () => {
  it('envía los ítems tal cual en PATCH /requests/{id}/update-items/', () => {
    const items = [{ item_id: 7, inventory_item: 3 }, { item_id: 8, is_off_catalog: true }];

    updateRequestItems(42, items);

    expect(client.patch).toHaveBeenCalledWith('/requests/42/update-items/', { items });
  });
});

describe('getAvailableActions (SYSPCC-029)', () => {
  it('sin rol no manda parámetros; con rol manda ?role=', () => {
    getAvailableActions(7);
    expect(client.get).toHaveBeenLastCalledWith('/requests/7/available-actions/', undefined);
    getAvailableActions(7, 'CENTRAL_WAREHOUSE');
    expect(client.get).toHaveBeenLastCalledWith('/requests/7/available-actions/', { params: { role: 'CENTRAL_WAREHOUSE' } });
  });
});

describe('borradores (SYSPCC-031)', () => {
  it('createDraft hace POST /requests/ con save_as_draft: true y el resto del cuerpo', () => {
    client.post.mockResolvedValue({ data: {} });

    createDraft({ flow: 'OPERATIONS', items: [] });

    expect(client.post).toHaveBeenCalledWith('/requests/', { flow: 'OPERATIONS', items: [], save_as_draft: true });
  });

  it('submitDraft hace POST /requests/{id}/submit/ sin cuerpo', () => {
    client.post.mockResolvedValue({ data: {} });

    submitDraft(7);

    expect(client.post).toHaveBeenCalledWith('/requests/7/submit/');
  });
});
