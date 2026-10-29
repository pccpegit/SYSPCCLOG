// SYSPCC-025 — datos sintéticos para las pruebas del módulo de almacén.
// Todos los nombres de personas son inventados: nunca se usan datos del libro real.

export const LAYOUT = {
  floors: [
    { floor: 1, pavilions: ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({ code, sections: [7, 7, 4, 4, 6][i] })) },
    { floor: 2, pavilions: ['F', 'G', 'H', 'I', 'J', 'K'].map((code) => ({ code, sections: 6 })) },
  ],
  levels: [1, 2, 3, 4, 5],
  pattern: '^[A-K]\\d{1,2}-[1-5]$',
};

let nextId = 100;

/** Ítem del catálogo tal como lo entrega `GET inventory/`. */
export function makeItem(overrides = {}) {
  nextId += 1;
  const id = overrides.id ?? nextId;
  return {
    id,
    product_code: `EPP${String(id).padStart(6, '0')}`,
    description: `Casco de seguridad modelo ${id} T: L`,
    unit: 'EA',
    category: 'EPP',
    item_type: 'EPP',
    item_type_display: 'EPP',
    brand: '',
    model_name: '',
    location: '',
    min_stock: 0,
    total_stock: 10,
    stocks: [{ id: id * 10, warehouse_type: 'CENTRAL', project_id: null, department_id: null, quantity: overrides.total_stock ?? 10 }],
    order_number: '',
    purchase_order_ref: '',
    packing_list: '',
    size: 'L',
    floor: 2,
    location_status: 'FLOOR_ONLY',
    location_display: 'PISO 2',
    observation: '',
    project_id: null,
    project_code: '',
    project_name: '',
    ...overrides,
  };
}

export const exactItem = (overrides = {}) =>
  makeItem({ location: 'F3-2', location_status: 'EXACT', location_display: 'F3-2', ...overrides });

export const page = (results, extra = {}) => ({ data: { count: results.length, next: null, previous: null, results, ...extra } });

export const SUMMARY = {
  total_items: 254,
  low_stock_count: 3,
  today_entries: 2,
  today_exits: 5,
  pending_location_count: 254,
  zero_stock_count: 27,
  undated_movements: 0,
};

export const summaryRow = (overrides = {}) => ({
  inventory_id: 1,
  product_code: 'EPP000001',
  description: 'Guantes de cuero T: L',
  unit: 'EA',
  category: 'EPP',
  size: 'L',
  initial_stock: 5,
  entries: 10,
  exits: 3,
  closing_stock: 12,
  current_stock: 12,
  location: 'PISO 2',
  location_status: 'FLOOR_ONLY',
  floor: 2,
  observation: '',
  project_code: 'OP',
  project_name: 'ON PLANT',
  ...overrides,
});

/** Detalle de una importación previsualizada. */
export function makeImport(overrides = {}) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    status: 'PREVIEWED',
    plan_digest: 'digest-abc',
    can_confirm: true,
    requires: { accept_warnings: true, accept_skipped_rows: true, project_labels: ['ON PLANT'] },
    projects: [{ label: 'ON PLANT', items: 251, matches: [], suggested_id: null }],
    unmatched_destinations: [
      { key: 'apellido-prueba-uno', display: 'APELLIDO PRUEBA UNO', rows: 3, candidates: 0 },
    ],
    summary: {
      sheets: { MATRIZ: { rows: 254 }, EGRESOS: { rows: 476 } },
      catalog: { new: 254, existing: 0 },
      entries: { to_import: 239, skipped_error: 20, already_imported: 0, groups: 4 },
      exits: { to_import: 459, skipped_error: 17, already_imported: 0, groups: 403 },
      stock: { projected_total: 6913, sheet_total: 6857, mismatched_items: 17, negative_items: 0 },
      counts: { blocker: 0, error: 37, warning: 967, info: 12 },
      by_code: { VALE_VACIO: 326, CANTIDAD_VACIA: 13 },
      skipped_rows: 37,
    },
    result: null,
    ...overrides,
  };
}
