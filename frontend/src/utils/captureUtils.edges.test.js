import { describe, it, expect, vi } from 'vitest';
import { formatQty, parseQty } from './quantity';
import {
  applyProduct,
  buildItemsPayload,
  clearProduct,
  extractCreateErrorMessage,
  getItemResolution,
  isItemTouched,
  MSG_DESCRIBE_OFF_CATALOG,
  MSG_PICK_PRODUCT,
  MSG_PICK_SOURCE,
  newCaptureItem,
  setItemSource,
  setOffCatalog,
  validateCaptureItems,
} from './requestCapture';
import {
  buildCoverageWarnings,
  buildItemDecisions,
  describeCoverage,
  describeUpdateItemsError,
  findUpdateItemsProblem,
  indexAvailability,
} from './stockCheck';
import { describeItemLink, itemSourceLabel, proposeItemSource, requestingAreaLabel } from '../data/requestCapture';

// SYSPCC-026 (QA ronda 1) — borderline inputs of the pure logic behind the capture and stock-check screens.

const EPP = { id: 7, product_code: 'EPP-0007', description: 'Casco', unit: 'UND', category: 'EPP', available: '3.000' };
const OTROS = { id: 8, product_code: 'MAT-0008', description: 'Cemento', unit: 'BLS', category: 'Otros', available: '0.000' };

const resolved = (over = {}) => ({ ...applyProduct(newCaptureItem(), EPP), cantidad: '5', ...over });

describe('quantity — cifras que manda la API', () => {
  it.each([
    ['1,5', 1.5],            // decimal comma
    [' 12 ', 12],
    ['1e3', 1000],
    ['-3', -3],
    ['0', 0],
    [0, 0],
  ])('parseQty(%j) = %s', (input, expected) => {
    expect(parseQty(input)).toBe(expected);
  });

  it.each([['Infinity'], ['-Infinity'], ['NaN'], ['12abc'], [NaN], [Infinity], [true], [{}]])(
    'parseQty(%j) no es una cifra', (input) => {
      expect(parseQty(input)).toBeNull();
    },
  );

  it('formatQty devuelve el texto original cuando no es una cifra, en vez de ocultarlo', () => {
    expect(formatQty('abc')).toBe('abc');
    expect(formatQty('12abc')).toBe('12abc');
  });

  it('formatQty trata la coma decimal y los negativos', () => {
    expect(formatQty('1,5')).toBe('1.5');
    expect(formatQty('-2.000')).toBe('-2');
    expect(formatQty('-0.5')).toBe('-0.5');
  });

  it('formatQty de algo que no es cifra ni texto muestra un guion', () => {
    expect(formatQty(NaN)).toBe('—');
    expect(formatQty({})).toBe('—');
  });
});

describe('requestCapture — la línea', () => {
  // BUG (SYSPCC-026, found by QA): `newCaptureItem` builds the client key as `Date.now() + Math.random()`.
  // At today's epoch a double only keeps ~4096 distinct fractions per millisecond, and the form builds
  // its 5 initial rows in the same millisecond, so ~0.24 % of page loads (measured: 977 of 400000)
  // start with two rows that share an id. Then typing in one row fills its twin(s) and deleting one
  // deletes them all, and React logs "two children with the same key". The contract is "every new line
  // has its own key", whatever the clock and the random generator do (a counter or crypto.randomUUID()).
  it('cada línea nueva tiene su propia clave, aunque el reloj y el azar se repitan', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1761700000000);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const ids = Array.from({ length: 5 }, () => newCaptureItem().id);

    now.mockRestore();
    random.mockRestore();
    expect(new Set(ids).size).toBe(5);
  });

  it('una fuente sola ya cuenta como línea tocada, igual que el stock declarado o la cantidad en cero', () => {
    expect(isItemTouched(setItemSource(newCaptureItem(), 'EPP'))).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), stockAlmacenObra: 3 })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), xAtenderManual: true })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), cantidad: '0' })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), searchText: '   ' })).toBe(false);
  });

  it('"fuera de catálogo" con una descripción de sólo espacios no resuelve la línea', () => {
    expect(getItemResolution(setOffCatalog({ ...newCaptureItem(), descripcion: '   ' }, true))).toBeNull();
    expect(getItemResolution({ ...setOffCatalog(newCaptureItem(), true), descripcion: ' Flete ' })).toBe('OFF_CATALOG');
  });

  it('el modo manda: un producto guardado en una línea "fuera de catálogo" no la vincula', () => {
    const odd = { ...newCaptureItem(), mode: 'off_catalog', product: EPP, descripcion: '' };
    expect(getItemResolution(odd)).toBeNull();
  });

  it('un producto sin categoría no propone fuente', () => {
    expect(applyProduct(newCaptureItem(), { ...EPP, category: undefined }).itemSource).toBe('');
    expect(applyProduct(newCaptureItem(), { ...EPP, category: null }).itemSource).toBe('');
    expect(applyProduct(newCaptureItem(), OTROS).itemSourceProposed).toBe(false);
  });

  it('cambiar de producto conserva cantidad, comentarios y stock declarado', () => {
    const item = { ...resolved(), comentarios: 'urgente', stockAlmacenPrincipal: 4 };
    const changed = applyProduct(clearProduct(item), OTROS);
    expect(changed).toMatchObject({ cantidad: '5', comentarios: 'urgente', stockAlmacenPrincipal: 4, unidad: 'BLS' });
  });

  it('una fuente elegida a mano sobrevive a quitar el producto y a marcar fuera de catálogo', () => {
    const manual = setItemSource(resolved(), 'GASES');
    expect(clearProduct(manual).itemSource).toBe('GASES');
    expect(setOffCatalog(manual, true).itemSource).toBe('GASES');
  });
});

describe('requestCapture — validación de líneas', () => {
  it('una línea con dos problemas los reporta ambos, en orden, con su número de ítem', () => {
    const blank = [{ ...newCaptureItem(), cantidad: '3' }];

    const result = validateCaptureItems([{ ...newCaptureItem() }, ...blank]);

    expect(result.valid).toBe(false);
    expect(result.messages).toEqual([`Ítem 2: ${MSG_PICK_PRODUCT}`, `Ítem 2: ${MSG_PICK_SOURCE}`]);
    expect(result.byItem[blank[0].id]).toEqual({ product: MSG_PICK_PRODUCT, source: MSG_PICK_SOURCE });
  });

  it('una línea "fuera de catálogo" tocada pide describirla, no elegir producto', () => {
    const off = setItemSource(setOffCatalog(newCaptureItem(), true), 'UTILES');
    expect(validateCaptureItems([off]).byItem[off.id]).toEqual({ product: MSG_DESCRIBE_OFF_CATALOG });
  });

  it('con una línea buena y otra mala no basta con la buena', () => {
    const good = resolved({ itemSource: 'EPP' });
    const bad = { ...newCaptureItem(), searchText: 'cas' };

    const result = validateCaptureItems([good, bad]);

    expect(result.valid).toBe(false);
    expect(result.resolvedCount).toBe(1);
  });

  it('sin ninguna línea tocada no hay mensajes por línea, sólo el de agregar al menos una', () => {
    const result = validateCaptureItems([newCaptureItem(), newCaptureItem()]);
    expect(result.messages).toHaveLength(1);
    expect(result.byItem).toEqual({});
  });
});

describe('requestCapture — payload', () => {
  const calc = () => 0;

  it('una cantidad vacía, con texto o negativa sale como número, nunca como texto', () => {
    const lines = [
      resolved({ cantidad: '' }),
      resolved({ cantidad: 'abc' }),
      resolved({ cantidad: '2.5' }),
    ].map((l) => ({ ...l, itemSource: 'EPP' }));

    expect(buildItemsPayload(lines, calc).map((i) => i.quantity)).toEqual([0, 0, 2.5]);
  });

  it('no incluye nada de una línea sin resolver, ni siquiera su comentario', () => {
    const lines = [resolved({ itemSource: 'EPP' }), { ...newCaptureItem(), comentarios: 'sólo un comentario' }];

    const payload = buildItemsPayload(lines, calc);

    expect(payload).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain('sólo un comentario');
  });

  it('el x_atender lo calcula la pantalla y se envía como número', () => {
    const [item] = buildItemsPayload([resolved({ itemSource: 'EPP' })], () => '3.5');
    expect(item.x_atender).toBe(3.5);
  });

  it('la descripción fuera de catálogo viaja sin espacios sobrantes', () => {
    const off = { ...setItemSource(setOffCatalog(newCaptureItem(), true), 'UTILES'), descripcion: '  Flete  ' };
    expect(buildItemsPayload([off], calc)[0].description).toBe('Flete');
  });
});

describe('extractCreateErrorMessage — casos límite', () => {
  const err = (detail) => ({ response: { status: 400, data: { error: true, status_code: 400, detail } } });

  it('el RFI/FWO se nombra como en el formulario y un campo desconocido no muestra su clave', () => {
    expect(extractCreateErrorMessage(err({ items: [{ rfi_fwo: ['Demasiado largo.'] }] }), 'x'))
      .toBe('Ítem 1 (RFI/FWO): Demasiado largo.');
    expect(extractCreateErrorMessage(err({ items: [{ otro_campo: ['Demasiado largo.'] }] }), 'x'))
      .toBe('Ítem 1: Demasiado largo.');
  });

  it('con el campo conocido usa su nombre en español', () => {
    expect(extractCreateErrorMessage(err({ items: [{ quantity: ['Valor inválido.'] }] }), 'x'))
      .toBe('Ítem 1 (Cantidad): Valor inválido.');
    expect(extractCreateErrorMessage(err({ items: [{ inventory_item: ['No existe.'] }] }), 'x'))
      .toBe('Ítem 1 (Producto): No existe.');
  });

  it('un mensaje que no es texto se ignora y se sigue con el siguiente', () => {
    const e = err({ items: [{ quantity: [{ nested: 'x' }], item_source: ['Falta la fuente.'] }] });
    expect(extractCreateErrorMessage(e, 'x')).toBe('Ítem 1 (Fuente): Falta la fuente.');
  });

  it('si no hay ningún mensaje legible por línea cae al texto general o al de respaldo', () => {
    expect(extractCreateErrorMessage(err({ items: [{}, {}] }), 'respaldo')).toBe('respaldo');
  });

  it('el área tiene prioridad sobre los errores de línea', () => {
    const e = err({ requesting_area: ['Obligatorio.'], items: [{ item_source: ['Falta.'] }] });
    expect(extractCreateErrorMessage(e, 'x')).toBe('Área del RQ: Obligatorio.');
  });

  it('un mensaje de área que viene como texto simple también se nombra', () => {
    expect(extractCreateErrorMessage(err({ requesting_area: 'Elija un área.' }), 'x')).toBe('Área del RQ: Elija un área.');
  });

  it('sin respuesta del servidor usa el texto de respaldo', () => {
    expect(extractCreateErrorMessage(new Error('Network Error'), 'No se pudo guardar.')).toBeTruthy();
    expect(extractCreateErrorMessage(undefined, 'No se pudo guardar.')).toBe('No se pudo guardar.');
  });
});

describe('stockCheck — casos límite', () => {
  it('indexAvailability tolera null, undefined y filas repetidas (gana la última)', () => {
    expect(indexAvailability(null)).toEqual({});
    expect(indexAvailability(undefined)).toEqual({});
    expect(indexAvailability([{ item_id: 1, v: 'a' }, { item_id: 1, v: 'b' }])).toEqual({ 1: { item_id: 1, v: 'b' } });
  });

  it('buildCoverageWarnings numera por posición cuando el ítem no trae line_number', () => {
    const warnings = buildCoverageWarnings([{ id: 1, description: 'A' }, { id: 2, description: 'B' }], { 1: 'purchase', 2: 'stock' }, {});
    expect(warnings).toEqual([expect.objectContaining({ itemId: 2, line: 2, reason: 'UNKNOWN' })]);
  });

  it('buildItemDecisions: una fuente elegida gana sobre la del ítem y una vacía no se envía', () => {
    const items = [{ id: 1, item_source: 'EPP' }, { id: 2, item_source: '' }, { id: 3 }];
    const decisions = buildItemDecisions(items, { 1: 'stock', 2: 'purchase', 3: 'purchase' }, {}, { 1: 'GASES' });

    expect(decisions).toEqual([
      { item_id: 1, supply_source: 'STOCK', item_source: 'GASES' },
      { item_id: 2, supply_source: 'PURCHASE' },
      { item_id: 3, supply_source: 'PURCHASE' },
    ]);
  });

  it('findUpdateItemsProblem tolera respuestas sin cuerpo o con otra forma', () => {
    expect(findUpdateItemsProblem(undefined)).toBeNull();
    expect(findUpdateItemsProblem(null)).toBeNull();
    expect(findUpdateItemsProblem({ ignored_item_ids: 'x' })).toBeNull();
    expect(findUpdateItemsProblem({ ignored_item_ids: [] })).toBeNull();
  });

  it('describeUpdateItemsError: un 409 sin detalle usa el mensaje por defecto y un 400 con lista usa su texto', () => {
    expect(describeUpdateItemsError({ response: { status: 409, data: {} } }))
      .toBe('Los ítems no se pueden modificar porque el requerimiento cambió. Actualice la página.');
    expect(describeUpdateItemsError({ response: { status: 400, data: { detail: 'Hay ítems repetidos en los datos enviados.' } } }))
      .toBe('Hay ítems repetidos en los datos enviados.');
    expect(describeUpdateItemsError(undefined))
      .toBe('No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.');
  });

  it('describeCoverage: la cobertura manda sobre el estado del vínculo y el estado de carga sobre nada', () => {
    expect(describeCoverage('FULL', 'UNLINKED').text).toBe('Stock suficiente');
    expect(describeCoverage(null, 'LINKED', true).text).toBe('Consultando…');
    expect(describeCoverage(null, 'LINKED', false).text).toBe('Sin datos de stock');
    expect(describeCoverage(undefined, undefined, false).text).toBe('Sin datos de stock');
  });
});

describe('vocabulario de captura — casos límite', () => {
  it('proposeItemSource ignora mayúsculas y espacios, pero no inventa otras familias', () => {
    expect(proposeItemSource(' epp ')).toBe('EPP');
    expect(proposeItemSource('Epp')).toBe('EPP');
    expect(proposeItemSource('EPPS')).toBe('');
    expect(proposeItemSource(undefined)).toBe('');
    expect(proposeItemSource(5)).toBe('');
  });

  it('las etiquetas prefieren la que manda el backend y caen al vocabulario', () => {
    expect(requestingAreaLabel('QC', 'Calidad')).toBe('Calidad');
    expect(requestingAreaLabel('QC')).toBe('Control de Calidad (QC)');
    expect(requestingAreaLabel('zz')).toBe('Sin área');
    expect(requestingAreaLabel(undefined, undefined)).toBe('Sin área');
    expect(itemSourceLabel('GASES')).toBe('Gases');
    expect(itemSourceLabel('zz')).toBe('');
    expect(itemSourceLabel('zz', 'Otro')).toBe('Otro');
  });

  it('describeItemLink tolera una línea ausente y no mezcla estados', () => {
    expect(describeItemLink(undefined).kind).toBe('UNLINKED');
    expect(describeItemLink(null).kind).toBe('UNLINKED');
    expect(describeItemLink({ inventory_item: 0, is_off_catalog: false }).kind).toBe('UNLINKED');   // id 0 is "no link"
    expect(describeItemLink({ inventory_item: 3 })).toEqual({ kind: 'LINKED', label: 'Vinculado al catálogo' });
    expect(describeItemLink({ inventory_item: 3, inventory_item_code: 'EPP-1' }).label).toBe('Vinculado a EPP-1');
  });
});
