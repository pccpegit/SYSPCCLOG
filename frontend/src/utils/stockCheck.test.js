import { describe, it, expect } from 'vitest';
import {
  buildCoverageWarnings,
  buildItemDecisions,
  COVERAGE_META,
  describeCoverage,
  describeCoverageSentence,
  describeCoverageGap,
  describeUpdateItemsError,
  effectiveSupply,
  findUpdateItemsProblem,
  indexAvailability,
  isLinkPending,
  suggestSupply,
} from './stockCheck';

const row = (over) => ({
  item_id: 1, line_number: 1, description: 'Casco', unit: 'UND', requested: '10.000',
  inventory_item: { id: 5, product_code: 'EPP-1', description: 'Casco', unit: 'UND' },
  link_status: 'LINKED', available_central: '10.000', committed_other_requests: '0.000',
  available_net: '10.000', shortfall: '0.000', coverage: 'FULL', ...over,
});

const items = [
  { id: 1, line_number: 1, description: 'Casco', item_source: '' },
  { id: 2, line_number: 2, description: 'Guantes', item_source: 'EPP' },
  { id: 3, line_number: 3, description: 'Topografía', item_source: '' },
];

describe('suggestSupply / effectiveSupply', () => {
  it('sólo una cobertura completa sugiere stock', () => {
    expect(suggestSupply(row({ coverage: 'FULL' }))).toBe('stock');
    expect(suggestSupply(row({ coverage: 'PARTIAL' }))).toBe('purchase');
    expect(suggestSupply(row({ coverage: 'NONE' }))).toBe('purchase');
    expect(suggestSupply(row({ coverage: null, link_status: 'UNLINKED' }))).toBe('purchase');
  });

  it('sin datos de disponibilidad no sugiere nada', () => {
    expect(suggestSupply(undefined)).toBeNull();
  });

  it('la elección explícita gana sobre la sugerencia', () => {
    const byItem = indexAvailability([row({ item_id: 1, coverage: 'FULL' })]);
    expect(effectiveSupply(1, {}, byItem)).toBe('stock');
    expect(effectiveSupply(1, { 1: 'purchase' }, byItem)).toBe('purchase');
    expect(effectiveSupply(9, {}, byItem)).toBeNull();
  });
});

describe('describeCoverageGap', () => {
  it('cubierto por completo no tiene brecha', () => {
    expect(describeCoverageGap(row())).toBeNull();
  });

  it('explica cada causa en español', () => {
    expect(describeCoverageGap(row({ coverage: 'PARTIAL', available_net: '4.000', shortfall: '6.000' })))
      .toEqual({ reason: 'PARTIAL', text: 'Stock parcial: hay 4 de 10 UND (faltan 6).' });
    expect(describeCoverageGap(row({ coverage: 'NONE', available_net: '0.000', shortfall: '10.000' })).reason).toBe('NONE');
    expect(describeCoverageGap(row({ coverage: null, link_status: 'UNLINKED' })).reason).toBe('UNLINKED');
    expect(describeCoverageGap(row({ coverage: null, link_status: 'OFF_CATALOG' })).reason).toBe('OFF_CATALOG');
    expect(describeCoverageGap(undefined).reason).toBe('UNKNOWN');
  });
});

describe('buildCoverageWarnings', () => {
  const byItem = indexAvailability([
    row({ item_id: 1, coverage: 'FULL' }),
    row({ item_id: 2, coverage: 'PARTIAL', available_net: '1.000', shortfall: '9.000', description: 'Guantes' }),
    row({ item_id: 3, coverage: null, link_status: 'OFF_CATALOG', description: 'Topografía' }),
  ]);

  it('avisa de los ítems de stock que el pool no cubre por completo', () => {
    const warnings = buildCoverageWarnings(items, { 1: 'stock', 2: 'stock', 3: 'stock' }, byItem);
    expect(warnings.map((w) => [w.line, w.reason])).toEqual([[2, 'PARTIAL'], [3, 'OFF_CATALOG']]);
  });

  it('los ítems que van a compra no generan aviso', () => {
    expect(buildCoverageWarnings(items, { 1: 'stock', 2: 'purchase', 3: 'purchase' }, byItem)).toEqual([]);
  });

  it('la sugerencia por defecto (parcial -> compra) no avisa; forzar stock sí', () => {
    expect(buildCoverageWarnings(items, {}, byItem)).toEqual([]);
    expect(buildCoverageWarnings(items, { 2: 'stock' }, byItem)).toHaveLength(1);
  });

  it('si no se pudo consultar la disponibilidad, un ítem de stock queda como no verificable', () => {
    const warnings = buildCoverageWarnings(items, { 1: 'stock' }, {});
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('UNKNOWN');
  });
});

describe('buildItemDecisions', () => {
  const byItem = indexAvailability([row({ item_id: 1 }), row({ item_id: 2, coverage: 'NONE' })]);

  it('arma STOCK / PURCHASE por ítem y agrega la fuente cuando existe', () => {
    const decisions = buildItemDecisions(items.slice(0, 2), { 2: 'stock' }, byItem, { 1: 'CONSUMIBLES' });
    expect(decisions).toEqual([
      { item_id: 1, supply_source: 'STOCK', item_source: 'CONSUMIBLES' },
      { item_id: 2, supply_source: 'STOCK', item_source: 'EPP' },
    ]);
  });

  it('no envía item_source vacío', () => {
    const [d] = buildItemDecisions([items[0]], {}, byItem, {});
    expect(d).toEqual({ item_id: 1, supply_source: 'STOCK' });
  });

  describe('"-- Sin fuente --" elegido a propósito', () => {
    it('sobre un ítem que ya tenía fuente la envía vacía, para que el servidor la quite', () => {
      const [d] = buildItemDecisions([items[1]], {}, byItem, { 2: '' });
      expect(d).toEqual({ item_id: 2, supply_source: 'PURCHASE', item_source: '' });
    });

    it('sobre un ítem que no tenía fuente no manda nada (no hay qué quitar)', () => {
      const [d] = buildItemDecisions([items[0]], {}, byItem, { 1: '' });
      expect(d).not.toHaveProperty('item_source');
    });

    it('sin tocar el selector conserva la fuente que el ítem ya tiene', () => {
      const [d] = buildItemDecisions([items[1]], {}, byItem, {});
      expect(d.item_source).toBe('EPP');
    });

    it('cambiar la fuente envía la nueva, también sobre una existente', () => {
      const [d] = buildItemDecisions([items[1]], {}, byItem, { 2: 'GASES' });
      expect(d.item_source).toBe('GASES');
    });
  });
});

describe('isLinkPending (producto propuesto por el solicitante, sin confirmar)', () => {
  const linkedItem = { id: 1, inventory_item: 5, is_off_catalog: false };

  it('sólo link_confirmed === false cuenta como pendiente', () => {
    expect(isLinkPending(linkedItem, row({ link_confirmed: false }))).toBe(true);
    expect(isLinkPending(linkedItem, row({ link_confirmed: true }))).toBe(false);
  });

  it('un RQ o una API sin la marca se toma como confirmado (nada cambia hasta que el servidor la envíe)', () => {
    expect(isLinkPending(linkedItem, row())).toBe(false);
    expect(isLinkPending(linkedItem, undefined)).toBe(false);
    expect(isLinkPending(linkedItem, row({ link_confirmed: null }))).toBe(false);
  });

  it('sin la fila de disponibilidad usa la marca del ítem', () => {
    expect(isLinkPending({ ...linkedItem, link_confirmed: false }, undefined)).toBe(true);
    expect(isLinkPending({ ...linkedItem, link_confirmed: true }, undefined)).toBe(false);
  });

  it('la fila (más reciente) manda sobre la marca del ítem', () => {
    expect(isLinkPending({ ...linkedItem, link_confirmed: false }, row({ link_confirmed: true }))).toBe(false);
  });

  it('el ítem fuera de catálogo propuesto también queda por confirmar', () => {
    const off = { id: 3, inventory_item: null, is_off_catalog: true };
    expect(isLinkPending(off, row({ link_status: 'OFF_CATALOG', inventory_item: null, link_confirmed: false }))).toBe(true);
    expect(isLinkPending({ ...off, link_confirmed: false }, undefined)).toBe(true);
  });

  it('un ítem sin vincular no tiene nada que confirmar', () => {
    const none = { id: 4, inventory_item: null, is_off_catalog: false, link_confirmed: false };
    expect(isLinkPending(none, row({ link_status: 'UNLINKED', inventory_item: null, link_confirmed: false }))).toBe(false);
    expect(isLinkPending(none, undefined)).toBe(false);
  });
});

describe('findUpdateItemsProblem', () => {
  it('ids ajenos devueltos en ignored_item_ids cuentan como fallo', () => {
    expect(findUpdateItemsProblem({ ignored_item_ids: [99] })).toMatch(/ya no pertenecen/);
  });
  it('sin ignorados no hay problema', () => {
    expect(findUpdateItemsProblem({ ignored_item_ids: [] })).toBeNull();
    expect(findUpdateItemsProblem({})).toBeNull();
    expect(findUpdateItemsProblem(undefined)).toBeNull();
  });
});

describe('describeUpdateItemsError', () => {
  const http = (status, data = {}) => ({ response: { status, data } });

  it('409 usa el detalle del backend', () => {
    expect(describeUpdateItemsError(http(409, { detail: 'El requerimiento ya está cerrado.', code: 'REQUEST_TERMINAL' })))
      .toBe('El requerimiento ya está cerrado.');
  });
  it('403, 404, 429 y 400 tienen mensajes propios', () => {
    expect(describeUpdateItemsError(http(403))).toMatch(/No tiene permiso/);
    expect(describeUpdateItemsError(http(404))).toMatch(/ya no existe/);
    expect(describeUpdateItemsError(http(429))).toMatch(/Demasiadas solicitudes/);
    expect(describeUpdateItemsError(http(400, { detail: { items: ['Hay ítems repetidos.'] } }))).toBe('Hay ítems repetidos.');
  });
  it('sin respuesta del servidor habla de conexión', () => {
    expect(describeUpdateItemsError(new Error('Network Error'))).toMatch(/No se pudo conectar/);
  });
  it('un 500 no expone texto crudo', () => {
    expect(describeUpdateItemsError(http(500))).toBe('No se pudieron guardar los ítems. Intente nuevamente.');
  });
});

describe('describeCoverage', () => {
  it('siempre trae texto, no sólo color', () => {
    expect(describeCoverage('FULL')).toEqual({ tone: 'green', text: 'Stock suficiente' });
    expect(describeCoverage('PARTIAL').text).toBe('Stock parcial');
    expect(describeCoverage('NONE').text).toBe('Sin stock');
    expect(describeCoverage(null, 'UNLINKED').text).toBe('Sin vincular');
    expect(describeCoverage(null, 'OFF_CATALOG').text).toBe('Fuera de catálogo');
    expect(describeCoverage(null, undefined, true).text).toBe('Consultando…');
    expect(describeCoverage(null, undefined, false).text).toBe('Sin datos de stock');
  });
});

describe('un solo vocabulario de cobertura (insignia y frase)', () => {
  it('la insignia y la frase de debajo usan las mismas etiquetas', () => {
    for (const coverage of ['FULL', 'PARTIAL', 'NONE']) {
      const { text } = describeCoverage(coverage);
      expect(text).toBe(COVERAGE_META[coverage].label);
      expect(describeCoverageSentence(coverage)).toMatch(new RegExp(`^${text}\\. `));
    }
  });

  it('nunca dice "Cubre todo" ni "Cubre parcial"', () => {
    const everything = JSON.stringify(COVERAGE_META) + ['FULL', 'PARTIAL', 'NONE'].map(describeCoverageSentence).join(' ');
    expect(everything).not.toMatch(/Cubre (todo|parcial)/i);
  });

  it('sin cobertura (o con una clave rara del servidor) no hay frase ni revienta', () => {
    expect(describeCoverageSentence(null)).toBeNull();
    expect(describeCoverageSentence(undefined)).toBeNull();
    expect(describeCoverageSentence('constructor')).toBeNull();
    expect(describeCoverage('constructor', 'UNLINKED').text).toBe('Sin vincular');
  });
});
