import { describe, it, expect } from 'vitest';
import { btnPrimary, thCls } from './uiStyles';

// Luminancia relativa y contraste WCAG 2.x (para fijar el color del botón principal).
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Tailwind: emerald-600 #059669, emerald-700 #047857.
const EMERALD = { 600: [5, 150, 105], 700: [4, 120, 87] };
const WHITE = [255, 255, 255];

describe('estilos compartidos del almacén', () => {
  it('el botón principal cumple el contraste AA (4,5:1) para texto blanco pequeño', () => {
    expect(contrast(WHITE, EMERALD[600])).toBeLessThan(4.5);   // por qué se cambió
    expect(contrast(WHITE, EMERALD[700])).toBeGreaterThanOrEqual(4.5);
    expect(btnPrimary).toContain('bg-emerald-700');
    expect(btnPrimary).toContain('hover:bg-emerald-800');
    expect(btnPrimary).not.toMatch(/bg-emerald-600/);
  });

  it('las cabeceras de tabla no bajan de 12 px', () => {
    expect(thCls).toContain('text-xs');
    expect(thCls).not.toMatch(/text-\[1\d?px\]/);
  });
});
