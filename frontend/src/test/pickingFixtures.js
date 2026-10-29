// SYSPCC-029 — datos sintéticos de la lista de picking y de los pendientes de almacén.
// Cantidades como cadenas decimales ("10.000"), igual que el servidor.

const product = (id, code, description, location, location_status) => ({
  id, product_code: code, description, unit: 'EA', category: 'EPP', location, location_status,
});

export const ITEM_CASCO = {
  id: 11, line_number: 1, description: 'Casco de seguridad blanco', unit: 'EA', quantity: '10.000',
  link_status: 'CONFIRMED',
  product: product(501, 'EPP000501', 'Casco de seguridad blanco', 'B3-2', 'EXACT'),
  available_central: '20.000', delivered: '4.000', remaining: '6.000', max_deliverable: '6.000',
  status: 'PARTIAL', can_deliver: true, blocked_reason: null,
};

export const ITEM_GUANTES = {
  id: 12, line_number: 2, description: 'Guantes de cuero', unit: 'PAR', quantity: '5.000',
  link_status: 'CONFIRMED',
  product: product(502, 'EPP000502', 'Guantes de cuero', 'PISO 1', 'FLOOR_ONLY'),
  available_central: '5.000', delivered: '0.000', remaining: '5.000', max_deliverable: '5.000',
  status: 'PENDING', can_deliver: true, blocked_reason: null,
};

export const ITEM_TUBO = {
  id: 13, line_number: 3, description: 'Tubo galvanizado 2 pulgadas', unit: 'M', quantity: '12.000',
  link_status: 'UNLINKED', product: null,
  available_central: null, delivered: '0.000', remaining: '12.000', max_deliverable: null,
  status: 'PENDING', can_deliver: false, blocked_reason: 'UNLINKED',
};

export const ITEM_LENTES = {
  id: 14, line_number: 4, description: 'Lentes claros', unit: 'EA', quantity: '3.000',
  link_status: 'CONFIRMED',
  product: product(504, 'EPP000504', 'Lentes claros', '', 'NONE'),
  available_central: '0.000', delivered: '0.000', remaining: '3.000', max_deliverable: '0.000',
  status: 'PENDING', can_deliver: false, blocked_reason: 'NO_STOCK',
};

export const DELIVERY_1 = {
  id: 1, dispatch_number: 'DSP-0001', dispatch_guide_number: 'GR-100', movement_date: '2026-10-20',
  dispatched_at: '2026-10-20T15:30:00-05:00', dispatched_by: 'Rosa Prueba Uno', is_reversal: false,
  reverses: null, reversed_by: null, notes: 'Primera tanda', can_reverse: true,
  lines: [{ request_item_id: 11, line_number: 1, description: 'Casco de seguridad blanco', quantity: '4.000' }],
};

export function makePicking(overrides = {}) {
  const { request, ...rest } = overrides;
  return {
    request: {
      id: 7, rq_number: 'RQ-2026-0007', flow: 'OPERATIONS', status: 'IN_STOCK',
      project: 'Proyecto Prueba', project_code: 'PRU-01', department: null,
      requested_by: 'Luis Prueba Dos', fecha_necesidad: '2026-11-05',
      deliverable_state: true, deliver_roles: ['CENTRAL_WAREHOUSE'], can_deliver: true, can_reverse: true,
      ...request,
    },
    items: [ITEM_CASCO, ITEM_GUANTES, ITEM_TUBO, ITEM_LENTES],
    summary: { items_total: 4, complete: 0, partial: 1, pending: 3, blocked: 2 },
    deliveries: [DELIVERY_1],
    ...rest,
  };
}

/** Error de Axios con la forma que entrega el cliente. */
export function apiError(status, data) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

export function pendingRow(overrides = {}) {
  return {
    id: 7, rq_number: 'RQ-2026-0007', flow: 'OPERATIONS', status: 'IN_STOCK',
    status_label: 'Stock disponible — pendiente despacho', pending_action: 'DISPATCHED',
    act_roles: ['CENTRAL_WAREHOUSE'], can_act: true, can_deliver: true, priority: 'NORMAL',
    fecha_necesidad: '2026-11-05', fecha_estimada_entrega: null, project: 'Proyecto Prueba',
    project_code: 'PRU-01', department: null, requested_by: 'Luis Prueba Dos', items_count: 4,
    stock_items: 4, purchase_items: 0, acquisition_type: '', created_at: '2026-10-01T10:00:00-05:00',
    ...overrides,
  };
}
