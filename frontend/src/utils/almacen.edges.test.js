import { describe, it, expect } from 'vitest';
import {
  availableStock, checkLocationCode, compact, countErrors, floorLabel, foldText, formatISODate, formatQty,
  hasAnyRole, isIntegerUnit, locationInfo, splitLocation, stockStatus, validateMovementDate, validateQuantity,
} from './almacen';
import { filenameFromDisposition, sanitizeFilename } from './download';

// SYSPCC-025 · QA ronda 2 — valores nulos, malformados o límite de las funciones puras del módulo.

describe('isIntegerUnit', () => {
  it.each([['ea', true], [' EA ', true], ['Par', true], ['jgo', true], ['UND', true], ['LT', false], ['M2', false], ['', false]])(
    '«%s» -> %s', (unit, expected) => expect(isIntegerUnit(unit)).toBe(expected),
  );
  it.each([null, undefined])('%s no es una unidad entera', (unit) => expect(isIntegerUnit(unit)).toBe(false));
});

describe('validateQuantity — bordes', () => {
  it.each([null, undefined, '', '   ', '0', '-3', 'abc', '1,5', 'Infinity', '-Infinity', 'NaN'])('rechaza %j', (raw) => {
    expect(validateQuantity(raw, 'LT')).toBe('La cantidad debe ser mayor que 0.');
  });
  it('0.001 es la cantidad mínima válida en unidades con decimales', () => {
    expect(validateQuantity('0.001', 'LT')).toBe('');
  });
  it('la unidad entera se nombra en mayúsculas en el mensaje', () => {
    expect(validateQuantity('1.5', ' par ')).toBe('La cantidad de PAR debe ser un número entero.');
  });
  it('sin unidad conocida acepta decimales', () => {
    expect(validateQuantity('2.5', undefined)).toBe('');
  });
});

describe('formatQty — valores que no son número', () => {
  it.each([null, undefined, 'abc', NaN, Infinity, {}])('%s se muestra como 0', (value) => {
    expect(formatQty(value)).toBe('0');
  });
  it('respeta hasta 3 decimales y separa miles', () => {
    expect(formatQty(1234.5678)).toMatch(/^1[\s\u00a0.,]?234[.,]568$/);
    expect(formatQty('0.5')).toMatch(/^0[.,]5$/);
  });
});

describe('availableStock — formas del ítem', () => {
  it('sin ítem es 0', () => expect(availableStock(null, 'CENTRAL')).toBe(0));
  it('sin detalle de stocks usa el total', () => {
    expect(availableStock({ total_stock: '7' }, 'CENTRAL')).toBe(7);
    expect(availableStock({}, 'CENTRAL')).toBe(0);
  });
  it('ignora el stock de proyecto o de departamento y el de otros almacenes', () => {
    const item = {
      stocks: [
        { warehouse_type: 'CENTRAL', project_id: null, department_id: null, quantity: '5' },
        { warehouse_type: 'CENTRAL', project_id: 3, department_id: null, quantity: '9' },
        { warehouse_type: 'CENTRAL', project_id: null, department_id: 2, quantity: '4' },
        { warehouse_type: 'SITE', project_id: null, department_id: null, quantity: '8' },
        { warehouse_type: 'CENTRAL', project_id: null, department_id: null },
      ],
    };
    expect(availableStock(item, 'CENTRAL')).toBe(5);
    expect(availableStock(item, 'SITE')).toBe(8);
    expect(availableStock(item, 'OFFICE')).toBe(0);
  });
});

describe('stockStatus — bordes', () => {
  it.each([[null, null, 'none'], [undefined, 5, 'none'], [0, 5, 'none'], [-2, 5, 'none'], [5, 5, 'low'], [6, 5, 'ok'], [3, 0, 'ok'], [3, null, 'ok'], ['4', '5', 'low']])(
    'stock %s, mínimo %s -> %s', (stock, min, expected) => expect(stockStatus(stock, min)).toBe(expected),
  );
});

describe('texto y fechas con datos ausentes', () => {
  it('foldText quita acentos, pasa a minúsculas y tolera null', () => {
    expect(foldText('ÁÉÍÓÚ Ñandú')).toBe('aeiou nandu');
    expect(foldText(null)).toBe('');
    expect(foldText(undefined)).toBe('');
  });
  it.each([null, undefined, '', 'ayer', '05/10/2026', '2026-1-5'])('formatISODate(%j) es vacío', (value) => {
    expect(formatISODate(value)).toBe('');
  });
  it('formatISODate acepta un datetime ISO y toma solo la fecha', () => {
    expect(formatISODate('2026-10-05T23:59:59Z')).toBe('05/10/2026');
  });
  it('validateMovementDate rechaza formatos que no son AAAA-MM-DD', () => {
    expect(validateMovementDate('05/10/2026', '2026-10-06').error).toBe('Indique la fecha del movimiento.');
    expect(validateMovementDate('2026-10-05T10:00', '2026-10-06').error).toBe('Indique la fecha del movimiento.');
  });
  it('exactamente 7 días atrás no avisa; 8 días sí', () => {
    expect(validateMovementDate('2026-09-29', '2026-10-06')).toEqual({ error: '', warning: '' });
    expect(validateMovementDate('2026-09-28', '2026-10-06').warning).toMatch(/anterior a 7 días/);
  });
  it('cruza el fin de año sin saltos', () => {
    expect(validateMovementDate('2025-12-30', '2026-01-02')).toEqual({ error: '', warning: '' });
  });
});

describe('ubicación con datos ausentes', () => {
  it.each([null, undefined, '', 'F3', 'F3-0', 'FF3-2', '3-2', 'F3-2-1', 'F123-2'])('splitLocation(%j) no inventa partes', (code) => {
    expect(splitLocation(code)).toEqual({ pavilion: '', section: '', level: '' });
  });
  it('splitLocation acepta minúsculas y espacios', () => {
    expect(splitLocation(' f3-2 ')).toEqual({ pavilion: 'F', section: '3', level: '2' });
  });
  it('floorLabel de un piso desconocido es vacío', () => {
    expect(floorLabel(3)).toBe('');
    expect(floorLabel(null)).toBe('');
    expect(floorLabel(undefined)).toBe('');
  });
  it('locationInfo de un ítem ausente o sin ubicación exacta', () => {
    expect(locationInfo(null)).toEqual({ exact: false, code: '', floor: '' });
    expect(locationInfo({ location_status: 'EXACT', location_display: '' , floor: 2 })).toEqual({ exact: false, code: '', floor: '2do piso' });
    expect(locationInfo({ location_status: 'FLOOR_ONLY', location_display: 'PISO 2', floor: 2 }).exact).toBe(false);
  });
  it('checkLocationCode sin niveles en el layout usa 1 a 5', () => {
    const layout = { floors: [{ floor: 2, pavilions: [{ code: 'F', sections: 6 }] }] };
    expect(checkLocationCode('F3-5', layout)).toEqual({ code: 'F3-5', error: '' });
    expect(checkLocationCode('F3-6', layout).error).toBe('El nivel debe estar entre 1 y 5.');
    expect(checkLocationCode('F3-0', layout).error).toMatch(/formato/i);
  });
  it('checkLocationCode normaliza una sección con cero a la izquierda', () => {
    const layout = { levels: [1, 2, 3], floors: [{ floor: 2, pavilions: [{ code: 'F', sections: 6 }] }] };
    expect(checkLocationCode('F03-2', layout).code).toBe('F3-2');
    expect(checkLocationCode('F00-2', layout).error).toMatch(/secciones del 1 al 6/);
  });
});

describe('roles, compact y countErrors con valores raros', () => {
  it('hasAnyRole con listas vacías', () => {
    expect(hasAnyRole([], ['A'])).toBe(false);
    expect(hasAnyRole(['A'], [])).toBe(false);
    expect(hasAnyRole(['A', 'B'], ['B', 'C'])).toBe(true);
  });
  it('compact conserva 0, false y quita null, undefined y texto en blanco', () => {
    expect(compact({ a: 0, b: false, c: null, d: undefined, e: '   ', f: ' x ' })).toEqual({ a: 0, b: false, f: ' x ' });
  });
  it('countErrors ignora líneas nulas y errores vacíos', () => {
    expect(countErrors({ lines: { a: null, b: { item: '', qty: 'mal' } }, movement_date: '' })).toBe(1);
    expect(countErrors({ lines: null })).toBe(0);
    expect(countErrors(undefined)).toBe(0);
  });
});

describe('descarga — nombres de archivo', () => {
  it('sanitizeFilename cae al respaldo cuando no queda nada', () => {
    expect(sanitizeFilename(null, 'x.xlsx')).toBe('x.xlsx');
    expect(sanitizeFilename('...', 'x.xlsx')).toBe('x.xlsx');
    expect(sanitizeFilename('   ', 'x.xlsx')).toBe('x.xlsx');
  });
  it('un filename* mal codificado cae al filename simple', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A; filename=\"resumen.xlsx\"")).toBe('resumen.xlsx');
  });
  it('sin filename utilizable usa el respaldo', () => {
    expect(filenameFromDisposition('attachment', 'resumen.xlsx')).toBe('resumen.xlsx');
    expect(filenameFromDisposition(null, 'resumen.xlsx')).toBe('resumen.xlsx');
  });
  it('un nombre con ruta se reduce a un nombre inofensivo', () => {
    const name = filenameFromDisposition('attachment; filename="../../etc/passwd"');
    expect(name).not.toContain('/');
    expect(name).not.toMatch(/^\./);
  });
});
