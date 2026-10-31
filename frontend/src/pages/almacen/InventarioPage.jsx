import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Package, Download, FileUp, MapPin, ChevronRight, Loader2,
} from 'lucide-react';
import {
  getInventory, getCategories, getSummary, getMovementSummary, exportInventory,
} from '../../api/almacen';
import { useAuth } from '../../context/useAuth';
import useFileDownload from '../../hooks/useFileDownload';
import useFilterAnnouncer from '../../hooks/useFilterAnnouncer';
import { ASSIGN_LOCATION_ROLES, IMPORT_ROLES } from '../../data/almacenRoles';
import { FLOOR_OPTIONS, ITEM_TYPE_COLORS, ITEM_TYPE_LABELS } from '../../data/almacenConstants';
import { formatQty, hasAnyRole } from '../../utils/almacen';
import { ucFirst } from '../../utils/format';
import AssignLocationModal from '../../components/almacen/AssignLocationModal';
import ItemFormModal from '../../components/almacen/ItemFormModal';
import { LocationChip, StockStatusChip } from '../../components/almacen/chips';
import {
  Banner, Card, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, Pagination,
} from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls, thCls } from '../../components/almacen/uiStyles';

const PAGE_SIZE = 25;

const isPending = (item) => item.location_status !== 'EXACT';

const STOCK_STATES = [
  { value: '', label: 'Todos' },
  { value: 'has', label: 'Con stock' },
  { value: 'none', label: 'Sin stock' },
  { value: 'low', label: 'Bajo mínimo' },
];

/** Parámetros del backend para los filtros activos (sin paginación). */
function buildFilterParams({ search, category, stockState, floor, pendingOnly }) {
  const params = {};
  if (search) params.search = search;
  if (category) params.category = category;
  if (floor) params.floor = floor;
  if (pendingOnly) params.location_status = 'pending';
  if (stockState === 'has') params.has_stock = 'true';
  if (stockState === 'none') params.has_stock = 'false';
  if (stockState === 'low') {
    // "Bajo mínimo" = con stock pero en o bajo el mínimo (los agotados son "Sin stock").
    params.low_stock = 'true';
    params.has_stock = 'true';
  }
  return params;
}

export default function InventarioPage() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [searchParams] = useSearchParams();
  const { userRoles } = useAuth();
  const canAssign = hasAnyRole(userRoles, ASSIGN_LOCATION_ROLES);
  const canImport = hasAnyRole(userRoles, IMPORT_ROLES);
  const download = useFileDownload();

  const [list, setList] = useState({ status: 'loading', items: [], total: 0 });
  const [categories, setCategories] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockState, setStockState] = useState(
    routerLocation.state?.lowStock ? 'low' : (searchParams.get('estado') ?? ''),
  );
  const [floor, setFloor] = useState(searchParams.get('piso') ?? '');
  const [pendingOnly, setPendingOnly] = useState(searchParams.get('pendientes') === '1');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState(() => new Set());
  const [assignItems, setAssignItems] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const requestSeq = useRef(0);
  // «Empezar a ubicar» (y el enlace del Dashboard con ?ubicar=1): al llegar el listado de pendientes
  // se abre la asignación del primero.
  const autoStart = useRef(searchParams.get('ubicar') === '1');

  const filters = { search, category, stockState, floor, pendingOnly };
  const filterKey = JSON.stringify(filters);

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
    setSelected(new Set());
  };

  // ── Datos auxiliares (categorías y cifras de cabecera) ────────────────────
  useEffect(() => {
    let alive = true;
    getCategories()
      .then((res) => {
        const cats = res.data?.results ?? res.data ?? [];
        if (alive) setCategories(Array.isArray(cats) ? cats : []);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([getSummary(), getMovementSummary({ page_size: 1 })]).then(([summary, units]) => {
      if (!alive) return;
      setKpis({
        totalItems: summary.status === 'fulfilled' ? summary.value.data?.total_items : null,
        zeroStock: summary.status === 'fulfilled' ? summary.value.data?.zero_stock_count : null,
        pending: summary.status === 'fulfilled' ? summary.value.data?.pending_location_count : null,
        units: units.status === 'fulfilled' ? units.value.data?.meta?.totals?.closing : null,
      });
    });
    return () => { alive = false; };
  }, [reloadKey]);

  // ── Listado ───────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async () => {
    const seq = ++requestSeq.current;
    setList((prev) => ({ ...prev, status: prev.items.length ? 'refreshing' : 'loading' }));
    try {
      const res = await getInventory({
        page, page_size: PAGE_SIZE,
        ...buildFilterParams({ search, category, stockState, floor, pendingOnly }),
      });
      if (seq !== requestSeq.current) return;
      const data = res.data?.results ?? res.data ?? [];
      const items = Array.isArray(data) ? data : [];
      setList({ status: 'ready', items, total: res.data?.count ?? items.length });
      if (autoStart.current && canAssign) {
        autoStart.current = false;
        const first = items.find(isPending);
        if (first) setAssignItems([first]);
      }
    } catch {
      if (seq === requestSeq.current) setList({ status: 'error', items: [], total: 0 });
    }
  }, [page, search, category, stockState, floor, pendingOnly, canAssign]);

  useEffect(() => {
    const timer = setTimeout(fetchItems, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchItems, search, reloadKey]);

  const announcement = useFilterAnnouncer(
    filterKey,
    list.status === 'ready' ? `Mostrando ${list.total} ${list.total === 1 ? 'ítem' : 'ítems'}.` : '',
  );

  // ── Selección ─────────────────────────────────────────────────────────────
  const pageIds = list.items.map((i) => i.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageIds));
  const selectedItems = list.items.filter((i) => selected.has(i.id));

  const refresh = () => {
    setSelected(new Set());
    setReloadKey((k) => k + 1);
  };

  const startLocating = () => {
    if (pendingOnly) {
      const first = list.items.find(isPending);
      if (first) setAssignItems([first]);
      return;
    }
    autoStart.current = true;
    setPendingOnly(true);
    setPage(1);
    setSelected(new Set());
  };

  const hasFilters = Boolean(search || category || stockState || floor || pendingOnly);
  const loading = list.status === 'loading';

  const kpiLine = kpis
    ? [
        kpis.totalItems != null && `${formatQty(kpis.totalItems)} ${kpis.totalItems === 1 ? 'ítem' : 'ítems'}`,
        kpis.units != null && `${formatQty(kpis.units)} unidades`,
        kpis.zeroStock != null && `${formatQty(kpis.zeroStock)} sin stock`,
        kpis.pending != null && `${formatQty(kpis.pending)} pendientes de ubicar`,
      ].filter(Boolean).join(' · ')
    : 'Cargando…';

  return (
    <>
      <div className="space-y-5 max-w-7xl mx-auto">
        <PageHeader
          title="Inventario"
          subtitle={kpiLine}
          actions={(
            <>
              <button
                type="button"
                onClick={() => download.run(
                  () => exportInventory(buildFilterParams(filters)),
                  'inventario.xlsx',
                  'No se pudo exportar el inventario. Intente nuevamente.',
                )}
                aria-disabled={download.busy}
                className={btnSecondary}
              >
                {download.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                Exportar
              </button>
              {canImport && (
                <Link to="/almacen/importar" className={btnSecondary}>
                  <FileUp size={16} aria-hidden="true" /> Importar Excel
                </Link>
              )}
              <button type="button" onClick={() => setShowForm(true)} className={`${btnPrimary} flex-1 sm:flex-none`}>
                <Plus size={16} strokeWidth={2.5} aria-hidden="true" /> Nuevo ítem
              </button>
            </>
          )}
        />

        {canAssign && kpis?.pending > 0 && (
          <Banner tone="amber">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <p>
                Sin ubicación exacta: {formatQty(kpis.pending)}. Asigne pabellón, sección y nivel a cada ítem
                para encontrarlos al preparar pedidos.
              </p>
              <button type="button" onClick={startLocating} className={`${btnPrimary} shrink-0`}>
                <MapPin size={15} aria-hidden="true" /> Empezar a ubicar
              </button>
            </div>
          </Banner>
        )}

        {/* ── Filtros ── */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label htmlFor="inv-search" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Buscar</label>
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
                <input
                  id="inv-search"
                  type="search"
                  value={search}
                  onChange={(e) => changeFilter(setSearch)(e.target.value)}
                  placeholder="Buscar por código, descripción, OC o packing list…"
                  className={`${inputCls()} pl-10`}
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="inv-category" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Categoría</label>
              <select id="inv-category" value={category} onChange={(e) => changeFilter(setCategory)(e.target.value)} className={inputCls()}>
                <option value="">Todas</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="inv-stock" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Estado de stock</label>
              <select id="inv-stock" value={stockState} onChange={(e) => changeFilter(setStockState)(e.target.value)} className={inputCls()}>
                {STOCK_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="inv-floor" className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Piso</label>
              <select id="inv-floor" value={floor} onChange={(e) => changeFilter(setFloor)(e.target.value)} className={inputCls()}>
                <option value="">Todos</option>
                {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <label className="md:col-span-2 flex items-center gap-2 min-h-11 px-3.5 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(e) => changeFilter(setPendingOnly)(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Solo pendientes de ubicar</span>
            </label>
          </div>
        </Card>

        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

        {/* ── Barra de acción masiva ── */}
        {canAssign && selected.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/30 px-4 py-3">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
              {selected.size} {selected.size === 1 ? 'ítem seleccionado' : 'ítems seleccionados'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(new Set())} className={btnSecondary}>Quitar selección</button>
              <button type="button" onClick={() => setAssignItems(selectedItems)} className={btnPrimary}>
                <MapPin size={15} aria-hidden="true" /> Asignar ubicación a {selected.size} {selected.size === 1 ? 'ítem' : 'ítems'}
              </button>
            </div>
          </div>
        )}

        {/* ── Tabla ── */}
        <Card className="overflow-hidden relative">
          {loading ? (
            <LoadingBlock label="Cargando inventario…" />
          ) : list.status === 'error' ? (
            <ErrorBlock message="No se pudo cargar el inventario." onRetry={fetchItems} />
          ) : list.items.length === 0 ? (
            <EmptyBlock
              icon={Package}
              title="No hay ítems que coincidan con los filtros."
              hint={hasFilters ? 'Pruebe con otros filtros.' : 'Cree un ítem o importe el libro de Excel.'}
            />
          ) : (
            <div className={`overflow-x-auto transition-opacity ${list.status === 'refreshing' ? 'opacity-50' : ''}`} aria-busy={list.status === 'refreshing'}>
              <table className="w-full text-sm">
                <caption className="sr-only">Ítems del inventario con su stock y ubicación</caption>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left">
                    {canAssign && (
                      <th scope="col" className="pl-4 pr-1 py-3 w-10">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos los ítems de esta página"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </th>
                    )}
                    <th scope="col" className={thCls}>Código</th>
                    <th scope="col" className={thCls}>Descripción</th>
                    <th scope="col" className={`${thCls} hidden md:table-cell`}>Unidad</th>
                    <th scope="col" className={`${thCls} hidden lg:table-cell`}>Categoría</th>
                    <th scope="col" className={`${thCls} text-right`}>Stock</th>
                    <th scope="col" className={thCls}>Ubicación</th>
                    <th scope="col" className={thCls}>Estado</th>
                    <th scope="col" className="px-3 py-3"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.items.map((item) => {
                    const stock = Number(item.total_stock ?? 0);
                    const typeColor = ITEM_TYPE_COLORS[item.item_type] ?? ITEM_TYPE_COLORS.MATERIAL;
                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                        onClick={() => navigate(`/almacen/inventario/${item.id}`)}
                      >
                        {canAssign && (
                          <td className="pl-4 pr-1 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${item.product_code}`}
                              checked={selected.has(item.id)}
                              onChange={() => toggleOne(item.id)}
                              className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link
                            to={`/almacen/inventario/${item.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            {item.product_code}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-900 font-medium leading-snug min-w-[14rem]">
                          {item.description}
                          {item.size && <span className="ml-2 text-xs font-normal text-gray-500">Talla {item.size}</span>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-600">{ucFirst(item.unit)}</td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold ring-1 ${typeColor}`}>
                            {item.category || ITEM_TYPE_LABELS[item.item_type] || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-base font-bold text-gray-900 tabular-nums">{formatQty(stock)}</td>
                        <td className="px-4 py-3"><LocationChip item={item} /></td>
                        <td className="px-4 py-3"><StockStatusChip total={stock} minStock={item.min_stock} /></td>
                        <td className="px-3 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {canAssign && (
                            <button
                              type="button"
                              onClick={() => setAssignItems([item])}
                              aria-label={`Asignar ubicación a ${item.product_code}`}
                              title="Asignar ubicación"
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                            >
                              <MapPin size={16} aria-hidden="true" />
                            </button>
                          )}
                          <ChevronRight size={15} className="text-gray-300 group-hover:text-emerald-500 inline-block align-middle" aria-hidden="true" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {list.status !== 'loading' && list.status !== 'error' && list.total > 0 && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} noun="ítems" onPage={(p) => { setPage(p); setSelected(new Set()); }} />
          )}
        </Card>
      </div>

      {assignItems && (
        <AssignLocationModal
          open
          items={assignItems}
          queue={assignItems.length === 1 ? list.items.filter(isPending) : []}
          onClose={() => setAssignItems(null)}
          onAssigned={() => setReloadKey((k) => k + 1)}
          onDone={() => { setAssignItems(null); refresh(); }}
        />
      )}
      {showForm && (
        <ItemFormModal
          categories={categories}
          canAssignLocation={canAssign}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}
    </>
  );
}
