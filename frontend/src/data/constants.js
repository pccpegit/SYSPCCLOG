// ============================================================
// constants.js — UI display constants for the RQ System
// These are local UI constants only — they do NOT come from the API.
// ============================================================

// ------------------------------------------------------------
// SYSPCC-019: frente "Oficina Central" — discriminador de UI usado en
// "Nuevo Requerimiento" (RequestCreatePage) para fijar Servicio/Proyecto
// y forzar flujo ADMINISTRATIVE. Mirror del backend
// (apps/core/enums.py::OFICINA_CENTRAL_FRENTE), comparar .trim().toUpperCase().
// ------------------------------------------------------------
export const FRENTE_OFICINA_CENTRAL = 'OFICINA CENTRAL';

export function isOficinaCentral(frente) {
  return (frente || '').trim().toUpperCase() === FRENTE_OFICINA_CENTRAL;
}

// ------------------------------------------------------------
// ROLES
// ------------------------------------------------------------
export const ROLES = {
  // Comunes
  REQUESTER:              'REQUESTER',
  GENERAL_MANAGER:        'GENERAL_MANAGER',
  CENTRAL_WAREHOUSE:      'CENTRAL_WAREHOUSE',
  // Operaciones
  PROJECT_RESIDENT:       'PROJECT_RESIDENT',
  PROJECT_CONTROL:        'PROJECT_CONTROL',
  LOGISTICS_COORDINATOR:  'LOGISTICS_COORDINATOR',
  SITE_WAREHOUSE:         'SITE_WAREHOUSE',
  // Administración
  DIRECT_SUPERVISOR:      'DIRECT_SUPERVISOR',
  ADMIN_MANAGER:          'ADMIN_MANAGER',
  LOGISTICS_SUPERVISOR:   'LOGISTICS_SUPERVISOR',
  LOGISTICS_CHIEF:        'LOGISTICS_CHIEF',
  PASAJES_MANAGER:        'PASAJES_MANAGER',
};

// ------------------------------------------------------------
// ROLE_LABELS
// Spanish display labels for each role constant.
// ------------------------------------------------------------
export const ROLE_LABELS = {
  [ROLES.REQUESTER]:              'Solicitante',
  [ROLES.GENERAL_MANAGER]:        'Gerente General',
  [ROLES.CENTRAL_WAREHOUSE]:      'Almacén Central',
  [ROLES.PROJECT_RESIDENT]:       'Residente de Proyecto',
  [ROLES.PROJECT_CONTROL]:        'Control de Proyecto',
  [ROLES.LOGISTICS_COORDINATOR]:  'Coord. Logístico',
  [ROLES.SITE_WAREHOUSE]:         'Almacén de Obra',
  [ROLES.DIRECT_SUPERVISOR]:      'Jefe Directo',
  [ROLES.ADMIN_MANAGER]:          'Gte. Administrativo',
  [ROLES.LOGISTICS_SUPERVISOR]:   'Supervisor Logístico',
  [ROLES.LOGISTICS_CHIEF]:        'Jefe Logístico',
  [ROLES.PASAJES_MANAGER]:        'Gestor de Pasajes',
};

// ------------------------------------------------------------
// STATUS
// Full 25-status workflow spanning 5 phases.
// ------------------------------------------------------------
export const STATUS = {
  // Phase 1 — Solicitud
  DRAFT:                'DRAFT',
  SUBMITTED:            'SUBMITTED',

  // Phase 2 — Validación
  TECHNICAL_REVIEW:     'TECHNICAL_REVIEW',
  TECHNICAL_APPROVED:   'TECHNICAL_APPROVED',
  TECHNICAL_REJECTED:   'TECHNICAL_REJECTED',
  BUDGET_REVIEW:        'BUDGET_REVIEW',
  WITHIN_PROPOSAL:      'WITHIN_PROPOSAL',
  ADDITIONAL_REQ:       'ADDITIONAL_REQ',
  GM_REVIEW:            'GM_REVIEW',
  GM_APPROVED:          'GM_APPROVED',
  GM_REJECTED:          'GM_REJECTED',
  VALIDATED:            'VALIDATED',

  // Phase 3 — Adquisición
  STOCK_CHECK:          'STOCK_CHECK',
  IN_STOCK:             'IN_STOCK',
  REQUIRES_PURCHASE:    'REQUIRES_PURCHASE',
  QUOTING:              'QUOTING',
  QUOTE_SELECTED:       'QUOTE_SELECTED',
  QUOTE_COST_APPROVED:  'QUOTE_COST_APPROVED',
  COST_OVERRUN_REVIEW:  'COST_OVERRUN_REVIEW',
  PO_GENERATED:         'PO_GENERATED',

  // Phase 4 — Entrega
  RECEIVING:            'RECEIVING',
  QUALITY_CHECK:        'QUALITY_CHECK',
  QUALITY_REJECTED:     'QUALITY_REJECTED',
  DISPATCHED_TO_SITE:   'DISPATCHED_TO_SITE',
  DELIVERED:            'DELIVERED',

  // Phase 4 — Entrega (Admin flow)
  RECEPTION_CONFORMITY: 'RECEPTION_CONFORMITY',
  RECEPTION_CLAIM:      'RECEPTION_CLAIM',
  WAREHOUSE_UPDATED:    'WAREHOUSE_UPDATED',

  // Phase 4 — Entrega (OPS)
  QUALITY_APPROVED:     'QUALITY_APPROVED',

  // Phase 3 — Adquisición (Admin flow)
  QUOTE_COMPARISON:     'QUOTE_COMPARISON',
  COST_OVERRUN_APPROVED:'COST_OVERRUN_APPROVED',
  COST_OVERRUN_REJECTED:'COST_OVERRUN_REJECTED',

  // Phase 2 — Validación (Admin flow)
  SUPERVISOR_REVIEW:    'SUPERVISOR_REVIEW',
  SUPERVISOR_APPROVED:  'SUPERVISOR_APPROVED',
  SUPERVISOR_REJECTED:  'SUPERVISOR_REJECTED',
  ADMIN_BUDGET_REVIEW:  'ADMIN_BUDGET_REVIEW',
  WITHIN_ANNUAL_PLAN:   'WITHIN_ANNUAL_PLAN',
  OUT_OF_ANNUAL_PLAN:   'OUT_OF_ANNUAL_PLAN',

  // Phase 5 — Cierre
  CLAIM_IN_REVIEW:      'CLAIM_IN_REVIEW',
  CLAIM_RESOLVED:       'CLAIM_RESOLVED',
  USER_CONFORMITY:      'USER_CONFORMITY',
  USER_CLAIM:           'USER_CLAIM',
  CLOSED:               'CLOSED',
  CANCELLED:            'CANCELLED',
};

// Backward-compatibility alias
export const STATUSES = STATUS;

// ------------------------------------------------------------
// STATUS_CONFIG
// ------------------------------------------------------------
export const STATUS_CONFIG = {
  // Phase 1
  [STATUS.DRAFT]: {
    label: 'Borrador',
    color: 'bg-gray-100 text-gray-700',
    bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400',
    phase: 1,
  },
  [STATUS.SUBMITTED]: {
    label: 'Enviado',
    color: 'bg-blue-100 text-blue-700',
    bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500',
    phase: 1,
  },

  // Phase 2
  [STATUS.TECHNICAL_REVIEW]: {
    label: 'Revisión Técnica',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 2,
  },
  [STATUS.TECHNICAL_APPROVED]: {
    label: 'Aprobado Técnico',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 2,
  },
  [STATUS.TECHNICAL_REJECTED]: {
    label: 'Rechazado Técnico',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 2,
  },
  [STATUS.BUDGET_REVIEW]: {
    label: 'Revisión Presupuestal',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 2,
  },
  [STATUS.WITHIN_PROPOSAL]: {
    label: 'Dentro de Propuesta',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 2,
  },
  [STATUS.ADDITIONAL_REQ]: {
    label: 'Requerimiento Adicional',
    color: 'bg-orange-100 text-orange-700',
    bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500',
    phase: 2,
  },
  [STATUS.GM_REVIEW]: {
    label: 'Revisión Gerencia',
    color: 'bg-purple-100 text-purple-700',
    bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500',
    phase: 2,
  },
  [STATUS.GM_APPROVED]: {
    label: 'Aprobado Gerencia',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 2,
  },
  [STATUS.GM_REJECTED]: {
    label: 'Rechazado Gerencia',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 2,
  },
  [STATUS.VALIDATED]: {
    label: 'Validado',
    color: 'bg-green-100 text-green-700',
    bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500',
    phase: 2,
  },

  // Phase 3
  [STATUS.STOCK_CHECK]: {
    label: 'Verificando Stock',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 3,
  },
  [STATUS.IN_STOCK]: {
    label: 'En Stock',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 3,
  },
  [STATUS.REQUIRES_PURCHASE]: {
    label: 'Requiere Compra',
    color: 'bg-orange-100 text-orange-700',
    bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500',
    phase: 3,
  },
  [STATUS.QUOTING]: {
    label: 'Cotizando',
    color: 'bg-blue-100 text-blue-700',
    bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500',
    phase: 3,
  },
  [STATUS.QUOTE_SELECTED]: {
    label: 'Cotización Seleccionada',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 3,
  },
  [STATUS.QUOTE_COST_APPROVED]: {
    label: 'Costo Aprobado — Pendiente OC',
    color: 'bg-emerald-100 text-emerald-700',
    bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500',
    phase: 3,
  },
  [STATUS.COST_OVERRUN_REVIEW]: {
    label: 'Revisión Sobrecosto',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 3,
  },
  [STATUS.PO_GENERATED]: {
    label: 'Orden de Compra Generada',
    color: 'bg-indigo-100 text-indigo-700',
    bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500',
    phase: 3,
  },

  // Phase 4
  [STATUS.RECEIVING]: {
    label: 'En Recepción',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 4,
  },
  [STATUS.QUALITY_CHECK]: {
    label: 'Control de Calidad',
    color: 'bg-blue-100 text-blue-700',
    bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500',
    phase: 4,
  },
  [STATUS.QUALITY_REJECTED]: {
    label: 'Calidad Rechazada',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 4,
  },
  [STATUS.DISPATCHED_TO_SITE]: {
    label: 'Despachado a Obra',
    color: 'bg-indigo-100 text-indigo-700',
    bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500',
    phase: 4,
  },
  [STATUS.DELIVERED]: {
    label: 'Entregado en Obra',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 4,
  },

  // Phase 5
  [STATUS.USER_CONFORMITY]: {
    label: 'Conformidad Usuario',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 5,
  },
  [STATUS.USER_CLAIM]: {
    label: 'Reclamo Usuario',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 5,
  },
  [STATUS.CLOSED]: {
    label: 'Cerrado',
    color: 'bg-gray-200 text-gray-600',
    bg: 'bg-gray-200', text: 'text-gray-600', dot: 'bg-gray-400',
    phase: 5,
  },
  [STATUS.CANCELLED]: {
    label: 'Cancelado',
    color: 'bg-gray-100 text-red-600',
    bg: 'bg-gray-100', text: 'text-red-600', dot: 'bg-gray-300',
    phase: null,
  },

  // Admin flow statuses
  [STATUS.SUPERVISOR_REVIEW]: {
    label: 'Revisión Jefe Directo',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 2,
  },
  [STATUS.SUPERVISOR_APPROVED]: {
    label: 'Aprobado por Jefe Directo',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 2,
  },
  [STATUS.SUPERVISOR_REJECTED]: {
    label: 'Rechazado por Jefe Directo',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 2,
  },
  [STATUS.ADMIN_BUDGET_REVIEW]: {
    label: 'Revisión Gte. Administrativo',
    color: 'bg-yellow-100 text-yellow-800',
    bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500',
    phase: 2,
  },
  [STATUS.WITHIN_ANNUAL_PLAN]: {
    label: 'Dentro del Plan Anual',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 2,
  },
  [STATUS.OUT_OF_ANNUAL_PLAN]: {
    label: 'Fuera del Plan Anual',
    color: 'bg-orange-100 text-orange-700',
    bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500',
    phase: 2,
  },
  [STATUS.QUOTE_COMPARISON]: {
    label: 'Comparativo de Cotizaciones',
    color: 'bg-blue-100 text-blue-700',
    bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500',
    phase: 3,
  },
  [STATUS.COST_OVERRUN_APPROVED]: {
    label: 'Sobrecosto Aprobado',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 3,
  },
  [STATUS.COST_OVERRUN_REJECTED]: {
    label: 'Sobrecosto Rechazado',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 3,
  },
  [STATUS.QUALITY_APPROVED]: {
    label: 'Calidad Aprobada',
    color: 'bg-green-100 text-green-700',
    bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500',
    phase: 4,
  },
  [STATUS.RECEPTION_CONFORMITY]: {
    label: 'Recepción Conforme',
    color: 'bg-green-100 text-green-700',
    bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500',
    phase: 4,
  },
  [STATUS.RECEPTION_CLAIM]: {
    label: 'Reclamo en Recepción',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 4,
  },
  [STATUS.WAREHOUSE_UPDATED]: {
    label: 'Almacén Actualizado',
    color: 'bg-indigo-100 text-indigo-700',
    bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500',
    phase: 4,
  },
  [STATUS.CLAIM_IN_REVIEW]: {
    label: 'Reclamo en Revisión',
    color: 'bg-orange-100 text-orange-700',
    bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500',
    phase: 5,
  },
  [STATUS.CLAIM_RESOLVED]: {
    label: 'Reclamo Resuelto',
    color: 'bg-teal-100 text-teal-700',
    bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500',
    phase: 5,
  },

  // Supplier claim cycle
  SUPPLIER_CLAIM_SENT: {
    label: 'Reclamo Enviado al Proveedor',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 4,
  },
  SUPPLIER_CLAIM_PENDING: {
    label: 'Esperando Reposición del Proveedor',
    color: 'bg-amber-100 text-amber-700',
    bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500',
    phase: 4,
  },
  SUPPLIER_REPLACEMENT_RECEIVED: {
    label: 'Reposición Recibida — En Verificación',
    color: 'bg-cyan-100 text-cyan-700',
    bg: 'bg-cyan-100', text: 'text-cyan-700', dot: 'bg-cyan-500',
    phase: 4,
  },
};

// ------------------------------------------------------------
// PRIORITY_CONFIG
// ------------------------------------------------------------
export const PRIORITY_CONFIG = {
  URGENT: {
    label: 'Urgente',
    color: 'bg-red-100 text-red-700 border-red-300',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
  },
  HIGH: {
    label: 'Alta',
    color: 'bg-orange-100 text-orange-700 border-orange-300',
    bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500',
  },
  NORMAL: {
    label: 'Normal',
    color: 'bg-blue-100 text-blue-700 border-blue-300',
    bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500',
  },
  LOW: {
    label: 'Baja',
    color: 'bg-gray-100 text-gray-600 border-gray-300',
    bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400',
  },
};

export const PRIORITIES = {
  URGENT: 'URGENT',
  HIGH:   'HIGH',
  NORMAL: 'NORMAL',
  LOW:    'LOW',
};

// ------------------------------------------------------------
// LIFECYCLE_PHASES
// Ordered array that drives the lifecycle progress bar (LifecycleBar).
// getPhaseForStatus returns the 0-based INDEX into this array.
// ------------------------------------------------------------
export const LIFECYCLE_PHASES = [
  {
    id:       1,
    name:     'Solicitud',
    label:    'Solicitud',
    icon:     'FileText',
    statuses: [STATUS.DRAFT, STATUS.SUBMITTED],
  },
  {
    id:       2,
    name:     'Validación',
    label:    'Validación',
    icon:     'ClipboardCheck',
    statuses: [
      STATUS.TECHNICAL_REVIEW,
      STATUS.TECHNICAL_APPROVED,
      STATUS.TECHNICAL_REJECTED,
      STATUS.BUDGET_REVIEW,
      STATUS.WITHIN_PROPOSAL,
      STATUS.ADDITIONAL_REQ,
      STATUS.SUPERVISOR_REVIEW,
      STATUS.SUPERVISOR_APPROVED,
      STATUS.SUPERVISOR_REJECTED,
      STATUS.ADMIN_BUDGET_REVIEW,
      STATUS.WITHIN_ANNUAL_PLAN,
      STATUS.OUT_OF_ANNUAL_PLAN,
      STATUS.GM_REVIEW,
      STATUS.GM_APPROVED,
      STATUS.GM_REJECTED,
      STATUS.VALIDATED,
    ],
  },
  {
    id:       3,
    name:     'Adquisición',
    label:    'Adquisición',
    icon:     'ShoppingCart',
    statuses: [
      STATUS.STOCK_CHECK,
      STATUS.IN_STOCK,
      STATUS.REQUIRES_PURCHASE,
      STATUS.QUOTING,
      STATUS.QUOTE_COMPARISON,
      STATUS.QUOTE_SELECTED,
      STATUS.COST_OVERRUN_REVIEW,
      STATUS.COST_OVERRUN_APPROVED,
      STATUS.COST_OVERRUN_REJECTED,
      STATUS.PO_GENERATED,
    ],
  },
  {
    id:       4,
    name:     'Entrega',
    label:    'Entrega',
    icon:     'Truck',
    statuses: [
      STATUS.RECEIVING,
      STATUS.QUALITY_CHECK,
      STATUS.QUALITY_APPROVED,
      STATUS.QUALITY_REJECTED,
      STATUS.RECEPTION_CONFORMITY,
      STATUS.RECEPTION_CLAIM,
      STATUS.DISPATCHED_TO_SITE,
      STATUS.DELIVERED,
      STATUS.WAREHOUSE_UPDATED,
    ],
  },
  {
    id:       5,
    name:     'Cierre',
    label:    'Cierre',
    icon:     'CheckCircle',
    statuses: [STATUS.USER_CONFORMITY, STATUS.USER_CLAIM, STATUS.CLAIM_IN_REVIEW, STATUS.CLAIM_RESOLVED, STATUS.CLOSED],
  },
];

/**
 * Returns the 0-based phase index for a given status key.
 * Returns -1 for CANCELLED or any status not found.
 */
export function getPhaseForStatus(status) {
  if (status === STATUS.CANCELLED) return -1;
  return LIFECYCLE_PHASES.findIndex((phase) => phase.statuses.includes(status));
}

/**
 * Returns the 1-based phase id for a given status key.
 * Returns null for CANCELLED.
 */
export function getPhaseIdForStatus(status) {
  if (status === STATUS.CANCELLED) return null;
  const phase = LIFECYCLE_PHASES.find((p) => p.statuses.includes(status));
  return phase ? phase.id : null;
}
