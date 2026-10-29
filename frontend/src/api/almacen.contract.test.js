import { describe, it, expect, vi, beforeEach } from 'vitest';

// SYSPCC-025 · QA ronda 1 — contrato de la capa api/ del almacén con el backend (URL, método,
// parámetros y tipo de respuesta). Las rutas se contrastan con el backend en
// `apps/warehouse/tests/test_qa_frontend_contract.py`.

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from './client';
import * as almacen from './almacen';
import * as importer from './almacenImport';

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(client).forEach((fn) => fn.mockResolvedValue({ data: {} }));
});

describe('api/almacen — lecturas', () => {
  it.each([
    ['getInventory', [{ search: 'x' }], 'get', '/warehouse/inventory/', { params: { search: 'x' } }],
    ['getKardex', [7, { date_from: '2026-10-01' }], 'get', '/warehouse/inventory/7/kardex/', { params: { date_from: '2026-10-01' } }],
    ['getCategories', [], 'get', '/warehouse/inventory/categories/'],
    ['getAlerts', [], 'get', '/warehouse/inventory/alerts/'],
    ['getSummary', [], 'get', '/warehouse/inventory/summary/'],
    ['getLocationLayout', [], 'get', '/warehouse/inventory/location-layout/'],
    ['getMovementSummary', [{ page: 2 }], 'get', '/warehouse/inventory/movement-summary/', { params: { page: 2 } }],
    ['getMovements', [{ voucher_number: '1' }], 'get', '/warehouse/movements/', { params: { voucher_number: '1' } }],
    ['getVoucher', [9], 'get', '/warehouse/movements/9/voucher/'],
    ['lookupPersonal', ['rosa'], 'get', '/warehouse/personal-lookup/', { params: { search: 'rosa' } }],
  ])('%s', (name, args, method, url, config) => {
    almacen[name](...args);
    expect(client[method]).toHaveBeenCalledTimes(1);
    expect(client[method].mock.calls[0][0]).toBe(url);
    if (config) expect(client[method].mock.calls[0][1]).toEqual(config);
  });
});

describe('api/almacen — escrituras', () => {
  it.each([
    ['registerEntry', [{ a: 1 }], 'post', '/warehouse/movements/entry/'],
    ['registerEntryBatch', [{ a: 1 }], 'post', '/warehouse/movements/batch-entry/'],
    ['registerExit', [{ a: 1 }], 'post', '/warehouse/movements/exit/'],
    ['registerExitBatch', [{ a: 1 }], 'post', '/warehouse/movements/batch-exit/'],
    ['registerEppDelivery', [{ a: 1 }], 'post', '/warehouse/movements/epp-delivery/'],
    ['linkPersonal', [{ a: 1 }], 'post', '/warehouse/movements/link-personal/'],
    ['createInventoryItem', [{ a: 1 }], 'post', '/warehouse/inventory/'],
  ])('%s envía el cuerpo tal cual', (name, args, method, url) => {
    almacen[name](...args);
    expect(client[method]).toHaveBeenCalledWith(url, { a: 1 });
  });

  it('assignLocations envuelve la lista en {assignments}', () => {
    almacen.assignLocations([{ inventory: 1, location: 'F3-2' }]);
    expect(client.post).toHaveBeenCalledWith('/warehouse/inventory/assign-locations/', {
      assignments: [{ inventory: 1, location: 'F3-2' }],
    });
  });

  it('patchInventoryItem usa PATCH y updateInventoryItem usa PUT', () => {
    almacen.patchInventoryItem(5, { observation: 'x' });
    almacen.updateInventoryItem(5, { observation: 'x' });
    expect(client.patch).toHaveBeenCalledWith('/warehouse/inventory/5/', { observation: 'x' });
    expect(client.put).toHaveBeenCalledWith('/warehouse/inventory/5/', { observation: 'x' });
  });
});

describe('api/almacen — borrado de productos', () => {
  it('deleteInventoryItem pide DELETE a /warehouse/inventory/{id}/ (con /v1 por el cliente)', () => {
    almacen.deleteInventoryItem(7);
    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith('/warehouse/inventory/7/');
  });
});

describe('api/almacen — descargas', () => {
  it.each([
    ['exportInventory', [{ floor: '2' }], '/warehouse/inventory/export/'],
    ['exportMovementSummary', [{ include_movements: true }], '/warehouse/inventory/movement-summary/export/'],
    ['exportMovements', [{ layout: 'excel_pcc' }], '/warehouse/movements/export/'],
  ])('%s pide un blob con los filtros', (name, args, url) => {
    almacen[name](...args);
    expect(client.get).toHaveBeenCalledWith(url, { params: args[0], responseType: 'blob' });
  });

  it('downloadGroupPdf pide el PDF del grupo como blob', () => {
    almacen.downloadGroupPdf(12);
    expect(client.get).toHaveBeenCalledWith('/warehouse/movements/groups/12/pdf/', { params: undefined, responseType: 'blob' });
  });

  it('ninguna ruta apunta al prefijo antiguo sin versión (/api/warehouse/...)', () => {
    Object.values(almacen).filter((fn) => typeof fn === 'function').forEach((fn) => {
      try { fn(1, {}); } catch { /* firmas distintas: solo importa la llamada al cliente */ }
    });
    const urls = Object.values(client).flatMap((fn) => fn.mock.calls.map((c) => c[0]));
    expect(urls.length).toBeGreaterThan(20);
    expect(urls.every((u) => u.startsWith('/warehouse/'))).toBe(true);
  });
});

describe('api/almacenImport', () => {
  it('uploadImport sube un multipart sin Content-Type fijo y con tiempo de espera largo', () => {
    const file = new File(['x'], 'libro.xlsx');
    importer.uploadImport(file, { updateExisting: true });
    const [url, body, config] = client.post.mock.calls[0];
    expect(url).toBe('/warehouse/imports/');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(body.get('warehouse')).toBe('CENTRAL');
    expect(body.get('update_existing')).toBe('true');
    expect(config.headers['Content-Type']).toBeUndefined();
    expect(config.timeout).toBeGreaterThanOrEqual(60000);
  });

  it('uploadImport no actualiza existentes por defecto', () => {
    importer.uploadImport(new File(['x'], 'libro.xlsx'));
    expect(client.post.mock.calls[0][1].get('update_existing')).toBe('false');
  });

  it('confirmImport traduce los nombres a los del backend', () => {
    importer.confirmImport('abc', {
      expectedPlanDigest: 'd1', projectMap: { 'ON PLANT': null }, destinationMap: { k: 5 },
      acceptWarnings: true, acceptSkippedRows: true,
    });
    const [url, body, config] = client.post.mock.calls[0];
    expect(url).toBe('/warehouse/imports/abc/confirm/');
    expect(body).toEqual({
      expected_plan_digest: 'd1', project_map: { 'ON PLANT': null }, destination_map: { k: 5 },
      accept_warnings: true, accept_skipped_rows: true,
    });
    expect(config.timeout).toBeGreaterThanOrEqual(60000);
  });

  it('confirmImport usa valores seguros por defecto (nada aceptado)', () => {
    importer.confirmImport('abc', { expectedPlanDigest: 'd1' });
    expect(client.post.mock.calls[0][1]).toMatchObject({
      project_map: {}, destination_map: {}, accept_warnings: false, accept_skipped_rows: false,
    });
  });

  it.each([
    ['getImports', [{ page: 1 }], 'get', '/warehouse/imports/'],
    ['getImport', ['abc'], 'get', '/warehouse/imports/abc/'],
    ['getImportProblems', ['abc', { severity: 'error' }], 'get', '/warehouse/imports/abc/problems/'],
    ['cancelImport', ['abc'], 'delete', '/warehouse/imports/abc/'],
  ])('%s', (name, args, method, url) => {
    importer[name](...args);
    expect(client[method].mock.calls[0][0]).toBe(url);
  });

  it('el informe de problemas y la plantilla se piden como blob', () => {
    importer.exportImportProblems('abc', { code: 'VALE_VACIO' });
    importer.downloadImportTemplate();
    expect(client.get).toHaveBeenCalledWith('/warehouse/imports/abc/problems/export/', { params: { code: 'VALE_VACIO' }, responseType: 'blob' });
    expect(client.get).toHaveBeenCalledWith('/warehouse/imports/template/', { responseType: 'blob' });
  });
});
