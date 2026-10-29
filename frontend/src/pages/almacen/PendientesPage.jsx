import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Search, RefreshCw, Package, Calendar, User,
  Building2, HardHat, ChevronLeft, ChevronRight, Inbox,
  CheckCircle, Loader2, Lock, Truck,
} from 'lucide-react';
import { getPendingRequests, getPendingCount } from '../../api/almacen';
import { getRequest, getAvailableActions, performAction } from '../../api/requests';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import HRDialog from '../../components/rrhh/HRDialog';
import { Banner, ErrorBlock, LoadingBlock } from '../../components/almacen/ui';
import { extractErrorMessage } from '../../utils/apiErrors';
import { roleList } from '../../utils/rqPicking';

// ── Config ──────────────────────────────────────────────────────────────────

const PRIORITY_CFG = {
  URGENT: { label:'Urgente',  bg:'bg-red-50 dark:bg-red-500/10',    text:'text-red-600 dark:text-red-400',    dot:'bg-red-500 animate-pulse' },
  HIGH:   { label:'Alta',     bg:'bg-orange-50 dark:bg-orange-500/10',  text:'text-orange-600 dark:text-orange-400', dot:'bg-orange-400' },
  NORMAL: { label:'Normal',   bg:'bg-blue-50 dark:bg-blue-500/10',    text:'text-blue-600 dark:text-blue-400',   dot:'bg-blue-400' },
  LOW:    { label:'Baja',     bg:'bg-gray-50',    text:'text-gray-500',   dot:'bg-gray-300' },
};

const STATUS_CFG = {
  IN_STOCK:           { label:'Pendiente despacho',     bg:'bg-amber-50 dark:bg-amber-500/10',  text:'text-amber-700 dark:text-amber-300',  border:'border-amber-200 dark:border-amber-500/30' },
  QUALITY_APPROVED:   { label:'Calidad aprobada — pendiente despacho', bg:'bg-sky-50 dark:bg-sky-500/10', text:'text-sky-700 dark:text-sky-300', border:'border-sky-200 dark:border-sky-500/30' },
  DISPATCHED_TO_SITE: { label:'Actualizar registros',   bg:'bg-violet-50 dark:bg-violet-500/10', text:'text-violet-700 dark:text-violet-300', border:'border-violet-200 dark:border-violet-500/30' },
  DELIVERED:          { label:'Confirmar en almacén',   bg:'bg-teal-50 dark:bg-teal-500/10',   text:'text-teal-700 dark:text-teal-300',   border:'border-teal-200 dark:border-teal-500/30' },
};

// Acciones del flujo que ejecuta el almacén (las únicas que se ofrecen en esta pantalla).
const ACTION_CFG = {
  DISPATCHED:               { label:'Registrar despacho',     color:'bg-amber-500 hover:bg-amber-600' },
  WAREHOUSE_RECORDS_UPDATED:{ label:'Actualizar registros',   color:'bg-violet-500 hover:bg-violet-600' },
};
const WAREHOUSE_ACTIONS = Object.keys(ACTION_CFG);

const SUPPLY_LABELS = { STOCK:'De stock', PURCHASE:'Compra', SERVICE:'Servicio', RENTAL:'Alquiler' };

/** Rol con el que el usuario ejecuta la acción pendiente (el servidor lo valida igual). */
function actingRoleFor(rq, userRoles) {
  if (!rq?.can_act) return '';
  return (rq.act_roles ?? []).find((r) => userRoles.includes(r)) ?? '';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PriorityDot({ priority }) {
  const c = PRIORITY_CFG[priority] ?? PRIORITY_CFG.NORMAL;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} aria-hidden="true" />{c.label}
    </span>
  );
}

function StatusPill({ status }) {
  const c = STATUS_CFG[status] ?? { label: status, bg:'bg-gray-50', text:'text-gray-600', border:'border-gray-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${c.bg} ${c.text} ${c.border}`}>{c.label}</span>;
}

// ── Action Panel ─────────────────────────────────────────────────────────────

function ActionPanel({ rq: card, actingRole, onClose, onSuccess }) {
  const rqId = card.id;
  const { showToast } = useToast();
  const [rq, setRq]               = useState(null);
  const [actions, setActions]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState('');
  const [comment, setComment]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  const canAct = !!actingRole;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [rqRes, actRes] = await Promise.all([
          getRequest(rqId),
          canAct ? getAvailableActions(rqId, actingRole) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRq(rqRes.data);
        const acts = actRes?.data?.available_actions ?? [];
        const warehouse = Array.isArray(acts) ? acts.filter((a) => WAREHOUSE_ACTIONS.includes(a.action)) : [];
        setActions(warehouse);
        if (warehouse.length === 1) setSelected(warehouse[0].action);
      } catch { if (!cancelled) setLoadError('No se pudo cargar el requerimiento. Intente de nuevo.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [rqId, canAct, actingRole]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      await performAction(rqId, { action: selected, acting_role: actingRole, comments: comment.trim() });
      showToast({ type: 'success', message: `${ACTION_CFG[selected]?.label ?? 'Acción'} registrado para ${card.rq_number}.` });
      onSuccess();
    } catch (err) {
      const message = extractErrorMessage(err, 'No se pudo ejecutar la acción. Intente nuevamente.');
      if (mounted.current) setError(message);
      showToast({ type: 'error', message, duration: 8000 });
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const showDeliverLink = card.can_deliver && (card.status === 'IN_STOCK' || card.status === 'QUALITY_APPROVED');

  return (
    <HRDialog
      open
      variant="drawer"
      busy={submitting}
      onClose={onClose}
      title={`Requerimiento ${card.rq_number}`}
      description={canAct ? 'Revise los ítems y ejecute la acción de almacén.' : 'Vista de solo lectura.'}
      footer={canAct && !loading && !loadError && actions.length > 0 ? (
        <>
          <button type="button" onClick={onClose} disabled={submitting}
            className="min-h-11 px-4 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="pendientes-action-form"
            aria-disabled={!selected || submitting || undefined}
            className={`min-h-11 px-5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${
              ACTION_CFG[selected]?.color ?? 'bg-amber-600 hover:bg-amber-700'
            }`}>
            {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={15} aria-hidden="true" />}
            {submitting ? 'Ejecutando…' : (ACTION_CFG[selected]?.label ?? 'Ejecutar')}
          </button>
        </>
      ) : null}
    >
      {loading ? (
        <LoadingBlock label="Cargando el requerimiento…" className="h-32" />
      ) : loadError ? (
        <ErrorBlock message={loadError} />
      ) : (
        <div className="space-y-4">
          {rq && (
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={rq.status} />
                <PriorityDot priority={rq.priority} />
                <span className="text-xs text-gray-500">{rq.flow === 'OPERATIONS' ? 'Operaciones' : 'Administración'}</span>
              </div>
              <p className="text-xs text-gray-600 font-medium">
                {rq.project?.name ?? rq.department?.name ?? '—'}
                {rq.fecha_necesidad && <span className="text-gray-500 font-normal"> · Necesidad: {rq.fecha_necesidad}</span>}
              </p>
              <p className="text-xs text-gray-500">Solicitado por: <span className="text-gray-700 font-medium">{rq.requested_by?.full_name ?? rq.requested_by}</span></p>
            </div>
          )}

          {rq?.items?.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ítems del requerimiento</h3>
              <ul className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100">
                {rq.items.map((item, i) => (
                  <li key={item.id ?? i} className="flex items-center justify-between px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{item.description}</p>
                      <p className="text-xs text-gray-500">
                        {SUPPLY_LABELS[item.supply_source] ?? item.supply_source ?? '—'}
                        {item.unit ? ` · ${item.unit}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-700 tabular-nums ml-4 shrink-0">{item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showDeliverLink && (
            <Banner tone="blue">
              Para entregar por tandas (entregas parciales con guía de remisión) use{' '}
              <Link to={`/almacen/pendientes/${rqId}/picking`} className="font-semibold underline">Picking y entrega</Link>.
            </Banner>
          )}

          {!canAct ? (
            <Banner tone="amber">
              Solo lectura: la acción de este estado corresponde a {roleList(card.act_roles) || 'otro rol'}.
            </Banner>
          ) : actions.length === 0 ? (
            <Banner tone="amber">
              No tienes acciones disponibles para este requerimiento con tu rol actual.
            </Banner>
          ) : (
            <form id="pendientes-action-form" onSubmit={handleSubmit} className="space-y-3" noValidate>
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Acción a ejecutar</legend>
                {actions.map((a) => {
                  const cfg = ACTION_CFG[a.action];
                  return (
                    <label key={a.action}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${
                        selected === a.action ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}>
                      <input type="radio" name="action" value={a.action}
                        checked={selected === a.action}
                        onChange={() => setSelected(a.action)}
                        className="accent-amber-500" />
                      <span className="text-sm font-semibold text-gray-700">{cfg?.label ?? a.label ?? a.action}</span>
                    </label>
                  );
                })}
              </fieldset>

              <div>
                <label htmlFor="pendientes-comment" className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Comentario <span className="text-gray-500 font-normal normal-case">(opcional)</span>
                </label>
                <textarea
                  id="pendientes-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="Agrega un comentario o nota para este movimiento..."
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300 transition-all resize-none"
                />
              </div>
              {error && <Banner tone="red">{error}</Banner>}
            </form>
          )}
        </div>
      )}
    </HRDialog>
  );
}

// ── RQ Card ──────────────────────────────────────────────────────────────────

function RQCard({ rq, onOpen }) {
  const c = STATUS_CFG[rq.status] ?? { border:'border-gray-100', bg:'bg-white', text:'text-gray-600' };
  const label = rq.can_act ? 'Gestionar' : 'Ver detalle';
  const hasPicking = rq.status === 'IN_STOCK' || rq.status === 'QUALITY_APPROVED';
  return (
    <article
      aria-label={`Requerimiento ${rq.rq_number}`}
      className="bg-white rounded-xl border-2 border-gray-100 overflow-hidden transition-all duration-150 hover:border-gray-200 hover:shadow-sm">
      <div className={`px-4 py-2.5 flex items-center justify-between gap-2 border-b border-gray-100 ${c.bg}`}>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className={`font-mono text-xs font-bold ${c.text}`}>{rq.rq_number}</span>
          <StatusPill status={rq.status} />
        </div>
        <PriorityDot priority={rq.priority} />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5">
          {rq.flow === 'OPERATIONS' ? <HardHat size={12} className="text-gray-400 shrink-0" aria-hidden="true" /> : <Building2 size={12} className="text-gray-400 shrink-0" aria-hidden="true" />}
          <p className="text-sm font-semibold text-gray-700 truncate">
            {rq.project ?? rq.department ?? '—'}
            {rq.project_code ? <span className="text-gray-500 font-normal"> · {rq.project_code}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-1 text-[11px] text-gray-500"><Package size={10} aria-hidden="true" />{rq.items_count} ítem{rq.items_count !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1 text-[11px] text-gray-500"><User size={10} aria-hidden="true" />{rq.requested_by}</span>
          {rq.fecha_necesidad && <span className="flex items-center gap-1 text-[11px] text-gray-500"><Calendar size={10} aria-hidden="true" />{rq.fecha_necesidad}</span>}
        </div>
        {!rq.can_act && (
          <p className="flex items-start gap-1.5 text-[11px] text-gray-600">
            <Lock size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
            Solo lectura: la acción corresponde a {roleList(rq.act_roles) || 'otro rol'}.
          </p>
        )}
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onOpen}
          aria-label={`${label} ${rq.rq_number}`}
          className={`min-h-9 px-3 rounded-lg text-xs font-semibold border ${c.border ?? 'border-gray-200'} ${c.text} hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600`}>
          {label}
        </button>
        {hasPicking && (
          <Link to={`/almacen/pendientes/${rq.id}/picking`}
            aria-label={`${rq.can_deliver ? 'Picking y entrega' : 'Ver picking'} de ${rq.rq_number}`}
            className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
            <Truck size={12} aria-hidden="true" />
            {rq.can_deliver ? 'Picking y entrega' : 'Ver picking'}
          </Link>
        )}
      </div>
    </article>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PendientesPage() {
  const { userRoles = [] } = useAuth();
  const [requests, setRequests]   = useState([]);
  const [summary, setSummary]     = useState({ total: 0, by_status: [] });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [filterFlow, setFilterFlow]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage]           = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected]   = useState(null);
  const PAGE_SIZE = 25;

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { page };
      if (search)       params.search = search;
      if (filterFlow)   params.flow   = filterFlow;
      if (filterStatus) params.status = filterStatus;
      const [listRes, countRes] = await Promise.all([
        getPendingRequests(params), getPendingCount(),
      ]);
      const results = listRes.data?.results ?? listRes.data ?? [];
      setRequests(Array.isArray(results) ? results : []);
      setTotalCount(listRes.data?.count ?? results.length);
      setSummary(countRes.data ?? { total: 0, by_status: [] });
    } catch { setError('No se pudo cargar los requerimientos pendientes.'); }
    finally { setLoading(false); }
  }, [page, search, filterFlow, filterStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Al cambiar un filtro se vuelve a la primera página (en el manejador, no en un efecto).
  const changeFilter = (setter) => (value) => { setter(value); setPage(1); };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 flex items-center justify-center">
              <ClipboardList size={16} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-gray-800 font-display tracking-tight">Requerimientos Pendientes</h1>
            {summary.total > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 text-[11px] font-bold">{summary.total}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 pl-[42px]">Selecciona un RQ para gestionar las acciones de almacén</p>
        </div>
        <button id="btn-refresh-pending" type="button" onClick={fetchData}
          className="flex items-center gap-1.5 min-h-9 px-3 py-2 rounded-xl border border-gray-100 bg-white text-xs font-medium text-gray-600 hover:text-gray-800 active:scale-95 transition-all">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Actualizar
        </button>
      </div>

      {/* Status summary badges */}
      {summary.by_status.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {[{ status:'__all__', label:'Todos', count: summary.total }, ...summary.by_status].map((s) => {
            const isAll = s.status === '__all__';
            const active = isAll ? filterStatus === '' : filterStatus === s.status;
            const cfg = STATUS_CFG[s.status] ?? {};
            return (
              <button key={s.status} type="button" aria-pressed={active}
                onClick={() => changeFilter(setFilterStatus)(isAll ? '' : (filterStatus === s.status ? '' : s.status))}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active ? `${cfg.bg ?? 'bg-amber-50 dark:bg-amber-500/10'} ${cfg.border ?? 'border-amber-200 dark:border-amber-500/30'} shadow-sm` : 'bg-white border-gray-100 hover:bg-gray-50'
                }`}>
                <span className={`text-base font-extrabold tabular-nums ${active ? (cfg.text ?? 'text-amber-700 dark:text-amber-300') : 'text-gray-700'}`}>{s.count}</span>
                <span className={`text-[11px] font-medium leading-tight ${active ? (cfg.text ?? 'text-amber-600 dark:text-amber-400') : 'text-gray-600'}`}>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
          <input id="search-pending" type="search" placeholder="Buscar RQ, proyecto, departamento, solicitante..."
            aria-label="Buscar requerimientos"
            value={search} onChange={(e) => changeFilter(setSearch)(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-100 rounded-xl bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300 transition-all" />
        </div>
        <select id="filter-flow" aria-label="Filtrar por flujo" value={filterFlow} onChange={(e) => changeFilter(setFilterFlow)(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-100 rounded-xl bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-400/30 transition-all">
          <option value="">Todos los flujos</option>
          <option value="OPERATIONS">Operaciones</option>
          <option value="ADMINISTRATIVE">Administración</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <LoadingBlock label="Cargando requerimientos pendientes…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={fetchData} />
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center">
            <Inbox size={32} strokeWidth={1.2} className="text-gray-400" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold text-gray-600">Sin requerimientos pendientes</p>
          <p className="text-xs text-gray-500">
            {search || filterFlow || filterStatus ? 'No hay resultados para los filtros aplicados.' : 'No hay RQs pendientes en este momento.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {requests.map((rq) => (
              <RQCard key={rq.id} rq={rq} onOpen={() => setSelected(rq)} />
            ))}
          </div>

          {totalPages > 1 && (
            <nav aria-label="Paginación" className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-500">
                {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, totalCount)} de {totalCount}
              </p>
              <div className="flex items-center gap-1">
                <button id="btn-prev-page" type="button" aria-label="Página anterior" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                  className="p-2 rounded-lg border border-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-all">
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <span className="px-3 py-1 text-xs text-gray-600" aria-current="page">{page}/{totalPages}</span>
                <button id="btn-next-page" type="button" aria-label="Página siguiente" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}
                  className="p-2 rounded-lg border border-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-all">
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </>
      )}

      {/* Action panel */}
      {selected && (
        <ActionPanel
          key={selected.id}
          rq={selected}
          actingRole={actingRoleFor(selected, userRoles)}
          onClose={() => setSelected(null)}
          onSuccess={() => { setSelected(null); fetchData(); }}
        />
      )}
    </div>
  );
}
