import { describe, it, expect } from 'vitest';
import {
  describeNetBreakdown,
  describeUnitMismatch,
  isUnitMismatch,
  stockUnitOf,
  suggestSupply,
  summarizeAvailability,
} from './stockCheck';

// SYSPCC-026 (QA ronda 4): las ramas de las funciones de unidades que las pruebas de la
// ronda no recorrían (unidades en blanco, fuentes de la unidad del stock, desglose sin unidad).
// Todas alimentan texto que la persona lee o que queda en el historial del RQ.

const row = (over) => ({
  item_id: 1, line_number: 1, description: 'Casco', unit: 'UND', requested: '10.000',
  inventory_item: { id: 5, product_code: 'EPP-1', description: 'Casco', unit: 'UND' },
  product_unit: 'UND', unit_mismatch: false, link_status: 'LINKED',
  available_central: '10.000', committed_other_requests: '0.000', committed_earlier_lines: '0.000',
  available_net: '10.000', shortfall: '0.000', coverage: 'FULL', ...over,
});

describe('stockUnitOf — de dónde sale la unidad de las cifras de stock', () => {
  it('prefiere product_unit', () => {
    expect(stockUnitOf(row({ product_unit: 'EA', unit: 'UND' }))).toBe('EA');
  });

  it('sin product_unit usa la unidad del producto vinculado', () => {
    expect(stockUnitOf(row({ product_unit: undefined, inventory_item: { id: 5, unit: 'PAR' }, unit: 'UND' }))).toBe('PAR');
  });

  it('un producto sin unidad (cadena vacía) NO hereda la unidad de la línea: se respeta lo declarado', () => {
    expect(stockUnitOf(row({ product_unit: '', unit: 'UND' }))).toBe('');
  });

  it('sin dato del producto y sin conflicto usa la unidad de la línea', () => {
    expect(stockUnitOf(row({ product_unit: undefined, inventory_item: null, unit: ' KG ' }))).toBe('KG');
  });

  it('sin dato del producto y con conflicto no inventa una unidad', () => {
    expect(stockUnitOf(row({
      product_unit: undefined, inventory_item: null, unit: 'KG', unit_mismatch: true, coverage: 'NOT_COMPARABLE',
    }))).toBe('');
  });

  it('una fila ausente da cadena vacía', () => {
    expect(stockUnitOf(undefined)).toBe('');
    expect(stockUnitOf(null)).toBe('');
  });
});

describe('summarizeAvailability — lo que queda en el historial del RQ', () => {
  it('unidad distinta con la unidad del stock en blanco dice "sin unidad", no una cadena vacía', () => {
    const text = summarizeAvailability(row({
      product_unit: '', unit: 'CAJA', unit_mismatch: true, coverage: 'NOT_COMPARABLE',
    }));
    expect(text).toBe('unidad distinta: stock en sin unidad, RQ en CAJA');
  });

  it('unidad distinta con la unidad del RQ en blanco dice "sin unidad"', () => {
    const text = summarizeAvailability(row({
      product_unit: 'EA', unit: '  ', unit_mismatch: true, coverage: 'NOT_COMPARABLE',
    }));
    expect(text).toBe('unidad distinta: stock en EA, RQ en sin unidad');
  });

  it('una fila sin unit nula tampoco rompe el resumen', () => {
    const text = summarizeAvailability(row({
      product_unit: 'EA', unit: null, unit_mismatch: true, coverage: 'NOT_COMPARABLE',
    }));
    expect(text).toBe('unidad distinta: stock en EA, RQ en sin unidad');
  });

  it('con unit_mismatch verdadero manda sobre una cobertura FULL contradictoria: nunca se lee como cubierto', () => {
    const text = summarizeAvailability(row({ unit_mismatch: true, coverage: 'FULL', product_unit: 'EA', unit: 'CAJA' }));
    expect(text).toContain('unidad distinta');
    expect(text).not.toContain('disponible neto');
  });

  it('con solo coverage NOT_COMPARABLE (servidor antiguo sin unit_mismatch) también es unidad distinta', () => {
    expect(isUnitMismatch(row({ unit_mismatch: undefined, coverage: 'NOT_COMPARABLE' }))).toBe(true);
    expect(suggestSupply(row({ unit_mismatch: undefined, coverage: 'NOT_COMPARABLE' }))).toBeNull();
  });

  it('sin fila o sin disponible neto dice "sin datos de stock"', () => {
    expect(summarizeAvailability(undefined)).toBe('sin datos de stock');
    expect(summarizeAvailability(row({ available_net: null }))).toBe('sin datos de stock');
  });

  it('con datos comparables dice el disponible neto sin unidad (la unidad ya va en la línea)', () => {
    expect(summarizeAvailability(row({ available_net: '12.000' }))).toBe('disponible neto: 12');
  });
});

describe('describeUnitMismatch — unidades en blanco', () => {
  it('sin unidad en el producto lo dice con palabras', () => {
    expect(describeUnitMismatch(row({ product_unit: '', unit: 'CAJA', unit_mismatch: true })))
      .toBe('Unidad distinta: el producto no tiene unidad definida y el RQ pide en CAJA.');
  });

  it('sin unidad en la línea lo dice con palabras', () => {
    expect(describeUnitMismatch(row({ product_unit: 'EA', unit: '', unit_mismatch: true })))
      .toBe('Unidad distinta: el stock está en EA y el RQ no indica unidad.');
  });

  it('con ambas en blanco no deja huecos', () => {
    expect(describeUnitMismatch(row({ product_unit: '', unit: null, unit_mismatch: true })))
      .toBe('Unidad distinta: el producto no tiene unidad definida y el RQ no indica unidad.');
  });
});

describe('describeNetBreakdown — sin unidad en el stock', () => {
  it('las cifras salen sin unidad colgando cuando el producto no la tiene', () => {
    const text = describeNetBreakdown(row({
      product_unit: '', available_central: '10.000', available_net: '4.000',
      committed_other_requests: '6.000', committed_earlier_lines: '0.000',
    }));
    expect(text).toBe('Hay 10 en el almacén central; el resto está comprometido con otros RQ.');
  });

  it('con otros RQ y líneas anteriores nombra a ambos con la unidad del producto', () => {
    const text = describeNetBreakdown(row({
      product_unit: 'PAR', available_central: '10.000', available_net: '1.000',
      committed_other_requests: '3.000', committed_earlier_lines: '6.000',
    }));
    expect(text).toBe(
      'Hay 10 PAR en el almacén central; 3 PAR están comprometidas con otros RQ y 6 PAR las toman los ítems anteriores de este RQ.',
    );
  });

  it('sin reducción del pool, o sin cifras, no dice nada', () => {
    expect(describeNetBreakdown(row({ available_central: '10.000', available_net: '10.000' }))).toBe('');
    expect(describeNetBreakdown(row({ available_net: null }))).toBe('');
    expect(describeNetBreakdown(row({ available_central: null }))).toBe('');
    expect(describeNetBreakdown(undefined)).toBe('');
  });
});
