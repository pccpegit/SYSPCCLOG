import { describe, it, expect } from 'vitest';
import { apiError, ITEM_CASCO, ITEM_GUANTES, ITEM_TUBO } from '../test/pickingFixtures';
import {
  buildDeliveryLines, describeDeliveryError, describePickingLoadError, maxQtyText, pickingLocation,
  roleList, validateDeliveryForm, validateLineQuantity, validateReason,
} from './rqPicking';

describe('pickingLocation', () => {
  it('ubicación exacta', () => {
    expect(pickingLocation(ITEM_CASCO)).toEqual({ exact: true, text: 'B3-2' });
  });
  it('solo piso: "Piso n — pendiente de ubicar"', () => {
    expect(pickingLocation(ITEM_GUANTES)).toEqual({ exact: false, text: 'Piso 1 — pendiente de ubicar' });
  });
  it('sin producto o sin ubicación', () => {
    expect(pickingLocation(ITEM_TUBO).text).toBe('Sin producto de catálogo');
    expect(pickingLocation({ product: { location: '', location_status: 'NONE' } }).text).toBe('Sin ubicación — pendiente de ubicar');
  });
});

describe('validateLineQuantity', () => {
  it('una línea vacía o en 0 no se entrega y no es error', () => {
    expect(validateLineQuantity('', ITEM_CASCO)).toBe('');
    expect(validateLineQuantity('0', ITEM_CASCO)).toBe('');
  });
  it('respeta el máximo, el entero y los 3 decimales', () => {
    expect(validateLineQuantity('6', ITEM_CASCO)).toBe('');
    expect(validateLineQuantity('7', ITEM_CASCO)).toBe('No puede superar 6 EA.');
    expect(validateLineQuantity('1.5', ITEM_CASCO)).toMatch(/entero/);
    expect(validateLineQuantity('-1', ITEM_CASCO)).toMatch(/mayor que 0/);
    expect(validateLineQuantity('abc', ITEM_CASCO)).toMatch(/mayor que 0/);
    expect(validateLineQuantity('1', { ...ITEM_CASCO, unit: 'M', max_deliverable: '2.000' })).toBe('');
    expect(validateLineQuantity('1.2345', { ...ITEM_CASCO, unit: 'M', max_deliverable: '2.000' })).toBe('Use como máximo 3 decimales.');
    expect(validateLineQuantity('1,5', { ...ITEM_CASCO, unit: 'M', max_deliverable: '2.000' })).toBe('');
  });
  it('una línea sin máximo no se puede entregar', () => {
    expect(validateLineQuantity('1', { ...ITEM_TUBO, can_deliver: true })).toBe('Esta línea no se puede entregar ahora.');
  });
});

describe('buildDeliveryLines / validateDeliveryForm', () => {
  const items = [ITEM_CASCO, ITEM_GUANTES, ITEM_TUBO];
  it('ignora líneas bloqueadas, vacías y en 0', () => {
    const lines = buildDeliveryLines(items, { 11: '2', 12: '0', 13: '4' });
    expect(lines).toEqual([{ request_item_id: 11, quantity: '2' }]);
  });
  it('exige guía, fecha no futura y notas ≤ 300', () => {
    const r = validateDeliveryForm({
      items, quantities: { 11: '2' }, guide: ' ', date: '2999-01-01', notes: 'x'.repeat(301), today: '2026-10-29',
    });
    expect(r.valid).toBe(false);
    expect(r.fieldErrors.dispatch_guide_number).toBe('Indique el número de la guía de remisión.');
    expect(r.fieldErrors.movement_date).toBe('La fecha no puede ser futura.');
    expect(r.fieldErrors.notes).toMatch(/300/);
  });
  it('es válido con guía y al menos una línea', () => {
    const r = validateDeliveryForm({ items, quantities: { 11: '2' }, guide: 'GR-1', date: '', notes: '', today: '2026-10-29' });
    expect(r.valid).toBe(true);
  });
  it('sin líneas no es válido', () => {
    const r = validateDeliveryForm({ items, quantities: {}, guide: 'GR-1', date: '', notes: '' });
    expect(r.hasLines).toBe(false);
    expect(r.valid).toBe(false);
  });
});

describe('validateReason', () => {
  it('motivo de 5 a 300 caracteres', () => {
    expect(validateReason('abcd').reason).toMatch(/mínimo 5/);
    expect(validateReason('abcde')).toEqual({});
    expect(validateReason('x'.repeat(301)).reason).toMatch(/300/);
    expect(validateReason('abcde', '2999-01-01', '2026-10-29').movement_date).toBe('La fecha no puede ser futura.');
  });
});

describe('describeDeliveryError', () => {
  it('sin respuesta es un problema de conexión', () => {
    expect(describeDeliveryError(new Error('x')).message).toMatch(/conectar/);
  });
  it('DELIVERY_LINES_INVALID mapea por request_item_id y pide recargar', () => {
    const d = describeDeliveryError(apiError(409, {
      code: 'DELIVERY_LINES_INVALID', detail: 'x',
      lines: [{ request_item_id: 5, code: 'EXCEEDS_REMAINING', message: 'Pendiente: 1 EA.' }, { request_item_id: 6, code: 'ITEM_NOT_LINKED' }],
    }));
    expect(d.lineErrors).toEqual({
      5: 'Pendiente: 1 EA.', 6: 'La línea no está vinculada a un producto del catálogo confirmado.',
    });
    expect(d.refresh).toBe(true);
    expect(d.message).toMatch(/2 líneas con problemas/);
  });
  it('DELIVERY_LINES_INVALID sin líneas usa el detalle del servidor', () => {
    expect(describeDeliveryError(apiError(409, { code: 'DELIVERY_LINES_INVALID', detail: 'Detalle propio.' })).message).toBe('Detalle propio.');
  });
  it('códigos de negocio con y sin detail', () => {
    expect(describeDeliveryError(apiError(409, { code: 'ALREADY_REVERSED', detail: 'Ya anulada.' })).message).toBe('Ya anulada.');
    expect(describeDeliveryError(apiError(409, { code: 'NOT_REVERSIBLE' })).message).toBe('Esta entrega no se puede anular.');
    expect(describeDeliveryError(apiError(409, { code: 'VOUCHER_NUMBER_CONFLICT' })).message).toMatch(/al mismo tiempo/);
    expect(describeDeliveryError(apiError(404, { code: 'DELIVERY_NOT_FOUND' })).message).toMatch(/ya no existe/);
    // Nunca muestra el código técnico.
    expect(describeDeliveryError(apiError(409, { code: 'REVERSE_FAILED' })).message).not.toMatch(/REVERSE_FAILED/);
  });
  it('validación DRF 400 por campo', () => {
    const d = describeDeliveryError(apiError(400, { error: true, status_code: 400, detail: { dispatch_guide_number: ['Este campo es obligatorio.'] } }));
    expect(d.fieldErrors).toEqual({ dispatch_guide_number: 'Este campo es obligatorio.' });
  });
  it('5xx y 403 sin código usan un texto genérico en español', () => {
    expect(describeDeliveryError(apiError(500, '<html>')).message).toBe('No se pudo completar la operación. Intente nuevamente.');
    expect(describeDeliveryError(apiError(403, {})).message).toBe('No tiene permiso para esta operación.');
  });
});

describe('describeDeliveryError — revisión del backend (envoltorio {error, status_code, detail, code, ...})', () => {
  const envelope = (status, extra) => apiError(status, { error: true, status_code: status, ...extra });

  it('INVALID_DATE: campo de fecha, detail del servidor y min_date', () => {
    const d = describeDeliveryError(envelope(400, {
      code: 'INVALID_DATE', detail: 'La fecha es anterior a la creación.', min_date: '2026-10-15',
    }));
    expect(d.fieldErrors).toEqual({ movement_date: 'La fecha es anterior a la creación.' });
    expect(d.minDate).toBe('2026-10-15');
    expect(d.refresh).toBe(false);
  });
  it('INVALID_DATE sin detail arma el texto con la fecha mínima (acepta ISO con hora)', () => {
    const d = describeDeliveryError(envelope(400, { code: 'INVALID_DATE', min_date: '2026-10-15T08:00:00-05:00' }));
    expect(d.message).toBe('La fecha no puede ser anterior al 15/10/2026.');
    expect(describeDeliveryError(envelope(400, { code: 'INVALID_DATE' })).minDate).toBe('');
  });
  it('RQ_NOT_REVERSIBLE_STATE pide recargar y muestra el detail', () => {
    const d = describeDeliveryError(envelope(409, {
      code: 'RQ_NOT_REVERSIBLE_STATE', status: 'DELIVERED', allowed_statuses: ['IN_STOCK', 'QUALITY_APPROVED'],
      detail: 'La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.',
    }));
    expect(d.refresh).toBe(true);
    expect(d.message).toMatch(/ciclo de reclamo/);
    expect(describeDeliveryError(envelope(409, { code: 'RQ_NOT_REVERSIBLE_STATE' })).message).toMatch(/ciclo de reclamo/);
  });
  it('RQ_TERMINAL ya no es un código propio', () => {
    expect(describeDeliveryError(envelope(409, { code: 'RQ_TERMINAL' })).refresh).toBe(false);
  });
  it('INTEGRITY_CONFLICT muestra el detail o un texto propio', () => {
    expect(describeDeliveryError(envelope(409, { code: 'INTEGRITY_CONFLICT', detail: 'Conflicto de datos.' })).message).toBe('Conflicto de datos.');
    expect(describeDeliveryError(envelope(409, { code: 'INTEGRITY_CONFLICT' })).message).toMatch(/otro cambio/);
  });
  it('sigue leyendo líneas y extras dentro del envoltorio', () => {
    const d = describeDeliveryError(envelope(409, {
      code: 'DELIVERY_LINES_INVALID', detail: 'x', lines: [{ request_item_id: 5, code: 'INSUFFICIENT_STOCK', message: 'Quedan 2.', available: '2.000' }],
    }));
    expect(d.lineErrors).toEqual({ 5: 'Quedan 2.' });
    expect(describeDeliveryError(envelope(400, { code: 'INVALID_ITEM', detail: 'Ajena.', item_ids: [9] })).lineErrors).toEqual({ 9: 'Esta línea no pertenece a este requerimiento.' });
  });
  it('la validación mínima se aplica en cliente cuando se conoce min_date', () => {
    const items = [ITEM_CASCO];
    expect(validateDeliveryForm({ items, quantities: { 11: '1' }, guide: 'G', date: '2026-10-10', notes: '', minDate: '2026-10-15', today: '2026-10-29' }).fieldErrors.movement_date)
      .toBe('La fecha no puede ser anterior al 15/10/2026.');
    expect(validateReason('motivo ok', '2026-10-10', '2026-10-29', '2026-10-15').movement_date).toMatch(/anterior al 15\/10\/2026/);
    expect(validateReason('motivo ok', '2026-10-15', '2026-10-29', '2026-10-15')).toEqual({});
  });
});

describe('otros helpers', () => {
  it('describePickingLoadError distingue los casos', () => {
    expect(describePickingLoadError(apiError(404, {})).code).toBe('NOT_FOUND');
    expect(describePickingLoadError(apiError(403, {})).code).toBe('FORBIDDEN');
    expect(describePickingLoadError(apiError(409, { code: 'INVALID_STATE' })).code).toBe('INVALID_STATE');
    expect(describePickingLoadError(new Error('x')).message).toMatch(/conectar/);
    expect(describePickingLoadError(apiError(500, {})).message).toMatch(/No se pudo cargar/);
  });
  it('roleList usa los nombres oficiales', () => {
    expect(roleList(['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF'])).toBe('Almacén Central, Jefe Logístico');
    expect(roleList(undefined)).toBe('');
  });
  it('maxQtyText respeta unidades enteras', () => {
    expect(maxQtyText(ITEM_CASCO)).toBe('6');
    expect(maxQtyText({ unit: 'EA', max_deliverable: '2.500' })).toBe('2');
    expect(maxQtyText({ unit: 'M', max_deliverable: '2.500' })).toBe('2.5');
    expect(maxQtyText(ITEM_TUBO)).toBe('');
  });
});
