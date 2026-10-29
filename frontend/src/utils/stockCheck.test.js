import { describe, it, expect } from 'vitest';
import {
  buildCoverageWarnings,
  buildItemDecisions,
  COVERAGE_META,
  describeCoverage,
  describeCoverageSentence,
  describeCoverageGap,
  describeNetBreakdown,
  describeUnitMismatch,
  describeUpdateItemsError,
  effectiveSupply,
  findUpdateItemsProblem,
  getLockedItems,
  indexAvailability,
  isLinkPending,
  isUnitMismatch,
  lockedItemsFromError,
  stockUnitOf,
  suggestSupply,
  summarizeAvailability,
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

// ─────────────────────────────────────────────────────────────────────────────
// Ronda 4: unidades (product_unit / unit_mismatch / NOT_COMPARABLE) y 409 de recibos
// ─────────────────────────────────────────────────────────────────────────────

// The server answers this when the line asks in CAJA and the product's stock is in EA: nothing is
// compared, `shortfall` is null and the figures stay in the product's unit.
const mismatchRow = (over) => row({
  unit: 'CAJA', requested: '2.000', product_unit: 'EA', unit_mismatch: true, coverage: 'NOT_COMPARABLE',
  inventory_item: { id: 5, product_code: 'EPP-1', description: 'Casco', unit: 'EA' },
  available_central: '10.000', committed_other_requests: '0.000', available_net: '10.000', shortfall: null,
  committed_earlier_lines: '0.000', ...over,
});

describe('unidad distinta — isUnitMismatch / stockUnitOf / describeUnitMismatch', () => {
  it('lo detecta por unit_mismatch o por la cobertura NOT_COMPARABLE (cualquiera de las dos basta)', () => {
    expect(isUnitMismatch(mismatchRow())).toBe(true);
    expect(isUnitMismatch(row({ unit_mismatch: true, coverage: 'FULL' }))).toBe(true);
    expect(isUnitMismatch(row({ coverage: 'NOT_COMPARABLE' }))).toBe(true);
    expect(isUnitMismatch(row())).toBe(false);
    expect(isUnitMismatch(row({ unit_mismatch: false }))).toBe(false);
    expect(isUnitMismatch(undefined)).toBe(false);
    expect(isUnitMismatch(null)).toBe(false);
  });

  it('las cifras de stock van en la unidad del PRODUCTO, no en la de la línea', () => {
    expect(stockUnitOf(row({ unit: 'EA', product_unit: 'UND' }))).toBe('UND');
    expect(stockUnitOf(mismatchRow())).toBe('EA');
  });

  it('sin product_unit usa la unidad del producto vinculado y, sin conflicto, la de la línea', () => {
    expect(stockUnitOf(row({ unit: 'EA', inventory_item: { id: 5, unit: 'UND' } }))).toBe('UND');
    expect(stockUnitOf(row({ unit: 'UND', inventory_item: null }))).toBe('UND');
    expect(stockUnitOf(undefined)).toBe('');
  });

  it('con unidades en conflicto nunca presta la unidad de la línea como si fuera la del stock', () => {
    const noProductUnit = mismatchRow({ product_unit: null, inventory_item: { id: 5, unit: null } });
    expect(stockUnitOf(noProductUnit)).toBe('');
  });

  it('una unidad en blanco del catálogo se respeta (no se reemplaza por la de la línea)', () => {
    expect(stockUnitOf(row({ unit: 'UND', product_unit: '' }))).toBe('');
  });

  it('dice las dos unidades en la frase pedida', () => {
    expect(describeUnitMismatch(mismatchRow())).toBe('Unidad distinta: el stock está en EA y el RQ pide en CAJA.');
  });

  it('una unidad en blanco se dice con palabras, sin dejar un hueco', () => {
    expect(describeUnitMismatch(mismatchRow({ product_unit: '' }))).toBe(
      'Unidad distinta: el producto no tiene unidad definida y el RQ pide en CAJA.',
    );
    expect(describeUnitMismatch(mismatchRow({ unit: '' }))).toBe(
      'Unidad distinta: el stock está en EA y el RQ no indica unidad.',
    );
  });
});

describe('unidad distinta — no sugiere, no cubre, avisa', () => {
  it('NOT_COMPARABLE no sugiere ningún origen (no hay base) y no se confunde con "compra"', () => {
    expect(suggestSupply(mismatchRow())).toBeNull();
    expect(suggestSupply(row({ unit_mismatch: true, coverage: 'FULL' }))).toBeNull();
    expect(effectiveSupply(1, {}, indexAvailability([mismatchRow({ item_id: 1 })]))).toBeNull();
  });

  it('la elección explícita de logística sigue mandando', () => {
    const byItem = indexAvailability([mismatchRow({ item_id: 1 })]);
    expect(effectiveSupply(1, { 1: 'stock' }, byItem)).toBe('stock');
    expect(effectiveSupply(1, { 1: 'purchase' }, byItem)).toBe('purchase');
  });

  it('la insignia dice "Unidad distinta" en ámbar', () => {
    expect(describeCoverage('NOT_COMPARABLE', 'LINKED')).toEqual({ tone: 'amber', text: 'Unidad distinta' });
    expect(COVERAGE_META.NOT_COMPARABLE.label).toBe('Unidad distinta');
  });

  it('la frase de la cobertura genérica no afirma cobertura', () => {
    const sentence = describeCoverageSentence('NOT_COMPARABLE');
    expect(sentence).toMatch(/^Unidad distinta\. /);
    expect(sentence).not.toMatch(/suficiente|parcial|sin stock|cubre/i);
  });

  it('la brecha es "no verificable" (nunca "sin producto vinculado") y nombra las dos unidades', () => {
    expect(describeCoverageGap(mismatchRow())).toEqual({
      reason: 'NOT_COMPARABLE',
      text: 'Unidad distinta: el stock está en EA y el RQ pide en CAJA. No se pudo verificar la cobertura.',
    });
  });

  it('marcada para stock genera un aviso (nunca un bloqueo); marcada para compra no', () => {
    const lines = [{ id: 1, line_number: 1, description: 'Casco' }];
    const byItem = indexAvailability([mismatchRow({ item_id: 1 })]);
    const warnings = buildCoverageWarnings(lines, { 1: 'stock' }, byItem);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ itemId: 1, line: 1, reason: 'NOT_COMPARABLE' });
    expect(warnings[0].text).toContain('Unidad distinta: el stock está en EA y el RQ pide en CAJA.');
    expect(buildCoverageWarnings(lines, { 1: 'purchase' }, byItem)).toEqual([]);
    // Without an explicit choice nothing is "stock" by suggestion either: no warning.
    expect(buildCoverageWarnings(lines, {}, byItem)).toEqual([]);
  });

  it('el resumen del historial dice que no se verificó, no una cifra comparable', () => {
    expect(summarizeAvailability(mismatchRow())).toBe('unidad distinta: stock en EA, RQ en CAJA');
    expect(summarizeAvailability(mismatchRow({ product_unit: '' }))).toBe('unidad distinta: stock en sin unidad, RQ en CAJA');
    expect(summarizeAvailability(row({ available_net: '12.000' }))).toBe('disponible neto: 12');
    expect(summarizeAvailability(row({ available_net: null }))).toBe('sin datos de stock');
    expect(summarizeAvailability(undefined)).toBe('sin datos de stock');
  });
});

describe('describeNetBreakdown — cómo se llega al disponible neto', () => {
  it('sin descuentos no hay frase', () => {
    expect(describeNetBreakdown(row({ available_central: '10.000', available_net: '10.000' }))).toBe('');
    expect(describeNetBreakdown(row({ available_central: null, available_net: null }))).toBe('');
    expect(describeNetBreakdown(undefined)).toBe('');
  });

  it('solo otros RQ: la frase de siempre, con la unidad del producto', () => {
    const r = row({ unit: 'EA', product_unit: 'UND', available_central: '15.000', available_net: '12.000', committed_other_requests: '3.000', committed_earlier_lines: '0.000' });
    expect(describeNetBreakdown(r)).toBe('Hay 15 UND en el almacén central; el resto está comprometido con otros RQ.');
  });

  it('solo los ítems anteriores del mismo RQ: lo dice sin culpar a otros RQ', () => {
    const r = row({ available_central: '10.000', available_net: '2.000', committed_other_requests: '0.000', committed_earlier_lines: '8.000' });
    expect(describeNetBreakdown(r)).toBe('Hay 10 UND en el almacén central; los ítems anteriores de este RQ ya toman 8 UND.');
  });

  it('las dos causas: la resta cuadra a la vista', () => {
    const r = row({ available_central: '10.000', available_net: '1.000', committed_other_requests: '3.000', committed_earlier_lines: '6.000' });
    expect(describeNetBreakdown(r)).toBe(
      'Hay 10 UND en el almacén central; 3 UND están comprometidas con otros RQ y 6 UND las toman los ítems anteriores de este RQ.',
    );
  });

  it('una fila vieja (sin committed_earlier_lines) sigue funcionando', () => {
    const r = row({ available_central: '15.000', available_net: '12.000', committed_other_requests: '3.000' });
    delete r.committed_earlier_lines;
    expect(describeNetBreakdown(r)).toContain('el resto está comprometido con otros RQ');
  });
});

describe('409 de update-items: líneas ya recibidas o despachadas', () => {
  const http = (status, data = {}) => ({ response: { status, data } });
  const received = (ids, extra = {}) => http(409, {
    detail: 'Algunos ítems ya fueron recibidos en el almacén y no se puede cambiar su producto de catálogo ni marcarlos como fuera de catálogo.',
    code: 'ITEMS_ALREADY_RECEIVED', item_ids: ids, ...extra,
  });
  const lines = [
    { id: 101, line_number: 1 }, { id: 102, line_number: 2 }, { id: 103, line_number: 3 },
  ];

  it('reconoce ITEMS_ALREADY_RECEIVED y ITEMS_ALREADY_DISPATCHED con sus ítems', () => {
    expect(getLockedItems(received([102]))).toEqual({ reason: 'RECEIVED', itemIds: [102] });
    expect(getLockedItems(http(409, { code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101, 103] })))
      .toEqual({ reason: 'DISPATCHED', itemIds: [101, 103] });
  });

  it('no confunde otros 409, otros estados ni respuestas raras', () => {
    expect(getLockedItems(http(409, { code: 'REQUEST_TERMINAL', item_ids: [] }))).toBeNull();
    expect(getLockedItems(http(409, { code: 'items_already_received', item_ids: [1] }))).toBeNull();   // the code is compared literally
    expect(getLockedItems(http(400, { code: 'ITEMS_ALREADY_RECEIVED', item_ids: [1] }))).toBeNull();
    expect(getLockedItems(http(409, 'Gateway'))).toBeNull();
    expect(getLockedItems(http(409, { code: 'constructor' }))).toBeNull();
    expect(getLockedItems(new Error('Network Error'))).toBeNull();
    expect(getLockedItems(undefined)).toBeNull();
  });

  it('ids repetidos o que no son números se descartan; sin item_ids queda la lista vacía', () => {
    expect(getLockedItems(received([102, 102, '103', null]))).toEqual({ reason: 'RECEIVED', itemIds: [102] });
    expect(getLockedItems(received(undefined))).toEqual({ reason: 'RECEIVED', itemIds: [] });
  });

  it('lockedItemsFromError arma el mapa { id: motivo } para marcar las líneas', () => {
    expect(lockedItemsFromError(received([101, 103]))).toEqual({ 101: 'RECEIVED', 103: 'RECEIVED' });
    expect(lockedItemsFromError(http(409, { code: 'REQUEST_TERMINAL' }))).toEqual({});
    expect(lockedItemsFromError(http(500))).toEqual({});
  });

  it('el mensaje nombra el ítem (con el número que ve el usuario), no el id de base de datos', () => {
    expect(describeUpdateItemsError(received([102]), lines)).toBe(
      'El ítem 2 ya fue recibido en el almacén: no se puede cambiar su producto ni marcarlo como fuera de catálogo.',
    );
  });

  it('con varios ítems habla en plural, ordenados y sin repetir', () => {
    expect(describeUpdateItemsError(received([103, 101]), lines)).toBe(
      'Los ítems 1 y 3 ya fueron recibidos en el almacén: no se puede cambiar su producto ni marcarlos como fuera de catálogo.',
    );
    expect(describeUpdateItemsError(received([103, 101, 102]), lines)).toContain('Los ítems 1, 2 y 3 ya fueron recibidos');
  });

  it('si la línea no trae número usa su posición', () => {
    expect(describeUpdateItemsError(received([7]), [{ id: 6 }, { id: 7 }])).toMatch(/^El ítem 2 ya fue recibido/);
  });

  it('si no se sabe qué líneas son, muestra el detalle del servidor (o uno propio) sin romper', () => {
    expect(describeUpdateItemsError(received([999]), lines)).toBe(
      'Algunos ítems ya fueron recibidos en el almacén y no se puede cambiar su producto de catálogo ni marcarlos como fuera de catálogo.',
    );
    expect(describeUpdateItemsError(received([102], { detail: undefined }))).toMatch(/^Algunos ítems ya fueron recibidos/);
    expect(describeUpdateItemsError(received([]), lines)).toMatch(/^Algunos ítems ya fueron recibidos/);
  });

  it('el despacho conserva el detalle del servidor, como antes', () => {
    expect(describeUpdateItemsError(
      http(409, { detail: 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.', code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101] }),
      lines,
    )).toBe('Algunos ítems ya tienen despachos de almacén y no se pueden modificar.');
  });
});
