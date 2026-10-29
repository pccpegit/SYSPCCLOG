// SYSPCC-030 — constantes de UI del Master de RQ (opciones de filtros, etiquetas y tonos).
// Los códigos son los del backend (`apps/rq/services/item_tracking.py`); si el servidor envía la
// etiqueta (`*_label`) esa manda, estos textos son el respaldo de los filtros.

import { REQUESTING_AREAS, ITEM_SOURCES } from './requestCapture';

export const AREA_FILTER_OPTIONS = [
  ...REQUESTING_AREAS,
  { value: 'NONE', label: 'Sin área' },
];

export const SOURCE_FILTER_OPTIONS = [
  ...ITEM_SOURCES,
  { value: 'NONE', label: 'Sin fuente' },
];

export const ITEM_STATUS_OPTIONS = [
  { value: 'PENDIENTE',    label: 'Pendiente' },
  { value: 'PARCIAL',      label: 'Parcial' },
  { value: 'ATENDIDO',     label: 'Atendido' },
  { value: 'STAND_BY',     label: 'Stand by' },
  { value: 'DESESTIMADO',  label: 'Desestimado' },
  { value: 'ANULADO',      label: 'Anulado' },
  { value: 'SIN_VINCULAR', label: 'Sin vincular' },
];

export const STAGE_OPTIONS = [
  { value: 'BORRADOR',           label: 'Borrador' },
  { value: 'EN_VALIDACION',      label: 'En validación' },
  { value: 'REVISION_GERENCIA',  label: 'En revisión de gerencia' },
  { value: 'RECHAZADO',          label: 'Rechazado' },
  { value: 'VERIFICACION_STOCK', label: 'Verificación de stock' },
  { value: 'COTIZACION',         label: 'Cotización y costo' },
  { value: 'ORDEN_COMPRA',       label: 'Orden de compra' },
  { value: 'POR_ENTREGAR',       label: 'Por entregar (almacén)' },
  { value: 'RECEPCION_CALIDAD',  label: 'Recepción y calidad' },
  { value: 'RECLAMO_PROVEEDOR',  label: 'Reclamo al proveedor' },
  { value: 'DESPACHADO',         label: 'Despachado a obra' },
  { value: 'ENTREGADO',          label: 'Entregado' },
  { value: 'CONFORMIDAD',        label: 'Conformidad del usuario' },
  { value: 'RECLAMO_USUARIO',    label: 'Reclamo del usuario' },
  { value: 'CERRADO',            label: 'Cerrado' },
  { value: 'CANCELADO',          label: 'Cancelado' },
];

export const ITEM_STATUS_LABELS = Object.fromEntries(ITEM_STATUS_OPTIONS.map((o) => [o.value, o.label]));
export const STAGE_LABELS = Object.fromEntries(STAGE_OPTIONS.map((o) => [o.value, o.label]));

/** Opciones de «filas por página» (el servidor admite hasta 100). */
export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/** Campos de orden aceptados por cada vista (el servidor responde 400 a cualquier otro). */
export const ITEM_ORDERING_FIELDS = [
  'rq_number', 'line_number', 'need_date', 'approval_date', 'project', 'requested_by', 'quantity',
  'source', 'priority', 'status', 'attended', 'missing', 'attended_date',
];
export const SUMMARY_ORDERING_FIELDS = [
  'rq_number', 'percent', 'approval_date', 'need_date', 'items_total', 'project', 'stage',
];

export const MAX_SEARCH_LENGTH = 100;
/** Espera tras dejar de teclear antes de consultar la búsqueda (ms). */
export const SEARCH_DEBOUNCE_MS = 400;
export const MAX_OVERRIDE_NOTE = 300;

export const OVERRIDE_LABELS = {
  STAND_BY: 'Stand by',
  DESESTIMADO: 'Desestimado',
};
