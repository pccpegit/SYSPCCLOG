import client from './client';

// SYSPCC-022 — HR module (contract generator).
// All routes live under /api/v1/hr/. There is no public file URL: downloads
// always use the session cookie and are delivered as blobs (see
// `downloadDocument` / `downloadTemplate`).

const BASE = '/hr';

// ── Metadatos ────────────────────────────────────────────────────────────────
export const getDocumentTypes = () => client.get(`${BASE}/document-types/`);

/** GET /hr/personal/?search= — minimum 2 characters (otherwise 400 search_too_short). */
export const searchPersonal = (search, params = {}) =>
  client.get(`${BASE}/personal/`, { params: { search, ...params } });

export const getPersonalPrefill = (id, documentType = 'CONTRACT') =>
  client.get(`${BASE}/personal/${id}/prefill/`, { params: { document_type: documentType } });

// ── Plantillas ───────────────────────────────────────────────────────────────
export const getTemplates = (params) => client.get(`${BASE}/templates/`, { params });

/** `form` = { document_type, name, slug?, notes?, file } */
export const uploadTemplate = (form) => {
  const body = new FormData();
  Object.entries(form).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') body.append(key, value);
  });
  // Content-Type: undefined lets the browser set the multipart boundary.
  return client.post(`${BASE}/templates/`, body, { headers: { 'Content-Type': undefined } });
};

export const activateTemplate = (id) => client.post(`${BASE}/templates/${id}/activate/`);
export const deactivateTemplate = (id) => client.post(`${BASE}/templates/${id}/deactivate/`);

// ── Asistente ────────────────────────────────────────────────────────────────
export const getAssistantStatus = () => client.get(`${BASE}/assistant/status/`);

/** `payload` = { document_type, text, personal_id?, known_data? } */
export const extractWithAssistant = (payload) => client.post(`${BASE}/assistant/extract/`, payload);

// ── Documentos ───────────────────────────────────────────────────────────────
export const getDocuments = (params) => client.get(`${BASE}/documents/`, { params });
export const getDocument = (id) => client.get(`${BASE}/documents/${id}/`);
export const createDocument = (payload) => client.post(`${BASE}/documents/`, payload);
export const updateDocument = (id, payload) => client.patch(`${BASE}/documents/${id}/`, payload);
export const deleteDocument = (id) => client.delete(`${BASE}/documents/${id}/`);
export const issueDocument = (id) => client.post(`${BASE}/documents/${id}/issue/`, {});
export const voidDocument = (id, reason) => client.post(`${BASE}/documents/${id}/void/`, { reason });
export const renderDocumentPdf = (id) => client.post(`${BASE}/documents/${id}/render-pdf/`);
export const getDocumentEvents = (id) => client.get(`${BASE}/documents/${id}/events/`);

// ── Descargas (blob) ─────────────────────────────────────────────────────────

/**
 * With `responseType: 'blob'`, JSON error bodies also arrive as a Blob. They
 * are re-parsed so `err.response.data` has the same shape ({ code, detail })
 * as in the rest of the API.
 */
async function unwrapBlobError(err) {
  const data = err?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      err.response.data = JSON.parse(await data.text());
    } catch {
      err.response.data = null;
    }
  }
  throw err;
}

/**
 * Sanitizes a server-provided file name: no path separators, control
 * characters or leading dots; falls back to `fallback` when nothing is left.
 */
export function sanitizeFilename(name, fallback = 'documento') {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/^\.+/, '').trim();
  return cleaned || fallback;
}

function filenameFromHeaders(headers, fallback) {
  const disposition = headers?.['content-disposition'] ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (!match) return fallback;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw value
  }
  return sanitizeFilename(raw, fallback);
}

/** Devuelve { blob, filename }. `format` = 'docx' | 'pdf'. */
export async function downloadDocument(id, format = 'docx') {
  try {
    const res = await client.get(`${BASE}/documents/${id}/download/`, {
      params: { format },
      responseType: 'blob',
    });
    return { blob: res.data, filename: filenameFromHeaders(res.headers, `documento-${id}.${format}`) };
  } catch (err) {
    return unwrapBlobError(err);
  }
}

export async function downloadTemplate(id) {
  try {
    const res = await client.get(`${BASE}/templates/${id}/download/`, { responseType: 'blob' });
    return { blob: res.data, filename: filenameFromHeaders(res.headers, `plantilla-${id}.docx`) };
  } catch (err) {
    return unwrapBlobError(err);
  }
}

/** Triggers a browser save for a blob and releases the temporary URL. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 1 s grace period: revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
