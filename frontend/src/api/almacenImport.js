import client from './client';

// SYSPCC-025 — importación del libro "INVENTARIO PCC - ALM" en dos pasos
// (previsualizar y confirmar). Solo CENTRAL_WAREHOUSE y LOGISTICS_CHIEF suben,
// confirman o cancelan; los cinco roles de almacén leen el historial.
// Las respuestas llevan nombres de destinos (datos personales): la UI solo los
// muestra en pantalla y nunca los guarda en consola, URL ni almacenamiento.

/** POST /warehouse/imports/ — sube el libro y devuelve la previsualización (201). */
export const uploadImport = (file, { updateExisting = false, warehouse = 'CENTRAL' } = {}) => {
  const body = new FormData();
  body.append('file', file);
  body.append('warehouse', warehouse);
  body.append('update_existing', updateExisting ? 'true' : 'false');
  // Sin Content-Type fijo: el navegador agrega el boundary del multipart.
  return client.post('/warehouse/imports/', body, {
    headers: { 'Content-Type': undefined },
    timeout: 120000,
  });
};

/** GET /warehouse/imports/ — historial (resumen corto). */
export const getImports = (params) => client.get('/warehouse/imports/', { params });

/** GET /warehouse/imports/{id}/ — estado, resumen, proyectos y destinos. */
export const getImport = (id) => client.get(`/warehouse/imports/${id}/`);

/** GET /warehouse/imports/{id}/problems/ — problemas paginados (severity, sheet, code, page, page_size). */
export const getImportProblems = (id, params) =>
  client.get(`/warehouse/imports/${id}/problems/`, { params });

/** Informe de problemas en Excel (sin nombres), con los mismos filtros. */
export const exportImportProblems = (id, params) =>
  client.get(`/warehouse/imports/${id}/problems/export/`, { params, responseType: 'blob' });

/** Plantilla .xlsx vacía con las cuatro hojas. */
export const downloadImportTemplate = () =>
  client.get('/warehouse/imports/template/', { responseType: 'blob' });

/**
 * POST /warehouse/imports/{id}/confirm/ — atómico e idempotente.
 * `projectMap`: { "ETIQUETA": idProyecto | null }; `destinationMap`: { clave: idPersonal }.
 */
export const confirmImport = (id, {
  expectedPlanDigest, projectMap = {}, destinationMap = {},
  acceptWarnings = false, acceptSkippedRows = false,
}) =>
  client.post(`/warehouse/imports/${id}/confirm/`, {
    expected_plan_digest: expectedPlanDigest,
    project_map: projectMap,
    destination_map: destinationMap,
    accept_warnings: acceptWarnings,
    accept_skipped_rows: acceptSkippedRows,
  }, { timeout: 120000 });

/** DELETE /warehouse/imports/{id}/ — cancela una importación previsualizada. */
export const cancelImport = (id) => client.delete(`/warehouse/imports/${id}/`);
