import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  PROBLEM_CODE_LABELS, buildProjectMap, importErrorMessage, isStaleImportError, problemCodeLabel, projectDecision,
  sumCounts, validateWorkbookFile,
} from './almacenImport';

const file = (name, size = 1000) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const apiError = (status, data) => ({ response: { status, data } });

describe('validateWorkbookFile', () => {
  it('acepta un .xlsx dentro del límite (sin distinguir mayúsculas)', () => {
    expect(validateWorkbookFile(file('libro.xlsx'))).toBe('');
    expect(validateWorkbookFile(file('LIBRO.XLSX', 10 * 1024 * 1024))).toBe('');
  });

  it('rechaza .xls y .xlsm explicando el motivo', () => {
    expect(validateWorkbookFile(file('libro.xlsm'))).toMatch(/no se admiten.*\.xlsx/i);
    expect(validateWorkbookFile(file('libro.xls'))).toMatch(/no se admiten/i);
  });

  it('rechaza otras extensiones, vacíos y archivos de más de 10 MB', () => {
    expect(validateWorkbookFile(file('libro.csv'))).toBe('El archivo debe ser un libro de Excel (.xlsx).');
    expect(validateWorkbookFile(file('libro.xlsx', 0))).toBe('El archivo está vacío.');
    expect(validateWorkbookFile(file('libro.xlsx', 10 * 1024 * 1024 + 1))).toBe('El archivo supera los 10 MB.');
    expect(validateWorkbookFile(undefined)).toMatch(/elija el libro/i);
  });
});

describe('errores de importación', () => {
  it('plan_changed e import_expired obligan a volver a subir', () => {
    expect(isStaleImportError(apiError(409, { code: 'plan_changed' }))).toBe(true);
    expect(isStaleImportError(apiError(409, { code: 'import_expired' }))).toBe(true);
    expect(isStaleImportError(apiError(400, { code: 'acceptance_required' }))).toBe(false);
  });

  it('traduce los códigos conocidos', () => {
    expect(importErrorMessage(apiError(429, {}), 'x')).toMatch(/máximo 10 por hora/);
    expect(importErrorMessage(apiError(409, { code: 'plan_changed' }), 'x')).toMatch(/vuelva a subir/i);
    expect(importErrorMessage(apiError(409, { code: 'file_already_imported' }), 'x')).toMatch(/ya se importó/i);
  });

  it('usa el detalle del servidor y, si no hay, el mensaje de respaldo', () => {
    expect(importErrorMessage(apiError(400, { detail: 'El archivo está dañado.' }), 'x')).toBe('El archivo está dañado.');
    expect(importErrorMessage({}, 'Respaldo')).toBe('Respaldo');
  });
});

describe('proyectos del libro', () => {
  const projects = [
    { label: 'ON PLANT', items: 10, matches: [{ id: 3 }], suggested_id: 3 },
    { label: 'OTRO', items: 2, matches: [], suggested_id: null },
  ];

  it('usa la sugerencia única del servidor y respeta lo que elija el usuario', () => {
    expect(projectDecision(projects[0], {})).toBe(3);
    expect(projectDecision(projects[0], { 'ON PLANT': null })).toBeNull();
    expect(projectDecision(projects[1], {})).toBeUndefined();
  });

  it('el mapa está completo solo si todas las etiquetas tienen decisión', () => {
    expect(buildProjectMap(['ON PLANT', 'OTRO'], projects, {})).toBeNull();
    expect(buildProjectMap(['ON PLANT', 'OTRO'], projects, { OTRO: null })).toEqual({ 'ON PLANT': 3, OTRO: null });
    expect(buildProjectMap([], projects, {})).toEqual({});
  });
});

describe('sumCounts', () => {
  it('suma los valores de un objeto contador del servidor', () => {
    expect(sumCounts({ initial: 0, entries: 4, exits: 403 })).toBe(407);
    expect(sumCounts({ rows_with_errors: 37, already_imported: 0 })).toBe(37);
  });

  it('acepta un número ya sumado', () => {
    expect(sumCounts(698)).toBe(698);
    expect(sumCounts(0)).toBe(0);
  });

  it('con datos ausentes o raros devuelve 0 (nunca NaN)', () => {
    for (const bad of [undefined, null, '', 'abc', NaN, Infinity, {}, { a: 'x', b: null }]) {
      expect(sumCounts(bad)).toBe(0);
    }
  });

  it('ignora valores no numéricos dentro del objeto', () => {
    expect(sumCounts({ entries: 3, note: 'x', exits: null, more: 2 })).toBe(5);
  });
});

describe('problemCodeLabel', () => {
  it('traduce los códigos conocidos a una etiqueta legible', () => {
    expect(problemCodeLabel('VALE_VACIO')).toBe('Egreso sin N° de vale');
    expect(problemCodeLabel('UBICACION_PISO_SIN_PABELLON')).toBe('Ubicación incompleta (solo el piso)');
  });

  it('un código desconocido se muestra tal cual', () => {
    expect(problemCodeLabel('CODIGO_NUEVO')).toBe('CODIGO_NUEVO');
  });

  it('todas las etiquetas están en español, sin el propio código ni guiones bajos', () => {
    for (const [code, label] of Object.entries(PROBLEM_CODE_LABELS)) {
      expect(label).not.toContain('_');
      expect(label).not.toBe(code);
      expect(label.length).toBeGreaterThan(5);
    }
  });
});

// The backend catalog (problems.CATALOG) is the source of truth for the problem codes: if a code is
// added there without its label here, the UI would show the raw code (e.g. STOCK_EXCEDIDO).
// (A plain path: jsdom's URL class is not the one Node's fs expects.)
const CATALOG_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend/apps/warehouse/services/imports/problems.py');

describe('PROBLEM_CODE_LABELS frente al catálogo del servidor', () => {
  const available = existsSync(CATALOG_FILE);

  it.skipIf(!available)('tiene un rótulo para cada código de problems.CATALOG y ninguno de más', () => {
    const source = readFileSync(CATALOG_FILE, 'utf8');
    const block = source.slice(source.indexOf('CATALOG: dict'), source.indexOf('\n}\n', source.indexOf('CATALOG: dict')));
    const serverCodes = [...block.matchAll(/^ {4}'([A-Z_]+)':/gm)].map((m) => m[1]);

    expect(serverCodes.length).toBeGreaterThan(30);
    expect(serverCodes.filter((code) => !(code in PROBLEM_CODE_LABELS))).toEqual([]);
    expect(Object.keys(PROBLEM_CODE_LABELS).filter((code) => !serverCodes.includes(code))).toEqual([]);
  });

  it('rotula STOCK_EXCEDIDO (bloqueante) con un texto legible', () => {
    expect(problemCodeLabel('STOCK_EXCEDIDO')).toBe('El stock superaría el máximo permitido');
  });
});
