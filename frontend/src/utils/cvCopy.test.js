import { describe, it, expect } from 'vitest';
import { COPY } from './cvCopy';

// Sample arguments to exercise every text-producing function.
const SAMPLES = [[0], [1], [40], [100, 120], ['Residente de obra — Oct 2026'], [{ done: 3, failed: 2, pending: 1, queued: 4, processing: 1 }]];

function collect(node, path = 'COPY', out = []) {
  if (typeof node === 'string') out.push({ path, text: node });
  else if (typeof node === 'function') {
    for (const args of SAMPLES) {
      try {
        const value = node(...args);
        if (typeof value === 'string') out.push({ path: `${path}(${JSON.stringify(args)})`, text: value });
        break;
      } catch {
        // try the next sample
      }
    }
  } else if (Array.isArray(node)) node.forEach((n, i) => collect(n, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => collect(v, `${path}.${k}`, out));
  return out;
}

const sentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;

describe('microcopy del módulo de CVs (TDAH)', () => {
  const all = collect(COPY);

  it('recorre una cantidad razonable de textos', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('ninguna frase propia supera las 12 palabras', () => {
    const offenders = [];
    for (const { path, text } of all) {
      for (const sentence of sentences(text)) {
        if (words(sentence) > 12) offenders.push(`${path}: "${sentence}" (${words(sentence)})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('el aviso de la IA es el texto acordado', () => {
    expect(COPY.disclaimer).toBe('La IA ayuda a ordenar; la decisión final es de RR. HH.');
  });

  it('concuerda el número: 1 año / 2 años, 1 listo / 2 listos, 1 CV / 2 CVs', () => {
    expect(COPY.results.years(1)).toBe('≈ 1 año');
    expect(COPY.results.years(2)).toBe('≈ 2 años');
    expect(COPY.results.years(0.5)).toBe('≈ 0.5 años');
    expect(COPY.results.yearsExact(1)).toBe('1 año');
    expect(COPY.results.ofReady(1, 1)).toBe('1 de 1 listo');
    expect(COPY.results.ofReady(1, 3)).toBe('1 de 3 listos');
    expect(COPY.results.doneBanner(1, 1)).toBe('¡Listo! Analizamos 1 de 1 CV.');
    expect(COPY.results.doneBanner(2, 3)).toBe('¡Listo! Analizamos 2 de 3 CVs.');
    expect(COPY.list.summary({ done: 1 })).toBe('1 listo');
    expect(COPY.list.summary({ done: 2, failed: 1 })).toBe('2 listos · 1 con error');
  });

  it('un solo nombre por estado: los del enum del backend y "Con error" en fila y filtro', () => {
    expect(COPY.list.status).toEqual({
      EMPTY: 'Sin CVs',
      PROCESSING: 'En proceso',
      COMPLETED: 'Completado',
      COMPLETED_WITH_ERRORS: 'Completado con errores',
    });
    expect(COPY.results.stateLabels).toEqual(COPY.list.status);
    expect(COPY.results.statuses.FAILED).toBe('Con error');
    expect(COPY.results.chips.FAILED).toBe('Con error');
    expect(COPY.wizard.nameLabel).toBe('Nombre del análisis');
  });
});
