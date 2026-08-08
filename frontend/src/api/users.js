import client from './client';

// SYSPCC-018 — mutations for the superadmin-only user management module.
// Reads (`getUsers`, `getUser`) stay in `core.js` — other pages already
// import from there and this ticket must not move/rename them.

/**
 * POST /users/{id}/reset-password/
 * Superadmin only. Forces a new system-generated temporary password and
 * sets `must_change_password=True` on the target user. The response's
 * `temporary_password` is shown exactly once — it is never retrievable
 * again after this call.
 */
export const resetPassword = (id) =>
  client.post(`/users/${id}/reset-password/`);

/**
 * POST /users/{id}/activate/
 * Superadmin only, idempotent. Returns the full updated user.
 */
export const activateUser = (id) =>
  client.post(`/users/${id}/activate/`);

/**
 * POST /users/{id}/deactivate/
 * Superadmin only, idempotent. 400 if `id` is the acting superadmin's own
 * account ("No puede desactivarse a sí mismo.").
 */
export const deactivateUser = (id) =>
  client.post(`/users/${id}/deactivate/`);

/**
 * POST /users/
 * Superadmin only. Payload: username, email, first_name, last_name,
 * position, department, phone, roles[]. No `password` field — the backend
 * always generates one. Response is the full user object plus a
 * one-time `temporary_password` key at the top level.
 */
export const createUser = (payload) =>
  client.post('/users/', payload);

/**
 * PATCH /users/{id}/
 * Superadmin only. `roles` omitted from the payload leaves role
 * assignments untouched; `roles: []` clears all of them; `roles: [...]`
 * replaces them entirely.
 */
export const updateUser = (id, payload) =>
  client.patch(`/users/${id}/`, payload);
