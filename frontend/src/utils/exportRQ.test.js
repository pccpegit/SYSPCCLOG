import { describe, it, expect, vi, beforeEach } from 'vitest';

// SYSPCC-036 — exceljs y file-saver solo se cargan al exportar (import dinámico).
// Los mocks de vi.mock se aplican a import() igual que a import estático; lo que
// se comprueba aquí es que exportar sigue generando y guardando el archivo.

const saveAs = vi.fn();
const cells = {};
const worksheet = { getCell: (ref) => (cells[ref] ??= {}) };
const load = vi.fn().mockResolvedValue(undefined);
const writeBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));

vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      xlsx = { load, writeBuffer };
      getWorksheet = () => worksheet;
      worksheets = [worksheet];
    },
  },
}));
vi.mock('file-saver', () => ({ saveAs: (...args) => saveAs(...args) }));

import { exportRQToExcel } from './exportRQ';

describe('exportRQToExcel', () => {
  beforeEach(() => {
    saveAs.mockClear();
    Object.keys(cells).forEach((k) => delete cells[k]);
    globalThis.fetch = vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(4) });
  });

  it('rellena la plantilla y descarga el archivo con el número de RQ', async () => {
    await exportRQToExcel({
      form: { usoEspecifico: 'Obra', fechaRequerimiento: '2026-10-30' },
      items: [{ descripcion: 'Cable', unidad: 'm', cantidad: '10', presupuestadoAdicional: 'P' }],
      currentUser: { name: 'Ana' },
      rqNumber: 'RQ/2026/0001',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/excel/FORMATO_RQ.xlsx');
    expect(cells.C5.value).toBe('Ana');
    expect(cells.C12.value).toBe('Cable');
    expect(cells.H6.value).toBe('30/10/2026');
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(saveAs.mock.calls[0][1]).toBe('RQ-2026-0001.xlsx');
  });
});
