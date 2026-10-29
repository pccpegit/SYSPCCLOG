// SYSPCC-025 — reglas puras del asistente de importación del libro de inventario.
// El servidor valida de nuevo todo (extensión, tamaño, contenido, macros).

import { extractErrorMessage } from './apiErrors';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const extensionOf = (name = '') => {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i).toLowerCase();
};

/** Mensaje de error de un archivo candidato; cadena vacía si se puede subir. */
export function validateWorkbookFile(file) {
  if (!file) return 'Elija el libro de inventario (.xlsx).';
  const ext = extensionOf(file.name);
  if (ext === '.xls' || ext === '.xlsm') {
    return `Los archivos ${ext} no se admiten (pueden traer macros). Guárdelo como libro de Excel .xlsx.`;
  }
  if (ext !== '.xlsx') return 'El archivo debe ser un libro de Excel (.xlsx).';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > MAX_IMPORT_BYTES) return 'El archivo supera los 10 MB.';
  return '';
}

export const SEVERITY_META = {
  blocker: { label: 'Bloqueante', tone: 'red', action: 'No se puede continuar' },
  error: { label: 'Error', tone: 'red', action: 'La fila se omite' },
  warning: { label: 'Advertencia', tone: 'amber', action: 'Se importa con marca' },
  info: { label: 'Informativo', tone: 'blue', action: 'Solo informativo' },
};

export const IMPORT_STATUS_LABELS = {
  PREVIEWED: 'Previsualizada',
  PROCESSING: 'En proceso',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Vencida',
  FAILED: 'Fallida',
};

// Códigos de error de confirmación tras los cuales hay que volver a subir el libro.
const STALE_CODES = new Set([
  'plan_changed', 'import_expired', 'import_not_confirmable', 'import_file_missing', 'import_conflict',
]);

export const errorCode = (err) => err?.response?.data?.code ?? '';

/** ¿El error obliga a volver a subir el archivo (no hay «re-previsualizar»)? */
export const isStaleImportError = (err) => STALE_CODES.has(errorCode(err));

/** Mensaje en español para un error de subida o confirmación. */
export function importErrorMessage(err, fallback) {
  const status = err?.response?.status;
  const code = errorCode(err);
  if (status === 429) return 'Demasiadas subidas seguidas (máximo 10 por hora). Intente más tarde.';
  if (code === 'plan_changed') {
    return 'El inventario cambió desde que se previsualizó el libro. Vuelva a subir el archivo para revisarlo de nuevo.';
  }
  if (code === 'import_expired') {
    return 'La previsualización venció. Vuelva a subir el archivo.';
  }
  if (code === 'file_already_imported') return 'Este libro ya se importó antes. No se volverá a cargar.';
  return extractErrorMessage(err, fallback);
}

/**
 * Decisión sobre un proyecto del libro: `id` (número), `null` (no asignar) o
 * `undefined` (aún sin decidir). Si el servidor sugiere uno único, se usa por defecto.
 */
export function projectDecision(project, projectMap) {
  if (Object.prototype.hasOwnProperty.call(projectMap, project.label)) return projectMap[project.label];
  return project.suggested_id ?? undefined;
}

/** `{ ETIQUETA: id|null }` con todas las decisiones tomadas; `null` si falta alguna. */
export function buildProjectMap(labels, projects, projectMap) {
  const byLabel = Object.fromEntries((projects ?? []).map((p) => [p.label, p]));
  const result = {};
  for (const label of labels ?? []) {
    const decision = projectDecision(byLabel[label] ?? { label }, projectMap);
    if (decision === undefined) return null;
    result[label] = decision;
  }
  return result;
}

/**
 * Total de un contador del resultado de la confirmación. El servidor entrega
 * objetos (`groups: { initial, entries, exits }`, `skipped: { rows_with_errors,
 * already_imported }`), pero también se acepta un número ya sumado.
 */
export function sumCounts(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object') {
    return Object.values(value).reduce((acc, v) => acc + sumCounts(v), 0);
  }
  return 0;
}

// Etiquetas legibles de los códigos de problema (el código queda como dato secundario).
// Los mensajes del servidor nunca citan celdas ni nombres; aquí solo se rotula el tipo.
export const PROBLEM_CODE_LABELS = {
  HOJA_FALTANTE: 'Falta una hoja del libro',
  CABECERA_FALTANTE: 'Faltan columnas obligatorias',
  ITEM_DESCONOCIDO: 'Ítem que no existe',
  STOCK_NEGATIVO: 'El stock quedaría negativo',
  STOCK_EXCEDIDO: 'El stock superaría el máximo permitido',
  CODIGO_DUPLICADO_DISTINTO: 'Código repetido con datos distintos',
  CANTIDAD_VACIA: 'Cantidad vacía',
  CANTIDAD_INVALIDA: 'Cantidad no válida',
  FECHA_INVALIDA: 'Fecha no válida',
  FECHA_FUTURA: 'Fecha posterior a hoy',
  UNIDAD_EN_CONFLICTO: 'Unidad distinta a la del sistema',
  DESTINO_VACIO: 'Egreso sin destino',
  ITEM_VACIO: 'Fila sin código de ítem',
  ITEM_OMITIDO: 'Ítem omitido por un error previo',
  FILA_INVALIDA: 'Fila no válida',
  FECHA_VACIA: 'Fila sin fecha',
  VALE_VACIO: 'Egreso sin N° de vale',
  VALE_REUTILIZADO: 'N° de vale repetido',
  UBICACION_PISO_SIN_PABELLON: 'Ubicación incompleta (solo el piso)',
  UBICACION_NO_RECONOCIDA: 'Ubicación que no existe en el almacén',
  DESTINO_SIN_PERSONAL: 'Destino sin trabajador en Personal',
  DESTINO_AMBIGUO: 'Destino que coincide con varios trabajadores',
  STOCK_DISTINTO_AL_LIBRO: 'Stock distinto al del libro',
  LIBRO_SIN_VALORES_CALCULADOS: 'Fórmulas sin valor calculado',
  DESCRIPCION_DISTINTA: 'Descripción distinta a la del sistema',
  PRODUCTO_SIN_STOCK_CERO: 'Ítem que queda sin stock',
  FILAS_IMPORTADAS_AUSENTES: 'Movimientos importados que ya no figuran',
  PREFIJO_NO_CLASIFICADO: 'Código con prefijo desconocido',
  PROYECTO_VACIO: 'Ítem sin proyecto',
  FILA_YA_IMPORTADA: 'Fila ya importada antes',
  SHIPMENT_QUANTITY_IGNORADA: 'Columna que no se importa',
  CODIGO_DUPLICADO_IDENTICO: 'Código repetido (idéntico)',
  CATALOGO_DESDE_RESUMEN: 'Catálogo tomado del resumen',
};

/** Etiqueta legible de un código de problema; si no se conoce, el propio código. */
export const problemCodeLabel = (code) => PROBLEM_CODE_LABELS[code] ?? code;
