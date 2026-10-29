import { describe, it, expect } from 'vitest';
import {
  describeItemLink,
  ITEM_SOURCES,
  itemSourceLabel,
  proposeItemSource,
  REQUESTING_AREAS,
  requestingAreaLabel,
} from './requestCapture';

describe('vocabulario de captura (espejo del backend)', () => {
  it('las 4 áreas y las 9 fuentes del backend', () => {
    expect(REQUESTING_AREAS.map((a) => a.value)).toEqual(['OP', 'QC', 'HSE', 'ADM']);
    expect(ITEM_SOURCES.map((s) => s.value)).toEqual([
      'EPP', 'HERRAMIENTAS', 'MATERIALES', 'EQUIPOS', 'FORMATERIA', 'CONSUMIBLES', 'UNIDADES', 'UTILES', 'GASES',
    ]);
  });

  it('el área vacía de un RQ histórico se muestra como "Sin área"', () => {
    expect(requestingAreaLabel('')).toBe('Sin área');
    expect(requestingAreaLabel(undefined)).toBe('Sin área');
    expect(requestingAreaLabel('OP')).toBe('Operaciones (OP)');
    expect(requestingAreaLabel('OP', 'Operaciones')).toBe('Operaciones'); // prefiere lo que manda el backend
  });

  it('etiqueta de fuente', () => {
    expect(itemSourceLabel('UTILES')).toBe('Útiles');
    expect(itemSourceLabel('', '')).toBe('');
    expect(itemSourceLabel('X', 'Etiqueta del backend')).toBe('Etiqueta del backend');
  });
});

describe('proposeItemSource', () => {
  it('sólo infiere EPP (el catálogo hoy distingue EPP y Otros)', () => {
    expect(proposeItemSource('EPP')).toBe('EPP');
    expect(proposeItemSource(' epp ')).toBe('EPP');
    expect(proposeItemSource('Otros')).toBe('');
    expect(proposeItemSource(null)).toBe('');
    expect(proposeItemSource(undefined)).toBe('');
  });
});

describe('describeItemLink', () => {
  it('distingue vinculado, fuera de catálogo y sin vincular', () => {
    expect(describeItemLink({ inventory_item: 5, inventory_item_code: 'EPP-1' }))
      .toEqual({ kind: 'LINKED', label: 'Vinculado a EPP-1' });
    expect(describeItemLink({ inventory_item: null, is_off_catalog: true }).kind).toBe('OFF_CATALOG');
    expect(describeItemLink({ inventory_item: null, is_off_catalog: false }).kind).toBe('UNLINKED');
    expect(describeItemLink({}).kind).toBe('UNLINKED');
  });
});
