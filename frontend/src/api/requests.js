import client from './client';

/**
 * GET /requests/
 * Supported params: status, priority, flow, project, department,
 *                   search, ordering, page
 */
export const getRequests = (params) =>
  client.get('/requests/', { params });

/** GET /requests/{id}/ */
export const getRequest = (id) =>
  client.get(`/requests/${id}/`);

/** POST /requests/ */
export const createRequest = (data) =>
  client.post('/requests/', data);

/** PATCH /requests/{id}/ */
export const updateRequest = (id, data) =>
  client.patch(`/requests/${id}/`, data);

/** DELETE /requests/{id}/ */
export const deleteRequest = (id) =>
  client.delete(`/requests/${id}/`);

/**
 * POST /requests/{id}/action/
 * actionData: { action, comment?, ... }
 */
export const performAction = (id, actionData) =>
  client.post(`/requests/${id}/action/`, actionData);

/** GET /requests/{id}/available-actions/ */
export const getAvailableActions = (id) =>
  client.get(`/requests/${id}/available-actions/`);

/** GET /requests/{id}/approvals/ */
export const getApprovals = (id) =>
  client.get(`/requests/${id}/approvals/`);

/** GET /requests/{id}/activity/ */
export const getActivity = (id) =>
  client.get(`/requests/${id}/activity/`);

/** GET /requests/{id}/attachments/ */
export const getAttachments = (id) =>
  client.get(`/requests/${id}/attachments/`);

/**
 * PATCH /requests/{id}/update-items/ — logistics only (stock check).
 * Each entry: { item_id, supply_source?, inventory_item?, is_off_catalog?, item_source? }
 * (only the keys sent are applied; at least one besides item_id).
 * 200 -> { updated_item_ids, unchanged_item_ids, ignored_item_ids, items }
 * 409 -> { detail, code: REQUEST_TERMINAL | ITEMS_ALREADY_DISPATCHED | INTEGRITY_ERROR, item_ids }
 */
export const updateRequestItems = (requestId, itemDecisions) =>
  client.patch(`/requests/${requestId}/update-items/`, { items: itemDecisions });

/**
 * How long the stock-availability query may take before it is given up (ms). The axios client has
 * no default timeout, and the stock-check screen waits for this answer before it enables its
 * confirmation button: a query that hangs must end as an error ("no verificable"), which opens
 * the button, and not leave logistics unable to send STOCK_CHECKED.
 */
export const STOCK_AVAILABILITY_TIMEOUT_MS = 15000;

/**
 * GET /requests/{id}/stock-availability/ — per line: requested vs CENTRAL pool
 * (net of what is still owed to other RQs), plus a coverage hint.
 * Advisory only: the stock-check decision stays with logistics.
 */
export const getStockAvailability = (requestId) =>
  client.get(`/requests/${requestId}/stock-availability/`, { timeout: STOCK_AVAILABILITY_TIMEOUT_MS });

/**
 * GET /request-catalog/?search= — type-ahead over the warehouse catalog for the
 * lines of an RQ. Any authenticated user; max 20 rows per page, >= 2 characters.
 * Rows: { id, product_code, description, unit, category, available }
 * (`available` is a decimal string: the CENTRAL pool quantity).
 * Pass `signal` (AbortController) to cancel a superseded search.
 */
export const searchRequestCatalog = (search, { page, signal } = {}) =>
  client.get('/request-catalog/', {
    params: { search, ...(page && page > 1 ? { page } : {}) },
    signal,
  });
