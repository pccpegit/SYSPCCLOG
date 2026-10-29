import { extractCodedDetail, extractErrorMessage } from './apiErrors';

// SYSPCC-026 — messages for the errors of the warehouse catalog that the user can act on.
//
// DELETE /warehouse/inventory/{id}/ answers 409 `{ error, status_code, detail, code }` with:
//   - `item_has_movements`: the product has movement history (it must survive);
//   - `item_linked_to_requests`: request lines (RQ) still point at the product, and deleting it
//     would silently detach them.
// The codes are lowercase (warehouse convention). The server's `detail` is already Spanish;
// the texts below are the fallback when it is missing, and the 4xx/5xx cases get an action.

export const INVENTORY_DELETE_CODES = {
  HAS_MOVEMENTS: 'item_has_movements',
  LINKED_TO_REQUESTS: 'item_linked_to_requests',
};

const LINKED_FALLBACK =
  'El producto está vinculado a líneas de requerimientos y no se puede eliminar. Desvincúlelo primero o déjelo sin stock.';
const MOVEMENTS_FALLBACK = 'El producto tiene historial de movimientos y no se puede eliminar.';

/** @returns {string} Spanish, action-oriented message for a failed product delete. */
export function describeInventoryDeleteError(err) {
  const status = err?.response?.status;
  if (!err?.response) {
    return 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.';
  }
  if (status === 409) {
    const code = err.response.data?.code;
    if (code === INVENTORY_DELETE_CODES.LINKED_TO_REQUESTS) return extractCodedDetail(err, LINKED_FALLBACK);
    if (code === INVENTORY_DELETE_CODES.HAS_MOVEMENTS) return extractCodedDetail(err, MOVEMENTS_FALLBACK);
    return extractCodedDetail(err, 'No se puede eliminar el producto porque otros registros dependen de él.');
  }
  if (status === 403) return 'No tiene permiso para eliminar productos del catálogo.';
  if (status === 404) return 'El producto ya no existe. Actualice la página.';
  if (status === 429) return 'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.';
  return extractErrorMessage(err, 'No se pudo eliminar el producto. Intente nuevamente.');
}
