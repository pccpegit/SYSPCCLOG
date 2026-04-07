import client from './client';

/** GET /suppliers/ */
export const getSuppliers = (params) =>
  client.get('/suppliers/', { params });

/** POST /suppliers/ */
export const createSupplier = (data) =>
  client.post('/suppliers/', data);

/** GET /quotations/?request={requestId} */
export const getQuotations = (requestId) =>
  client.get('/quotations/', { params: { request: requestId } });

/** POST /quotations/ */
export const createQuotation = (data) =>
  client.post('/quotations/', data);

/** POST /quotations/{id}/select/ */
export const selectQuotation = (id) =>
  client.post(`/quotations/${id}/select/`);

/** GET /purchase-orders/ */
export const getPurchaseOrders = (params) =>
  client.get('/purchase-orders/', { params });

/** POST /purchase-orders/ */
export const createPurchaseOrder = (data) =>
  client.post('/purchase-orders/', data);
