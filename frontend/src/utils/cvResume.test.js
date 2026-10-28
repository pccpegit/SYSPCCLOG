import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installMemoryLocalStorage } from '../test/memoryStorage';
import { clearSkipped, isSkipped, markSkipped, resumeHref, resumeStep } from './cvResume';

beforeEach(() => {
  installMemoryLocalStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cvResume — "continuar sin convocatoria"', () => {
  it('recuerda, consulta y olvida por análisis', () => {
    expect(isSkipped(5)).toBe(false);
    markSkipped(5);
    expect(isSkipped(5)).toBe(true);
    expect(isSkipped(6)).toBe(false);
    clearSkipped(5);
    expect(isSkipped(5)).toBe(false);
  });

  it('si el almacenamiento falla (modo privado, bloqueado) no rompe nada', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: broken, setItem: broken, removeItem: broken });
    expect(isSkipped(5)).toBe(false);
    expect(() => markSkipped(5)).not.toThrow();
    expect(() => clearSkipped(5)).not.toThrow();
  });
});

describe('cvResume — paso donde reanudar', () => {
  it('con CVs subidos va a los resultados', () => {
    expect(resumeStep({ id: 5, counts: { total: 3 }, has_requirements: false })).toBe('results');
    expect(resumeHref({ id: 5, counts: { total: 3 } })).toBe('/rrhh/cvs/5');
  });

  it('con requisitos (fila de lista o detalle) va al paso 2', () => {
    expect(resumeStep({ id: 5, counts: { total: 0 }, has_requirements: true })).toBe(2);
    expect(resumeStep({ id: 5, requirements: [{ id: 1 }] })).toBe(2);
    expect(resumeHref({ id: 5, has_requirements: true })).toBe('/rrhh/cvs/5/preparar?paso=2');
  });

  it('sin requisitos abre el paso 1, salvo que se haya elegido continuar sin convocatoria', () => {
    expect(resumeStep({ id: 5, counts: { total: 0 }, has_requirements: false })).toBe(1);
    expect(resumeStep({ id: 5 })).toBe(1);
    expect(resumeHref({ id: 5, requirements: [] })).toBe('/rrhh/cvs/5/preparar');
    markSkipped(5);
    expect(resumeStep({ id: 5, requirements: [] })).toBe(2);
  });
});
