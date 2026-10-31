// SYSPCC-030 — filas sintéticas del Master de RQ con la forma real del backend (sin datos reales).

export const progress = (over = {}) => ({
  percent: 40, items_total: 3, items_counted: 3, items_attended: 1, items_partial: 1,
  items_pending: 1, items_stand_by: 0, items_unlinked: 0, items_discarded: 0, items_voided: 0, ...over,
});

export function buildMasterRow(over = {}) {
  return {
    id: 101, request_id: 42, rq_number: 'RQ-2026-0042', line_number: 1,
    flow: 'OPERATIONS', flow_label: 'Operaciones',
    project_id: 7, project_code: 'PRY-001', project_name: 'Proyecto Demo Uno',
    department_id: null, department_name: '', origin: 'PRY-001',
    requesting_area: 'HSE', requesting_area_label: 'Seguridad y Salud (HSE)',
    description: 'Casco blanco', unit: 'UND', product_code: 'EPP-0001',
    quantity: '10.000', quantity_attended: '4.000', quantity_missing: '6.000',
    central_stock: '7.000', central_stock_is_live: true,
    item_source: 'EPP', item_source_label: 'EPP',
    priority: 'NORMAL', priority_label: 'Normal',
    requested_by_id: 3, requested_by_name: 'Usuario Prueba 1',
    approval_date: '2026-10-01', need_date: '2026-10-20', attended_date: '2026-10-10',
    last_delivery_date: '2026-10-10',
    status: 'PARCIAL', status_label: 'Parcial',
    tracking: 'VINCULADO', tracking_label: 'Vinculado', link_proposed: '', attended_by_flow: '',
    guides: ['T001-0001'], guide_text: 'T001-0001',
    attention_responsible: 'Almacenero Prueba', comments: 'Entregar en el frente 3',
    attention_override: '', attention_override_label: '', attention_note: '', can_set_override: false,
    budget_type: 'P', budget_classification: 'WITHIN_PROPOSAL', budget_classification_label: 'Dentro de propuesta',
    gm_approval: 'NO_APLICA', gm_approval_label: 'No aplica', gm_approval_kind: '', gm_approval_kind_label: '',
    stage: 'POR_ENTREGAR', stage_label: 'Por entregar (almacén)', phase: 4,
    rq_status: 'IN_STOCK', rq_status_label: 'En stock',
    alerts: [],
    rq_progress: progress(),
    deliveries: [
      { dispatch_id: 9, dispatch_number: 'DSP-0009', date: '2026-10-10', guide: 'T001-0001', quantity: '5.000', is_reversal: false, responsible: 'Almacenero Prueba' },
      { dispatch_id: 10, dispatch_number: 'DSP-0010', date: '2026-10-11', guide: 'T001-0002', quantity: '-1.000', is_reversal: true, responsible: 'Almacenero Prueba' },
    ],
    ...over,
  };
}

export function buildSummaryRow(over = {}) {
  return {
    request_id: 42, rq_number: 'RQ-2026-0042', flow: 'OPERATIONS', flow_label: 'Operaciones',
    project_id: 7, project_code: 'PRY-001', project_name: 'Proyecto Demo Uno',
    department_id: null, department_name: '', origin: 'PRY-001',
    requesting_area: 'HSE', requesting_area_label: 'Seguridad y Salud (HSE)',
    priority: 'NORMAL', priority_label: 'Normal', requested_by_id: 3, requested_by_name: 'Usuario Prueba 1',
    approval_date: '2026-10-01', need_date: '2026-10-20',
    rq_status: 'IN_STOCK', rq_status_label: 'En stock', stage: 'POR_ENTREGAR', stage_label: 'Por entregar (almacén)',
    phase: 4, is_open: true,
    gm_approval: 'APROBADO', gm_approval_label: 'Aprobado', gm_approval_kind: 'ADICIONAL', gm_approval_kind_label: 'Adicional',
    percent: 40, items_total: 3, items_counted: 3, items_attended: 1, items_partial: 1, items_pending: 1,
    items_stand_by: 0, items_unlinked: 0, items_discarded: 0, items_voided: 0,
    ...over,
  };
}

export const buildKpis = (over = {}) => ({
  rqs_total: 12, rqs_open: 9, items_total: 80,
  items_by_status: { PENDIENTE: 30, PARCIAL: 10, ATENDIDO: 40 },
  items_pending: 30, items_partial: 10, items_attended: 40,
  percent_avg: 55.5, linked_pct: 90, by_origin: [], ...over,
});

export const page = (results, over = {}) => ({
  count: results.length, next: null, previous: null, results, ...over,
});
