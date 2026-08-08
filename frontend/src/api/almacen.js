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

/** GET /warehouse/movements/{id}/pdf/ — download movement PDF */
export const getMovementPdfUrl = (id) =>
  `/api/warehouse/movements/${id}/pdf/`;

/**
 * Returns the URL for the inventory Excel export (open directly or use as href).
 * Accepts the same filter params as getInventory.
 * @param {object} params - Optional query params (category, item_type, search, low_stock)
 */
export const exportInventoryUrl = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `/api/warehouse/inventory/export/${qs ? `?${qs}` : ''}`;
};

/**
 * Returns the URL for the movements Excel export (open directly or use as href).
 * Accepts the same filter params as getMovements.
 * @param {object} params - Optional query params
 */
export const exportMovementsUrl = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `/api/warehouse/movements/export/${qs ? `?${qs}` : ''}`;
};

/** GET /warehouse/inventory/{id}/recent-movements/ — last 5 movements for an item */
export const getRecentMovements = (id) =>
  client.get(`/warehouse/inventory/${id}/recent-movements/`);

// ── Pending RQ requests for warehouse ─────────────────────────────────────

/** GET /warehouse/pending-requests/list/ — RQs pending warehouse action */
export const getPendingRequests = (params) =>
  client.get('/warehouse/pending-requests/list/', { params });

/** GET /warehouse/pending-requests/count/ — badge count by status */
export const getPendingCount = (params) =>
  client.get('/warehouse/pending-requests/count/', { params });

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
