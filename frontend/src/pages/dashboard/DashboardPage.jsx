import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Clock,
  ShoppingCart,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  Package,
  TrendingUp,
  Plus,
  ClipboardList,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLES, STATUS } from '../../data/constants';
import { getRequests } from '../../api/requests';
import { getProjects } from '../../api/core';
import SummaryCard from '../../components/ui/SummaryCard';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';

function formatCurrency(val) {
  if (!val && val !== 0) return 'S/ 0';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Loading spinner ───────────────────────────────────────────
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

// ── Section heading with bold colored left-border accent ──────
function SectionHeading({ icon: Icon, iconClass = 'text-blue-500', accentColor = 'border-blue-500', children }) {
  return (
    <h2 className={`text-lg font-bold text-gray-900 flex items-center gap-2.5 pl-3 border-l-4 ${accentColor}`}>
      {Icon && <Icon size={20} className={iconClass} />}
      {children}
    </h2>
  );
}

// ── Budget progress bar (PROJECT_CONTROL view) ────────────────
function BudgetBar({ project }) {
  const total = project.total_budget ?? project.totalBudget ?? 0;
  const spent = project.spent_budget ?? project.spentBudget ?? 0;
  const pct = total > 0 ? Math.min(Math.round((spent / total) * 100), 100) : 0;
  const barColor  = pct >= 90 ? 'bg-red-500'   : pct >= 70 ? 'bg-amber-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-green-600';

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-sm font-semibold text-gray-800">{project.code} — {project.name}</span>
        <span className={`text-sm font-bold ${textColor}`}>{pct}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3">
        <div className={`${barColor} h-3 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1.5">
        <span>Ejecutado: {formatCurrency(spent)}</span>
        <span>Presupuesto: {formatCurrency(total)}</span>
      </div>
    </div>
  );
}

// ── Requests table ────────────────────────────────────────────
function RequestsTable({ requests, onRowClick }) {
  if (requests.length === 0) {
    return (
      <div className="py-16 text-center">
        <Package size={48} className="mx-auto mb-4 text-gray-200" />
        <p className="text-base font-semibold text-gray-500">No hay requerimientos para mostrar.</p>
        <p className="text-sm text-gray-400 mt-1">
          Los requerimientos asignados a su rol apareceran aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-200 bg-gray-50">
            <th className="py-3.5 px-5 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">RQ #</th>
            <th className="py-3.5 px-5 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">Descripcion</th>
            <th className="py-3.5 px-5 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden md:table-cell">Proyecto</th>
            <th className="py-3.5 px-5 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Prioridad</th>
            <th className="py-3.5 px-5 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">Estado</th>
            <th className="py-3.5 px-5 text-right text-xs font-bold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Costo Est.</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((req, idx) => (
            <tr
              key={req.id}
              onClick={() => onRowClick(req.rq_number ?? req.rqNumber)}
              className={[
                'border-b border-gray-100 cursor-pointer transition-all duration-100',
                'hover:bg-blue-50 hover:shadow-[inset_3px_0_0_0_#3b82f6]',
                idx % 2 !== 0 ? 'bg-gray-50/70' : 'bg-white',
              ].join(' ')}
            >
              <td className="py-4 px-5 font-mono font-bold text-blue-700 whitespace-nowrap text-xs">
                {req.rq_number ?? req.rqNumber}
              </td>
              <td className="py-4 px-5 text-gray-800 max-w-xs">
                <span className="line-clamp-2 leading-snug">{req.description}</span>
              </td>
              <td className="py-4 px-5 text-xs text-gray-500 hidden md:table-cell whitespace-nowrap">
                {req.project_code ?? req.projectCode}
              </td>
              <td className="py-4 px-5 hidden sm:table-cell">
                <PriorityBadge priority={req.priority} />
              </td>
              <td className="py-4 px-5">
                <StatusBadge status={req.status} />
              </td>
              <td className="py-4 px-5 text-right font-semibold text-gray-700 hidden lg:table-cell whitespace-nowrap">
                {formatCurrency(req.estimated_cost ?? req.estimatedCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Compute dashboard stats from a list of requests ───────────
function computeStats(requests, role) {
  const total      = requests.length;
  const REJECTED_STATUSES = [
    STATUS.TECHNICAL_REJECTED, STATUS.GM_REJECTED, STATUS.SUPERVISOR_REJECTED,
    STATUS.COST_OVERRUN_REJECTED, STATUS.QUALITY_REJECTED,
    'BUDGET_REJECTED', 'ADMIN_BUDGET_REJECTED',
  ];
  const rejected   = requests.filter((r) => REJECTED_STATUSES.includes(r.status)).length;
  const closed     = requests.filter((r) => r.status === STATUS.CLOSED).length;

  let pending    = 0;
  let inProgress = 0;
  let pendingBudget = 0;

  switch (role) {
    case ROLES.PROJECT_RESIDENT:
      pending    = requests.filter((r) => r.status === STATUS.SUBMITTED).length;
      inProgress = requests.filter((r) => ![STATUS.SUBMITTED, STATUS.CLOSED, STATUS.CANCELLED, STATUS.TECHNICAL_REJECTED].includes(r.status)).length;
      break;
    case ROLES.PROJECT_CONTROL:
      pending = requests.filter((r) => [STATUS.TECHNICAL_APPROVED, STATUS.QUOTE_SELECTED].includes(r.status)).length;
      inProgress = requests.filter((r) => ![STATUS.CLOSED, STATUS.CANCELLED, STATUS.TECHNICAL_REJECTED].includes(r.status)).length;
      pendingBudget = requests
        .filter((r) => [STATUS.TECHNICAL_APPROVED, STATUS.QUOTE_SELECTED].includes(r.status))
        .reduce((s, r) => s + (r.estimated_cost ?? r.estimatedCost ?? 0), 0);
      break;
    case ROLES.GENERAL_MANAGER:
      pending = requests.filter((r) => [STATUS.GM_REVIEW, STATUS.COST_OVERRUN_REVIEW].includes(r.status)).length;
      inProgress = requests.filter((r) => ![STATUS.CLOSED, STATUS.CANCELLED].includes(r.status)).length;
      pendingBudget = requests
        .filter((r) => [STATUS.GM_REVIEW, STATUS.COST_OVERRUN_REVIEW].includes(r.status))
        .reduce((s, r) => s + (r.estimated_cost ?? r.estimatedCost ?? 0), 0);
      break;
    case ROLES.LOGISTICS:
      pending = requests.filter((r) => r.status === STATUS.VALIDATED).length;
      inProgress = requests.filter((r) => [
        STATUS.STOCK_CHECK, STATUS.REQUIRES_PURCHASE, STATUS.QUOTING,
        STATUS.QUOTE_SELECTED, STATUS.COST_OVERRUN_REVIEW, STATUS.PO_GENERATED,
      ].includes(r.status)).length;
      break;
    default: // REQUESTER and others
      pending    = requests.filter((r) => [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.TECHNICAL_REVIEW].includes(r.status)).length;
      inProgress = requests.filter((r) => [
        STATUS.VALIDATED, STATUS.STOCK_CHECK, STATUS.REQUIRES_PURCHASE,
        STATUS.QUOTING, STATUS.PO_GENERATED, STATUS.RECEIVING,
      ].includes(r.status)).length;
      break;
  }

  return { total, pending, inProgress, closed, rejected, pendingBudget };
}

// ── Role-specific table config ────────────────────────────────
function getTableConfig(role, allRequests) {
  switch (role) {
    case ROLES.PROJECT_RESIDENT:
      return {
        title: 'Pendientes de Revisión Técnica',
        rows:  allRequests.filter((r) => r.status === STATUS.SUBMITTED).slice(0, 8),
      };
    case ROLES.PROJECT_CONTROL:
      return {
        title: 'Pendientes de Revisión Presupuestal',
        rows:  allRequests.filter((r) => [STATUS.TECHNICAL_APPROVED, STATUS.QUOTE_SELECTED].includes(r.status)).slice(0, 8),
      };
    case ROLES.GENERAL_MANAGER:
      return {
        title: 'Requieren Mi Aprobación',
        rows:  allRequests.filter((r) => [STATUS.GM_REVIEW, STATUS.COST_OVERRUN_REVIEW].includes(r.status)).slice(0, 8),
      };
    default:
      return {
        title: 'Mis Requerimientos Recientes',
        rows:  allRequests.slice(0, 8),
      };
  }
}

// ── KPI card definitions per role ────────────────────────────
function buildKpiCards(role, stats, projectCount) {
  switch (role) {
    case ROLES.REQUESTER:
      return [
        { title: 'Total RQs',      value: stats.total,      icon: FileText,     color: 'blue'   },
        { title: 'Pendientes',     value: stats.pending,    icon: Clock,        color: 'amber'  },
        { title: 'En Adquisición', value: stats.inProgress, icon: ShoppingCart, color: 'teal'   },
        { title: 'Rechazados',     value: stats.rejected,   icon: AlertTriangle, color: 'red'   },
        { title: 'Cerrados',       value: stats.closed,     icon: CheckCircle,  color: 'green'  },
      ];
    case ROLES.PROJECT_RESIDENT:
      return [
        { title: 'Por Revisar',    value: stats.pending,    icon: AlertTriangle, color: 'amber'  },
        { title: 'Activos',        value: stats.inProgress, icon: Layers,        color: 'blue'   },
        { title: 'Rechazados',     value: stats.rejected,   icon: AlertTriangle, color: 'red'    },
        { title: 'Total Visibles', value: stats.total,      icon: FileText,      color: 'purple' },
      ];
    case ROLES.PROJECT_CONTROL:
      return [
        { title: 'Cola Presupuestal', value: stats.pending,                       icon: Clock,       color: 'purple' },
        { title: 'En Proceso',        value: stats.inProgress,                    icon: TrendingUp,  color: 'blue'   },
        { title: 'Costo Pendiente',   value: formatCurrency(stats.pendingBudget), icon: DollarSign,  color: 'orange' },
        { title: 'Total Revisados',   value: stats.total,                         icon: CheckCircle, color: 'green'  },
      ];
    case ROLES.GENERAL_MANAGER:
      return [
        { title: 'Pend. Mi Aprobación', value: stats.pending,                       icon: AlertTriangle, color: 'amber'  },
        { title: 'Activos',             value: stats.inProgress,                    icon: TrendingUp,    color: 'blue'   },
        { title: 'Gasto Pendiente',     value: formatCurrency(stats.pendingBudget), icon: DollarSign,    color: 'orange' },
        { title: 'Proyectos Activos',   value: projectCount,                        icon: Package,       color: 'teal'   },
      ];
    case ROLES.LOGISTICS:
      return [
        { title: 'Pendientes Acción', value: stats.pending,    icon: Clock,        color: 'amber' },
        { title: 'En Proceso',        value: stats.inProgress, icon: ShoppingCart, color: 'blue'  },
        { title: 'Completados',       value: stats.closed,     icon: CheckCircle,  color: 'green' },
        { title: 'Total Visibles',    value: stats.total,      icon: Package,      color: 'teal'  },
      ];
    default:
      return [
        { title: 'Total RQs',  value: stats.total,      icon: FileText,    color: 'blue'  },
        { title: 'Pendientes', value: stats.pending,     icon: Clock,       color: 'amber' },
        { title: 'Activos',    value: stats.inProgress,  icon: Layers,      color: 'teal'  },
        { title: 'Cerrados',   value: stats.closed,      icon: CheckCircle, color: 'green' },
      ];
  }
}

// ── Main Dashboard ────────────────────────────────────────────
export default function DashboardPage() {
  const { currentUser, primaryRole } = useAuth();
  const navigate = useNavigate();

  const role = primaryRole ?? ROLES.REQUESTER;

  const [requests,     setRequests]     = useState([]);
  const [projects,     setProjects]     = useState([]);
  const [loadingReqs,  setLoadingReqs]  = useState(true);
  const [loadingProjs, setLoadingProjs] = useState(true);

  // Fetch requests filtered by role-relevant statuses
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const { data } = await getRequests({ page_size: 50, ordering: '-created_at' });
        setRequests(data.results ?? []);
      } catch (err) {
        console.error('Error fetching requests:', err);
      } finally {
        setLoadingReqs(false);
      }
    };
    fetchRequests();
  }, []);

  // Fetch projects (used for budget bars and GM project count)
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data } = await getProjects({ page_size: 50 });
        setProjects(data.results ?? []);
      } catch (err) {
        console.error('Error fetching projects:', err);
      } finally {
        setLoadingProjs(false);
      }
    };
    fetchProjects();
  }, []);

  const isLoading = loadingReqs || loadingProjs;

  const stats      = computeStats(requests, role);
  const kpiCards   = buildKpiCards(role, stats, projects.length);
  const { title: tableTitle, rows: tableRows } = getTableConfig(role, requests);

  const displayName = currentUser?.full_name
    ?? `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    ?? currentUser?.username
    ?? '';

  function handleRowClick(rqNumber) {
    navigate(`/rq/requests/${rqNumber}`);
  }

  // Quick action button — bigger, more prominent
  function QuickAction() {
    if (role === ROLES.REQUESTER) {
      return (
        <button
          onClick={() => navigate('/rq/requests/new')}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-200 shadow-md"
        >
          <Plus size={20} />
          Nuevo Requerimiento
        </button>
      );
    }
    if (role === ROLES.PROJECT_RESIDENT) {
      return (
        <button
          onClick={() => navigate('/rq/approvals')}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 bg-yellow-500 text-white text-base font-bold rounded-xl hover:bg-yellow-600 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-200 shadow-md"
        >
          <ClipboardList size={20} />
          Ir a Aprobaciones
        </button>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-base mt-1">
            Bienvenido,{' '}
            <span className="font-bold text-gray-800">{displayName}</span>
            {currentUser?.position && (
              <span className="text-gray-400"> — {currentUser.position}</span>
            )}
          </p>
        </div>
        <QuickAction />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {kpiCards.map((card, idx) => (
              <SummaryCard
                key={idx}
                title={card.title}
                value={card.value}
                icon={card.icon}
                color={card.color}
              />
            ))}
          </div>

          {/* Budget bars — only for PROJECT_CONTROL */}
          {role === ROLES.PROJECT_CONTROL && projects.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-7">
              <div className="mb-6">
                <SectionHeading icon={TrendingUp} iconClass="text-purple-500" accentColor="border-purple-500">
                  Avance Presupuestal por Proyecto
                </SectionHeading>
              </div>
              {projects.map((p) => (
                <BudgetBar key={p.id} project={p} />
              ))}
            </div>
          )}

          {/* Requests table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
              <SectionHeading icon={FileText} iconClass="text-blue-500" accentColor="border-blue-500">
                {tableTitle}
              </SectionHeading>
              <button
                onClick={() => navigate('/rq/requests')}
                className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50"
              >
                Ver todos &rarr;
              </button>
            </div>
            <RequestsTable requests={tableRows} onRowClick={handleRowClick} />
          </div>
        </>
      )}
    </div>
  );
}
