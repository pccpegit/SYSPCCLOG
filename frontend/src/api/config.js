export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1/';

/** Backend origin for serving media files (signatures, etc.) */
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
