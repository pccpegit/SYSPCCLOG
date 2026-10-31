import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Loader2, Scale, Search } from 'lucide-react';
import { exportMovementSummary, getCategories, getMovementSummary } from '../../api/almacen';
import { getProjects } from '../../api/core';
import useFileDownload from '../../hooks/useFileDownload';
import useFilterAnnouncer from '../../hooks/useFilterAnnouncer';
import { FLOOR_OPTIONS } from '../../data/almacenConstants';
import { formatQty, localISODate } from '../../utils/almacen';
import {
  Banner, Card, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, Pagination,
} from '../../components/almacen/ui';
import { btnSecondary, inputCls, thCls } from '../../components/almacen/uiStyles';

const PAGE_SIZE = 50;
const ORDER_ERROR = 'La fecha inicial no puede ser posterior a la final.';

/** Parámetros del backend para los filtros activos (sin paginación). */
function buildParams(f) {
  const params = {};
  if (f.dateFrom) params.date_from = f.dateFrom;
  if (f.dateTo) params.date_to = f.dateTo;
  if (f.search) params.search = f.search;
  if (f.category) params.category = f.category;
  if (f.floor) params.floor = f.floor;
  if (f.project) params.project = f.project;
  if (f.onlyMovement) params.only_with_movement = 'true';
  if (f.onlyZero) params.only_zero_stock = 'true';
  return params;
}

const NUM = 'px-4 py-3 text-right tabular-nums';

/**
 * Resumen de movimiento: equivalente a la hoja «RESUMEN DE MOVIMIENTO» de su libro
 * (INV. INICIAL + INGRESOS − EGRESOS = STOCK ACTUAL), con filtro de periodo.
 */
export default function ResumenPage() {
  const navigate = useNavigate();
  const download = useFileDownload();
  const [state, setState] = useState({ status: 'loading', rows: [], total: 0, meta: null });
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [floor, setFloor] = useState('');
  const [project, setProject] = useState('');
  const [onlyMovement, setOnlyMovement] = useState(false);
  const [onlyZero, setOnlyZero] = useState(false);
  const [includeMovements, setIncludeMovements] = useState(false);
  const [page, setPage] = useState(1);
  const seq = useRef(0);

  const filters = { dateFrom, dateTo, search, category, floor, project, onlyMovement, onlyZero };
  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? ORDER_ERROR : '';
  const periodFiltered = Boolean(dateFrom || dateTo);

  const change = (setter) => (value) => { setter(value); setPage(1); };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getCategories();
        const list = res?.data?.results ?? res?.data ?? [];
        if (alive && Array.isArray(list)) setCategories(list);
      } catch {
        // Sin categorías el filtro simplemente queda en "Todas".
      }
      try {
        const res = await getProjects({ page_size: 100 });
        const list = res?.data?.results ?? res?.data ?? [];
        if (alive && Array.isArray(list)) setProjects(list);
      } catch {
        // El filtro por proyecto es opcional: sin permiso o sin red simplemente no se ofrece.
      }
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    if (rangeError) return;
    const mine = ++seq.current;
    setState((prev) => ({ ...prev, status: prev.rows.length ? 'refreshing' : 'loading' }));
    try {
      const res = await getMovementSummary({
        page, page_size: PAGE_SIZE,
        ...buildParams({ dateFrom, dateTo, search, category, floor, project, onlyMovement, onlyZero }),
      });
      if (mine !== seq.current) return;
      const rows = res.data?.results ?? [];
      setState({ status: 'ready', rows, total: res.data?.count ?? rows.length, meta: res.data?.meta ?? null });
    } catch {
      if (mine === seq.current) setState({ status: 'error', rows: [], total: 0, meta: null });
    }
  }, [page, dateFrom, dateTo, search, category, floor, project, onlyMovement, onlyZero, rangeError]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const announcement = useFilterAnnouncer(
    JSON.stringify(filters),
    state.status === 'ready' ? `Mostrando ${state.total} ${state.total === 1 ? 'ítem' : 'ítems'}.` : '',
  );

  const totals = state.meta?.totals;
  const undated = state.meta?.undated_movements ?? 0;
  // «Stock actual» here comes from movements (initial + entries - exits) while Inventario reads the real
  // stock. They only agree when every unit has a documented movement; flag the rows where they do not
  // (not with a date filter: a past closing stock legitimately differs from today's).
  const divergentRows = periodFiltered
    ? 0
    : state.rows.filter((r) => r.current_stock != null && Number(r.current_stock) !== Number(r.closing_stock)).length;
  const loading = state.status === 'loading';

  const exportBook = () => download.run(
    () => exportMovementSummary({
      ...buildParams(filters),
      ...(includeMovements ? { include_movements: 'true' } : {}),
    }),
    `resumen_movimiento_${localISODate()}.xlsx`,
    'No se pudo exportar el resumen. Intente nuevamente.',
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <PageHeader
        title="Resumen de movimiento"
        subtitle="Inventario inicial, ingresos, egresos y stock por ítem, como en su hoja de Excel."
        icon={Scale}
        actions={(
          <button type="button" onClick={exportBook} aria-disabled={download.busy || Boolean(rangeError)} className={btnSecondary}>
            {download.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            Exportar a Excel
          </button>
        )}
      />

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="res-from" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Desde</label>
            <input id="res-from" type="date" value={dateFrom} max={dateTo || undefined} aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? 'res-range-error' : undefined} onChange={(e) => change(setDateFrom)(e.target.value)} className={inputCls(!!rangeError)} />
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="res-to" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Hasta</label>
            <input id="res-to" type="date" value={dateTo} min={dateFrom || undefined} aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? 'res-range-error' : undefined} onChange={(e) => change(setDateTo)(e.target.value)} className={inputCls(!!rangeError)} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label htmlFor="res-search" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Buscar</label>
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
              <input id="res-search" type="search" value={search} onChange={(e) => change(setSearch)(e.target.value)} placeholder="Código, descripción, OC…" className={`${inputCls()} pl-10`} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="res-category" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Categoría</label>
            <select id="res-category" value={category} onChange={(e) => change(setCategory)(e.target.value)} className={inputCls()}>
              <option value="">Todas</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="res-floor" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Piso</label>
            <select id="res-floor" value={floor} onChange={(e) => change(setFloor)(e.target.value)} className={inputCls()}>
              <option value="">Todos</option>
              {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
        {rangeError && <p id="res-range-error" role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{rangeError}</p>}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="res-project" className="text-xs font-semibold text-gray-600 font-display">Proyecto</label>
              <select id="res-project" value={project} onChange={(e) => change(setProject)(e.target.value)} className={`${inputCls()} !w-auto`}>
                <option value="">Todos</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>)}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none">
            <input type="checkbox" checked={onlyMovement} onChange={(e) => change(setOnlyMovement)(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-gray-700">Solo con movimiento</span>
          </label>
          <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none">
            <input type="checkbox" checked={onlyZero} onChange={(e) => change(setOnlyZero)(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-gray-700">Solo sin stock</span>
          </label>
          <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none sm:ml-auto">
            <input type="checkbox" checked={includeMovements} onChange={(e) => setIncludeMovements(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-gray-700">Incluir hojas INGRESOS y EGRESOS al exportar</span>
          </label>
        </div>
      </Card>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {divergentRows > 0 && (
        <Banner tone="amber">
          En esta página, {divergentRows} {divergentRows === 1 ? 'ítem tiene' : 'ítems tienen'} un stock en Inventario distinto al calculado
          con sus movimientos (inicial + ingresos − egresos). Suele pasar con stock cargado sin documentar: el stock real es el de{' '}
          <Link to="/almacen/inventario" className="font-semibold underline">Inventario</Link>.
        </Banner>
      )}

      {periodFiltered && undated > 0 && (
        <Banner tone="amber">
          {undated} {undated === 1 ? 'movimiento sin fecha no se incluye' : 'movimientos sin fecha no se incluyen'} en este periodo.
          Quite el filtro de fechas para verlos o revíselos en{' '}
          <Link to="/almacen/movimientos" className="font-semibold underline">Movimientos</Link>.
        </Banner>
      )}

      <Card className={`overflow-hidden ${state.status === 'refreshing' ? 'opacity-60' : ''}`} aria-busy={state.status === 'refreshing'}>
        {loading ? (
          <LoadingBlock label="Calculando el resumen…" />
        ) : state.status === 'error' ? (
          <ErrorBlock message="No se pudo cargar el resumen de movimiento." onRetry={load} />
        ) : rangeError ? (
          <EmptyBlock icon={Scale} title="Corrija el rango de fechas para ver el resumen." />
        ) : state.rows.length === 0 ? (
          <EmptyBlock
            icon={Scale}
            title={periodFiltered || onlyMovement ? 'No hay movimientos en el periodo seleccionado.' : 'No hay ítems que coincidan con los filtros.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Resumen de movimiento por ítem</caption>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th scope="col" className={thCls}>Código</th>
                  <th scope="col" className={thCls}>Descripción</th>
                  <th scope="col" className={thCls}>UOM</th>
                  <th scope="col" className={`${thCls} text-right`}>Inv. inicial</th>
                  <th scope="col" className={`${thCls} text-right`}>Ingresos</th>
                  <th scope="col" className={`${thCls} text-right`}>Egresos</th>
                  <th scope="col" className={`${thCls} text-right`}>Stock actual</th>
                  <th scope="col" className={thCls}>Ubicación</th>
                  <th scope="col" className={thCls}>Observación</th>
                  <th scope="col" className={thCls}>Proyecto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.rows.map((row) => (
                  <tr
                    key={row.inventory_id}
                    onClick={() => navigate(`/almacen/inventario/${row.inventory_id}`)}
                    className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/10 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        to={`/almacen/inventario/${row.inventory_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        {row.product_code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-900 min-w-[14rem]">{row.description}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.unit}</td>
                    <td className={`${NUM} text-gray-700`}>{formatQty(row.initial_stock)}</td>
                    <td className={`${NUM} text-emerald-700 dark:text-emerald-400`}>{formatQty(row.entries)}</td>
                    <td className={`${NUM} text-rose-600 dark:text-rose-400`}>{formatQty(row.exits)}</td>
                    <td className={`${NUM} font-bold ${row.closing_stock <= 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900'}`}>{formatQty(row.closing_stock)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700 whitespace-nowrap">{row.location || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[14rem] break-words">{row.observation || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{row.project_name || row.project_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <th scope="row" colSpan={3} className="px-4 py-3 text-left text-xs uppercase tracking-wider">
                      Total <span className="font-normal normal-case text-gray-500">(todos los resultados)</span>
                    </th>
                    <td className={NUM}>{formatQty(totals.initial)}</td>
                    <td className={`${NUM} text-emerald-700 dark:text-emerald-400`}>{formatQty(totals.entries)}</td>
                    <td className={`${NUM} text-rose-600 dark:text-rose-400`}>{formatQty(totals.exits)}</td>
                    <td className={NUM}>{formatQty(totals.closing)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {state.status !== 'loading' && state.status !== 'error' && !rangeError && state.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={state.total} noun="ítems" onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
