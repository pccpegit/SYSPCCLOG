import client from './client';

/** GET /claims/ */
export const getClaims = (params) =>
  client.get('/claims/', { params });

/** POST /claims/ */
export const createClaim = (data) =>
  client.post('/claims/', data);

/** PUT /claims/{id}/ */
export const updateClaim = (id, data) =>
  client.put(`/claims/${id}/`, data);
