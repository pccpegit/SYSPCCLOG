import client from './client';

// ── Inventory ─────────────────────────────────────────────────────────────────

/** GET /warehouse/inventory/ — list items with stock levels */
export const getInventory = (params) =>
  client.get('/warehouse/inventory/', { params });

/** GET /warehouse/inventory/{id}/ — single item detail */
export const getInventoryItem = (id) =>
  client.get(`/warehouse/inventory/${id}/`);

/** POST /warehouse/inventory/ — create new item */
export const createInventoryItem = (data) =>
  client.post('/warehouse/inventory/', data);

/** PUT /warehouse/inventory/{id}/ — update item */
export const updateInventoryItem = (id, data) =>
  client.put(`/warehouse/inventory/${id}/`, data);

/** PATCH /warehouse/inventory/{id}/ — partial update (SYSPCC-025: observation, OC, packing list...) */
export const patchInventoryItem = (id, data) =>
  client.patch(`/warehouse/inventory/${id}/`, data);

/**
 * DELETE /warehouse/inventory/{id}/ — remove a product from the catalog.
 * 204 on success. 409 `item_has_movements` (it has movement history) or `item_linked_to_requests`
 * (request lines still point at it): both carry a Spanish `detail`; see `describeInventoryDeleteError`
 * in utils/almacenErrors.js for the message to show.
 */
export const deleteInventoryItem = (id) =>
  client.delete(`/warehouse/inventory/${id}/`);

/** GET /warehouse/inventory/{id}/kardex/ — movement history for one item */
export const getKardex = (id, params) =>
  client.get(`/warehouse/inventory/${id}/kardex/`, { params });

/** GET /warehouse/inventory/categories/ — distinct category list */
export const getCategories = () =>
  client.get('/warehouse/inventory/categories/');

/** GET /warehouse/inventory/alerts/ — low-stock alerts */
export const getAlerts = () =>
  client.get('/warehouse/inventory/alerts/');

/** GET /warehouse/inventory/summary/ — dashboard KPIs */
export const getSummary = () =>
  client.get('/warehouse/inventory/summary/');

// ── Movements ─────────────────────────────────────────────────────────────────

/** GET /warehouse/movements/ — list all movements */
export const getMovements = (params) =>
  client.get('/warehouse/movements/', { params });

/** POST /warehouse/movements/entry/ — register an entry */
export const registerEntry = (data) =>
  client.post('/warehouse/movements/entry/', data);

/** POST /warehouse/movements/batch-entry/ — register multiple entries in one request */
export const registerEntryBatch = (data) =>
  client.post('/warehouse/movements/batch-entry/', data);

/** POST /warehouse/movements/exit/ — register an exit */
export const registerExit = (data) =>
  client.post('/warehouse/movements/exit/', data);

/** POST /warehouse/movements/batch-exit/ — register multiple exits in one request */
export const registerExitBatch = (data) =>
  client.post('/warehouse/movements/batch-exit/', data);

/** GET /warehouse/movements/{id}/voucher/ — voucher data for printing */
export const getVoucher = (id) =>
  client.get(`/warehouse/movements/${id}/voucher/`);

/** GET /warehouse/inventory/{id}/recent-movements/ — last 5 movements for an item */
export const getRecentMovements = (id) =>
  client.get(`/warehouse/inventory/${id}/recent-movements/`);

// ── Pending RQ requests for warehouse ─────────────────────────────────────

/** GET /warehouse/pending-requests/list/ — RQs pending warehouse action */
export const getPendingRequests = (params) =>
  client.get('/warehouse/pending-requests/list/', { params });

/**
 * GET /warehouse/pending-requests/deliverable/ — RQ pendientes por entregar (SYSPCC-041), para el
 * selector de la pantalla de Salida. Params: `search` (RQ, proyecto, solicitante), `page`, `page_size`.
 * Paginado `{ count, next, previous, results }`; cada fila trae `id`, `rq_number`, `project`,
 * `department`, `requested_by`, `items_pending`, `items_partial`, `items_deliverable`, `percent`.
 */
export const getDeliverableRequests = (params) =>
  client.get('/warehouse/pending-requests/deliverable/', { params });

/** GET /warehouse/pending-requests/count/ — badge count by status */
export const getPendingCount = (params) =>
  client.get('/warehouse/pending-requests/count/', { params });

// ── Picking y entregas parciales de un RQ (SYSPCC-029) ─────────────────────

/**
 * GET /warehouse/pending-requests/{rqId}/picking/ — lista de picking, resumen e historial de
 * entregas. 409 INVALID_STATE si el RQ ya no está en la etapa de almacén.
 */
export const getRqPicking = (rqId) =>
  client.get(`/warehouse/pending-requests/${rqId}/picking/`);

/**
 * POST /warehouse/pending-requests/{rqId}/deliver/ — registra una entrega parcial.
 * `{ lines: [{ request_item_id, quantity }], movement_date?, notes? }` (la guía GR-AAAA-NNNNNN la
 * genera el servidor, SYSPCC-041). 201 `{ delivery, picking }`; `delivery` trae `dispatch_guide_number`,
 * `dispatch_number`, `movement_group_id` y `first_movement_id`. No cambia el estado del RQ.
 */
export const deliverRqItems = (rqId, data) =>
  client.post(`/warehouse/pending-requests/${rqId}/deliver/`, data);

/**
 * POST /warehouse/pending-requests/{rqId}/deliveries/{dispatchId}/reverse/ — anula una entrega.
 * `{ reason, movement_date? }`. 201 `{ delivery, picking }`.
 */
export const reverseRqDelivery = (rqId, dispatchId, data) =>
  client.post(`/warehouse/pending-requests/${rqId}/deliveries/${dispatchId}/reverse/`, data);

// ── OneDrive ─────────────────────────────────────────────────────────────────

/** GET /warehouse/onedrive/status/ — check connection */
export const getOneDriveStatus = () =>
  client.get('/warehouse/onedrive/status/');

/** POST /warehouse/onedrive/connect/ — start device code flow */
export const oneDriveConnect = () =>
  client.post('/warehouse/onedrive/connect/');

/** POST /warehouse/onedrive/poll/ — poll for auth completion */
export const oneDrivePoll = (deviceCode) =>
  client.post('/warehouse/onedrive/poll/', { device_code: deviceCode });

/** POST /warehouse/onedrive/disconnect/ — remove connection */
export const oneDriveDisconnect = () =>
  client.post('/warehouse/onedrive/disconnect/');

// ── SYSPCC-025: ubicaciones, resumen de movimiento, EPP, exportaciones ─────────

/** GET /warehouse/inventory/location-layout/ — pabellones, secciones y niveles del almacén */
export const getLocationLayout = () =>
  client.get('/warehouse/inventory/location-layout/');

/**
 * POST /warehouse/inventory/assign-locations/ — asigna ubicaciones (todo o nada, máx. 300).
 * 400 => `errors: [{ index, field, error }]`.
 */
export const assignLocations = (assignments) =>
  client.post('/warehouse/inventory/assign-locations/', { assignments });

/** GET /warehouse/inventory/movement-summary/ — INV. INICIAL / INGRESOS / EGRESOS / STOCK por ítem */
export const getMovementSummary = (params) =>
  client.get('/warehouse/inventory/movement-summary/', { params });

/**
 * POST /warehouse/movements/epp-delivery/ — entrega de EPP a un trabajador (exige fecha). Desde
 * SYSPCC-041 el N° de vale ya no se escribe: el servidor genera la guía `internal_guide_number`.
 */
export const registerEppDelivery = (data) =>
  client.post('/warehouse/movements/epp-delivery/', data);

/** GET /warehouse/personal-lookup/?search= — solo id, nombre, puesto y código de proyecto (mín. 3 letras) */
export const lookupPersonal = (search) =>
  client.get('/warehouse/personal-lookup/', { params: { search } });

/** POST /warehouse/movements/link-personal/ — vincula un destino en texto con un trabajador */
export const linkPersonal = (data) =>
  client.post('/warehouse/movements/link-personal/', data);

// Descargas: devuelven un Blob (se guardan con utils/download.js).
const getBlob = (url, params) => client.get(url, { params, responseType: 'blob' });

/** Excel del inventario con los filtros activos. */
export const exportInventory = (params) => getBlob('/warehouse/inventory/export/', params);

/** Excel del resumen de movimiento (`include_movements: true` agrega INGRESOS y EGRESOS). */
export const exportMovementSummary = (params) =>
  getBlob('/warehouse/inventory/movement-summary/export/', params);

/** Excel de movimientos; `layout: 'excel_pcc'` entrega las hojas INGRESOS y EGRESOS de su libro. */
export const exportMovements = (params) => getBlob('/warehouse/movements/export/', params);

/** PDF del vale de un grupo de movimientos. */
export const downloadGroupPdf = (groupId) =>
  getBlob(`/warehouse/movements/groups/${groupId}/pdf/`);
