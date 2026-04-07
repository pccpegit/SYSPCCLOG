// ============================================================
// mockData.js — RQ System Prototype Mock Data
// Empresa: SYSPCC | Moneda: Soles peruanos (S/)
// Última actualización: 2026-03-07
// ============================================================

// ------------------------------------------------------------
// 1. ROLES
// ------------------------------------------------------------
export const ROLES = {
  REQUESTER:         'REQUESTER',
  PROJECT_RESIDENT:  'PROJECT_RESIDENT',
  PROJECT_CONTROL:   'PROJECT_CONTROL',
  GENERAL_MANAGER:   'GENERAL_MANAGER',
  LOGISTICS:         'LOGISTICS',
  CENTRAL_WAREHOUSE: 'CENTRAL_WAREHOUSE',
  SITE_WAREHOUSE:    'SITE_WAREHOUSE',
};

// ------------------------------------------------------------
// 2. ROLE_LABELS
// Spanish display labels for each role constant.
// ------------------------------------------------------------
export const ROLE_LABELS = {
  [ROLES.REQUESTER]:         'Usuario',
  [ROLES.PROJECT_RESIDENT]:  'Residente de Proyecto',
  [ROLES.PROJECT_CONTROL]:   'Control de Proyecto',
  [ROLES.GENERAL_MANAGER]:   'Gerente General',
  [ROLES.LOGISTICS]:         'Coord. Logístico',
  [ROLES.CENTRAL_WAREHOUSE]: 'Almacén Central',
  [ROLES.SITE_WAREHOUSE]:    'Almacén de Obra',
};

// ------------------------------------------------------------
// 3. STATUS
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
  COST_OVERRUN_REVIEW:  'COST_OVERRUN_REVIEW',
  PO_GENERATED:         'PO_GENERATED',

  // Phase 4 — Entrega
  RECEIVING:            'RECEIVING',
  QUALITY_CHECK:        'QUALITY_CHECK',
  QUALITY_REJECTED:     'QUALITY_REJECTED',
  DISPATCHED_TO_SITE:   'DISPATCHED_TO_SITE',
  DELIVERED:            'DELIVERED',

  // Phase 5 — Cierre
  USER_CONFORMITY:      'USER_CONFORMITY',
  USER_CLAIM:           'USER_CLAIM',
  CLOSED:               'CLOSED',
  CANCELLED:            'CANCELLED',
};

// Backward-compatibility alias used by LifecycleBar and older references
export const STATUSES = STATUS;

// ------------------------------------------------------------
// 4. STATUS_CONFIG
// Each entry has:
//   label  — Spanish display text
//   color  — combined Tailwind string (bg + text) for compact pill usage
//   bg     — individual bg class  \
//   text   — individual text class  > kept for StatusBadge compatibility
//   dot    — individual dot class  /
//   phase  — 1–5 matching LIFECYCLE_PHASES, null for CANCELLED
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
  [STATUS.COST_OVERRUN_REVIEW]: {
    label: 'Revisión Sobrecosto',
    color: 'bg-red-100 text-red-700',
    bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500',
    phase: 3,
  },
  [STATUS.PO_GENERATED]: {
    label: 'OC Generada',
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
};

// ------------------------------------------------------------
// 5. PRIORITY_CONFIG
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

// Backward-compat constant object (some older files may import PRIORITIES)
export const PRIORITIES = {
  URGENT: 'URGENT',
  HIGH:   'HIGH',
  NORMAL: 'NORMAL',
  LOW:    'LOW',
};

// ------------------------------------------------------------
// 6. MOCK_USERS
// One user per role with realistic Peruvian names.
// ------------------------------------------------------------
export const MOCK_USERS = [
  {
    id:       1,
    name:     'Alberto Torres Quispe',
    email:    'atorres@syspcc.pe',
    role:     ROLES.REQUESTER,
    position: 'Ingeniero de Campo',
    avatar:   'AT',
  },
  {
    id:       2,
    name:     'Bruno Méndez Ríos',
    email:    'bmendez@syspcc.pe',
    role:     ROLES.PROJECT_RESIDENT,
    position: 'Residente de Obra',
    avatar:   'BM',
  },
  {
    id:       3,
    name:     'Carmen Villanueva Salas',
    email:    'cvillanueva@syspcc.pe',
    role:     ROLES.PROJECT_CONTROL,
    position: 'Controladora de Proyectos',
    avatar:   'CV',
  },
  {
    id:       4,
    name:     'Diego Paredes Huanca',
    email:    'dparedes@syspcc.pe',
    role:     ROLES.GENERAL_MANAGER,
    position: 'Gerente General',
    avatar:   'DP',
  },
  {
    id:       5,
    name:     'Elena Castillo Mora',
    email:    'ecastillo@syspcc.pe',
    role:     ROLES.LOGISTICS,
    position: 'Coordinadora Logística',
    avatar:   'EC',
  },
  {
    id:       6,
    name:     'Fernando Guzmán Lara',
    email:    'fguzman@syspcc.pe',
    role:     ROLES.CENTRAL_WAREHOUSE,
    position: 'Jefe de Almacén Central',
    avatar:   'FG',
  },
  {
    id:       7,
    name:     'Gloria Ramírez Chávez',
    email:    'gramirez@syspcc.pe',
    role:     ROLES.SITE_WAREHOUSE,
    position: 'Almacenera de Obra',
    avatar:   'GR',
  },
];

// ------------------------------------------------------------
// 7. MOCK_PROJECTS
// ------------------------------------------------------------
export const MOCK_PROJECTS = [
  {
    id:          1,
    code:        'OBRA-14',
    name:        'Edificio Residencial Los Pinos',
    location:    'San Borja, Lima',
    totalBudget: 500000,
    spentBudget: 340000,
    resident:    'Bruno Méndez Ríos',
    residentId:  2,
    startDate:   '2025-08-01',
    endDate:     '2026-09-30',
    status:      'En Ejecución',
    description: 'Edificio multifamiliar de 12 pisos con sótano doble. Estructura de concreto armado.',
  },
  {
    id:          2,
    code:        'OBRA-17',
    name:        'Centro Comercial Plaza Norte II',
    location:    'Independencia, Lima',
    totalBudget: 1200000,
    spentBudget: 520000,
    resident:    'Bruno Méndez Ríos',
    residentId:  2,
    startDate:   '2025-11-01',
    endDate:     '2027-03-31',
    status:      'En Ejecución',
    description: 'Ampliación y remodelación de centro comercial. Área de construcción: 8,400 m².',
  },
  {
    id:          3,
    code:        'OBRA-21',
    name:        'Planta Industrial Procesadora AGRO-SUR',
    location:    'Lurín, Lima',
    totalBudget: 850000,
    spentBudget: 105000,
    resident:    'Bruno Méndez Ríos',
    residentId:  2,
    startDate:   '2026-01-15',
    endDate:     '2026-12-31',
    status:      'Inicio',
    description: 'Construcción de planta industrial de 3,200 m² para procesamiento agroindustrial.',
  },
];

// ------------------------------------------------------------
// 8. MOCK_REQUESTS
// 8 supply requests covering the full workflow spectrum.
// Items use realistic construction materials in Spanish.
// ------------------------------------------------------------
export const MOCK_REQUESTS = [
  // ── RQ-2026-0001: CLOSED — ciclo completo ──────────────────
  {
    id:                   1,
    rqNumber:             'RQ-2026-0001',
    projectId:            1,
    projectCode:          'OBRA-14',
    projectName:          'Edificio Residencial Los Pinos',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'SYSPCC',
    servicio:             'CW140001 WO0001 - Vaciado Losa Nivel 5',
    usoEspecifico:        'Vaciado de losa de concreto armado piso 5',
    fechaEntrega:         '2026-01-14',
    description:          'Materiales de concreto para vaciado de losa del piso 5',
    justification:        'Programación de vaciado de losa del nivel 5 para el 15/01/2026 según cronograma contractual. Sin estos materiales se paraliza la obra.',
    priority:             'HIGH',
    status:               STATUS.CLOSED,
    estimatedCost:        18500,
    finalCost:            17980,
    budgetClassification: 'Dentro de Propuesta',
    createdAt:            '2026-01-05T08:30:00',
    requiredDate:         '2026-01-14',
    updatedAt:            '2026-01-28T16:00:00',
    items: [
      { lineNumber: 1, description: 'Cemento Portland Tipo I',     quantity: 120, unit: 'bolsa', specifications: 'Marca Sol o similar, 42.5 kg/bolsa',               stockAlmacenObra: 0, stockAlmacenPrincipal: 20, xAtender: 120, presupuestadoAdicional: 'P', rfiFwo: 'RFI-001', estatusGuia: 'GR-2026-0047', comentarios: 'Entregado completo' },
      { lineNumber: 2, description: 'Arena gruesa de río',          quantity: 8,   unit: 'm³',   specifications: 'Granulometría según NTP 400.037, libre de arcilla',   stockAlmacenObra: 0, stockAlmacenPrincipal: 0,  xAtender: 8,   presupuestadoAdicional: 'P', rfiFwo: 'RFI-001', estatusGuia: 'GR-2026-0047', comentarios: 'Entregado completo' },
      { lineNumber: 3, description: 'Piedra chancada 3/4"',         quantity: 10,  unit: 'm³',   specifications: 'Resistencia mínima 2000 kg/cm², limpia y sin finos',  stockAlmacenObra: 0, stockAlmacenPrincipal: 0,  xAtender: 10,  presupuestadoAdicional: 'P', rfiFwo: 'RFI-001', estatusGuia: 'GR-2026-0047', comentarios: 'Entregado completo' },
      { lineNumber: 4, description: 'Aditivo plastificante Sika',  quantity: 25,  unit: 'litro', specifications: 'Sika Plastiment-20 o equivalente aprobado',            stockAlmacenObra: 0, stockAlmacenPrincipal: 5,  xAtender: 25,  presupuestadoAdicional: 'P', rfiFwo: 'RFI-001', estatusGuia: 'GR-2026-0047', comentarios: 'Entregado completo' },
    ],
    approvals: [
      { action: 'Enviado',                         by: 'Alberto Torres Quispe',   role: ROLES.REQUESTER,         date: '2026-01-05T08:30:00', comments: 'Solicitud urgente por cronograma.' },
      { action: 'Aprobado Técnicamente',           by: 'Bruno Méndez Ríos',       role: ROLES.PROJECT_RESIDENT,  date: '2026-01-06T10:15:00', comments: 'Cantidades verificadas con el expediente técnico.' },
      { action: 'Aprobado Presupuestalmente',      by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,   date: '2026-01-07T09:00:00', comments: 'Costo dentro del presupuesto de concreto aprobado.' },
      { action: 'Stock verificado — Req. Compra',  by: 'Fernando Guzmán Lara',   role: ROLES.CENTRAL_WAREHOUSE,  date: '2026-01-07T14:30:00', comments: 'Stock insuficiente. Se procede a cotización.' },
      { action: 'OC Generada',                     by: 'Elena Castillo Mora',    role: ROLES.LOGISTICS,          date: '2026-01-10T11:00:00', comments: 'OC-2026-0047 emitida a Distribuidora Lima S.A.C.' },
      { action: 'Recibido en Almacén',             by: 'Fernando Guzmán Lara',   role: ROLES.CENTRAL_WAREHOUSE,  date: '2026-01-13T08:00:00', comments: 'Recepción completa. Calidad conforme.' },
      { action: 'Despachado a Obra',               by: 'Gloria Ramírez Chávez',  role: ROLES.SITE_WAREHOUSE,     date: '2026-01-13T15:00:00', comments: 'Despacho realizado en camión #12.' },
      { action: 'Conformidad del Usuario',         by: 'Alberto Torres Quispe',  role: ROLES.REQUESTER,          date: '2026-01-15T07:45:00', comments: 'Materiales recibidos conforme. Vaciado exitoso.' },
      { action: 'Cerrado',                         by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,   date: '2026-01-28T16:00:00', comments: 'RQ cerrada correctamente. Costo final S/ 17,980.' },
    ],
  },

  // ── RQ-2026-0002: DELIVERED — pendiente conformidad usuario ──
  {
    id:                   2,
    rqNumber:             'RQ-2026-0002',
    projectId:            1,
    projectCode:          'OBRA-14',
    projectName:          'Edificio Residencial Los Pinos',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'SYSPCC',
    servicio:             'CW140002 WO0003 - Encofrado Columnas P7-P8',
    usoEspecifico:        'Encofrado de columnas niveles 7 y 8',
    fechaEntrega:         '2026-02-05',
    description:          'Encofrado metálico para columnas del piso 7 y 8',
    justification:        'Las columnas del nivel 7 requieren encofrado de mayor resistencia por las dimensiones estructurales. El encofrado de madera actual no cumple con la especificación técnica.',
    priority:             'HIGH',
    status:               STATUS.DELIVERED,
    estimatedCost:        32000,
    finalCost:            31500,
    budgetClassification: 'Dentro de Propuesta',
    createdAt:            '2026-01-20T09:00:00',
    requiredDate:         '2026-02-05',
    updatedAt:            '2026-02-18T10:00:00',
    items: [
      { lineNumber: 1, description: 'Panel de encofrado metálico 0.90×1.80 m', quantity: 40, unit: 'und', specifications: 'Acero galvanizado calibre 14, presión máx. 60 kN/m²',    stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 40, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Puntales metálicos telescópicos',          quantity: 24, unit: 'und', specifications: 'Altura regulable 2.0–3.5 m, carga nominal 15 kN',          stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 24, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Accesorios de fijación y anclaje',         quantity: 1,  unit: 'kit', specifications: 'Kit completo: pasadores, cuñas, grapas para 40 paneles',  stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 1,  presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado',                     by: 'Alberto Torres Quispe',   role: ROLES.REQUESTER,         date: '2026-01-20T09:00:00', comments: 'Necesario para avanzar en casco.' },
      { action: 'Aprobado Técnicamente',       by: 'Bruno Méndez Ríos',       role: ROLES.PROJECT_RESIDENT,  date: '2026-01-21T11:00:00', comments: 'Especificaciones validadas con diseño estructural.' },
      { action: 'Aprobado Presupuestalmente',  by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,   date: '2026-01-22T09:30:00', comments: 'Presupuesto de encofrado disponible.' },
      { action: 'OC Generada',                 by: 'Elena Castillo Mora',    role: ROLES.LOGISTICS,          date: '2026-01-25T14:00:00', comments: 'OC-2026-0063 a Encofrados del Perú E.I.R.L.' },
      { action: 'Recibido y Despachado',       by: 'Fernando Guzmán Lara',   role: ROLES.CENTRAL_WAREHOUSE,  date: '2026-02-04T07:30:00', comments: 'Recepción y despacho directo a obra.' },
      { action: 'Entregado en Obra',           by: 'Gloria Ramírez Chávez',  role: ROLES.SITE_WAREHOUSE,     date: '2026-02-04T16:00:00', comments: 'Entregado al Ing. Torres en almacén de obra.' },
    ],
  },

  // ── RQ-2026-0003: PO_GENERATED — en adquisición ─────────────
  {
    id:                   3,
    rqNumber:             'RQ-2026-0003',
    projectId:            2,
    projectCode:          'OBRA-17',
    projectName:          'Centro Comercial Plaza Norte II',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Acabados',
    frente:               'SYSPCC',
    servicio:             'CW170001 WO0005 - Acabados Sótano',
    usoEspecifico:        'Pintura de pisos de estacionamiento y zonas húmedas',
    fechaEntrega:         '2026-02-25',
    description:          'Pintura epóxica para pisos de estacionamiento y zonas húmedas',
    justification:        'Acabado de pisos de sótano y estacionamiento según especificaciones del proyecto. La pintura epóxica es requerida por el cliente para garantizar durabilidad y resistencia química.',
    priority:             'NORMAL',
    status:               STATUS.PO_GENERATED,
    estimatedCost:        14200,
    finalCost:            null,
    budgetClassification: 'Dentro de Propuesta',
    createdAt:            '2026-02-01T10:00:00',
    requiredDate:         '2026-02-25',
    updatedAt:            '2026-02-14T15:00:00',
    poNumber:             'OC-2026-0089',
    supplier:             'Pinturas Tekno S.A.',
    items: [
      { lineNumber: 1, description: 'Pintura epóxica base solvente — Parte A', quantity: 30, unit: 'galón', specifications: 'Tekno Epoxi 4000 o equiv. Color gris tráfico. Catalizador incluido.', stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 30, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Pintura epóxica base solvente — Parte B', quantity: 30, unit: 'galón', specifications: 'Catalizador para Tekno Epoxi 4000',                                    stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 30, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Diluyente epóxico',                        quantity: 10, unit: 'galón', specifications: 'Diluyente específico para sistema epóxico',                            stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 10, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 4, description: 'Sellador de piso (primer)',                quantity: 15, unit: 'galón', specifications: 'Primer epóxico para concreto, penetración mín. 2 mm',                  stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 15, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado',                     by: 'Alberto Torres Quispe',   role: ROLES.REQUESTER,        date: '2026-02-01T10:00:00', comments: 'Acabados de sótano programados para quincena de febrero.' },
      { action: 'Aprobado Técnicamente',       by: 'Bruno Méndez Ríos',       role: ROLES.PROJECT_RESIDENT, date: '2026-02-03T08:30:00', comments: 'OK según especificaciones de arquitectura.' },
      { action: 'Aprobado Presupuestalmente',  by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,  date: '2026-02-04T10:00:00', comments: 'Dentro del presupuesto de acabados.' },
      { action: 'OC Generada',                 by: 'Elena Castillo Mora',    role: ROLES.LOGISTICS,         date: '2026-02-14T15:00:00', comments: 'OC-2026-0089 a Pinturas Tekno. Entrega estimada 24/02.' },
    ],
  },

  // ── RQ-2026-0004: GM_REVIEW — req. adicional, pendiente gerente ──
  {
    id:                   4,
    rqNumber:             'RQ-2026-0004',
    projectId:            1,
    projectCode:          'OBRA-14',
    projectName:          'Edificio Residencial Los Pinos',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'SYSPCC',
    servicio:             'CW140003 WO0004 - Drenaje Sótano N-2',
    usoEspecifico:        'Sistema de bombeo temporal para drenaje de napa freática',
    fechaEntrega:         '2026-02-18',
    description:          'Sistema de bombeo para drenaje de sótano — requerimiento adicional',
    justification:        'Durante la excavación del sótano nivel -2 se detectó nivel freático más alto que lo proyectado. Se requiere sistema de bombeo temporal no contemplado en el presupuesto original.',
    priority:             'URGENT',
    status:               STATUS.GM_REVIEW,
    estimatedCost:        28000,
    finalCost:            null,
    budgetClassification: 'Requerimiento Adicional',
    createdAt:            '2026-02-10T07:00:00',
    requiredDate:         '2026-02-18',
    updatedAt:            '2026-02-16T09:00:00',
    items: [
      { lineNumber: 1, description: 'Bomba sumergible 2HP 3"',           quantity: 3,  unit: 'und', specifications: 'Caudal mín. 350 L/min, cable de 10 m, marca Pedrollo o equiv.', stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 3,  presupuestadoAdicional: 'A', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Tubería PVC SAP 3" (tramo 5 m)',    quantity: 20, unit: 'und', specifications: 'Clase 10, con unión e/ campana para descarga',                         stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 20, presupuestadoAdicional: 'A', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Manguera reforzada 3" flexible',    quantity: 30, unit: 'm',   specifications: 'Presión máx. 6 bar, temperatura -5 a 60 °C',                           stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 30, presupuestadoAdicional: 'A', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 4, description: 'Tablero eléctrico provisional 32A', quantity: 1,  unit: 'und', specifications: 'Con interruptor diferencial y breakers para 3 bombas',                 stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 1,  presupuestadoAdicional: 'A', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado',                     by: 'Alberto Torres Quispe',   role: ROLES.REQUESTER,        date: '2026-02-10T07:00:00', comments: 'URGENTE: nivel freático alto. Se paraliza si no se actúa hoy.' },
      { action: 'Aprobado Técnicamente',       by: 'Bruno Méndez Ríos',       role: ROLES.PROJECT_RESIDENT, date: '2026-02-10T09:00:00', comments: 'Verificado en campo. El nivel freático supera la cota -4.20 m.' },
      { action: 'Clasificado como Adicional',  by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,  date: '2026-02-11T08:30:00', comments: 'No contemplado en presupuesto. Requiere aprobación de Gerencia. Se adjunta sustento.' },
    ],
  },

  // ── RQ-2026-0005: BUDGET_REVIEW — pendiente control ─────────
  {
    id:                   5,
    rqNumber:             'RQ-2026-0005',
    projectId:            2,
    projectCode:          'OBRA-17',
    projectName:          'Centro Comercial Plaza Norte II',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'SYSPCC',
    servicio:             'CW170002 WO0006 - Cimentación Ampliación Este',
    usoEspecifico:        'Armado de columnas de refuerzo - cimentación',
    fechaEntrega:         '2026-03-01',
    description:          'Varillas de acero corrugado 1/2" y 5/8" para columnas de refuerzo',
    justification:        'Inicio de la etapa de cimentación de la ampliación este. Las varillas son necesarias para el armado de 24 columnas según el cronograma de la semana 8.',
    priority:             'HIGH',
    status:               STATUS.BUDGET_REVIEW,
    estimatedCost:        22400,
    finalCost:            null,
    budgetClassification: null,
    createdAt:            '2026-02-20T08:00:00',
    requiredDate:         '2026-03-01',
    updatedAt:            '2026-02-22T11:00:00',
    items: [
      { lineNumber: 1, description: 'Varilla corrugada de acero Ø 1/2" (12 m)', quantity: 150, unit: 'und', specifications: 'Grado 60, NTP 341.031, marca Aceros Arequipa o equiv.', stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 150, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Varilla corrugada de acero Ø 5/8" (12 m)', quantity: 80,  unit: 'und', specifications: 'Grado 60, NTP 341.031, marca Aceros Arequipa o equiv.', stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 80,  presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Alambre negro N° 16',                        quantity: 5,   unit: 'kg',  specifications: 'Para amarre de armadura',                               stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 5,   presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado',               by: 'Alberto Torres Quispe', role: ROLES.REQUESTER,        date: '2026-02-20T08:00:00', comments: 'Solicitud según programa semanal.' },
      { action: 'Aprobado Técnicamente', by: 'Bruno Méndez Ríos',     role: ROLES.PROJECT_RESIDENT, date: '2026-02-22T11:00:00', comments: 'Cantidades conformes con el metrado de armadura. Aprobado.' },
    ],
  },

  // ── RQ-2026-0006: TECHNICAL_REVIEW — pendiente residente ────
  {
    id:                   6,
    rqNumber:             'RQ-2026-0006',
    projectId:            3,
    projectCode:          'OBRA-21',
    projectName:          'Planta Industrial Procesadora AGRO-SUR',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Instalaciones',
    frente:               'AGRO-SUR',
    servicio:             'CW210001 WO0001 - IISS Área de Proceso',
    usoEspecifico:        'Instalaciones sanitarias de desagüe y agua potable',
    fechaEntrega:         '2026-03-20',
    description:          'Tubería PVC-U SAP para instalaciones sanitarias — área de proceso',
    justification:        'Inicio de instalaciones sanitarias del área de proceso de la planta. Tuberías para desagüe industrial y agua potable según planos IS-03 y IS-04.',
    priority:             'NORMAL',
    status:               STATUS.TECHNICAL_REVIEW,
    estimatedCost:        8750,
    finalCost:            null,
    budgetClassification: null,
    createdAt:            '2026-03-05T10:30:00',
    requiredDate:         '2026-03-20',
    updatedAt:            '2026-03-05T10:30:00',
    items: [
      { lineNumber: 1, description: 'Tubería PVC SAP 4" × 3 m (desagüe)',  quantity: 40, unit: 'und', specifications: 'Clase 10, NTP 399.003, para desagüe industrial',          stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 40, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Tubería PVC SAP 2" × 3 m (agua)',     quantity: 25, unit: 'und', specifications: 'Clase 10, NTP 399.002, para agua potable a presión',           stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 25, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Codo PVC 4" × 90°',                   quantity: 20, unit: 'und', specifications: 'Para desagüe, con junta elástica',                             stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 20, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 4, description: 'Codo PVC 2" × 90°',                   quantity: 15, unit: 'und', specifications: 'Para agua, roscado',                                           stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 15, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 5, description: 'Pegamento para PVC (1/4 galón)',       quantity: 6,  unit: 'und', specifications: 'Oatey o equiv., para uniones a presión',                       stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 6,  presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado', by: 'Alberto Torres Quispe', role: ROLES.REQUESTER, date: '2026-03-05T10:30:00', comments: 'Solicitud para inicio de IIEE sanitarias.' },
    ],
  },

  // ── RQ-2026-0007: DRAFT — no enviada aún ────────────────────
  {
    id:                   7,
    rqNumber:             'RQ-2026-0007',
    projectId:            3,
    projectCode:          'OBRA-21',
    projectName:          'Planta Industrial Procesadora AGRO-SUR',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'AGRO-SUR',
    servicio:             'CW210002 WO0002 - Excavación Manual Zona Sur',
    usoEspecifico:        'Herramientas para excavación manual',
    fechaEntrega:         '2026-03-15',
    description:          'Herramientas menores para frente de excavación manual',
    justification:        'Útiles y herramientas para inicio de trabajos de excavación manual en zona sur de la planta. Stock agotado en almacén de obra.',
    priority:             'LOW',
    status:               STATUS.DRAFT,
    estimatedCost:        3200,
    finalCost:            null,
    budgetClassification: null,
    createdAt:            '2026-03-06T16:00:00',
    requiredDate:         '2026-03-15',
    updatedAt:            '2026-03-06T16:00:00',
    items: [
      { lineNumber: 1, description: 'Pico de acero con mango de madera', quantity: 10, unit: 'und', specifications: 'Peso aprox. 2.5 kg, mango 80 cm',         stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 10, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Lampa cuadrada con mango',           quantity: 10, unit: 'und', specifications: 'Acero reforzado, mango 1.20 m',              stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 10, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 3, description: 'Carretilla buggy 80 L',              quantity: 4,  unit: 'und', specifications: 'Rueda neumática, cubeta de polietileno',     stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 4,  presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 4, description: 'Guantes de cuero reforzado (par)',   quantity: 20, unit: 'par', specifications: 'Talla M y L, resistente a abrasión',         stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 20, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 5, description: 'Casco de seguridad ANSI Z89.1',      quantity: 10, unit: 'und', specifications: 'Clase E, con rachet, colores variados',      stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 10, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [],
  },

  // ── RQ-2026-0008: VALIDATED — lista para logística ──────────
  {
    id:                   8,
    rqNumber:             'RQ-2026-0008',
    projectId:            1,
    projectCode:          'OBRA-14',
    projectName:          'Edificio Residencial Los Pinos',
    requestedBy:          1,
    requestedByName:      'Alberto Torres Quispe',
    area:                 'Producción',
    frente:               'SYSPCC',
    servicio:             'CW140004 WO0007 - Losa Entrepiso P6',
    usoEspecifico:        'Armado de losa aligerada nivel 6',
    fechaEntrega:         '2026-03-10',
    description:          'Malla de acero electrosoldada para losa de entrepiso piso 6',
    justification:        'Armado de losa aligerada del nivel 6. La malla electrosoldada reemplaza al armado manual según indicación del calculista para optimizar tiempo de ejecución.',
    priority:             'NORMAL',
    status:               STATUS.VALIDATED,
    estimatedCost:        9600,
    finalCost:            null,
    budgetClassification: 'Dentro de Propuesta',
    createdAt:            '2026-02-28T08:00:00',
    requiredDate:         '2026-03-10',
    updatedAt:            '2026-03-04T09:00:00',
    items: [
      { lineNumber: 1, description: 'Malla electrosoldada ASTM A497 Ø6mm / 15×15 cm', quantity: 25, unit: 'pln', specifications: 'Paño 2.40×6.00 m, acero fy=5000 kg/cm²',              stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 25, presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
      { lineNumber: 2, description: 'Alambre negro N° 16 para amarre',                  quantity: 8,  unit: 'kg',  specifications: 'Para fijación de malla y acero complementario',    stockAlmacenObra: 0, stockAlmacenPrincipal: 0, xAtender: 8,  presupuestadoAdicional: 'P', rfiFwo: '', estatusGuia: '', comentarios: '' },
    ],
    approvals: [
      { action: 'Enviado',                     by: 'Alberto Torres Quispe',   role: ROLES.REQUESTER,        date: '2026-02-28T08:00:00', comments: 'Losa de nivel 6 programada para semana 10.' },
      { action: 'Aprobado Técnicamente',       by: 'Bruno Méndez Ríos',       role: ROLES.PROJECT_RESIDENT, date: '2026-02-28T14:00:00', comments: 'Conforme. Malla especificada por el calculista.' },
      { action: 'Aprobado Presupuestalmente',  by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,  date: '2026-03-01T10:00:00', comments: 'Dentro del presupuesto de acero estructural.' },
      { action: 'Validado',                    by: 'Carmen Villanueva Salas', role: ROLES.PROJECT_CONTROL,  date: '2026-03-04T09:00:00', comments: 'RQ validada. Se envía a Coordinación Logística para atención.' },
    ],
  },
];

// ------------------------------------------------------------
// 9. LIFECYCLE_PHASES
// Ordered array that drives the lifecycle progress bar (LifecycleBar).
// Each phase exposes both `name` and `label` for compatibility.
// getPhaseForStatus returns the 0-based INDEX into this array.
// ------------------------------------------------------------
export const LIFECYCLE_PHASES = [
  {
    id:       1,
    name:     'Solicitud',
    label:    'Solicitud',      // used by LifecycleBar
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
      STATUS.QUOTE_SELECTED,
      STATUS.COST_OVERRUN_REVIEW,
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
      STATUS.QUALITY_REJECTED,
      STATUS.DISPATCHED_TO_SITE,
      STATUS.DELIVERED,
    ],
  },
  {
    id:       5,
    name:     'Cierre',
    label:    'Cierre',
    icon:     'CheckCircle',
    statuses: [STATUS.USER_CONFORMITY, STATUS.USER_CLAIM, STATUS.CLOSED],
  },
];

// ------------------------------------------------------------
// 10. HELPER FUNCTIONS
// ------------------------------------------------------------

/**
 * Returns the 0-based phase index for a given status key.
 * Used by LifecycleBar (mirrors LIFECYCLE_PHASES.findIndex behaviour).
 * Returns -1 for CANCELLED or any status not found.
 *
 * @param {string} status
 * @returns {number}
 */
export function getPhaseForStatus(status) {
  if (status === STATUS.CANCELLED) return -1;
  return LIFECYCLE_PHASES.findIndex((phase) => phase.statuses.includes(status));
}

/**
 * Returns the 1-based phase id for a given status key.
 * Returns null for statuses outside the main flow (CANCELLED).
 *
 * @param {string} status
 * @returns {number|null}
 */
export function getPhaseIdForStatus(status) {
  if (status === STATUS.CANCELLED) return null;
  const phase = LIFECYCLE_PHASES.find((p) => p.statuses.includes(status));
  return phase ? phase.id : null;
}

/**
 * Returns the requests visible to a given role.
 *
 * Visibility rules:
 *   REQUESTER         — only their own requests (requestedBy === 1 in prototype)
 *   PROJECT_RESIDENT  — all requests past the DRAFT stage
 *   PROJECT_CONTROL   — all requests from technical review onward
 *   GENERAL_MANAGER   — requests escalated to GM or already resolved by GM
 *   LOGISTICS         — requests from VALIDATED through delivery / closure
 *   CENTRAL_WAREHOUSE — requests at stock / receiving stages
 *   SITE_WAREHOUSE    — requests at dispatch and delivery stages
 *
 * @param {string} role
 * @returns {Array}
 */
export function getRequestsByRole(role) {
  switch (role) {
    case ROLES.REQUESTER:
      // Prototype: single requester with id 1
      return MOCK_REQUESTS.filter((r) => r.requestedBy === 1);

    case ROLES.PROJECT_RESIDENT:
      return MOCK_REQUESTS.filter((r) => r.status !== STATUS.DRAFT);

    case ROLES.PROJECT_CONTROL:
      return MOCK_REQUESTS.filter((r) =>
        ![STATUS.DRAFT, STATUS.SUBMITTED, STATUS.TECHNICAL_REVIEW].includes(r.status)
      );

    case ROLES.GENERAL_MANAGER:
      return MOCK_REQUESTS.filter((r) =>
        [
          STATUS.ADDITIONAL_REQ,
          STATUS.GM_REVIEW,
          STATUS.GM_APPROVED,
          STATUS.GM_REJECTED,
          STATUS.VALIDATED,
          STATUS.CLOSED,
        ].includes(r.status) ||
        r.budgetClassification === 'Requerimiento Adicional'
      );

    case ROLES.LOGISTICS:
      return MOCK_REQUESTS.filter((r) =>
        [
          STATUS.VALIDATED,
          STATUS.STOCK_CHECK,
          STATUS.IN_STOCK,
          STATUS.REQUIRES_PURCHASE,
          STATUS.QUOTING,
          STATUS.QUOTE_SELECTED,
          STATUS.COST_OVERRUN_REVIEW,
          STATUS.PO_GENERATED,
          STATUS.RECEIVING,
          STATUS.QUALITY_CHECK,
          STATUS.QUALITY_REJECTED,
          STATUS.DISPATCHED_TO_SITE,
          STATUS.DELIVERED,
          STATUS.USER_CONFORMITY,
          STATUS.CLOSED,
        ].includes(r.status)
      );

    case ROLES.CENTRAL_WAREHOUSE:
      return MOCK_REQUESTS.filter((r) =>
        [
          STATUS.STOCK_CHECK,
          STATUS.IN_STOCK,
          STATUS.REQUIRES_PURCHASE,
          STATUS.PO_GENERATED,
          STATUS.RECEIVING,
          STATUS.QUALITY_CHECK,
          STATUS.QUALITY_REJECTED,
          STATUS.DISPATCHED_TO_SITE,
        ].includes(r.status)
      );

    case ROLES.SITE_WAREHOUSE:
      return MOCK_REQUESTS.filter((r) =>
        [
          STATUS.DISPATCHED_TO_SITE,
          STATUS.DELIVERED,
          STATUS.USER_CONFORMITY,
          STATUS.USER_CLAIM,
        ].includes(r.status)
      );

    default:
      return [];
  }
}

/**
 * Returns requests actively pending an action from the given role.
 * Used for "bandeja de pendientes" / attention indicators in the UI.
 *
 * @param {string} role
 * @returns {Array}
 */
export function getPendingApprovals(role) {
  switch (role) {
    case ROLES.REQUESTER:
      // Drafts not yet submitted + delivered items awaiting user conformity
      return MOCK_REQUESTS.filter((r) =>
        [STATUS.DRAFT, STATUS.DELIVERED, STATUS.USER_CONFORMITY].includes(r.status)
      );

    case ROLES.PROJECT_RESIDENT:
      return MOCK_REQUESTS.filter((r) => r.status === STATUS.TECHNICAL_REVIEW);

    case ROLES.PROJECT_CONTROL:
      return MOCK_REQUESTS.filter((r) =>
        [STATUS.TECHNICAL_APPROVED, STATUS.BUDGET_REVIEW, STATUS.GM_APPROVED].includes(r.status)
      );

    case ROLES.GENERAL_MANAGER:
      return MOCK_REQUESTS.filter((r) => r.status === STATUS.GM_REVIEW);

    case ROLES.LOGISTICS:
      return MOCK_REQUESTS.filter((r) =>
        [STATUS.VALIDATED, STATUS.QUOTE_SELECTED, STATUS.COST_OVERRUN_REVIEW].includes(r.status)
      );

    case ROLES.CENTRAL_WAREHOUSE:
      return MOCK_REQUESTS.filter((r) =>
        [STATUS.STOCK_CHECK, STATUS.PO_GENERATED, STATUS.QUALITY_CHECK].includes(r.status)
      );

    case ROLES.SITE_WAREHOUSE:
      return MOCK_REQUESTS.filter((r) => r.status === STATUS.DISPATCHED_TO_SITE);

    default:
      return [];
  }
}

/**
 * Returns KPI statistics for the dashboard summary cards of a given role.
 *
 * Returned shape:
 * {
 *   total:         number,  // total requests visible to this role
 *   pending:       number,  // requests awaiting action from this role
 *   inProgress:    number,  // active (not DRAFT, not CLOSED/CANCELLED)
 *   closed:        number,  // completed (CLOSED)
 *   urgent:        number,  // URGENT-priority requests in pending queue
 *   rejected:      number,  // rejected at any stage in visible set
 *   totalBudget:   number,  // sum of estimatedCost for visible requests (S/)
 *   pendingBudget: number,  // sum of estimatedCost for pending requests (S/)
 * }
 *
 * @param {string} role
 * @returns {object}
 */
export function getDashboardStats(role) {
  const visible  = getRequestsByRole(role);
  const pending  = getPendingApprovals(role);

  const inProgress = visible.filter(
    (r) => ![STATUS.DRAFT, STATUS.CLOSED, STATUS.CANCELLED].includes(r.status)
  );

  const closed = visible.filter((r) => r.status === STATUS.CLOSED);

  const urgentPending = pending.filter((r) => r.priority === 'URGENT');

  const rejected = visible.filter((r) =>
    [STATUS.TECHNICAL_REJECTED, STATUS.GM_REJECTED, STATUS.QUALITY_REJECTED].includes(r.status)
  );

  const totalBudget = visible.reduce(
    (sum, r) => sum + (r.estimatedCost ?? 0),
    0
  );

  const pendingBudget = pending.reduce(
    (sum, r) => sum + (r.estimatedCost ?? 0),
    0
  );

  return {
    total:         visible.length,
    pending:       pending.length,
    inProgress:    inProgress.length,
    closed:        closed.length,
    urgent:        urgentPending.length,
    rejected:      rejected.length,
    totalBudget,
    pendingBudget,
  };
}
