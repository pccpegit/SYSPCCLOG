import { describe, it, expect } from 'vitest';
import { HR_ERROR_MESSAGES, hrErrorCode, hrErrorMessage } from './hrErrors';

const err = (status, data) => ({ response: { status, data } });

describe('hrErrorMessage', () => {
  it.each(Object.entries(HR_ERROR_MESSAGES))('mapea el código %s a su mensaje es-PE', (code, message) => {
    expect(hrErrorMessage(err(400, { code, detail: null }))).toBe(message);
    expect(hrErrorMessage(err(400, { code, detail: '   ' }))).toBe(message);
    expect(message.length).toBeGreaterThan(10);
  });

  it('cubre todos los códigos del contrato del asistente y de PDF', () => {
    for (const code of ['assistant_unavailable', 'assistant_unreadable', 'assistant_rate_limited', 'assistant_failed', 'pdf_disabled', 'pdf_not_available', 'invalid_state']) {
      expect(HR_ERROR_MESSAGES).toHaveProperty(code);
    }
  });

  it('hrErrorCode devuelve null sin respuesta o sin code', () => {
    expect(hrErrorCode(undefined)).toBeNull();
    expect(hrErrorCode(new Error('x'))).toBeNull();
    expect(hrErrorCode(err(400, { detail: 'x' }))).toBeNull();
    expect(hrErrorCode(err(409, { code: 'invalid_state' }))).toBe('invalid_state');
  });

  it('sin respuesta (red caída) devuelve mensaje de conexión', () => {
    expect(hrErrorMessage(new Error('Network Error'))).toMatch(/no hay conexión/i);
  });

  it('código desconocido usa el detail del backend', () => {
    expect(hrErrorMessage(err(400, { code: 'otra_cosa', detail: 'Detalle propio.' }))).toBe('Detalle propio.');
  });

  it('401/404/429 sin detail usan el mensaje por status', () => {
    expect(hrErrorMessage(err(401, {}))).toMatch(/sesión expiró/i);
    expect(hrErrorMessage(err(404, {}))).toMatch(/no se encontró/i);
    expect(hrErrorMessage(err(429, {}))).toMatch(/demasiadas solicitudes/i);
  });

  it('403 siempre muestra el mensaje de permiso aunque haya detail', () => {
    expect(hrErrorMessage(err(403, { detail: 'inglés raro' }))).toMatch(/no tienes permiso/i);
  });

  it('5xx muestra error de servidor sin filtrar el detail', () => {
    expect(hrErrorMessage(err(500, { detail: 'Traceback...' }))).toMatch(/error del servidor/i);
    expect(hrErrorMessage(err(503, {}))).toMatch(/error del servidor/i);
  });

  it('usa el fallback cuando no hay nada reconocible', () => {
    expect(hrErrorMessage(err(400, null), 'Mi fallback')).toBe('Mi fallback');
  });

  it.each([400, 404, 409, 422, 429])('en %i el detail (string no vacío) del backend gana sobre el mapa', (status) => {
    expect(hrErrorMessage(err(status, { code: 'invalid_state', detail: 'Mensaje específico del servidor.' })))
      .toBe('Mensaje específico del servidor.');
  });

  it('sin detail utilizable cae al mapa por código', () => {
    expect(hrErrorMessage(err(409, { code: 'invalid_state' }))).toBe(HR_ERROR_MESSAGES.invalid_state);
    expect(hrErrorMessage(err(409, { code: 'invalid_state', detail: { campo: ['x'] } }))).toBe(HR_ERROR_MESSAGES.invalid_state);
  });

  it('5xx nunca filtra el detail: mapa por código o mensaje genérico', () => {
    expect(hrErrorMessage(err(502, { code: 'assistant_failed', detail: 'boom interno' }))).toBe(HR_ERROR_MESSAGES.assistant_failed);
    expect(hrErrorMessage(err(500, { code: 'otra', detail: 'Traceback' }))).toMatch(/error del servidor/i);
  });

  it('incluye los códigos company_data_missing y docx_missing', () => {
    expect(HR_ERROR_MESSAGES.company_data_missing).toBe(
      'Faltan datos de la empresa (razón social, RUC o representante legal). Configúralos antes de emitir.',
    );
    expect(HR_ERROR_MESSAGES.docx_missing).toMatch(/archivo Word/);
    expect(hrErrorMessage(err(400, { code: 'company_data_missing' }))).toBe(HR_ERROR_MESSAGES.company_data_missing);
  });
});
