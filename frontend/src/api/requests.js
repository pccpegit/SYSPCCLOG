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

/** PATCH /requests/{id}/items/ — update supply_source for items */
export const updateRequestItems = (requestId, itemDecisions) =>
  client.patch(`/requests/${requestId}/update-items/`, { items: itemDecisions });
