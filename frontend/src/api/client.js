import axios from 'axios';
import { API_BASE_URL } from './config';

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── CSRF (double-submit cookie pattern) ──────────────────────────────────────
// Backend sets a JS-readable `csrftoken` cookie via GET /auth/csrf/ (see
// api/auth.js -> bootstrapCsrf, triggered from AuthContext on app mount).
// Every unsafe request (POST/PUT/PATCH/DELETE) must echo that cookie's value
// back in the X-CSRFToken header. GET/HEAD/OPTIONS are read-only and exempt.

const CSRF_COOKIE_NAME = 'csrftoken';
const CSRF_HEADER_NAME = 'X-CSRFToken';
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Reads a cookie value by name. Returns null if absent or no document (SSR/tests). */
export function getCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Request interceptor logic: attaches X-CSRFToken from the csrftoken cookie
 * on unsafe (mutating) methods. Exported standalone so it can be unit tested
 * without spinning up network calls, and reused verbatim on retried requests
 * (the response interceptor's `client(originalRequest)` re-runs this too).
 */
export function attachCsrfToken(config) {
  const method = config.method?.toLowerCase();
  if (method && UNSAFE_METHODS.has(method)) {
    const token = getCookie(CSRF_COOKIE_NAME);
    if (token) {
      config.headers = config.headers ?? {};
      config.headers[CSRF_HEADER_NAME] = token;
    }
  }
  return config;
}

client.interceptors.request.use(attachCsrfToken);

// ─── Request queue for concurrent 401s during refresh ────────────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

// URLs that should NOT trigger the refresh/redirect cycle
const SKIP_REFRESH_URLS = ['/auth/token/refresh/', '/auth/login/', '/users/me/'];

const shouldSkipRefresh = (url) =>
  SKIP_REFRESH_URLS.some((skip) => url?.includes(skip));

// ─── Response interceptor – handle 401 and trigger cookie-based refresh ───────
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    // SYSPCC-018: defense-in-depth safety net. The primary gate is the
    // frontend route layout (RequirePasswordChangeLayout) redirecting to
    // /cambiar-password right after login, but the backend blocks EVERY
    // request outside a small allowlist while must_change_password is true
    // (CookieJWTAuthentication.authenticate()) — if a stale tab or a direct
    // API call slips past the route guard, this catches it too. Checking
    // `data.code` (not just the 403 status) matters because CSRF failures
    // and ordinary permission denials also return 403.
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'must_change_password' &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/cambiar-password'
    ) {
      window.location.assign('/cambiar-password');
      return Promise.reject(error);
    }

    const originalRequest = error.config;

    // Never retry auth-related endpoints — just reject so the caller handles it
    if (shouldSkipRefresh(originalRequest.url)) {
      return Promise.reject(error);
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => client(originalRequest))
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Bare axios (not `client`) so it can't recurse through the 401
        // handler, but it still mutates state server-side, so it still
        // needs the CSRF header attached by hand.
        const refreshHeaders = { 'Content-Type': 'application/json' };
        const csrfToken = getCookie(CSRF_COOKIE_NAME);
        if (csrfToken) refreshHeaders[CSRF_HEADER_NAME] = csrfToken;

        await axios.post(
          `${API_BASE_URL}auth/token/refresh/`,
          {},
          { withCredentials: true, headers: refreshHeaders },
        );

        processQueue(null);
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        // Don't redirect here — let AuthContext handle navigation
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default client;
