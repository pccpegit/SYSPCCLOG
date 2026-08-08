import client from './client';

// SYSPCC-018 — mutations for the superadmin-only project management module.
// Reads (`getProjects`, `getProject`) stay in `core.js` — other pages
// already import from there and this ticket must not move/rename them.

/**
 * POST /projects/
 * Superadmin only. Fields: code, name, location, client, frente,
 * total_budget, start_date, end_date, is_active.
 */
export const createProject = (payload) =>
  client.post('/projects/', payload);

/**
 * PATCH /projects/{id}/
 * Superadmin only. Same field set as create.
 */
export const updateProject = (id, payload) =>
  client.patch(`/projects/${id}/`, payload);

/**
 * POST /projects/{id}/activate/
 * Superadmin only, idempotent.
 */
export const activateProject = (id) =>
  client.post(`/projects/${id}/activate/`);

/**
 * POST /projects/{id}/deactivate/
 * Superadmin only, idempotent.
 */
export const deactivateProject = (id) =>
  client.post(`/projects/${id}/deactivate/`);
