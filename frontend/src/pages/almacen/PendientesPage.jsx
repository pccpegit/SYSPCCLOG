import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Search, RefreshCw, Package, Calendar, User,
  Building2, HardHat, ChevronLeft, ChevronRight, Inbox,
  X, CheckCircle, AlertCircle, Loader2, ArrowUpRight, ChevronDown,
} from 'lucide-react';
import { getPendingRequests, getPendingCount } from '../../api/almacen';
import { getRequest, getAvailableActions, performAction } from '../../api/requests';

// ── Config ──────────────────────────────────────────────────────────────────

const PRIORITY_CFG = {
  URGENT: { label:'Urgente',  bg:'bg-red-50 dark:bg-red-500/10',    text:'text-red-600 dark:text-red-400',    dot:'bg-red-500 animate-pulse' },
  HIGH:   { label:'Alta',     bg:'bg-orange-50 dark:bg-orange-500/10',  text:'text-orange-600 dark:text-orange-400', dot:'bg-orange-400' },
  NORMAL: { label:'Normal',   bg:'bg-blue-50 dark:bg-blue-500/10',    text:'text-blue-600 dark:text-blue-400',   dot:'bg-blue-400' },
  LOW:    { label:'Baja',     bg:'bg-gray-50',    text:'text-gray-500',   dot:'bg-gray-300' },
};

const STATUS_CFG = {
  IN_STOCK:           { label:'Pendiente despacho',     bg:'bg-amber-50 dark:bg-amber-500/10',  text:'text-amber-700 dark:text-amber-300',  border:'border-amber-200 dark:border-amber-500/30' },
  DISPATCHED_TO_SITE: { label:'Actualizar registros',   bg:'bg-violet-50 dark:bg-violet-500/10', text:'text-violet-700 dark:text-violet-300', border:'border-violet-200 dark:border-violet-500/30' },
  DELIVERED:          { label:'Confirmar en almacén',   bg:'bg-teal-50 dark:bg-teal-500/10',   text:'text-teal-700 dark:text-teal-300',   border:'border-teal-200 dark:border-teal-500/30' },
};

const ACTION_CFG = {
  DISPATCHED:               { label:'Registrar Despacho',       color:'bg-amber-500 hover:bg-amber-600' },
  WAREHOUSE_RECORDS_UPDATED:{ label:'Actualizar Registros',     color:'bg-violet-500 hover:bg-violet-600' },
  SITE_RECEIVED:            { label:'Confirmar Recepción',       color:'bg-teal-500 hover:bg-teal-600' },
};

const SUPPLY_LABELS = { STOCK:'De stock', PURCHASE:'Compra', SERVICE:'Servicio', RENTAL:'Alquiler' };

// ── Sub-components ───────────────────────────────────────────────────────────

function PriorityDot({ priority }) {
  const c = PRIORITY_CFG[priority] ?? PRIORITY_CFG.NORMAL;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{c.label}
    </span>
  );
}

function StatusPill({ status }) {
  const c = STATUS_CFG[status] ?? { label: status, bg:'bg-gray-50', text:'text-gray-600', border:'border-gray-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${c.bg} ${c.text} ${c.border}`}>{c.label}</span>;
}

// ── Action Panel ─────────────────────────────────────────────────────────────

function ActionPanel({ rqId, onClose, onSuccess }) {
  const [rq, setRq]               = useState(null);
  const [actions, setActions]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState('');
  const [comment, setComment]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [rqRes, actRes] = await Promise.all([
          getRequest(rqId),
          getAvailableActions(rqId),
        ]);
        if (cancelled) return;
        setRq(rqRes.data);
        const acts = actRes.data?.actions ?? actRes.data ?? [];
        const warehouseActions = ['DISPATCHED','WAREHOUSE_RECORDS_UPDATED','SITE_RECEIVED'];
        setActions(Array.isArray(acts) ? acts.filter(a => warehouseActions.includes(a.action ?? a)) : []);
        if (acts.length === 1) setSelected(acts[0].action ?? acts[0]);
      } catch { if (!cancelled) setError('No se pudo cargar el requerimiento.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [rqId]);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      await performAction(rqId, { action: selected, comment });
      setDone(true);
      setTimeout(() => { onSuccess(); }, 1200);
    } catch (e) {
      setError(e?.response?.data?.detail ?? e?.response?.data?.error ?? 'Error al ejecutar la acción.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Requerimiento</p>
            <p className="text-base font-bold text-gray-800 font-mono">{rq?.rq_number ?? '...'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={22} className="animate-spin text-amber-500" />
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <CheckCircle size={40} className="text-emerald-500" />
              <p className="text-sm font-semibold text-gray-700">¡Acción ejecutada correctamente!</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
                </div>
              )}

              {/* RQ summary */}
              {rq && (
                <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill status={rq.status} />
                    <PriorityDot priority={rq.priority} />
                    <span className="text-[10px] text-gray-400">{rq.flow === 'OPERATIONS' ? 'Operaciones' : 'Administración'}</span>
                  </div>
                  <p className="text-xs text-gray-600 font-medium">
                    {rq.project?.name ?? rq.department?.name ?? '—'}
                    {rq.fecha_necesidad && <span className="text-gray-400 font-normal"> · Necesidad: {rq.fecha_necesidad}</span>}
                  </p>
                  <p className="text-xs text-gray-400">Solicitado por: <span className="text-gray-600 font-medium">{rq.requested_by?.full_name ?? rq.requested_by}</span></p>
                </div>
              )}

              {/* Items list */}
              {rq?.items?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ítems del requerimiento</p>
                  <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                    {rq.items.map((item, i) => (
                      <div key={item.id ?? i} className="flex items-center justify-between px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700 truncate">{item.description}</p>
                          <p className="text-[10px] text-gray-400">
                            {SUPPLY_LABELS[item.supply_source] ?? item.supply_source ?? '—'}
                            {item.unit ? ` · ${item.unit}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-gray-700 tabular-nums ml-4 shrink-0">
                          {item.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action selector */}
              {actions.length === 0 ? (
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  No tienes acciones disponibles para este requerimiento con tu rol actual.
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Acción a ejecutar</p>
                  <div className="space-y-2">
                    {actions.map((a) => {
                      const key = a.action ?? a;
                      const cfg = ACTION_CFG[key];
                      return (
                        <label key={key}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${
                            selected === key ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' : 'border-gray-100 bg-white hover:border-gray-200'
                          }`}>
                          <input type="radio" name="action" value={key}
                            checked={selected === key}
                            onChange={() => setSelected(key)}
                            className="accent-amber-500" />
                          <div>
                            <p className="text-sm font-semibold text-gray-700">{cfg?.label ?? a.label ?? key}</p>
                            {a.description && <p className="text-[11px] text-gray-400">{a.description}</p>}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                      Comentario <span className="text-gray-300 font-normal normal-case">(opcional)</span>
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      placeholder="Agrega un comentario o nota para este movimiento..."
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300 transition-all resize-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !done && actions.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-all">
              Cancelar
            </button>
            <button
              id="btn-execute-action"
              onClick={handleSubmit}
              disabled={!selected || submitting}
              className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 ${
                ACTION_CFG[selected]?.color ?? 'bg-amber-500 hover:bg-amber-600'
              }`}>
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
              {submitting ? 'Ejecutando...' : (ACTION_CFG[selected]?.label ?? 'Ejecutar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── RQ Card ──────────────────────────────────────────────────────────────────

function RQCard({ rq, selected, onClick }) {
  const c = STATUS_CFG[rq.status] ?? { border:'border-gray-100', bg:'bg-white', text:'text-gray-600' };
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-150 active:scale-[0.99] ${
        selected ? `${c.border} shadow-md` : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }`}>
      <div className={`px-4 py-2.5 flex items-center justify-between gap-2 border-b ${selected ? c.border : 'border-gray-50'} ${c.bg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono text-xs font-bold ${c.text}`}>{rq.rq_number}</span>
          <StatusPill status={rq.status} />
        </div>
        <PriorityDot priority={rq.priority} />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5">
          {rq.flow === 'OPERATIONS' ? <HardHat size={12} className="text-gray-300 shrink-0" /> : <Building2 size={12} className="text-gray-300 shrink-0" />}
          <p className="text-sm font-semibold text-gray-700 truncate">
            {rq.project ?? rq.department ?? '—'}
            {rq.project_code ? <span className="text-gray-400 font-normal"> · {rq.project_code}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-1 text-[11px] text-gray-400"><Package size={10} />{rq.items_count} ítem{rq.items_count !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1 text-[11px] text-gray-400"><User size={10} />{rq.requested_by}</span>
          {rq.fecha_necesidad && <span className="flex items-center gap-1 text-[11px] text-gray-400"><Calendar size={10} />{rq.fecha_necesidad}</span>}
        </div>
      </div>
      <div className={`px-4 py-2.5 border-t ${selected ? c.border : 'border-gray-50'} flex items-center justify-between`}>
        <p className="text-[11px] text-gray-400">Clic para ver acciones</p>
        <div className={`flex items-center gap-1 text-[11px] font-semibold ${c.text}`}>
          Gestionar <ArrowUpRight size={11} />
        </div>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PendientesPage() {
  const [requests, setRequests]   = useState([]);
  const [summary, setSummary]     = useState({ total: 0, by_status: [] });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [filterFlow, setFilterFlow]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage]           = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
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
  useEffect(() => { setPage(1); }, [search, filterFlow, filterStatus]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 flex items-center justify-center">
              <ClipboardList size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-lg font-bold text-gray-800 font-display tracking-tight">Requerimientos Pendientes</h1>
            {summary.total > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 text-[11px] font-bold">{summary.total}</span>
            )}
          </div>
          <p className="text-xs text-gray-400 pl-[42px]">Selecciona un RQ para gestionar las acciones de almacén</p>
        </div>
        <button id="btn-refresh-pending" onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-100 bg-white text-xs font-medium text-gray-500 hover:text-gray-700 active:scale-95 transition-all">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Status summary badges */}
      {summary.by_status.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[{ status:'__all__', label:'Todos', count: summary.total }, ...summary.by_status].map((s) => {
            const isAll = s.status === '__all__';
            const active = isAll ? filterStatus === '' : filterStatus === s.status;
            const cfg = STATUS_CFG[s.status] ?? {};
            return (
              <button key={s.status}
                onClick={() => setFilterStatus(isAll ? '' : (filterStatus === s.status ? '' : s.status))}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active ? `${cfg.bg ?? 'bg-amber-50 dark:bg-amber-500/10'} ${cfg.border ?? 'border-amber-200 dark:border-amber-500/30'} shadow-sm` : 'bg-white border-gray-100 hover:bg-gray-50'
                }`}>
                <span className={`text-base font-extrabold tabular-nums ${active ? (cfg.text ?? 'text-amber-700 dark:text-amber-300') : 'text-gray-700'}`}>{s.count}</span>
                <span className={`text-[11px] font-medium leading-tight ${active ? (cfg.text ?? 'text-amber-600 dark:text-amber-400') : 'text-gray-500'}`}>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
          <input id="search-pending" type="text" placeholder="Buscar RQ, proyecto, departamento, solicitante..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-100 rounded-xl bg-white text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300 transition-all" />
        </div>
        <select id="filter-flow" value={filterFlow} onChange={(e) => setFilterFlow(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-100 rounded-xl bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-400/30 transition-all">
          <option value="">Todos los flujos</option>
          <option value="OPERATIONS">Operaciones</option>
          <option value="ADMINISTRATIVE">Administración</option>
        </select>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-amber-500" />
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center">
            <Inbox size={32} strokeWidth={1.2} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">Sin requerimientos pendientes</p>
          <p className="text-xs text-gray-300">
            {search || filterFlow || filterStatus ? 'No hay resultados para los filtros aplicados.' : 'No hay RQs pendientes en este momento.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {requests.map((rq) => (
              <RQCard key={rq.id} rq={rq}
                selected={selectedId === rq.id}
                onClick={() => setSelectedId(selectedId === rq.id ? null : rq.id)} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-400">
                {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, totalCount)} de {totalCount}
              </p>
              <div className="flex items-center gap-1">
                <button id="btn-prev-page" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                  className="p-1.5 rounded-lg border border-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-all">
                  <ChevronLeft size={14} />
                </button>
                <span className="px-3 py-1 text-xs text-gray-500">{page}/{totalPages}</span>
                <button id="btn-next-page" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}
                  className="p-1.5 rounded-lg border border-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-all">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Action panel modal */}
      {selectedId && (
        <ActionPanel
          rqId={selectedId}
          onClose={() => setSelectedId(null)}
          onSuccess={() => { setSelectedId(null); fetchData(); }}
        />
      )}
    </div>
  );
}
