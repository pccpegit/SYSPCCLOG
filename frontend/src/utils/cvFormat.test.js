import { describe, it, expect } from 'vitest';
import { etaMinutes, formatBytes, formatUsd, normalizeText, plural } from './cvFormat';
import { etaText, estimateSeconds } from '../hooks/useEta';

describe('cvFormat', () => {
  it('formatea tamaños, dinero y plural', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
    expect(formatUsd(0.8)).toBe('0.80');
    expect(plural(1, 'CV', 'CVs')).toBe('CV');
    expect(plural(3, 'CV', 'CVs')).toBe('CVs');
    expect(normalizeText('  Ingeniería  CIVIL ')).toBe('ingenieria  civil');
  });

  it('redondea el tiempo estimado: <1 min, minutos hacia arriba y múltiplos de 5 desde 20', () => {
    expect(etaMinutes(30)).toBe(0);
    expect(etaMinutes(61)).toBe(2);
    expect(etaMinutes(8 * 60 - 10)).toBe(8);
    expect(etaMinutes(21 * 60)).toBe(25);
    expect(etaText(null)).toBe('Calculando el tiempo…');
    expect(etaText(20)).toBe('Falta menos de 1 min');
    expect(etaText(8 * 60)).toBe('Faltan unos 8 min');
  });

  it('no estima sin al menos 3 listos y 20 s', () => {
    expect(estimateSeconds({ pending: 10, finishedSince: 2, elapsedMs: 60000 })).toBeNull();
    expect(estimateSeconds({ pending: 10, finishedSince: 3, elapsedMs: 10000 })).toBeNull();
    expect(estimateSeconds({ pending: 10, finishedSince: 4, elapsedMs: 40000 })).toBe(100);
  });
});
