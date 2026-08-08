import axios from 'axios';
import { API_BASE_URL } from './config';

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
        await axios.post(
          `${API_BASE_URL}auth/token/refresh/`,
          {},
          { withCredentials: true },
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
