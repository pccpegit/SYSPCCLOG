import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, ListTree, Loader2, Rows3, Table2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getRequestMaster, getRequestMasterSummary } from '../../api/requestMaster';
import { getProjects } from '../../api/core';
import useMasterQuery from '../../hooks/useMasterQuery';
import useMasterExport from '../../hooks/useMasterExport';
import MasterKpis from '../../components/requestMaster/MasterKpis';
import MasterFilters from '../../components/requestMaster/MasterFilters';
import MasterTabs from '../../components/requestMaster/MasterTabs';
import MasterItemsTable from '../../components/requestMaster/MasterItemsTable';
import MasterSummaryTable from '../../components/requestMaster/MasterSummaryTable';
import OverrideDialog from '../../components/requestMaster/OverrideDialog';
import Pagination from '../../components/requestMaster/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/requestMaster/QueryStates';
import {
  TABS, activeFilterCount, buildApiParams, buildMasterSearch, describeLoadError, nextOrdering,
  panelDomId, parseMasterSearch, tabDomId, EMPTY_FILTERS,
} from '../../utils/requestMaster';

const TAB_DEFS = [
  { id: TABS.ITEM, label: 'Por ítem', icon: Rows3 },
  { id: TABS.RQ, label: 'Por RQ', icon: ListTree },
];

/**
 * SYSPCC-030 — Master de RQ: seguimiento de cada ítem de cada RQ (reemplaza el Excel «MASTER DE RQ»).
 * La URL es la fuente de verdad de pestaña, filtros, orden y página (se puede compartir y vuelve con
 * Atrás). La visibilidad la decide el servidor según el rol; aquí solo se pinta lo que devuelve.
 */
export default function RequestMasterPage() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, filters, ordering, page, pageSize } = useMemo(() => parseMasterSearch(searchParams), [searchParams]);

  const [projects, setProjects] = useState([]);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const exporter = useMasterExport();

  useEffect(() => {
    document.title = 'Master de RQ · SYSPCC';
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProjects({ page_size: 100 })
      .then(({ data }) => { if (!cancelled) setProjects(data.results ?? data ?? []); })
      .catch(() => { /* el filtro de proyecto simplemente queda sin opciones */ });
    return () => { cancelled = true; };
  }, []);

  const go = useCallback((next, { replace = false } = {}) => {
    setSearchParams(buildMasterSearch(next), { replace });
  }, [setSearchParams]);

  const current = { tab, filters, ordering, page, pageSize };
  const changeFilters = (patch) => go({ ...current, filters: { ...filters, ...patch }, page: 1 }, { replace: 'search' in patch });
  const clearFilters = () => go({ ...current, filters: EMPTY_FILTERS, page: 1 });
  const changeTab = (next) => go({ ...current, tab: next, ordering: '', page: 1 });
  const changeOrder = (field) => go({ ...current, ordering: nextOrdering(ordering, field), page: 1 });
  const changePage = (next) => go({ ...current, page: next });
  const changePageSize = (size) => go({ ...current, pageSize: size, page: 1 });

  const filterCount = activeFilterCount(filters);
  const isItemTab = tab === TABS.ITEM;

  const list = useMasterQuery(
    isItemTab ? getRequestMaster : getRequestMasterSummary,
    buildApiParams(filters, { ordering, page, page_size: pageSize }),
  );
  const kpiQuery = useMasterQuery(getRequestMasterSummary, buildApiParams(filters, { page_size: 1 }));

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;

  function handleSaved(result) {
    const item = result?.item;
    if (item) list.patchRows((row) => (row.id === item.id ? { ...row, ...item } : row));
    setOverrideTarget(null);
    kpiQuery.reload();
    showToast({
      type: result?.changed === false ? 'info' : 'success',
      message: result?.detail || 'Seguimiento actualizado.',
    });
  }

  let liveText = '';
  if (list.loading) liveText = 'Cargando el Master de RQ…';
  else if (list.error) liveText = 'No se pudo cargar el Master de RQ.';
  else if (list.data) liveText = `${count} ${isItemTab ? (count === 1 ? 'ítem' : 'ítems') : (count === 1 ? 'RQ' : 'RQs')} en el Master.`;

  const showStale = list.loading && list.data;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 flex items-center gap-2.5 tracking-tight font-display">
            <Table2 size={26} className="text-blue-600 dark:text-blue-400" strokeWidth={2} aria-hidden="true" />
            Master de RQ
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Seguimiento de cada ítem de los requerimientos, de la aprobación a la entrega.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exporter.run(buildApiParams(filters))}
          aria-disabled={exporter.busy}
          className="w-full sm:w-auto inline-flex min-h-11 items-center justify-center gap-2.5 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 shadow-md shadow-blue-600/15 font-display aria-disabled:opacity-60 aria-disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {exporter.busy
            ? <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            : <Download size={17} aria-hidden="true" />}
          {exporter.busy ? 'Preparando Excel…' : 'Descargar Master (Excel)'}
        </button>
      </div>

      {/* Regiones vivas siempre montadas: se anuncian al cambiar su texto. */}
      <p aria-live="polite" className="sr-only">{liveText}</p>
      <p aria-live="polite" className={exporter.message ? 'text-xs text-gray-500' : 'sr-only'}>{exporter.message}</p>

      <MasterKpis kpis={kpiQuery.data?.kpis ?? null} loading={kpiQuery.loading} failed={Boolean(kpiQuery.error)} />

      <MasterFilters
        filters={filters}
        projects={projects}
        onChange={changeFilters}
        onClear={clearFilters}
        activeCount={filterCount}
      />

      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <MasterTabs tabs={TAB_DEFS} active={tab} onChange={changeTab} label="Vista del Master" />

        <div
          role="tabpanel"
          id={panelDomId(tab)}
          aria-labelledby={tabDomId(tab)}
          aria-busy={list.loading}
          tabIndex={-1}
        >
          {list.loading && !list.data ? (
            <LoadingState label="Cargando el Master de RQ…" />
          ) : list.error ? (
            <ErrorState
              message={describeLoadError(list.error)}
              onRetry={list.reload}
              extra={page > 1 && (
                <button
                  type="button"
                  onClick={() => changePage(1)}
                  className="min-h-11 px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 font-display"
                >
                  Ir a la primera página
                </button>
              )}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              filtered={filterCount > 0}
              onClear={clearFilters}
              title={isItemTab ? 'No hay ítems para mostrar' : 'No hay RQs para mostrar'}
            />
          ) : (
            <>
              {isItemTab ? (
                <MasterItemsTable
                  rows={rows}
                  ordering={ordering}
                  onOrder={changeOrder}
                  busy={Boolean(showStale)}
                  onOverride={(row, kind) => setOverrideTarget({ row, kind })}
                />
              ) : (
                <MasterSummaryTable rows={rows} ordering={ordering} onOrder={changeOrder} busy={Boolean(showStale)} />
              )}
              <Pagination
                count={count}
                page={page}
                pageSize={pageSize}
                hasNext={Boolean(list.data?.next)}
                hasPrevious={page > 1}
                onPage={changePage}
                onPageSize={changePageSize}
              />
            </>
          )}
        </div>
      </div>

      <OverrideDialog target={overrideTarget} onClose={() => setOverrideTarget(null)} onSaved={handleSaved} />
    </div>
  );
}
