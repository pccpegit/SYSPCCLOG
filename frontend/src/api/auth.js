import client from './client';

/**
 * POST /auth/login/
 * Backend sets httpOnly cookies (access + refresh).
 * Response body contains { user } — tokens are NOT returned to JS.
 */
export const login = (username, password) =>
  client.post('/auth/login/', { username, password });

/**
 * POST /auth/logout/
 * Backend clears the httpOnly cookies server-side.
 * No token body required — cookies are sent automatically via withCredentials.
 */
export const logout = () =>
  client.post('/auth/logout/');

/**
 * POST /auth/token/refresh/
 * Refresh cookie is sent automatically — no body needed.
 * Backend rotates the access cookie.
 */
export const refreshToken = () =>
  client.post('/auth/token/refresh/');

/**
 * GET /users/me/
 * Returns the currently authenticated user object.
 * Used to restore session on app load (cookie sent automatically).
 */
export const getMe = () => client.get('/users/me/');

/**
 * POST /users/me/change-password/
 */
export const changePassword = (oldPassword, newPassword, newPasswordConfirm) =>
  client.post('/users/me/change-password/', {
    old_password: oldPassword,
    new_password: newPassword,
    new_password_confirm: newPasswordConfirm,
  });
