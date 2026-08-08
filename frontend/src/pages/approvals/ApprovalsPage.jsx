import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, ArrowRight, Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLES, ROLE_LABELS, STATUS } from '../../data/constants';
import { getRequests } from '../../api/requests';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatCurrency(val) {
  if (!val && val !== 0) return '—';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function getPendingStatuses(role) {
  switch (role) {
    case ROLES.PROJECT_RESIDENT:
      return [STATUS.SUBMITTED, STATUS.ADDITIONAL_REQ];
    case ROLES.PROJECT_CONTROL:
      return [STATUS.TECHNICAL_APPROVED, STATUS.QUOTE_SELECTED];
    case ROLES.ADMIN_MANAGER:
      return [STATUS.SUPERVISOR_APPROVED, STATUS.QUOTE_SELECTED];
    case ROLES.GENERAL_MANAGER:
      return [STATUS.GM_REVIEW, STATUS.COST_OVERRUN_REVIEW];
    case ROLES.DIRECT_SUPERVISOR:
      return [STATUS.SUBMITTED, STATUS.OUT_OF_ANNUAL_PLAN];
    case ROLES.LOGISTICS_COORDINATOR:
      return [STATUS.VALIDATED, STATUS.QUOTE_COST_APPROVED, STATUS.COST_OVERRUN_APPROVED];
    case ROLES.LOGISTICS_SUPERVISOR:
      return [STATUS.VALIDATED, STATUS.QUOTE_COST_APPROVED, STATUS.COST_OVERRUN_APPROVED, STATUS.USER_CONFORMITY, STATUS.CLAIM_IN_REVIEW];
    case ROLES.LOGISTICS_CHIEF:
      return [STATUS.QUOTING];
    default:
      return [];
  }
}

function getApprovalRoute(role, rqId, status) {
  switch (role) {
    case ROLES.PROJECT_RESIDENT:  return `/rq/approvals/tech-review/${rqId}`;
    case ROLES.DIRECT_SUPERVISOR: return `/rq/approvals/tech-review/${rqId}`;
    case ROLES.PROJECT_CONTROL:
    case ROLES.ADMIN_MANAGER:
      return status === STATUS.QUOTE_SELECTED
        ? `/rq/approvals/quote-cost-review/${rqId}`
        : `/rq/approvals/budget-review/${rqId}`;
    case ROLES.GENERAL_MANAGER:
      return status === STATUS.COST_OVERRUN_REVIEW
        ? `/rq/approvals/cost-overrun/${rqId}`
        : `/rq/approvals/manager/${rqId}`;
    default:                      return `/rq/requests/${rqId}`;
  }
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600" />
    </div>
  );
}

const APPROVAL_ROLES = [
  ROLES.PROJECT_RESIDENT, ROLES.PROJECT_CONTROL, ROLES.GENERAL_MANAGER,
  ROLES.DIRECT_SUPERVISOR, ROLES.ADMIN_MANAGER,
  ROLES.LOGISTICS_COORDINATOR, ROLES.LOGISTICS_SUPERVISOR, ROLES.LOGISTICS_CHIEF,
];

export default function ApprovalsPage() {
  const { primaryRole } = useAuth();
  const navigate = useNavigate();

  const role = primaryRole ?? ROLES.PROJECT_RESIDENT;

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const hasApprovals = APPROVAL_ROLES.includes(role);

  useEffect(() => {
    if (!hasApprovals) {
      setLoading(false);
      return;
    }

    const fetchPending = async () => {
      try {
        const statuses = getPendingStatuses(role);
        if (statuses.length === 0) {
          setPending([]);
          return;
        }

        const { data } = await getRequests({
          status_in: statuses.join(','),
          page_size: 100,
          ordering: '-created_at',
        });
        setPending(data.results ?? []);
      } catch (err) {
        console.error('Error fetching pending approvals:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPending();
  }, [role, hasApprovals]);

  if (!hasApprovals) {
    return (
      <div className="flex flex-col items-center justify-center min-h-96 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
          <AlertTriangle size={28} className="text-amber-400" />
        </div>
        <h2 className="text-xl font-extrabold text-gray-800 font-display">Sin acceso</h2>
        <p className="text-gray-500 mt-2 text-sm">
          Su rol ({ROLE_LABELS[role] ?? role}) no tiene aprobaciones pendientes.
        </p>
        <button
          onClick={() => navigate('/rq')}
          className="mt-5 text-sm font-bold text-blue-600 hover:underline font-display"
        >
          Ir al Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 flex items-center gap-2.5 tracking-tight font-display">
          <ClipboardList size={24} className="text-blue-600" strokeWidth={2} />
          Bandeja de Aprobaciones
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {ROLE_LABELS[role]} — {loading ? '...' : `${pending.length} pendiente${pending.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
            <Clock size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-500 font-bold font-display">No hay aprobaciones pendientes</p>
          <p className="text-sm text-gray-400 mt-1">Está todo al día. Vuelva más tarde.</p>
          <button
            onClick={() => navigate('/rq')}
            className="mt-4 text-sm font-bold text-blue-600 hover:underline font-display"
          >
            Ir al Dashboard
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((req, idx) => {
            const rqId = req.rq_number ?? req.rqNumber ?? req.id;
            const route = getApprovalRoute(role, rqId, req.status);
            return (
              <div
                key={req.id}
                className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 sm:p-6 hover:shadow-lg hover:border-blue-300/60 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                onClick={() => navigate(route)}
                style={{
                  animation: `staggerIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) ${idx * 0.05}s both`,
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100/60">
                        {rqId}
                      </span>
                      <PriorityBadge priority={req.priority} />
                      <StatusBadge status={req.status} />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-gray-900 leading-snug font-display">{req.description}</h3>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
                      <span>{(req.project_code ?? req.projectCode) ? `${req.project_code ?? req.projectCode} — ${req.project_name ?? req.projectName}` : req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—'}</span>
                      <span>Solicitante: {req.requested_by_name ?? req.requestedByName}</span>
                      <span>Req.: {formatDate(req.required_date ?? req.requiredDate)}</span>
                    </div>
                  </div>
                  <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3">
                    <span className="text-sm font-extrabold text-gray-800 whitespace-nowrap font-display">
                      {formatCurrency(req.estimated_cost ?? req.estimatedCost)}
                    </span>
                    <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-bold rounded-xl hover:from-blue-700 hover:to-blue-800 hover:shadow-md whitespace-nowrap shadow-sm shadow-blue-600/15 font-display">
                      Revisar
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
