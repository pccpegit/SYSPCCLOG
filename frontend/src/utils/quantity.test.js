import { describe, it, expect } from 'vitest';
import { formatQty, parseQty } from './quantity';

describe('parseQty', () => {
  it('lee decimales que la API manda como string', () => {
    expect(parseQty('12.000')).toBe(12);
    expect(parseQty('0.500')).toBe(0.5);
    expect(parseQty(3)).toBe(3);
  });

  it('devuelve null cuando no hay cifra', () => {
    expect(parseQty(null)).toBeNull();
    expect(parseQty(undefined)).toBeNull();
    expect(parseQty('')).toBeNull();
    expect(parseQty('abc')).toBeNull();
  });
});

describe('formatQty', () => {
  it('muestra enteros sin decimales y el resto sin ceros finales', () => {
    expect(formatQty('12.000')).toBe('12');
    expect(formatQty('0.500')).toBe('0.5');
    expect(formatQty(7)).toBe('7');
    expect(formatQty('0.000')).toBe('0');
  });

  it('conserva los 3 decimales que guarda la API (la cantidad mínima válida es 0.001)', () => {
    expect(formatQty('0.001')).toBe('0.001');
    expect(formatQty('0.125')).toBe('0.125');
    expect(formatQty('12.250')).toBe('12.25');
    expect(formatQty('1234.567')).toBe('1234.567');
    expect(formatQty(0.004)).toBe('0.004');                      // no se pinta como "0.00" junto a "Stock suficiente"
  });

  it('no usa notación científica ni "-0" con cifras diminutas o negativas', () => {
    expect(formatQty('0.0004')).toBe('0');
    expect(formatQty('-0.0004')).toBe('0');
    expect(formatQty('-0.5')).toBe('-0.5');
    expect(formatQty(1e-9)).toBe('0');
  });

  it('muestra un guion cuando no hay cifra', () => {
    expect(formatQty(null)).toBe('—');
    expect(formatQty(undefined)).toBe('—');
    expect(formatQty('')).toBe('—');
  });
});
