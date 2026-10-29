import { describe, it, expect } from 'vitest';
import {
  applyProduct,
  buildItemsPayload,
  clearProduct,
  extractCreateErrorMessage,
  getItemResolution,
  hasValidQuantity,
  isItemTouched,
  MSG_DESCRIBE_OFF_CATALOG,
  MSG_NO_ITEMS,
  MSG_PICK_PRODUCT,
  MSG_PICK_SOURCE,
  MSG_QUANTITY,
  newCaptureItem,
  payloadRowNumbers,
  setItemSource,
  setOffCatalog,
  validateCaptureItems,
} from './requestCapture';

const CASCO = {
  id: 501, product_code: 'EPP-0001', description: 'Casco de seguridad', unit: 'UND',
  category: 'EPP', available: '12.000',
};
const CEMENTO = {
  id: 502, product_code: 'MAT-0100', description: 'Cemento Portland', unit: 'BOLSA',
  category: 'Otros', available: '0.000',
};

const calcX = (item) => Math.max(0, (parseFloat(item.cantidad) || 0) - (Number(item.stockAlmacenObra) || 0));

describe('estado de cada línea', () => {
  it('una línea nueva está vacía y sin tocar', () => {
    const item = newCaptureItem();
    expect(getItemResolution(item)).toBeNull();
    expect(isItemTouched(item)).toBe(false);
  });

  it('elegir un producto la resuelve como vinculada y copia descripción y unidad', () => {
    const item = applyProduct(newCaptureItem(), CEMENTO);
    expect(getItemResolution(item)).toBe('LINKED');
    expect(item.descripcion).toBe('Cemento Portland');
    expect(item.unidad).toBe('BOLSA');
    expect(item.searchText).toBe('');
  });

  it('"fuera de catálogo" sólo resuelve cuando tiene descripción', () => {
    let item = setOffCatalog(newCaptureItem(), true);
    expect(getItemResolution(item)).toBeNull();
    expect(isItemTouched(item)).toBe(true); // marcarla ya es una intención
    item = { ...item, descripcion: 'Servicio de topografía' };
    expect(getItemResolution(item)).toBe('OFF_CATALOG');
    item = { ...item, descripcion: '   ' };
    expect(getItemResolution(item)).toBeNull();
  });

  it('texto escrito en el buscador sin elegir cuenta como línea tocada (no se descarta en silencio)', () => {
    const item = { ...newCaptureItem(), searchText: 'cas' };
    expect(isItemTouched(item)).toBe(true);
    expect(getItemResolution(item)).toBeNull();
  });

  it('cantidad, comentarios, RFI o stock declarado también cuentan como tocada', () => {
    expect(isItemTouched({ ...newCaptureItem(), cantidad: '5' })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), comentarios: 'urgente' })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), rfiFwo: 'RFI-1' })).toBe(true);
    expect(isItemTouched({ ...newCaptureItem(), stockAlmacenObra: 3 })).toBe(true);
  });

  it('quitar el producto o marcar fuera de catálogo suelta el vínculo anterior', () => {
    const linked = applyProduct(newCaptureItem(), CASCO);
    const cleared = clearProduct(linked);
    expect(cleared.product).toBeNull();
    expect(cleared.descripcion).toBe('');
    expect(cleared.unidad).toBe('UND');

    const off = setOffCatalog(linked, true);
    expect(off.product).toBeNull();
    expect(off.mode).toBe('off_catalog');
    expect(setOffCatalog(off, false).mode).toBe('catalog');
  });
});

describe('Fuente propuesta por la categoría', () => {
  it('un producto EPP propone EPP', () => {
    const item = applyProduct(newCaptureItem(), CASCO);
    expect(item.itemSource).toBe('EPP');
    expect(item.itemSourceProposed).toBe(true);
  });

  it('una categoría que no es EPP no propone nada', () => {
    const item = applyProduct(newCaptureItem(), CEMENTO);
    expect(item.itemSource).toBe('');
    expect(item.itemSourceProposed).toBe(false);
  });

  it('una propuesta sigue al producto: al cambiar a uno no-EPP se retira', () => {
    const item = applyProduct(applyProduct(newCaptureItem(), CASCO), CEMENTO);
    expect(item.itemSource).toBe('');
  });

  it('una fuente elegida a mano gana siempre', () => {
    let item = applyProduct(newCaptureItem(), CASCO);
    item = setItemSource(item, 'CONSUMIBLES');
    expect(item.itemSourceProposed).toBe(false);
    expect(applyProduct(item, CASCO).itemSource).toBe('CONSUMIBLES');
    expect(clearProduct(item).itemSource).toBe('CONSUMIBLES');
  });

  it('al quitar el producto se retira la fuente que sólo estaba propuesta', () => {
    const cleared = clearProduct(applyProduct(newCaptureItem(), CASCO));
    expect(cleared.itemSource).toBe('');
    expect(isItemTouched(cleared)).toBe(false);
  });
});

describe('validateCaptureItems', () => {
  // A resolved line also needs a quantity: `linked()` is a complete, valid line.
  const linked = (source = 'EPP', cantidad = '2') => ({
    ...setItemSource(applyProduct(newCaptureItem(), CASCO), source),
    cantidad,
  });

  it('acepta líneas resueltas con fuente y cantidad e ignora las vacías', () => {
    const result = validateCaptureItems([linked(), newCaptureItem(), newCaptureItem()]);
    expect(result).toMatchObject({ valid: true, resolvedCount: 1, messages: [], issues: [] });
  });

  it('sin ninguna línea pide agregar al menos una', () => {
    const result = validateCaptureItems([newCaptureItem(), newCaptureItem()]);
    expect(result.valid).toBe(false);
    expect(result.messages).toEqual([MSG_NO_ITEMS]);
  });

  it('una línea tocada sin producto ni fuera de catálogo indica cuál es', () => {
    const blank = newCaptureItem();
    const touched = { ...newCaptureItem(), cantidad: '4' };
    const result = validateCaptureItems([linked(), blank, touched]);
    expect(result.valid).toBe(false);
    expect(result.byItem[touched.id].product).toBe(MSG_PICK_PRODUCT);
    expect(result.byItem[touched.id].source).toBe(MSG_PICK_SOURCE);
    expect(result.byItem[blank.id]).toBeUndefined();
    expect(result.messages).toContain(`Ítem 3: ${MSG_PICK_PRODUCT}`);
    expect(result.messages).toContain(`Ítem 3: ${MSG_PICK_SOURCE}`);
  });

  it('fuera de catálogo sin descripción pide describirlo', () => {
    const off = { ...setOffCatalog(newCaptureItem(), true), itemSource: 'EQUIPOS' };
    const result = validateCaptureItems([linked(), off]);
    expect(result.byItem[off.id]).toEqual({ product: MSG_DESCRIBE_OFF_CATALOG });
  });

  it('una línea resuelta sin fuente falla sólo por la fuente', () => {
    const noSource = { ...applyProduct(newCaptureItem(), CEMENTO), cantidad: '3' }; // no-EPP: sin propuesta
    const result = validateCaptureItems([noSource]);
    expect(result.valid).toBe(false);
    expect(result.byItem[noSource.id]).toEqual({ source: MSG_PICK_SOURCE });
  });

  describe('cantidad', () => {
    it.each([
      ['en blanco', ''],
      ['cero', '0'],
      ['negativa', '-2'],
      ['no numérica', 'abc'],
      ['sólo espacios', '   '],
    ])('una línea resuelta con la cantidad %s no pasa', (_label, cantidad) => {
      const item = linked('EPP', cantidad);
      const result = validateCaptureItems([item]);
      expect(result.valid).toBe(false);
      expect(result.byItem[item.id]).toEqual({ quantity: MSG_QUANTITY });
      expect(result.messages).toEqual([`Ítem 1: ${MSG_QUANTITY}`]);
    });

    it.each(['1', '0.001', '2.5', '1000', ' 4 '])('la cantidad %s es válida', (cantidad) => {
      expect(hasValidQuantity({ cantidad })).toBe(true);
      expect(validateCaptureItems([linked('EPP', cantidad)]).valid).toBe(true);
    });

    it('un ítem fuera de catálogo también necesita cantidad', () => {
      const off = { ...setOffCatalog(newCaptureItem(), true), descripcion: 'Flete', itemSource: 'EQUIPOS' };
      expect(validateCaptureItems([off]).byItem[off.id]).toEqual({ quantity: MSG_QUANTITY });
      expect(validateCaptureItems([{ ...off, cantidad: '1' }]).valid).toBe(true);
    });

    it('una línea sin resolver no suma el aviso de cantidad: primero se corrige el producto', () => {
      const touched = { ...newCaptureItem(), searchText: 'cas', itemSource: 'EPP' };
      expect(validateCaptureItems([touched]).byItem[touched.id]).toEqual({ product: MSG_PICK_PRODUCT });
    });

    it('lista todos los problemas de una línea en el orden de la fila: producto, cantidad, fuente', () => {
      const bad = { ...applyProduct(newCaptureItem(), CEMENTO), cantidad: '0' };
      expect(validateCaptureItems([bad]).messages).toEqual([
        `Ítem 1: ${MSG_QUANTITY}`,
        `Ítem 1: ${MSG_PICK_SOURCE}`,
      ]);
    });
  });

  describe('issues (cada mensaje con su línea y campo, para enlazarlo al control)', () => {
    it('describe línea, campo y mensaje', () => {
      const blankQty = linked('EPP', '');
      const touched = { ...newCaptureItem(), cantidad: '4' };
      const { issues } = validateCaptureItems([blankQty, touched]);
      expect(issues).toEqual([
        { itemId: blankQty.id, field: 'quantity', message: `Ítem 1: ${MSG_QUANTITY}` },
        { itemId: touched.id, field: 'product', message: `Ítem 2: ${MSG_PICK_PRODUCT}` },
        { itemId: touched.id, field: 'source', message: `Ítem 2: ${MSG_PICK_SOURCE}` },
      ]);
    });

    it('sin ninguna línea el aviso no pertenece a una línea', () => {
      expect(validateCaptureItems([newCaptureItem()]).issues).toEqual([
        { itemId: null, field: null, message: MSG_NO_ITEMS },
      ]);
    });
  });
});

describe('newCaptureItem — clave de la línea', () => {
  it('cada línea tiene su propia clave aunque se creen todas en el mismo instante', () => {
    const ids = Array.from({ length: 200 }, () => newCaptureItem().id);
    expect(new Set(ids).size).toBe(200);
  });

  it('la clave es texto y sirve tal cual para armar ids de DOM', () => {
    const { id } = newCaptureItem();
    expect(typeof id).toBe('string');
    expect(`item-${id}-search`).toMatch(/^item-[\w-]+-search$/);
  });
});

describe('buildItemsPayload', () => {
  it('un producto del catálogo envía inventory_item y toma descripción y unidad del producto', () => {
    const item = { ...setItemSource(applyProduct(newCaptureItem(), CASCO), 'EPP'), cantidad: '10', stockAlmacenObra: 4, stockAlmacenPrincipal: 2 };
    const [line] = buildItemsPayload([item], calcX);
    expect(line).toMatchObject({
      line_number: 1,
      description: 'Casco de seguridad',
      unit: 'UND',
      quantity: 10,
      stock_almacen_obra: 4,
      stock_almacen_central: 2,
      x_atender: 6,
      item_source: 'EPP',
      inventory_item: 501,
    });
    expect(line).not.toHaveProperty('is_off_catalog');
  });

  it('un ítem fuera de catálogo envía is_off_catalog y la descripción tipeada, sin inventory_item', () => {
    const item = {
      ...setOffCatalog(newCaptureItem(), true),
      descripcion: '  Servicio de topografía ',
      unidad: 'GLB',
      itemSource: 'EQUIPOS',
    };
    const [line] = buildItemsPayload([item], calcX);
    expect(line).toMatchObject({
      description: 'Servicio de topografía',
      unit: 'GLB',
      is_off_catalog: true,
      item_source: 'EQUIPOS',
    });
    expect(line).not.toHaveProperty('inventory_item');
  });

  it('numera sólo las líneas resueltas, nunca envía supply_source y usa stock_almacen_central', () => {
    const a = setItemSource(applyProduct(newCaptureItem(), CASCO), 'EPP');
    const b = { ...setOffCatalog(newCaptureItem(), true), descripcion: 'Flete', itemSource: 'MATERIALES' };
    const lines = buildItemsPayload([newCaptureItem(), a, newCaptureItem(), b], calcX);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2]);
    lines.forEach((l) => {
      expect(l).not.toHaveProperty('supply_source');
      expect(l).not.toHaveProperty('stock_almacen_principal');
      expect(l).toHaveProperty('stock_almacen_central');
    });
  });

  it('una línea con producto Y fuera de catálogo no puede salir: el modo las excluye', () => {
    // applyProduct fija mode='catalog'; setOffCatalog descarta el producto.
    const off = setOffCatalog(applyProduct(newCaptureItem(), CASCO), true);
    expect(off.product).toBeNull();
    const back = applyProduct(off, CEMENTO);
    expect(back.mode).toBe('catalog');
    const [line] = buildItemsPayload([setItemSource(back, 'MATERIALES')], calcX);
    expect(line.inventory_item).toBe(502);
    expect(line).not.toHaveProperty('is_off_catalog');
  });
});

describe('extractCreateErrorMessage', () => {
  const err = (detail) => ({ response: { status: 400, data: { error: true, status_code: 400, detail } } });

  it('nombra la línea y el campo de un 400 en items', () => {
    const e = err({ items: [{}, { item_source: ['Este campo no puede estar en blanco.'] }] });
    expect(extractCreateErrorMessage(e, 'x')).toBe('Ítem 2 (Fuente): Este campo no puede estar en blanco.');
  });

  it('nombra el área del RQ', () => {
    expect(extractCreateErrorMessage(err({ requesting_area: ['Este campo es obligatorio.'] }), 'x'))
      .toBe('Área del RQ: Este campo es obligatorio.');
  });

  it('un mensaje de texto en items se muestra tal cual', () => {
    expect(extractCreateErrorMessage(err({ items: ['Debe incluir al menos un ítem.'] }), 'x'))
      .toBe('Debe incluir al menos un ítem.');
  });

  it('en cualquier otro caso usa el extractor genérico o el texto de respaldo', () => {
    expect(extractCreateErrorMessage(err('Algo salió mal.'), 'x')).toBe('Algo salió mal.');
    expect(extractCreateErrorMessage({}, 'respaldo')).toBe('respaldo');
  });
});

describe('payloadRowNumbers', () => {
  const resolved = (product) => applyProduct(newCaptureItem(), product);

  it('devuelve el número de fila del formulario de cada línea que viaja, saltando las filas en blanco', () => {
    const items = [newCaptureItem(), resolved(CASCO), newCaptureItem(), resolved(CEMENTO), newCaptureItem()];
    expect(payloadRowNumbers(items)).toEqual([2, 4]);
    // Same lines, same order as the payload.
    expect(buildItemsPayload(items.map((it) => ({ ...it, cantidad: '1' })), calcX)).toHaveLength(2);
  });

  it('una fila sin producto ni descripción fuera de catálogo no cuenta aunque se haya tocado', () => {
    const touched = { ...newCaptureItem(), cantidad: '3' };
    expect(payloadRowNumbers([touched, resolved(CASCO)])).toEqual([2]);
  });

  it('sin líneas resueltas no hay filas', () => {
    expect(payloadRowNumbers([newCaptureItem(), newCaptureItem()])).toEqual([]);
    expect(payloadRowNumbers([])).toEqual([]);
  });
});
