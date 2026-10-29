import { describe, it, expect } from 'vitest';
import {
  addDaysISO, availableStock, checkLocationCode, compact, countErrors, formatISODate, isIntegerUnit, localISODate,
  isLocationPrefix, locationInfo, splitLocation, stockShortageMessage, stockStatus, validateMovementDate, validateQuantity,
} from './almacen';

describe('validateMovementDate', () => {
  const today = '2026-10-28';

  it('exige la fecha', () => {
    expect(validateMovementDate('', today).error).toBe('Indique la fecha del movimiento.');
    expect(validateMovementDate(undefined, today).error).toBe('Indique la fecha del movimiento.');
  });

  it('rechaza fechas futuras', () => {
    expect(validateMovementDate('2026-10-29', today).error).toBe('La fecha no puede ser futura.');
  });

  it('acepta hoy y hasta 7 días atrás sin avisar', () => {
    expect(validateMovementDate(today, today)).toEqual({ error: '', warning: '' });
    expect(validateMovementDate('2026-10-21', today)).toEqual({ error: '', warning: '' });
  });

  it('avisa (sin bloquear) cuando es de hace más de 7 días', () => {
    const result = validateMovementDate('2026-10-20', today);
    expect(result.error).toBe('');
    expect(result.warning).toBe('La fecha es anterior a 7 días. Verifique antes de guardar.');
  });
});

describe('validateQuantity', () => {
  it('exige un número mayor que 0', () => {
    expect(validateQuantity('', 'EA')).toBe('La cantidad debe ser mayor que 0.');
    expect(validateQuantity('0', 'EA')).toBe('La cantidad debe ser mayor que 0.');
    expect(validateQuantity('-2', 'EA')).toBe('La cantidad debe ser mayor que 0.');
    expect(validateQuantity('abc', 'EA')).toBe('La cantidad debe ser mayor que 0.');
  });

  it('pide enteros para EA, UND, PAR y JGO', () => {
    expect(validateQuantity('1.5', 'EA')).toBe('La cantidad de EA debe ser un número entero.');
    expect(validateQuantity('2.5', 'par')).toBe('La cantidad de PAR debe ser un número entero.');
    expect(validateQuantity('3', 'EA')).toBe('');
  });

  it('acepta decimales en otras unidades', () => {
    expect(validateQuantity('1.5', 'M2')).toBe('');
    expect(validateQuantity('0.25', 'LT')).toBe('');
    expect(isIntegerUnit('JGO')).toBe(true);
    expect(isIntegerUnit('KG')).toBe(false);
  });
});

describe('fechas', () => {
  it('formatea AAAA-MM-DD como dd/mm/aaaa sin corrimiento de zona horaria', () => {
    expect(formatISODate('2026-10-05')).toBe('05/10/2026');
    expect(formatISODate('2026-10-05T23:30:00-05:00')).toBe('05/10/2026');
    expect(formatISODate(null)).toBe('');
  });

  it('suma días a una fecha', () => {
    expect(addDaysISO('2026-10-28', -30)).toBe('2026-09-28');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('localISODate usa el calendario local', () => {
    expect(localISODate(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
});

describe('stock', () => {
  it('mensaje de stock insuficiente', () => {
    expect(stockShortageMessage('EPP000123', 3, 5)).toBe('Stock insuficiente para EPP000123. Disponible: 3, solicitado: 5.');
  });

  it('estado: sin stock, bajo mínimo o con stock', () => {
    expect(stockStatus(0, 0)).toBe('none');
    expect(stockStatus(2, 5)).toBe('low');
    expect(stockStatus(5, 5)).toBe('low');
    expect(stockStatus(6, 5)).toBe('ok');
    expect(stockStatus(1, 0)).toBe('ok');
  });

  it('disponible = pool del almacén sin proyecto', () => {
    const item = {
      total_stock: 99,
      stocks: [
        { warehouse_type: 'CENTRAL', project_id: null, department_id: null, quantity: 4 },
        { warehouse_type: 'CENTRAL', project_id: 7, department_id: null, quantity: 50 },
        { warehouse_type: 'SITE', project_id: null, department_id: null, quantity: 9 },
      ],
    };
    expect(availableStock(item, 'CENTRAL')).toBe(4);
    expect(availableStock(item, 'SITE')).toBe(9);
    expect(availableStock({ total_stock: 8 }, 'CENTRAL')).toBe(8);
  });
});

describe('ubicación', () => {
  it('separa pabellón, sección y nivel', () => {
    expect(splitLocation('F3-2')).toEqual({ pavilion: 'F', section: '3', level: '2' });
    expect(splitLocation('b12-5')).toEqual({ pavilion: 'B', section: '12', level: '5' });
    expect(splitLocation('PISO 2')).toEqual({ pavilion: '', section: '', level: '' });
  });

  it('exacta o pendiente según el estado que informa el backend', () => {
    expect(locationInfo({ location_status: 'EXACT', location_display: 'F3-2', floor: 2 })).toEqual({ exact: true, code: 'F3-2', floor: '2do piso' });
    expect(locationInfo({ location_status: 'FLOOR_ONLY', location_display: 'PISO 2', floor: 2 })).toEqual({ exact: false, code: '', floor: '2do piso' });
    expect(locationInfo({ location_status: 'NONE' }).exact).toBe(false);
  });
});

describe('compact', () => {
  it('quita vacíos y undefined pero conserva 0 y false', () => {
    expect(compact({ a: '', b: '  ', c: undefined, d: null, e: 0, f: false, g: 'x' })).toEqual({ e: 0, f: false, g: 'x' });
  });
});

describe('countErrors', () => {
  it('cuenta los errores del encabezado y de cada línea', () => {
    expect(countErrors({
      movement_date: 'Indique la fecha.',
      worker: 'Seleccione el trabajador.',
      lines: { a: { item: 'Seleccione un ítem.', qty: 'Indique la cantidad.' }, b: { qty: 'Cantidad inválida.' } },
    })).toBe(5);
  });

  it('ignora campos vacíos o sin error', () => {
    expect(countErrors({ movement_date: '', lines: { a: {} } })).toBe(0);
    expect(countErrors({ lines: {} })).toBe(0);
  });

  it('con datos ausentes devuelve 0', () => {
    expect(countErrors(undefined)).toBe(0);
    expect(countErrors(null)).toBe(0);
    expect(countErrors({})).toBe(0);
  });
});

describe('checkLocationCode', () => {
  const layout = {
    floors: [
      { floor: 1, pavilions: [{ code: 'A', sections: 7 }, { code: 'C', sections: 4 }] },
      { floor: 2, pavilions: [{ code: 'F', sections: 6 }, { code: 'G', sections: 6 }] },
    ],
    levels: [1, 2, 3, 4, 5],
  };

  it('normaliza un código válido (mayúsculas y espacios)', () => {
    expect(checkLocationCode(' f3-2 ', layout)).toEqual({ code: 'F3-2', error: '' });
    expect(checkLocationCode('A07-1', layout)).toEqual({ code: 'A7-1', error: '' });
  });

  it('texto vacío no es un error: aún no hay nada que validar', () => {
    expect(checkLocationCode('', layout)).toEqual({ code: '', error: '' });
    expect(checkLocationCode('   ', layout)).toEqual({ code: '', error: '' });
    expect(checkLocationCode(undefined, layout)).toEqual({ code: '', error: '' });
  });

  it.each(['F', 'F3', '3-2', 'F3-', 'F3-0', 'FF3-2', 'F3_2', 'F3 2'])('rechaza el formato «%s»', (text) => {
    const result = checkLocationCode(text, layout);
    expect(result.code).toBe('');
    expect(result.error).toMatch(/use el formato/i);
  });

  it('rechaza un pabellón que no existe', () => {
    expect(checkLocationCode('Z1-1', layout).error).toBe('El pabellón Z no existe en el almacén.');
  });

  it('con un piso acotado solo acepta los pabellones de ese piso', () => {
    expect(checkLocationCode('A1-1', layout, 2).error).toBe('El pabellón A no existe en ese piso.');
    expect(checkLocationCode('F1-1', layout, 2).code).toBe('F1-1');
    expect(checkLocationCode('F1-1', layout, '2').code).toBe('F1-1');
  });

  it('rechaza una sección fuera del rango del pabellón', () => {
    expect(checkLocationCode('C5-1', layout).error).toBe('El pabellón C tiene secciones del 1 al 4.');
    expect(checkLocationCode('C0-1', layout).error).toBe('El pabellón C tiene secciones del 1 al 4.');
  });

  it('rechaza un nivel que el formato admite pero el layout no tiene', () => {
    expect(checkLocationCode('F3-9', layout).error).toBe('El nivel debe estar entre 1 y 5.');
  });

  it('rechaza un nivel fuera del layout', () => {
    expect(checkLocationCode('F1-4', { ...layout, levels: [1, 2, 3] }).error).toBe('El nivel debe estar entre 1 y 3.');
  });

  it('sin layout cargado no encuentra pabellones (no valida a ciegas)', () => {
    expect(checkLocationCode('F3-2', null).error).toMatch(/no existe/i);
  });
});

describe('isLocationPrefix', () => {
  it.each(['F', 'f', 'F3', 'F33', 'F3-', 'F33-', ' F3- '])('«%s» todavía puede llegar a ser un código válido', (text) => {
    expect(isLocationPrefix(text)).toBe(true);
  });

  it.each(['', '3', 'FF', 'F-', 'F333', 'F3-2', 'F3--', 'F 3', 'F3-2-'])('«%s» no es un comienzo válido (vacío, imposible o ya completo)', (text) => {
    expect(isLocationPrefix(text)).toBe(false);
  });

  it('acepta undefined y null sin fallar', () => {
    expect(isLocationPrefix(undefined)).toBe(false);
    expect(isLocationPrefix(null)).toBe(false);
  });
});
