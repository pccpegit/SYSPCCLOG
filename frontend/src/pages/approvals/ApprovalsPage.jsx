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

// Returns which statuses the current role needs to act on
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
      return [STATUS.SUBMITTED];
    case ROLES.ADMIN_MANAGER:
      return [STATUS.SUPERVISOR_APPROVED];
    case ROLES.LOGISTICS_COORDINATOR:
      return [STATUS.VALIDATED];
    case ROLES.LOGISTICS_SUPERVISOR:
      return [STATUS.VALIDATED];
    case ROLES.LOGISTICS_CHIEF:
      return [STATUS.QUOTING];
    default:
      return [];
  }
}

function getApprovalRoute(role, rqId) {
  switch (role) {
    case ROLES.PROJECT_RESIDENT:  return `/rq/approvals/tech-review/${rqId}`;
    case ROLES.DIRECT_SUPERVISOR: return `/rq/approvals/tech-review/${rqId}`;
    case ROLES.PROJECT_CONTROL:   return `/rq/approvals/budget-review/${rqId}`;
    case ROLES.ADMIN_MANAGER:     return `/rq/approvals/budget-review/${rqId}`;
    case ROLES.GENERAL_MANAGER:   return `/rq/approvals/manager/${rqId}`;
    default:                      return `/rq/requests/${rqId}`;
  }
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

export default function ApprovalsPage() {
  const { primaryRole } = useAuth();
  const navigate = useNavigate();

  const role = primaryRole ?? ROLES.PROJECT_RESIDENT;

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const approvalRoles = [
    ROLES.PROJECT_RESIDENT, ROLES.PROJECT_CONTROL, ROLES.GENERAL_MANAGER,
    ROLES.DIRECT_SUPERVISOR, ROLES.ADMIN_MANAGER,
    ROLES.LOGISTICS_COORDINATOR, ROLES.LOGISTICS_SUPERVISOR, ROLES.LOGISTICS_CHIEF,
  ];
  const hasApprovals = approvalRoles.includes(role);

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

        // Fetch per status and merge results
        const requests = await Promise.all(
          statuses.map((s) => getRequests({ status: s, page_size: 50, ordering: '-created_at' }))
        );
        const merged = requests.flatMap((r) => r.data.results ?? []);
        // Deduplicate by id
        const unique = [...new Map(merged.map((r) => [r.id, r])).values()];
        setPending(unique);
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
        <AlertTriangle size={48} className="text-amber-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Sin acceso</h2>
        <p className="text-gray-500 mt-2 text-sm">
          Su rol ({ROLE_LABELS[role] ?? role}) no tiene aprobaciones pendientes.
        </p>
        <button
          onClick={() => navigate('/rq')}
          className="mt-5 text-sm text-blue-600 hover:underline"
        >
          Ir al Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
          <ClipboardList size={26} className="text-blue-600" />
          Bandeja de Aprobaciones
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {ROLE_LABELS[role]} — {loading ? '...' : `${pending.length} pendiente${pending.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center">
          <Clock size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No hay aprobaciones pendientes</p>
          <p className="text-sm text-gray-400 mt-1">Está todo al día. Vuelva más tarde.</p>
          <button
            onClick={() => navigate('/rq')}
            className="mt-4 text-sm text-blue-600 hover:underline"
          >
            Ir al Dashboard
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((req) => {
            const rqId = req.rq_number ?? req.rqNumber ?? req.id;
            const route = getApprovalRoute(role, rqId);
            return (
              <div
                key={req.id}
                className="bg-white rounded-xl border-2 border-gray-200 shadow-sm p-6 hover:shadow-lg hover:border-blue-300 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                onClick={() => navigate(route)}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                        {rqId}
                      </span>
                      <PriorityBadge priority={req.priority} />
                      <StatusBadge status={req.status} />
                    </div>
                    <h3 className="text-base font-bold text-gray-900 leading-snug">{req.description}</h3>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                      <span>{req.project_code ?? req.projectCode} — {req.project_name ?? req.projectName}</span>
                      <span>Solicitante: {req.requested_by_name ?? req.requestedByName}</span>
                      <span>Req.: {formatDate(req.required_date ?? req.requiredDate)}</span>
                    </div>
                  </div>
                  <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3">
                    <span className="text-sm font-bold text-gray-800 whitespace-nowrap">
                      {formatCurrency(req.estimated_cost ?? req.estimatedCost)}
                    </span>
                    <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 hover:shadow-md transition-all duration-200 whitespace-nowrap">
                      Revisar
                      <ArrowRight size={16} />
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
