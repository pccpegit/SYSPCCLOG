import client from './client';

// SYSPCC-030 — Master de RQ: seguimiento por ítem de todos los RQs que el usuario puede ver.
// Los filtros son los mismos en los tres endpoints (ver utils/requestMaster.js -> buildApiParams).

/**
 * GET /request-master/ — una fila por ítem de RQ, paginado `{ count, next, previous, results }`.
 * Filtros: project, department, requested_by, request, flow, area, source, item_status, tracking,
 * alert, stage, status, approved_from/to, attended_from/to, with_shortage, with_alerts, search,
 * ordering, page, page_size (≤100). Filtro inválido -> 400.
 */
export const getRequestMaster = (params) =>
  client.get('/request-master/', { params });

/** GET /request-master/summary/ — una fila por RQ más `kpis` del conjunto filtrado completo. */
export const getRequestMasterSummary = (params) =>
  client.get('/request-master/summary/', { params });

/**
 * GET /request-master/export/ — libro .xlsx con los mismos filtros. Cabeceras: `Content-Disposition`
 * (nombre) y `X-Export-Truncated: true|false`. Limitado a 10 descargas por minuto (429).
 */
export const exportRequestMaster = (params) =>
  client.get('/request-master/export/', { params, responseType: 'blob' });

/**
 * POST /requests/{id}/items/{itemId}/attention-override/ — fija o quita el seguimiento manual.
 * `data`: `{ override: 'STAND_BY' | 'DESESTIMADO' | '' | null, note }` (note obligatoria al fijar, ≤300).
 * 200 -> `{ detail, changed, item }`; 409 `REQUEST_TERMINAL`; 403; 400.
 */
export const setItemAttentionOverride = (requestId, itemId, data) =>
  client.post(`/requests/${requestId}/items/${itemId}/attention-override/`, data);
