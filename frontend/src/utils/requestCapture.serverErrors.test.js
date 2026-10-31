import { describe, it, expect } from 'vitest';
import { extractCreateErrorMessage } from './requestCapture';

// SYSPCC-026 (QA ronda 2). What the backend REALLY answers to POST /requests/ after the
// round of corrections (messages copied from the serializer, in the custom exception
// handler envelope), and what the form must show for each one.

const FALLBACK = 'Error al guardar el requerimiento.';
const bad = (detail) => ({ response: { status: 400, data: { error: true, status_code: 400, detail } } });

describe('extractCreateErrorMessage — errores reales de la creación', () => {
  it('cantidad cero: nombra la línea y el campo con el mensaje del servidor', () => {
    const e = bad({ items: [{}, { quantity: ['La cantidad debe ser mayor que cero.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 2 (Cantidad): La cantidad debe ser mayor que cero.');
  });

  it('fuente faltante: nombra la fuente', () => {
    const e = bad({ items: [{ item_source: ['Este campo es obligatorio.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 1 (Fuente): Este campo es obligatorio.');
  });

  it('producto que ya no existe en el catálogo: nombra el producto', () => {
    const e = bad({ items: [{ inventory_item: ['Clave primaria "999" inválida - objeto no existe.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe(
      'Ítem 1 (Producto): Clave primaria "999" inválida - objeto no existe.',
    );
  });

  it('producto y fuera de catálogo a la vez: nombra el campo que sobra', () => {
    const e = bad({ items: [{ is_off_catalog: ['Un ítem vinculado a un producto del catálogo no puede marcarse como fuera de catálogo.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe(
      'Ítem 1 (Fuera de catálogo): Un ítem vinculado a un producto del catálogo no puede marcarse como fuera de catálogo.',
    );
  });

  it('con errores en varias líneas muestra la primera', () => {
    const e = bad({ items: [{}, { unit: ['Demasiado largo.'] }, { quantity: ['Inválida.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 2 (Unidad): Demasiado largo.');
  });

  it('el RFI/FWO se nombra como en el formulario, no con el identificador del código', () => {
    const e = bad({ items: [{ rfi_fwo: ['Máximo 50 caracteres.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 1 (RFI/FWO): Máximo 50 caracteres.');
  });

  it('un campo que la tabla no conoce nombra el ítem sin mostrar la clave del código', () => {
    const e = bad({ items: [{ campo_interno_nuevo: ['No es válido.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 1: No es válido.');
    const nonField = bad({ items: [{ non_field_errors: ['Línea duplicada.'] }] });
    expect(extractCreateErrorMessage(nonField, FALLBACK)).toBe('Ítem 1: Línea duplicada.');
  });

  it.each([
    ['stock_almacen_obra', 'Stock almacén obra'],
    ['stock_almacen_central', 'Stock almacén central'],
    ['x_atender', 'X atender'],
    ['presupuestado_adicional', 'P/A'],
    ['comentarios', 'Comentarios'],
    ['line_number', 'Número de ítem'],
  ])('el campo %s se nombra "%s"', (field, label) => {
    const e = bad({ items: [{ [field]: ['Valor no válido.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe(`Ítem 1 (${label}): Valor no válido.`);
  });

  it('un campo con el nombre de una propiedad del prototipo no revienta ni se muestra como etiqueta', () => {
    const e = bad({ items: [{ constructor: ['Valor no válido.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 1: Valor no válido.');
  });

  it('con las filas del formulario, el número del ítem es el de la fila y no la posición en lo enviado', () => {
    // Form: row 1 blank, row 2 resolved (position 0 in the payload), row 3 blank, row 4 resolved (position 1).
    const e = bad({ items: [{}, { quantity: ['Valor no válido.'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK, [2, 4])).toBe('Ítem 4 (Cantidad): Valor no válido.');
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Ítem 2 (Cantidad): Valor no válido.');   // without the map: the position
  });

  it('el área tiene prioridad sobre los errores de línea', () => {
    const e = bad({ requesting_area: ['Este campo es obligatorio.'], items: [{ quantity: ['x'] }] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Área del RQ: Este campo es obligatorio.');
  });

  it('colisión de número de RQ: muestra el texto del servidor', () => {
    const e = bad({ rq_number: 'No se pudo generar el número de requerimiento, intente nuevamente.' });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe(
      'No se pudo generar el número de requerimiento, intente nuevamente.',
    );
  });

  it('el flujo exige proyecto o departamento: muestra el texto del servidor', () => {
    expect(extractCreateErrorMessage(bad({ project: 'El flujo Operaciones requiere un proyecto.' }), FALLBACK))
      .toBe('El flujo Operaciones requiere un proyecto.');
    expect(extractCreateErrorMessage(bad({ department: ['El flujo Administración requiere un departamento.'] }), FALLBACK))
      .toBe('El flujo Administración requiere un departamento.');
  });
});

describe('extractCreateErrorMessage — el tope y el mínimo de líneas (error de la lista, no de una línea)', () => {
  // DRF reports a list-level error under `non_field_errors`, not as an array of line errors.
  // The backend now caps a request at 200 lines and refuses an empty one.
  it('más de 200 líneas: explica el tope en vez del mensaje genérico', () => {
    const e = bad({ items: { non_field_errors: ['Un requerimiento admite como máximo 200 ítems.'] } });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Un requerimiento admite como máximo 200 ítems.');
  });

  it('sin líneas: explica que falta al menos una', () => {
    const e = bad({ items: { non_field_errors: ['Agregue al menos un ítem al requerimiento.'] } });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Agregue al menos un ítem al requerimiento.');
  });

  it('el mismo error como lista de textos (otra forma que DRF puede usar) también se entiende', () => {
    const e = bad({ items: ['Un requerimiento admite como máximo 200 ítems.'] });
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Un requerimiento admite como máximo 200 ítems.');
  });
});

describe('extractCreateErrorMessage — respuestas que no son de validación', () => {
  it('un 413 o un 502 del proxy no se muestra como un trozo de HTML', () => {
    const e = { response: { status: 413, data: '<html><head><title>413 Request Entity Too Large</title></head></html>' } };
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe(FALLBACK);
  });

  it('un 429 muestra el texto del limitador', () => {
    const e = { response: { status: 429, data: { detail: 'Demasiadas solicitudes. Intente más tarde.' } } };
    expect(extractCreateErrorMessage(e, FALLBACK)).toBe('Demasiadas solicitudes. Intente más tarde.');
  });

  it('sin respuesta (red caída) usa el respaldo', () => {
    expect(extractCreateErrorMessage(new Error('Network Error'), FALLBACK)).toBe(FALLBACK);
  });
});
