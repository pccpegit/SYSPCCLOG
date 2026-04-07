// Complete action descriptions in Spanish
const ACTION_DESCRIPTIONS = {
  SUBMITTED: 'envió el requerimiento',
  TECHNICAL_APPROVED: 'aprobó técnicamente el requerimiento',
  TECHNICAL_REJECTED: 'rechazó técnicamente el requerimiento',
  BUDGET_CLASSIFIED: 'clasificó el presupuesto del requerimiento',
  SUPERVISOR_APPROVED: 'aprobó el requerimiento',
  SUPERVISOR_REJECTED: 'rechazó el requerimiento',
  ADMIN_BUDGET_REVIEWED: 'revisó el presupuesto vs Plan Anual',
  GM_APPROVED: 'aprobó el requerimiento como Gerencia General',
  GM_REJECTED: 'rechazó el requerimiento como Gerencia General',
  VALIDATED: 'validó el requerimiento para atención',
  STOCK_CHECKED: 'verificó la disponibilidad de stock',
  QUOTE_REQUESTED: 'solicitó cotizaciones a proveedores',
  QUOTE_COMPARED: 'elaboró el comparativo de cotizaciones',
  QUOTE_SELECTED: 'seleccionó al proveedor',
  COST_OVERRUN_APPROVED: 'aprobó el sobrecosto',
  COST_OVERRUN_REJECTED: 'rechazó el sobrecosto',
  PO_GENERATED: 'generó la Orden de Compra',
  RECEIVED: 'registró la recepción en almacén',
  QUALITY_APPROVED: 'aprobó el control de calidad',
  QUALITY_REJECTED: 'rechazó por calidad (reclamo al proveedor)',
  RECEPTION_CONFIRMED: 'confirmó la recepción conforme',
  RECEPTION_CLAIMED: 'generó reclamo en recepción',
  DISPATCHED: 'despachó los materiales a obra',
  DELIVERED: 'confirmó la entrega en destino',
  WAREHOUSE_RECORDS_UPDATED: 'actualizó los registros de almacén',
  USER_CONFIRMED: 'confirmó la conformidad de recepción',
  USER_CLAIMED: 'generó un reclamo por no conformidad',
  CLAIM_RESOLVED: 'resolvió el reclamo',
  SUPPLIER_CLAIM_SENT: 'envió reclamo formal al proveedor',
  SUPPLIER_CLAIM_UPDATED: 'actualizó el estado del reclamo al proveedor',
  SUPPLIER_REPLACEMENT_RECEIVED: 'recibió reposición del proveedor',
  QUOTE_COST_APPROVED: 'aprobó la cotización (dentro de presupuesto)',
  QUOTE_COST_REJECTED: 'rechazó la cotización (excede presupuesto)',
  CLOSED: 'cerró el requerimiento',
  CANCELLED: 'canceló el requerimiento',
};

// Complete role labels in Spanish
const ROLE_LABELS = {
  REQUESTER: 'Solicitante',
  PROJECT_RESIDENT: 'Residente de Proyecto',
  PROJECT_CONTROL: 'Control de Proyecto',
  GENERAL_MANAGER: 'Gerente General',
  ADMIN_MANAGER: 'Gerente Administrativo',
  LOGISTICS_COORDINATOR: 'Coord. Logístico',
  LOGISTICS_SUPERVISOR: 'Supervisor Logístico',
  LOGISTICS_CHIEF: 'Jefe Logístico',
  CENTRAL_WAREHOUSE: 'Almacén Central',
  SITE_WAREHOUSE: 'Almacén de Obra',
  DIRECT_SUPERVISOR: 'Jefe Directo',
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('es-PE', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function ActivityLog({ approvals = [] }) {
  const completed = approvals.filter((a) => {
    const date = a.performed_at ?? a.date ?? null;
    const action = a.action ?? '';
    return date !== null && action !== 'PENDING';
  });

  if (completed.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">Sin actividad registrada.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {completed.map((entry, idx) => {
        const name = entry.performed_by_name ?? entry.user_name ?? entry.by ?? 'Sistema';
        const role = entry.role ?? '';
        const action = entry.action ?? '';
        const date = entry.performed_at ?? entry.date ?? entry.created_at ?? null;
        const comments = entry.comments ?? entry.detail ?? '';

        const description = ACTION_DESCRIPTIONS[action] ?? action.toLowerCase().replace(/_/g, ' ');
        const roleLabel = ROLE_LABELS[role] ?? role;
        const formattedDate = formatDate(date);

        return (
          <li key={entry.id ?? idx} className={`flex gap-3 text-sm p-3 rounded-lg ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
            <span className="w-40 shrink-0 text-xs font-medium text-gray-400 pt-0.5 leading-relaxed">
              {formattedDate}
            </span>

            <div className="flex-1">
              <p className="text-gray-700 leading-snug">
                <span className="font-semibold text-gray-900">{name}</span>{' '}
                <span className="text-gray-400">({roleLabel})</span>{' '}
                {description}.
              </p>
              {comments && (
                <p className="mt-1 text-xs text-gray-500 italic leading-snug">
                  &ldquo;{comments}&rdquo;
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
