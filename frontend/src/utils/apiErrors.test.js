import { describe, it, expect } from 'vitest';
import { extractErrorMessage, extractFieldErrors } from './apiErrors';

// SYSPCC-026 (QA ronda 2). The creation of an RQ, update-items and the stock check all
// show the text these helpers pick out of a failed response. The shapes below are the
// ones those endpoints really answer (custom exception handler envelope, the 409 of
// update-items, the DRF throttle) plus what a reverse proxy in front of Django answers
// when Django never got the request.

const err = (status, data) => ({ response: { status, data } });
const FALLBACK = 'Mensaje de respaldo.';

describe('extractErrorMessage — respuestas de la API', () => {
  it('un detail de texto se muestra tal cual', () => {
    expect(extractErrorMessage(err(403, { detail: 'No tiene permiso.' }), FALLBACK)).toBe('No tiene permiso.');
  });

  it('el 409 de update-items ({detail, code, item_ids}) muestra su detail en español', () => {
    const body = {
      detail: 'Los ítems solo se pueden modificar desde la validación del requerimiento hasta antes del despacho. Estado actual: Enviado.',
      code: 'REQUEST_STATE_NOT_EDITABLE',
      item_ids: [],
    };
    expect(extractErrorMessage(err(409, body), FALLBACK)).toBe(body.detail);
  });

  it('una lista en detail muestra el primer mensaje', () => {
    expect(extractErrorMessage(err(400, { detail: ['Primero.', 'Segundo.'] }), FALLBACK)).toBe('Primero.');
  });

  it('un detail por campos (envoltorio global) muestra el primer mensaje del primer campo', () => {
    const body = { error: true, status_code: 400, detail: { requesting_area: ['Este campo es obligatorio.'] } };
    expect(extractErrorMessage(err(400, body), FALLBACK)).toBe('Este campo es obligatorio.');
  });

  it('un campo cuyo valor es texto (no lista) también sirve', () => {
    expect(extractErrorMessage(err(400, { detail: { flow: 'Combinación inválida.' } }), FALLBACK)).toBe('Combinación inválida.');
  });

  it('si el primer campo no es texto (errores por línea) usa el respaldo en vez de inventar un texto', () => {
    const body = { detail: { items: [{ quantity: ['La cantidad debe ser mayor que cero.'] }] } };
    expect(extractErrorMessage(err(400, body), FALLBACK)).toBe(FALLBACK);
  });

  it('la forma sin envoltorio (campos en la raíz) también se entiende', () => {
    expect(extractErrorMessage(err(400, { old_password: ['Contraseña incorrecta.'] }), FALLBACK)).toBe('Contraseña incorrecta.');
  });

  it('sin respuesta (red caída) o sin cuerpo usa el respaldo', () => {
    expect(extractErrorMessage(new Error('Network Error'), FALLBACK)).toBe(FALLBACK);
    expect(extractErrorMessage(err(500, undefined), FALLBACK)).toBe(FALLBACK);
    expect(extractErrorMessage(err(500, null), FALLBACK)).toBe(FALLBACK);
    expect(extractErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('un cuerpo vacío o un objeto sin mensajes usa el respaldo', () => {
    expect(extractErrorMessage(err(500, ''), FALLBACK)).toBe(FALLBACK);
    expect(extractErrorMessage(err(500, {}), FALLBACK)).toBe(FALLBACK);
    expect(extractErrorMessage(err(500, { error: true, status_code: 500 }), FALLBACK)).toBe(FALLBACK);
  });

  it('sin respaldo explícito usa el mensaje genérico en español', () => {
    expect(extractErrorMessage(err(500, {}))).toBe('Ocurrió un error inesperado. Intente nuevamente.');
  });
});

describe('extractErrorMessage — cuando responde el proxy y no Django', () => {
  // A 502/504 from the platform's proxy, or a 413 from nginx, carries an HTML page, which
  // axios hands over as a STRING. Object.values('<html>') is its characters: the toast
  // would say "<". The user has to see the fallback, not a piece of markup.
  it.each([
    ['502 con una página HTML', 502, '<html><body><h1>502 Bad Gateway</h1></body></html>'],
    ['413 de nginx', 413, '<html><head><title>413 Request Entity Too Large</title></head></html>'],
    ['504 con texto plano', 504, 'upstream request timeout'],
    ['503 con solo espacios', 503, '   '],
  ])('%s usa el respaldo, no un fragmento del cuerpo', (_label, status, body) => {
    expect(extractErrorMessage(err(status, body), FALLBACK)).toBe(FALLBACK);
  });
});

describe('extractFieldErrors', () => {
  it('devuelve el primer mensaje de cada campo del detail', () => {
    const body = { error: true, status_code: 400, detail: { requesting_area: ['Obligatorio.'], flow: 'Inválido.' } };
    expect(extractFieldErrors(err(400, body))).toEqual({ requesting_area: 'Obligatorio.', flow: 'Inválido.' });
  });

  it('ignora las claves del envoltorio', () => {
    const body = { error: true, status_code: 400, code: 'x', detail: { project: ['Falta.'] } };
    expect(Object.keys(extractFieldErrors(err(400, body)))).toEqual(['project']);
  });

  it('un detail de texto no es un error de campo', () => {
    expect(extractFieldErrors(err(409, { detail: 'Algo pasó.', code: 'REQUEST_TERMINAL' }))).toEqual({});
  });

  it('una respuesta que no es un objeto (HTML del proxy, red caída) no produce campos', () => {
    expect(extractFieldErrors(err(502, '<html>502</html>'))).toEqual({});
    expect(extractFieldErrors(new Error('Network Error'))).toEqual({});
    expect(extractFieldErrors(undefined)).toEqual({});
  });
});
