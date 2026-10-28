import { describe, it, expect } from 'vitest';
import { ITEM_ERRORS, isRetryable, itemError } from './cvErrors';

describe('cvErrors', () => {
  it.each(Object.keys(ITEM_ERRORS))('el código %s tiene mensaje corto en español y decide si se puede reintentar', (code) => {
    const info = itemError(code);
    expect(info.message.length).toBeGreaterThan(10);
    expect(info.message).toMatch(/[.]$/);
    expect(typeof isRetryable(code)).toBe('boolean');
  });

  it('solo se reintentan las fallas temporales; las que dependen del archivo o la configuración no', () => {
    for (const code of ['ai_rate_limited', 'ai_failed', 'ai_unparseable', 'internal_error']) expect(isRetryable(code)).toBe(true);
    for (const code of ['cv_unreadable', 'file_missing', 'ai_unavailable', 'ai_refusal', 'cv_rejected_by_ai']) expect(isRetryable(code)).toBe(false);
  });

  it('gana el mensaje del servidor cuando viene', () => {
    expect(itemError('ai_failed', 'Mensaje del backend.').message).toBe('Mensaje del backend.');
    expect(itemError('ai_failed', '').message).toBe(ITEM_ERRORS.ai_failed.message);
  });

  it('un código desconocido o vacío cae en el error interno (reintentable) y no rompe', () => {
    expect(itemError('codigo_nuevo').message).toBe(ITEM_ERRORS.internal_error.message);
    expect(itemError(undefined).retryable).toBe(true);
    expect(isRetryable('codigo_nuevo')).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
  });

  it('las fallas sin reintento ofrecen una salida: ver el original o quitar el CV', () => {
    expect(itemError('cv_unreadable').action).toBe('original');
    expect(itemError('file_missing').action).toBe('remove');
  });
});
