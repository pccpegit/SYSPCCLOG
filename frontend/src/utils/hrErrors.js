// SYSPCC-022 — es-PE messages for the HR module error codes.
// The backend returns { error, status_code, detail, code }. When `detail` is
// a string (es-PE for all 4xx business errors) it wins; the table below is the fallback for
// codes whose detail is missing or not a string.

import { extractErrorMessage } from './apiErrors';

export const HR_ERROR_MESSAGES = {
  invalid_docx: 'El archivo no es un documento Word (.docx) válido.',
  file_too_large: 'El archivo supera el tamaño máximo permitido (5 MB).',
  macros_not_allowed: 'La plantilla contiene macros. Guárdala como .docx sin macros.',
  external_links_not_allowed: 'La plantilla contiene vínculos externos, que no están permitidos.',
  template_syntax_error: 'La plantilla tiene un error en sus variables. Revisa que cada {{ variable }} esté escrita de una sola vez en Word.',
  template_has_unknown_variables: 'No se puede activar: la plantilla usa variables que el sistema no reconoce.',
  template_active: 'La plantilla está activa y no puede eliminarse.',
  template_in_use: 'La plantilla ya se usó en documentos y no puede eliminarse.',
  template_version_conflict: 'Otra persona creó una versión al mismo tiempo. Vuelve a intentarlo.',
  template_inactive: 'La plantilla elegida ya no está activa. Actualiza la página y elige otra.',
  template_file_missing: 'No se encontró el archivo de la plantilla en el servidor. Avisa al administrador.',
  template_render_error: 'No se pudo generar el documento con esta plantilla. Revisa los datos o la plantilla.',
  invalid_state: 'El documento cambió de estado y esta acción ya no es posible. Actualiza la página.',
  pdf_not_available: 'El PDF no está disponible para este documento.',
  pdf_disabled: 'La conversión a PDF no está habilitada en este entorno.',
  invalid_format: 'Formato de descarga no válido.',
  search_too_short: 'Escribe al menos 2 caracteres para buscar.',
  company_data_missing: 'Faltan datos de la empresa (razón social, RUC o representante legal). Configúralos antes de emitir.',
  docx_missing: 'El documento no tiene archivo Word. Vuelve a generar el borrador.',
  assistant_unavailable: 'El asistente no está disponible. Completa el formulario manualmente.',
  assistant_unreadable: 'No se pudo interpretar la descripción. Reescríbela con más detalle o completa el formulario.',
  assistant_rate_limited: 'Se alcanzó el límite de consultas al asistente. Espera un momento o usa el formulario.',
  assistant_failed: 'El asistente no respondió. Inténtalo de nuevo o completa el formulario.',
};

const STATUS_MESSAGES = {
  401: 'Tu sesión expiró. Inicia sesión nuevamente.',
  403: 'No tienes permiso para realizar esta acción.',
  404: 'No se encontró el recurso solicitado.',
  429: 'Demasiadas solicitudes. Espera unos segundos e inténtalo de nuevo.',
};

const HANDLED_4XX = new Set([400, 404, 409, 422, 429]);

export function hrErrorCode(err) {
  return err?.response?.data?.code ?? null;
}

/** Mensaje es-PE para mostrar en un banner o toast. */
export function hrErrorMessage(err, fallback = 'Ocurrió un error inesperado. Inténtalo nuevamente.') {
  const code = hrErrorCode(err);
  if (!err?.response) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
  const status = err.response.status;
  // 401/403/5xx: generic message, never the backend text.
  if (status === 401 || status === 403) return STATUS_MESSAGES[status];
  if (status >= 500) {
    // Our own table text for known codes (assistant_failed, pdf_disabled…); never the backend text.
    return (code && HR_ERROR_MESSAGES[code]) || 'Error del servidor. Inténtalo nuevamente en unos minutos.';
  }
  // 4xx business errors: the backend `detail` (es-PE) wins; the code table
  // is the fallback when there is no usable string.
  const detail = err.response.data?.detail;
  if (HANDLED_4XX.has(status) && typeof detail === 'string' && detail.trim()) return detail;
  if (code && HR_ERROR_MESSAGES[code]) return HR_ERROR_MESSAGES[code];
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  return extractErrorMessage(err, fallback);
}
