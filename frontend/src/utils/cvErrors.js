// SYSPCC-023 — mensajes es-PE de los errores del módulo de CVs.
// Errores de petición: ver HR_ERROR_MESSAGES (utils/hrErrors.js) + hrErrorMessage.
// Aquí: fallas por CV (`error_code` del item) y utilidades de presentación.

export const ITEM_ERRORS = {
  cv_unreadable: { message: 'No pudimos leer este CV. Prueba con otra versión.', retryable: false, action: 'original' },
  file_missing: { message: 'El archivo ya no está. Súbelo de nuevo.', retryable: false, action: 'remove' },
  ai_unavailable: { message: 'El análisis no está disponible ahora. Avisa al administrador.', retryable: false },
  ai_rate_limited: { message: 'Hay muchas solicitudes. Reintenta en unos minutos.', retryable: true },
  ai_failed: { message: 'El servicio no respondió. Inténtalo de nuevo.', retryable: true },
  ai_refusal: { message: 'La IA no pudo procesar este CV. Revísalo a mano.', retryable: false, action: 'original' },
  ai_unparseable: { message: 'No se pudo armar la ficha. Inténtalo de nuevo.', retryable: true },
  cv_rejected_by_ai: { message: 'El archivo no sirve para el análisis. Revísalo.', retryable: false, action: 'original' },
  internal_error: { message: 'Ocurrió un error inesperado. Inténtalo de nuevo.', retryable: true },
};

const FALLBACK = ITEM_ERRORS.internal_error;

export function itemError(errorCode, backendMessage) {
  const known = ITEM_ERRORS[errorCode];
  if (known) return { ...known, message: backendMessage || known.message };
  return { ...FALLBACK, message: backendMessage || FALLBACK.message };
}

export const isRetryable = (errorCode) => (ITEM_ERRORS[errorCode] ?? FALLBACK).retryable;
