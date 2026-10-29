import { describe, it, expect } from 'vitest';
import {
  MIN_FORM_ROWS,
  countUnresolvedTouched,
  extractSubmitErrorMessages,
  itemsFromDraft,
  newCaptureItem,
  setOffCatalog,
  validateCaptureItems,
} from './requestCapture';

// SYSPCC-031 — helpers of the drafts.

const LINKED = {
  id: 1, description: 'Casco', quantity: '5.000', unit: 'UND', inventory_item: 501,
  inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco',
  inventory_item_unit: 'UND', is_off_catalog: false, item_source: 'EPP',
  stock_almacen_obra: '1.000', stock_almacen_central: '2.000', presupuestado_adicional: 'A',
  rfi_fwo: 'RFI-9', comentarios: 'urgente',
};
const OFF = {
  id: 2, description: 'Servicio', quantity: '0.000', unit: 'GLB', inventory_item: null,
  inventory_item_code: null, is_off_catalog: true, item_source: 'EQUIPOS',
};

describe('itemsFromDraft', () => {
  it('reconstruye la línea con producto del catálogo, fuente y datos opcionales', () => {
    const [linked] = itemsFromDraft([LINKED]);

    expect(linked).toMatchObject({
      mode: 'catalog', cantidad: '5', unidad: 'UND', itemSource: 'EPP', itemSourceProposed: false,
      stockAlmacenObra: 1, stockAlmacenPrincipal: 2, presupuestadoAdicional: 'A', rfiFwo: 'RFI-9', comentarios: 'urgente',
    });
    expect(linked.product).toMatchObject({ id: 501, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' });
  });

  it('un ítem fuera de catálogo vuelve como tal y la cantidad 0 vuelve vacía', () => {
    const [, off] = itemsFromDraft([LINKED, OFF]);

    expect(off).toMatchObject({ mode: 'off_catalog', product: null, descripcion: 'Servicio', cantidad: '', unidad: 'GLB' });
  });

  it('rellena con filas vacías hasta el mínimo del formulario y cada fila tiene su propia clave', () => {
    const rows = itemsFromDraft([LINKED]);

    expect(rows).toHaveLength(MIN_FORM_ROWS);
    expect(new Set(rows.map((r) => r.id)).size).toBe(MIN_FORM_ROWS);
  });

  it('un borrador cargado se valida como cualquier formulario: la cantidad 0 sigue pendiente', () => {
    const result = validateCaptureItems(itemsFromDraft([LINKED, OFF]));

    expect(result.valid).toBe(false);
    expect(result.messages).toEqual(['Ítem 2: Ingrese la cantidad (mayor que 0).']);
  });
});

describe('countUnresolvedTouched', () => {
  it('cuenta las líneas tocadas que no tienen producto ni descripción fuera de catálogo', () => {
    const untouched = newCaptureItem();
    const half = { ...newCaptureItem(), cantidad: '4' };
    const offEmpty = setOffCatalog(newCaptureItem(), true);
    const resolved = { ...setOffCatalog(newCaptureItem(), true), descripcion: 'Papel' };

    expect(countUnresolvedTouched([untouched, half, offEmpty, resolved])).toBe(2);
  });
});

describe('extractSubmitErrorMessages', () => {
  it('aplana todos los mensajes del 400 del envío, en el orden del servidor', () => {
    const err = {
      response: {
        status: 400,
        data: { error: true, detail: { service: ['Seleccione un servicio.'], items: ['Ítem 1: A.', 'Ítem 2: B.'] } },
      },
    };

    expect(extractSubmitErrorMessages(err, 'x')).toEqual(['Seleccione un servicio.', 'Ítem 1: A.', 'Ítem 2: B.']);
  });

  it('usa el mensaje de la respuesta cuando no hay campos, y el de respaldo si no hay respuesta', () => {
    expect(extractSubmitErrorMessages({ response: { status: 400, data: { detail: 'No.' } } }, 'x')).toEqual(['No.']);
    expect(extractSubmitErrorMessages(new Error('red'), 'No se pudo enviar.')).toEqual(['No se pudo enviar.']);
  });
});
