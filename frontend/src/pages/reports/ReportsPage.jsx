import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  FileText,
  TrendingUp,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle,
  Package,
  ShoppingCart,
  Layers,
  Calendar,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { getRequests } from '../../api/requests';
import { getProjects } from '../../api/core';
import SummaryCard from '../../components/ui/SummaryCard';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import {
  STATUS,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  PRIORITIES,
  LIFECYCLE_PHASES,
} from '../../data/constants';

// ── Helpers ───────────────────────────────────────────────────
function formatCurrency(val) {
  if (!val && val !== 0) return 'S/ 0';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return daysBetween(dateStr, new Date().toISOString());
}

// ── Loading spinner ───────────────────────────────────────────
function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      <p className="text-gray-500 font-medium">Cargando datos de análisis...</p>
    </div>
  );
}

// ── Section card wrapper ───────────────────────────────────────
function ReportCard({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm p-6 ${className}`}>
      {children}
    </div>
  );
}

// ── Section heading ────────────────────────────────────────────
function SectionHeading({ icon: Icon, iconClass = 'text-blue-500', accentColor = 'border-blue-500', children, subtitle }) {
  return (
    <div className="mb-5">
      <h2 className={`text-base font-bold text-gray-900 flex items-center gap-2.5 pl-3 border-l-4 ${accentColor}`}>
        {Icon && <Icon size={18} className={iconClass} />}
        {children}
      </h2>
      {subtitle && <p className="text-xs text-gray-400 mt-1 pl-3">{subtitle}</p>}
    </div>
  );
}

// ── Horizontal bar ─────────────────────────────────────────────
function HBar({ label, count, maxCount, barColor = 'bg-blue-500', badge }) {
  const pct = maxCount > 0 ? Math.max(Math.round((count / maxCount) * 100), 0) : 0;
  return (
    <div className="flex items-center gap-3 mb-3 last:mb-0">
      <span className="w-44 text-xs font-medium text-gray-600 truncate shrink-0" title={label}>{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-7 overflow-hidden relative">
        <div
          className={`h-full rounded-full ${barColor} flex items-center pl-2.5 transition-all duration-700`}
          style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
        >
          {count > 0 && (
            <span className="text-xs font-bold text-white drop-shadow-sm">{count}</span>
          )}
        </div>
      </div>
      <span className="w-8 text-xs font-bold text-gray-500 text-right shrink-0">{count}</span>
      {badge && <span className="shrink-0">{badge}</span>}
    </div>
  );
}

// ── Vertical bar (for monthly trend) ──────────────────────────
function VBar({ label, count, maxCount, barColor = 'bg-blue-500' }) {
  const CHART_HEIGHT = 120; // px
  const pct = maxCount > 0 ? Math.max(Math.round((count / maxCount) * 100), 0) : 0;
  const barHeight = count > 0 ? Math.max(Math.round((pct / 100) * CHART_HEIGHT), 6) : 0;
  const spacerHeight = CHART_HEIGHT - barHeight;
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <span className="text-xs font-bold text-gray-700" style={{ minHeight: '1rem' }}>
        {count > 0 ? count : ''}
      </span>
      <div className="w-full flex flex-col justify-end" style={{ height: `${CHART_HEIGHT}px` }}>
        {spacerHeight > 0 && <div style={{ height: `${spacerHeight}px` }} />}
        <div
          className={`w-full ${barColor} rounded-t-lg transition-all duration-700`}
          style={{ height: `${barHeight}px` }}
        />
      </div>
      <span className="text-xs text-gray-500 font-medium text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Donut chart (conic-gradient) ───────────────────────────────
function DonutChart({ segments }) {
  // segments: [{ label, count, color, hexColor }]
  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (total === 0) {
    return (
      <div className="w-36 h-36 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
        <span className="text-xs text-gray-400">Sin datos</span>
      </div>
    );
  }

  let accumulated = 0;
  const conicStops = segments
    .filter((s) => s.count > 0)
    .map((seg) => {
      const pct = (seg.count / total) * 100;
      const stop = `${seg.hexColor} ${accumulated.toFixed(1)}% ${(accumulated + pct).toFixed(1)}%`;
      accumulated += pct;
      return stop;
    })
    .join(', ');

  return (
    <div className="relative w-36 h-36 mx-auto">
      <div
        className="w-36 h-36 rounded-full"
        style={{ background: `conic-gradient(${conicStops})` }}
      />
      {/* Inner hole */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-white flex flex-col items-center justify-center shadow-inner">
          <span className="text-xl font-extrabold text-gray-800 leading-none">{total}</span>
          <span className="text-xs text-gray-400 font-medium">total</span>
        </div>
      </div>
    </div>
  );
}

// ── Funnel step ────────────────────────────────────────────────
function FunnelStep({ phase, count, total, colorClass, isLast }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const widthPct = 40 + (pct * 0.6); // between 40% and 100%
  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-center" style={{ width: '100%' }}>
        <div
          className={`${colorClass} rounded-lg py-2.5 px-4 flex items-center justify-between transition-all duration-700 mx-auto`}
          style={{ width: `${widthPct}%` }}
        >
          <span className="text-xs font-bold text-white truncate">{phase}</span>
          <span className="text-sm font-extrabold text-white ml-2 shrink-0">{count}</span>
        </div>
        {!isLast && (
          <div className="w-0.5 h-3 bg-gray-300 mx-auto" />
        )}
      </div>
    </div>
  );
}

// ── Priority legend item ───────────────────────────────────────
function PriorityLegendItem({ label, count, total, dotColor, textColor }) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${dotColor} shrink-0`} />
        <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full ${dotColor} rounded-full transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 font-medium w-12 text-right">{count} ({pct}%)</span>
      </div>
    </div>
  );
}

// ── Budget stacked bar ─────────────────────────────────────────
function BudgetProjectBar({ project, totalBudget, committedBudget, spentBudget }) {
  const total = totalBudget ?? 0;
  const committed = committedBudget ?? 0;
  const spent = spentBudget ?? 0;

  const committedPct = total > 0 ? Math.min(Math.round((committed / total) * 100), 100) : 0;
  const spentPct     = total > 0 ? Math.min(Math.round((spent     / total) * 100), 100) : 0;
  const overBudget   = committedPct >= 90;

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-sm font-semibold text-gray-800 truncate max-w-xs">
          {project.code} — {project.name}
        </span>
        <span className={`text-xs font-bold shrink-0 ml-2 ${overBudget ? 'text-red-600' : 'text-gray-500'}`}>
          {committedPct}% comprometido
        </span>
      </div>
      {/* Stacked bar */}
      <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden relative">
        {/* Spent (executed) */}
        <div
          className="h-full absolute left-0 top-0 bg-blue-600 rounded-l-full transition-all duration-700"
          style={{ width: `${spentPct}%` }}
        />
        {/* Committed (additional) */}
        {committedPct > spentPct && (
          <div
            className={`h-full absolute top-0 ${overBudget ? 'bg-red-400' : 'bg-amber-400'} transition-all duration-700`}
            style={{ left: `${spentPct}%`, width: `${committedPct - spentPct}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 text-xs text-gray-400 mt-1.5">
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1" />Ejecutado: {formatCurrency(spent)}</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Comprometido: {formatCurrency(committed)}</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-gray-200 mr-1" />Presupuesto: {formatCurrency(total)}</span>
      </div>
    </div>
  );
}

// ── Compute all analytics from raw requests ───────────────────
function computeAnalytics(requests, projects) {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  // KPIs
  const total = requests.length;
  const active = requests.filter(
    (r) => ![STATUS.CLOSED, STATUS.CANCELLED, STATUS.DRAFT].includes(r.status)
  ).length;
  const closedThisMonth = requests.filter((r) => {
    if (r.status !== STATUS.CLOSED) return false;
    const d = new Date(r.updated_at ?? r.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;
  const totalCost = requests.reduce(
    (s, r) => s + Number(r.estimated_cost ?? r.estimatedCost ?? 0), 0
  );
  const closedWithDates = requests.filter(
    (r) => r.status === STATUS.CLOSED && r.created_at && r.updated_at
  );
  const avgAttentionDays = closedWithDates.length > 0
    ? Math.round(
        closedWithDates.reduce((s, r) => s + daysBetween(r.created_at, r.updated_at), 0)
        / closedWithDates.length
      )
    : null;
  const overdue = requests.filter((r) => {
    if ([STATUS.CLOSED, STATUS.CANCELLED].includes(r.status)) return false;
    const deadline = r.fecha_estimada_entrega ?? r.estimatedDelivery;
    if (!deadline) return false;
    return new Date(deadline) < now;
  }).length;

  // By status
  const byStatus = {};
  requests.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  });

  // By project
  const byProject = {};
  requests.forEach((r) => {
    const code = r.project_code ?? r.projectCode ?? 'Sin Proyecto';
    byProject[code] = (byProject[code] ?? 0) + 1;
  });

  // By priority
  const byPriority = {};
  ['URGENT', 'HIGH', 'NORMAL', 'LOW'].forEach((p) => { byPriority[p] = 0; });
  requests.forEach((r) => {
    const p = r.priority ?? 'NORMAL';
    byPriority[p] = (byPriority[p] ?? 0) + 1;
  });

  // By acquisition type
  const ACQTYPE_LABELS = {
    COMPRA_LOCAL:  'Compra Local',
    COMPRA_FORANEA:'Compra Foránea',
    IMPORTACION:   'Importación',
    FABRICACION:   'Fabricación',
    ALQUILER:      'Alquiler',
    CALIBRACION:   'Calibración',
  };
  const byAcqType = {};
  Object.keys(ACQTYPE_LABELS).forEach((k) => { byAcqType[k] = 0; });
  requests.forEach((r) => {
    const t = r.acquisition_type ?? r.acquisitionType;
    if (t && byAcqType[t] !== undefined) byAcqType[t]++;
    else if (t) byAcqType[t] = (byAcqType[t] ?? 0) + 1;
  });

  // By lifecycle phase (funnel)
  const byPhase = {};
  LIFECYCLE_PHASES.forEach((ph) => { byPhase[ph.id] = 0; });
  requests.forEach((r) => {
    const phase = LIFECYCLE_PHASES.find((ph) => ph.statuses.includes(r.status));
    if (phase) byPhase[phase.id] = (byPhase[phase.id] ?? 0) + 1;
  });

  // Monthly trend — last 6 months
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    const count = requests.filter((r) => {
      const rd = new Date(r.created_at);
      return rd.getMonth() === m && rd.getFullYear() === y;
    }).length;
    const label = d.toLocaleDateString('es-PE', { month: 'short' });
    monthlyTrend.push({ label: label.charAt(0).toUpperCase() + label.slice(1), count });
  }

  // Pending attention table
  const pendingAttention = requests
    .filter((r) => ![STATUS.CLOSED, STATUS.CANCELLED].includes(r.status))
    .map((r) => ({
      ...r,
      daysInStatus: daysAgo(r.updated_at ?? r.created_at),
      isOverdue: (() => {
        const d = r.fecha_estimada_entrega ?? r.estimatedDelivery;
        return d ? new Date(d) < now : false;
      })(),
    }))
    .sort((a, b) => {
      const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return b.daysInStatus - a.daysInStatus;
    })
    .slice(0, 20);

  // Budget by project (merge from projects list)
  const budgetByProject = projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    totalBudget:     p.total_budget     ?? p.totalBudget     ?? 0,
    committedBudget: p.committed_budget ?? p.committedBudget ?? 0,
    spentBudget:     p.spent_budget     ?? p.spentBudget     ?? 0,
  }));

  return {
    kpis: { total, active, closedThisMonth, totalCost, avgAttentionDays, overdue },
    byStatus,
    byProject,
    byPriority,
    byAcqType,
    ACQTYPE_LABELS,
    byPhase,
    monthlyTrend,
    pendingAttention,
    budgetByProject,
  };
}

// ── STATUS bar colors (hex for conic-gradient) ────────────────
const STATUS_BAR_COLORS = {
  [STATUS.DRAFT]:               'bg-gray-300',
  [STATUS.SUBMITTED]:           'bg-blue-400',
  [STATUS.TECHNICAL_REVIEW]:    'bg-yellow-400',
  [STATUS.TECHNICAL_APPROVED]:  'bg-teal-400',
  [STATUS.TECHNICAL_REJECTED]:  'bg-red-400',
  [STATUS.BUDGET_REVIEW]:       'bg-yellow-500',
  [STATUS.WITHIN_PROPOSAL]:     'bg-teal-500',
  [STATUS.ADDITIONAL_REQ]:      'bg-orange-400',
  [STATUS.GM_REVIEW]:           'bg-purple-500',
  [STATUS.GM_APPROVED]:         'bg-teal-600',
  [STATUS.GM_REJECTED]:         'bg-red-500',
  [STATUS.VALIDATED]:           'bg-green-500',
  [STATUS.STOCK_CHECK]:         'bg-yellow-600',
  [STATUS.IN_STOCK]:            'bg-teal-400',
  [STATUS.REQUIRES_PURCHASE]:   'bg-orange-500',
  [STATUS.QUOTING]:             'bg-blue-500',
  [STATUS.QUOTE_SELECTED]:      'bg-teal-700',
  [STATUS.COST_OVERRUN_REVIEW]: 'bg-red-600',
  [STATUS.PO_GENERATED]:        'bg-indigo-500',
  [STATUS.RECEIVING]:           'bg-yellow-600',
  [STATUS.QUALITY_CHECK]:       'bg-blue-600',
  [STATUS.QUALITY_REJECTED]:    'bg-red-700',
  [STATUS.DISPATCHED_TO_SITE]:  'bg-indigo-600',
  [STATUS.DELIVERED]:           'bg-teal-600',
  [STATUS.USER_CONFORMITY]:     'bg-yellow-700',
  [STATUS.USER_CLAIM]:          'bg-red-700',
  [STATUS.CLOSED]:              'bg-gray-400',
  [STATUS.CANCELLED]:           'bg-gray-300',
};

const PRIORITY_HEX = {
  URGENT: '#ef4444',
  HIGH:   '#f97316',
  NORMAL: '#3b82f6',
  LOW:    '#9ca3af',
};

const PHASE_COLORS = [
  'bg-blue-400',
  'bg-yellow-400',
  'bg-orange-400',
  'bg-teal-500',
  'bg-green-500',
];

const PROJECT_BAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-orange-500',
  'bg-indigo-500', 'bg-pink-500', 'bg-cyan-500', 'bg-amber-500',
];

// ── Main ReportsPage ──────────────────────────────────────────
export default function ReportsPage() {
  const navigate = useNavigate();

  const [requests,     setRequests]     = useState([]);
  const [projects,     setProjects]     = useState([]);
  const [loadingReqs,  setLoadingReqs]  = useState(true);
  const [loadingProjs, setLoadingProjs] = useState(true);
  const [lastRefresh,  setLastRefresh]  = useState(new Date());
  const [refreshing,   setRefreshing]   = useState(false);

  const fetchData = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [reqRes, projRes] = await Promise.all([
        getRequests({ page_size: 1000, ordering: '-created_at' }),
        getProjects({ page_size: 100 }),
      ]);
      setRequests(reqRes.data.results ?? []);
      setProjects(projRes.data.results ?? []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error fetching reports data:', err);
    } finally {
      setLoadingReqs(false);
      setLoadingProjs(false);
      if (showSpinner) setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const isLoading = loadingReqs || loadingProjs;

  const analytics = useMemo(
    () => (isLoading ? null : computeAnalytics(requests, projects)),
    [requests, projects, isLoading]
  );

  if (isLoading) return <LoadingSpinner />;
  if (!analytics) return null;

  const {
    kpis, byStatus, byProject, byPriority, byAcqType,
    ACQTYPE_LABELS, byPhase, monthlyTrend, pendingAttention, budgetByProject,
  } = analytics;

  // Sort statuses by count desc, filter zero-count
  const sortedStatuses = Object.entries(byStatus)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);
  const maxStatusCount = sortedStatuses[0]?.[1] ?? 1;

  const sortedProjects = Object.entries(byProject)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);
  const maxProjectCount = sortedProjects[0]?.[1] ?? 1;

  const maxMonthCount = Math.max(...monthlyTrend.map((m) => m.count), 1);

  const prioritySegments = ['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((p) => ({
    label:    PRIORITY_CONFIG[p].label,
    count:    byPriority[p] ?? 0,
    dotColor: PRIORITY_CONFIG[p].dot,
    textColor: PRIORITY_CONFIG[p].text,
    hexColor:  PRIORITY_HEX[p],
  }));
  const priorityTotal = prioritySegments.reduce((s, seg) => s + seg.count, 0);

  const sortedAcqTypes = Object.entries(byAcqType)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);
  const maxAcqCount = sortedAcqTypes[0]?.[1] ?? 1;

  const phaseTotal = Object.values(byPhase).reduce((s, c) => s + c, 0);

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            <BarChart3 size={32} className="text-blue-600 shrink-0" />
            Informes y Análisis
          </h1>
          <p className="text-gray-500 text-base mt-1">
            Vista ejecutiva del sistema de requerimientos —{' '}
            <span className="font-semibold text-gray-700">{requests.length} RQs</span> analizados
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400 hidden sm:block">
            Actualizado: {lastRefresh.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* ── Section 1: KPI Cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        <SummaryCard
          title="Total RQs"
          value={kpis.total}
          icon={FileText}
          color="blue"
        />
        <SummaryCard
          title="RQs Activos"
          value={kpis.active}
          icon={TrendingUp}
          color="teal"
        />
        <SummaryCard
          title="Cerrados Este Mes"
          value={kpis.closedThisMonth}
          icon={CheckCircle}
          color="green"
        />
        <SummaryCard
          title="Costo Total Estimado"
          value={formatCurrency(kpis.totalCost)}
          icon={DollarSign}
          color="purple"
        />
        <SummaryCard
          title="Tiempo Prom. Atención"
          value={kpis.avgAttentionDays !== null ? `${kpis.avgAttentionDays} días` : '—'}
          icon={Clock}
          color="orange"
        />
        <SummaryCard
          title="RQs Vencidos"
          value={kpis.overdue}
          icon={AlertTriangle}
          color={kpis.overdue > 0 ? 'red' : 'green'}
        />
      </div>

      {/* ── Row: Status chart + Monthly trend ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Section 2: Por Estado */}
        <ReportCard>
          <SectionHeading
            icon={Layers}
            iconClass="text-blue-500"
            accentColor="border-blue-500"
            subtitle={`${sortedStatuses.length} estados con actividad`}
          >
            RQs por Estado
          </SectionHeading>
          <div className="space-y-0">
            {sortedStatuses.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Sin datos</p>
            ) : (
              sortedStatuses.map(([status, count]) => {
                const cfg = STATUS_CONFIG[status];
                const barColor = STATUS_BAR_COLORS[status] ?? 'bg-blue-400';
                return (
                  <HBar
                    key={status}
                    label={cfg?.label ?? status}
                    count={count}
                    maxCount={maxStatusCount}
                    barColor={barColor}
                  />
                );
              })
            )}
          </div>
        </ReportCard>

        {/* Section 7: RQs por Mes */}
        <ReportCard>
          <SectionHeading
            icon={Calendar}
            iconClass="text-indigo-500"
            accentColor="border-indigo-500"
            subtitle="Últimos 6 meses"
          >
            Tendencia Mensual
          </SectionHeading>
          <div className="flex items-end gap-2 h-48 pt-4">
            {monthlyTrend.map((m, i) => (
              <VBar
                key={i}
                label={m.label}
                count={m.count}
                maxCount={maxMonthCount}
                barColor="bg-indigo-500"
              />
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
            <span>Total período: <strong className="text-gray-700">{monthlyTrend.reduce((s, m) => s + m.count, 0)}</strong></span>
            <span>Promedio/mes: <strong className="text-gray-700">{Math.round(monthlyTrend.reduce((s, m) => s + m.count, 0) / 6)}</strong></span>
          </div>
        </ReportCard>
      </div>

      {/* ── Row: Priority donut + Acquisition type ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Section 4: Por Prioridad */}
        <ReportCard>
          <SectionHeading
            icon={AlertTriangle}
            iconClass="text-orange-500"
            accentColor="border-orange-500"
            subtitle="Distribución por nivel de urgencia"
          >
            RQs por Prioridad
          </SectionHeading>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <DonutChart segments={prioritySegments} />
            <div className="flex-1 w-full">
              {prioritySegments.map((seg) => (
                <PriorityLegendItem
                  key={seg.label}
                  label={seg.label}
                  count={seg.count}
                  total={priorityTotal}
                  dotColor={seg.dotColor}
                  textColor={seg.textColor}
                />
              ))}
            </div>
          </div>
        </ReportCard>

        {/* Section 5: Por Tipo de Adquisición */}
        <ReportCard>
          <SectionHeading
            icon={ShoppingCart}
            iconClass="text-teal-500"
            accentColor="border-teal-500"
            subtitle="Por modalidad de adquisición"
          >
            Por Tipo de Adquisición
          </SectionHeading>
          {sortedAcqTypes.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">Sin datos de tipo de adquisición</p>
          ) : (
            sortedAcqTypes.map(([key, count]) => (
              <HBar
                key={key}
                label={ACQTYPE_LABELS[key] ?? key}
                count={count}
                maxCount={maxAcqCount}
                barColor="bg-teal-500"
              />
            ))
          )}
        </ReportCard>
      </div>

      {/* ── Section 3: Por Proyecto ──────────────────────────── */}
      <ReportCard>
        <SectionHeading
          icon={Package}
          iconClass="text-purple-500"
          accentColor="border-purple-500"
          subtitle={`${sortedProjects.length} proyectos con requerimientos`}
        >
          RQs por Proyecto
        </SectionHeading>
        {sortedProjects.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Sin datos por proyecto</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {sortedProjects.map(([code, count], idx) => (
              <HBar
                key={code}
                label={code}
                count={count}
                maxCount={maxProjectCount}
                barColor={PROJECT_BAR_COLORS[idx % PROJECT_BAR_COLORS.length]}
              />
            ))}
          </div>
        )}
      </ReportCard>

      {/* ── Section 6: Funnel de Fases ───────────────────────── */}
      <ReportCard>
        <SectionHeading
          icon={Filter}
          iconClass="text-amber-500"
          accentColor="border-amber-500"
          subtitle="Distribución de RQs activos por fase del ciclo de vida"
        >
          Flujo de Aprobaciones (Embudo)
        </SectionHeading>
        <div className="max-w-lg mx-auto space-y-0">
          {LIFECYCLE_PHASES.map((phase, idx) => (
            <FunnelStep
              key={phase.id}
              phase={phase.label}
              count={byPhase[phase.id] ?? 0}
              total={phaseTotal}
              colorClass={PHASE_COLORS[idx]}
              isLast={idx === LIFECYCLE_PHASES.length - 1}
            />
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {LIFECYCLE_PHASES.map((phase, idx) => (
            <div key={phase.id} className="text-center">
              <div className={`text-xl font-extrabold ${['text-blue-500','text-yellow-500','text-orange-500','text-teal-500','text-green-500'][idx]}`}>
                {byPhase[phase.id] ?? 0}
              </div>
              <div className="text-xs text-gray-500 font-medium">{phase.label}</div>
            </div>
          ))}
        </div>
      </ReportCard>

      {/* ── Section 9: Presupuesto por Proyecto ─────────────── */}
      {budgetByProject.length > 0 && (
        <ReportCard>
          <SectionHeading
            icon={DollarSign}
            iconClass="text-green-500"
            accentColor="border-green-500"
            subtitle="Ejecución presupuestal por proyecto"
          >
            Presupuesto por Proyecto
          </SectionHeading>
          <div className="flex flex-wrap gap-4 mb-5 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="w-4 h-3 rounded bg-blue-600 inline-block" />
              Ejecutado
            </span>
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="w-4 h-3 rounded bg-amber-400 inline-block" />
              Comprometido
            </span>
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="w-4 h-3 rounded bg-gray-200 inline-block" />
              Disponible
            </span>
          </div>
          {budgetByProject.map((p) => (
            <BudgetProjectBar
              key={p.id}
              project={p}
              totalBudget={p.totalBudget}
              committedBudget={p.committedBudget}
              spentBudget={p.spentBudget}
            />
          ))}
        </ReportCard>
      )}

      {/* ── Section 8: Pending Attention Table ──────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2.5 pl-3 border-l-4 border-red-500">
              <Clock size={18} className="text-red-500" />
              RQs Pendientes de Atención
            </h2>
            <p className="text-xs text-gray-400 mt-1 pl-3">
              {pendingAttention.length} requerimientos activos — ordenados por prioridad y tiempo en estado
            </p>
          </div>
          <button
            onClick={() => navigate('/rq/requests')}
            className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50 shrink-0"
          >
            Ver todos &rarr;
          </button>
        </div>

        {pendingAttention.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle size={48} className="mx-auto mb-4 text-green-200" />
            <p className="text-base font-semibold text-gray-500">No hay requerimientos pendientes.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200 bg-gray-50">
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">RQ #</th>
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden md:table-cell">Proyecto</th>
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Solicitante</th>
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">Estado</th>
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Prioridad</th>
                  <th className="py-3.5 px-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">Días en estado</th>
                  <th className="py-3.5 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden xl:table-cell whitespace-nowrap">Fecha Límite</th>
                </tr>
              </thead>
              <tbody>
                {pendingAttention.map((req, idx) => {
                  const rowBg = req.isOverdue
                    ? 'bg-red-50 hover:bg-red-100'
                    : idx % 2 !== 0
                    ? 'bg-gray-50/70 hover:bg-blue-50'
                    : 'bg-white hover:bg-blue-50';

                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/rq/requests/${req.rq_number ?? req.rqNumber}`)}
                      className={`border-b border-gray-100 cursor-pointer transition-all duration-100 hover:shadow-[inset_3px_0_0_0_#3b82f6] ${rowBg}`}
                    >
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-700 whitespace-nowrap text-xs">
                        {req.rq_number ?? req.rqNumber}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-gray-500 hidden md:table-cell whitespace-nowrap">
                        {req.project_code ?? req.projectCode ?? '—'}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-gray-600 hidden lg:table-cell max-w-xs">
                        <span className="truncate block">
                          {req.requester_name ?? req.requesterName ?? '—'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="py-3.5 px-4 hidden sm:table-cell">
                        <PriorityBadge priority={req.priority} />
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center justify-center w-12 h-7 rounded-full text-xs font-bold ${
                          req.daysInStatus >= 7
                            ? 'bg-red-100 text-red-700'
                            : req.daysInStatus >= 3
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {req.daysInStatus}d
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs hidden xl:table-cell whitespace-nowrap">
                        {req.isOverdue ? (
                          <span className="text-red-600 font-semibold flex items-center gap-1">
                            <AlertTriangle size={12} />
                            {formatDate(req.fecha_estimada_entrega ?? req.estimatedDelivery)}
                          </span>
                        ) : (
                          <span className="text-gray-400">
                            {formatDate(req.fecha_estimada_entrega ?? req.estimatedDelivery)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom spacer */}
      <div className="h-4" />
    </div>
  );
}
