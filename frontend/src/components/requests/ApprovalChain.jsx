import { CheckCircle2, Clock, XCircle } from 'lucide-react';

// Complete action labels in Spanish
const ACTION_LABELS = {
  SUBMITTED: 'Enviado',
  TECHNICAL_APPROVED: 'Aprobación Técnica',
  TECHNICAL_REJECTED: 'Rechazado Técnicamente',
  BUDGET_CLASSIFIED: 'Clasificación Presupuestal',
  SUPERVISOR_APPROVED: 'Aprobado por Jefe Directo',
  SUPERVISOR_REJECTED: 'Rechazado por Jefe Directo',
  ADMIN_BUDGET_REVIEWED: 'Revisión Presupuestal',
  GM_APPROVED: 'Aprobado por Gerencia',
  GM_REJECTED: 'Rechazado por Gerencia',
  VALIDATED: 'Validado',
  STOCK_CHECKED: 'Stock Verificado',
  QUOTE_REQUESTED: 'Cotizaciones Solicitadas',
  QUOTE_COMPARED: 'Comparativo Elaborado',
  QUOTE_SELECTED: 'Proveedor Seleccionado',
  COST_OVERRUN_APPROVED: 'Sobrecosto Aprobado',
  COST_OVERRUN_REJECTED: 'Sobrecosto Rechazado',
  PO_GENERATED: 'Orden de Compra Generada',
  RECEIVED: 'Recibido en Almacén',
  QUALITY_APPROVED: 'Calidad Aprobada',
  QUALITY_REJECTED: 'Calidad Rechazada',
  RECEPTION_CONFIRMED: 'Recepción Conforme',
  RECEPTION_CLAIMED: 'Reclamo en Recepción',
  DISPATCHED: 'Despachado a Obra',
  DELIVERED: 'Entregado',
  WAREHOUSE_RECORDS_UPDATED: 'Almacén Actualizado',
  USER_CONFIRMED: 'Conformidad del Usuario',
  USER_CLAIMED: 'Reclamo del Usuario',
  CLAIM_RESOLVED: 'Reclamo Resuelto',
  SUPPLIER_CLAIM_SENT: 'Reclamo Enviado al Proveedor',
  SUPPLIER_CLAIM_UPDATED: 'Estado de Reclamo Actualizado',
  SUPPLIER_REPLACEMENT_RECEIVED: 'Reposición Recibida',
  QUOTE_COST_APPROVED: 'Cotización Aprobada por Control',
  QUOTE_COST_REJECTED: 'Cotización Excede Presupuesto',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
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

const REJECTED_ACTIONS = [
  'TECHNICAL_REJECTED', 'SUPERVISOR_REJECTED', 'GM_REJECTED',
  'COST_OVERRUN_REJECTED', 'QUALITY_REJECTED', 'RECEPTION_CLAIMED',
  'USER_CLAIMED', 'CANCELLED', 'REJECTED',
];

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('es-PE', {
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

export default function ApprovalChain({ approvals = [] }) {
  if (approvals.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        Sin historial de aprobaciones.
      </p>
    );
  }

  return (
    <ol className="relative border-l-2 border-gray-200 space-y-6 ml-3">
      {approvals.map((entry, idx) => {
        // Support both API format and mock format
        const name = entry.performed_by_name ?? entry.by ?? 'Sistema';
        const role = entry.role ?? '';
        const action = entry.action ?? '';
        const date = entry.performed_at ?? entry.date ?? null;
        const comments = entry.comments ?? '';

        const isPending = action === 'PENDING' || !date;
        const isRejected = REJECTED_ACTIONS.includes(action);

        const Icon = isPending ? Clock : isRejected ? XCircle : CheckCircle2;
        const iconColor = isPending
          ? 'text-gray-300'
          : isRejected
          ? 'text-red-500'
          : 'text-green-500';

        const actionLabel = ACTION_LABELS[action] ?? action;
        const roleLabel = ROLE_LABELS[role] ?? role;

        return (
          <li key={entry.id ?? idx} className="ml-6">
            <span className={`absolute -left-3.5 flex items-center justify-center w-7 h-7 bg-white rounded-full ring-4 ring-white ${isPending ? 'pulse-attention' : ''}`}>
              <Icon size={22} className={iconColor} />
            </span>

            <div
              className={`p-3 rounded-lg border ${
                isPending
                  ? 'bg-gray-50 border-gray-200'
                  : isRejected
                  ? 'bg-red-50 border-red-100'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{name}</span>
                  <span className="text-xs text-gray-400">&middot;</span>
                  <span className="text-xs text-gray-500">{roleLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isPending
                        ? 'bg-gray-100 text-gray-500'
                        : isRejected
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {actionLabel}
                  </span>
                  {date && (
                    <span className="text-xs text-gray-400">
                      {formatDate(date)}
                    </span>
                  )}
                </div>
              </div>

              {comments && (
                <p className="mt-1.5 text-sm text-gray-600 leading-snug">{comments}</p>
              )}

              {isPending && !comments && (
                <p className="mt-1 text-xs text-gray-400 italic">Esperando acción...</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
