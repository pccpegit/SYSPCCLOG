import client, { refreshSession } from './client';

/**
 * GET /auth/csrf/
 * CSRF bootstrap (double-submit cookie pattern). Sets the JS-readable
 * `csrftoken` cookie that the request interceptor in api/client.js echoes
 * back as the X-CSRFToken header on every mutating request. Must be called
 * — and settled — before the first POST/PUT/PATCH/DELETE, including login.
 * See AuthContext, which triggers this on app mount and awaits it in login().
 */
export const bootstrapCsrf = () => client.get('/auth/csrf/');

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
 * Lee la cookie HttpOnly `refresh_token` y reescribe las cookies de sesión;
 * exige X-CSRFToken. Reutiliza el helper deduplicado de api/client.js (el mismo
 * del interceptor 401), por lo que no recursa por el interceptor. Rechaza con
 * 401 si el refresh no sirve (no borra cookies).
 */
export { refreshSession };

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

/**
 * POST /users/me/signature/
 * Upload signature image (file upload or base64 canvas drawing).
 */
export const uploadSignatureFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return client.post('/users/me/signature/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const uploadSignatureDrawing = (base64Data) =>
  client.post('/users/me/signature/', { signature_data: base64Data });

/**
 * DELETE /users/me/signature/
 */
export const deleteSignature = () =>
  client.delete('/users/me/signature/');
