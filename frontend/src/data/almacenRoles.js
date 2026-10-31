// SYSPCC-025 — qué roles ven cada acción del módulo de almacén.
// Es solo UX: el backend (apps/warehouse/permissions.py) valida cada petición
// y no concede ningún bypass de superusuario.

/** Fase 3 (Almacenamiento): asignar la ubicación exacta de un ítem. */
export const ASSIGN_LOCATION_ROLES = ['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF'];

/** Subir, confirmar y cancelar importaciones de inventario. */
export const IMPORT_ROLES = ['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF'];

/** Vincular destinos de egresos con trabajadores de Personal. */
export const LINK_PERSONAL_ROLES = ['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF'];

/** Entrega de EPP con vale (Fase 4, paso 5) y transferencia entre pisos. */
export const COUNTER_ROLES = ['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE'];

/** Logística: puede registrar ingresos en cualquier almacén (el servidor no la acota a obra). */
export const LOGISTICS_ROLES = ['LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF'];

/** Texto del permiso para asignar ubicación, con los nombres oficiales de los roles. */
export const ASSIGN_LOCATION_PERMISSION_TEXT = 'Solo Almacén Central y Jefe Logístico pueden asignar o cambiar la ubicación.';

/** Roles que operan el módulo /almacen (los mismos del RoleRoute de App.jsx). */
export const WAREHOUSE_MODULE_ROLES = [
  'CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE',
  'LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF',
];
