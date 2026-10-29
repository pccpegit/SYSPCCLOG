import { describe, it, expect } from 'vitest';
import { describeInventoryDeleteError, INVENTORY_DELETE_CODES } from './almacenErrors';

// SYSPCC-026 — DELETE /warehouse/inventory/{id}/ answers 409 with a `code` the user can act on.
// The backend wraps it as { error, status_code, detail, code }.
const http = (status, data = {}) => ({ response: { status, data } });
const conflict = (code, detail) => http(409, { error: true, status_code: 409, detail, code });

describe('describeInventoryDeleteError', () => {
  it('item_linked_to_requests muestra el detalle del servidor tal cual (ya viene en español)', () => {
    const detail = 'El ítem está vinculado a líneas de requerimientos y no se puede eliminar. Desvincúlelo primero o déjelo sin stock.';
    expect(describeInventoryDeleteError(conflict('item_linked_to_requests', detail))).toBe(detail);
  });

  it('item_linked_to_requests sin detalle usa un texto propio que explica qué hacer', () => {
    const msg = describeInventoryDeleteError(conflict('item_linked_to_requests'));
    expect(msg).toMatch(/vinculado a líneas de requerimientos/);
    expect(msg).toMatch(/Desvincúlelo primero o déjelo sin stock/);
  });

  it('item_has_movements sigue funcionando: detalle del servidor o texto propio', () => {
    expect(describeInventoryDeleteError(conflict('item_has_movements', 'El ítem tiene historial de movimientos y no se puede eliminar.')))
      .toBe('El ítem tiene historial de movimientos y no se puede eliminar.');
    expect(describeInventoryDeleteError(conflict('item_has_movements'))).toBe('El producto tiene historial de movimientos y no se puede eliminar.');
  });

  it('un 409 con otro código no deja la pantalla sin explicación', () => {
    expect(describeInventoryDeleteError(http(409, { detail: 'Conflicto raro.' }))).toBe('Conflicto raro.');
    expect(describeInventoryDeleteError(http(409, {}))).toBe('No se puede eliminar el producto porque otros registros dependen de él.');
  });

  it('403, 404 y 429 tienen su acción', () => {
    expect(describeInventoryDeleteError(http(403))).toMatch(/No tiene permiso para eliminar/);
    expect(describeInventoryDeleteError(http(404))).toMatch(/ya no existe/);
    expect(describeInventoryDeleteError(http(429))).toMatch(/Demasiadas solicitudes/);
  });

  it('sin respuesta habla de conexión y un 500 (o un HTML del proxy) no se muestra crudo', () => {
    expect(describeInventoryDeleteError(new Error('Network Error'))).toMatch(/No se pudo conectar/);
    expect(describeInventoryDeleteError(http(500))).toBe('No se pudo eliminar el producto. Intente nuevamente.');
    expect(describeInventoryDeleteError(http(502, '<html>Bad Gateway</html>'))).toBe('No se pudo eliminar el producto. Intente nuevamente.');
    expect(describeInventoryDeleteError(undefined)).toMatch(/No se pudo conectar/);
  });

  it('los códigos se comparan literalmente en minúsculas (convención del almacén)', () => {
    expect(INVENTORY_DELETE_CODES).toEqual({ HAS_MOVEMENTS: 'item_has_movements', LINKED_TO_REQUESTS: 'item_linked_to_requests' });
    // An uppercase variant is NOT the almacén code: it falls into the generic 409 text.
    expect(describeInventoryDeleteError(http(409, { code: 'ITEM_LINKED_TO_REQUESTS' }))).toMatch(/otros registros dependen/);
  });
});
