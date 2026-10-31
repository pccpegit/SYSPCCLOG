// SYSPCC-025 — descarga de archivos generados por el backend (Excel, PDF) como blob.
//
// Las exportaciones pasan por el cliente Axios (cookies + CSRF + refresh del
// token), nunca por un <a href> directo: así una sesión vencida se renueva y los
// errores llegan al código en vez de abrir una página de error en el navegador.

/** Nombre de archivo seguro (sin rutas ni caracteres de control). */
export function sanitizeFilename(name, fallback = 'descarga') {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}

/** Lee `filename` / `filename*` de la cabecera Content-Disposition. */
export function filenameFromDisposition(header, fallback = 'descarga') {
  if (!header) return sanitizeFilename(fallback);
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return sanitizeFilename(decodeURIComponent(star[1].trim()), fallback);
    } catch {
      // cae al filename simple
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? sanitizeFilename(plain[1].trim(), fallback) : sanitizeFilename(fallback);
}

/** Dispara la descarga de un Blob en el navegador. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Dar tiempo al navegador a iniciar la descarga antes de liberar la URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Espera una respuesta Axios `responseType: 'blob'` y guarda el archivo con el
 * nombre que sugiere el servidor. Devuelve el nombre usado.
 */
export async function downloadResponse(request, fallbackName) {
  const response = await request;
  const name = filenameFromDisposition(response.headers?.['content-disposition'], fallbackName);
  saveBlob(response.data, name);
  return name;
}
