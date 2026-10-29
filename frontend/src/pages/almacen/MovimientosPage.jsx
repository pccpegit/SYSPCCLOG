import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Check, ChevronDown, Download, FileSpreadsheet, Filter, Loader2, Printer, Search } from 'lucide-react';
import { exportMovements, getMovements } from '../../api/almacen';
import useFileDownload from '../../hooks/useFileDownload';
import useFilterAnnouncer from '../../hooks/useFilterAnnouncer';
import { MOVEMENT_CONFIG, WAREHOUSE_LABELS } from '../../data/almacenConstants';
import { formatISODate, formatQty } from '../../utils/almacen';
import { Card, Chip, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, Pagination } from '../../components/almacen/ui';
import { btnSecondary, inputCls, thCls } from '../../components/almacen/uiStyles';

const PAGE_SIZE = 25;
const ORDER_ERROR = 'La fecha inicial no puede ser posterior a la final.';

const MOVEMENT_TYPES = [
  { value: '', label: 'Todos' },
  { value: 'ENTRY', label: 'Ingresos' },
  { value: 'EXIT', label: 'Egresos' },
  { value: 'TRANSFER', label: 'Traslados' },
  { value: 'ADJUSTMENT', label: 'Ajustes' },
];

const WAREHOUSE_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'CENTRAL', label: 'Central' },
  { value: 'SITE', label: 'Obra' },
  { value: 'OFFICE', label: 'Oficina' },
];

// El filtro activo se distingue por icono ✓, anillo y negrita, no solo por el color.
const pillCls = (active, tone = 'emerald') => `inline-flex items-center gap-1.5 min-h-9 px-3 py-2 rounded-xl text-xs border transition-all duration-150 whitespace-nowrap font-display ${
  active
    ? (tone === 'blue'
      ? 'font-bold ring-2 ring-blue-400 bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/50 dark:ring-blue-500/50 dark:text-blue-300'
      : 'font-bold ring-2 ring-emerald-400 bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/50 dark:ring-emerald-500/50 dark:text-emerald-300')
    : 'font-semibold bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
}`;

function MovTypeBadge({ type }) {
  const cfg = MOVEMENT_CONFIG[type] ?? { label: type, bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-100' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${cfg.bg} ${cfg.text} ring-1 ${cfg.ring}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {cfg.label}
    </span>
  );
}

export default function MovimientosPage() {
  const download = useFileDownload();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', rows: [], total: 0 });
  const [page, setPage] = useState(1);

  const [movType, setMovType] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Enlaces del Dashboard: /almacen/movimientos?sin_vale=1 y ?sin_fecha=1
  const [noVoucher, setNoVoucher] = useState(searchParams.get('sin_vale') === '1');
  const [undated, setUndated] = useState(searchParams.get('sin_fecha') === '1');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [voucher, setVoucher] = useState('');
  const [destination, setDestination] = useState('');
  const [supplier, setSupplier] = useState('');
  const [qtyMin, setQtyMin] = useState('');
  const [qtyMax, setQtyMax] = useState('');
  const seq = useRef(0);

  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? ORDER_ERROR : '';

  const filterParams = useCallback(() => {
    const params = {};
    if (movType) params.movement_type = movType;
    if (warehouse) params.warehouse = warehouse;
    if (search) params.search = search;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (noVoucher) params.no_voucher = 'true';
    if (undated) params.has_date = 'false';
    if (voucher.trim()) params.voucher_number = voucher.trim();
    if (destination.trim()) params.destination = destination.trim();
    if (supplier) params.supplier = supplier;
    if (qtyMin) params.qty_min = qtyMin;
    if (qtyMax) params.qty_max = qtyMax;
    return params;
  }, [movType, warehouse, search, dateFrom, dateTo, noVoucher, undated, voucher, destination, supplier, qtyMin, qtyMax]);

  const filterKey = JSON.stringify(filterParams());
  const hasFilters = filterKey !== '{}';

  // Cualquier filtro vuelve a la página 1.
  const change = (setter) => (value) => { setter(value); setPage(1); };

  const load = useCallback(async () => {
    if (rangeError) return;
    const mine = ++seq.current;
    setState((prev) => ({ ...prev, status: prev.rows.length ? 'refreshing' : 'loading' }));
    try {
      const res = await getMovements({ page, page_size: PAGE_SIZE, ...filterParams() });
      if (mine !== seq.current) return;
      const data = res.data?.results ?? res.data ?? [];
      const rows = Array.isArray(data) ? data : [];
      setState({ status: 'ready', rows, total: res.data?.count ?? rows.length });
    } catch {
      if (mine === seq.current) setState({ status: 'error', rows: [], total: 0 });
    }
  }, [page, filterParams, rangeError]);

  useEffect(() => {
    const timer = setTimeout(load, search || voucher || destination ? 400 : 0);
    return () => clearTimeout(timer);
  }, [load, search, voucher, destination]);

  const announcement = useFilterAnnouncer(
    filterKey,
    state.status === 'ready' ? `Mostrando ${state.total} ${state.total === 1 ? 'movimiento' : 'movimientos'}.` : '',
  );

  const exportAs = (extra, fallback) => download.run(
    () => exportMovements({ ...filterParams(), ...extra }),
    fallback,
    'No se pudo exportar los movimientos. Intente nuevamente.',
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <PageHeader
        title="Movimientos"
        subtitle="Historial de ingresos, egresos, traslados y ajustes."
        icon={ArrowLeftRight}
        actions={(
          <>
            <button type="button" onClick={() => exportAs({}, 'movimientos.xlsx')} aria-disabled={download.busy} className={btnSecondary}>
              {download.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              Exportar
            </button>
            <button type="button" onClick={() => exportAs({ layout: 'excel_pcc' }, 'movimientos_excel_pcc.xlsx')} aria-disabled={download.busy} className={btnSecondary}>
              <FileSpreadsheet size={16} aria-hidden="true" /> Formato de su libro
            </button>
          </>
        )}
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <label htmlFor="mov-search" className="sr-only">Buscar movimientos</label>
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
              <input
                id="mov-search"
                type="search"
                value={search}
                onChange={(e) => change(setSearch)(e.target.value)}
                placeholder="Buscar por código, ítem o N° de movimiento…"
                className={`${inputCls()} pl-10`}
              />
            </div>
            <div role="group" aria-label="Tipo de movimiento" className="flex gap-1.5 flex-wrap">
              {MOVEMENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={movType === t.value}
                  onClick={() => change(setMovType)(movType === t.value ? '' : t.value)}
                  className={pillCls(movType === t.value)}
                >
                  {movType === t.value && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
            <div role="group" aria-label="Almacén" className="flex gap-1.5 flex-wrap">
              {WAREHOUSE_FILTERS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  aria-pressed={warehouse === w.value}
                  onClick={() => change(setWarehouse)(warehouse === w.value ? '' : w.value)}
                  className={pillCls(warehouse === w.value, 'blue')}
                >
                  {warehouse === w.value && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                  {w.label}
                </button>
              ))}
            </div>
            <div className="flex gap-3 lg:ml-auto flex-wrap items-end">
              <div>
                <label htmlFor="mov-from" className="block text-xs font-semibold text-gray-600 mb-1">Desde</label>
                <input id="mov-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => change(setDateFrom)(e.target.value)} className={inputCls(!!rangeError)} />
              </div>
              <div>
                <label htmlFor="mov-to" className="block text-xs font-semibold text-gray-600 mb-1">Hasta</label>
                <input id="mov-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => change(setDateTo)(e.target.value)} className={inputCls(!!rangeError)} />
              </div>
              <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none">
                <input type="checkbox" checked={noVoucher} onChange={(e) => change(setNoVoucher)(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="text-sm text-gray-700">Sin N° de vale</span>
              </label>
              <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none">
                <input type="checkbox" checked={undated} onChange={(e) => change(setUndated)(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="text-sm text-gray-700">Sin fecha</span>
              </label>
            </div>
          </div>
          {rangeError && <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{rangeError}</p>}

          <div>
            <button
              type="button"
              aria-expanded={showAdvanced}
              aria-controls="mov-advanced"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <Filter size={12} aria-hidden="true" /> Filtros avanzados
              <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {showAdvanced && (
              <div id="mov-advanced" className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label htmlFor="mov-voucher" className="block text-xs font-semibold text-gray-600 mb-1">N° de vale</label>
                  <input id="mov-voucher" value={voucher} onChange={(e) => change(setVoucher)(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label htmlFor="mov-destination" className="block text-xs font-semibold text-gray-600 mb-1">Trabajador / destino</label>
                  <input id="mov-destination" value={destination} onChange={(e) => change(setDestination)(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label htmlFor="mov-supplier" className="block text-xs font-semibold text-gray-600 mb-1">Proveedor</label>
                  <input id="mov-supplier" value={supplier} onChange={(e) => change(setSupplier)(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label htmlFor="mov-qmin" className="block text-xs font-semibold text-gray-600 mb-1">Cantidad mínima</label>
                  <input id="mov-qmin" type="number" min="0" value={qtyMin} onChange={(e) => change(setQtyMin)(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label htmlFor="mov-qmax" className="block text-xs font-semibold text-gray-600 mb-1">Cantidad máxima</label>
                  <input id="mov-qmax" type="number" min="0" value={qtyMax} onChange={(e) => change(setQtyMax)(e.target.value)} className={inputCls()} />
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <Card className={`overflow-hidden ${state.status === 'refreshing' ? 'opacity-60' : ''}`} aria-busy={state.status === 'refreshing'}>
        {state.status === 'loading' ? (
          <LoadingBlock label="Cargando movimientos…" />
        ) : state.status === 'error' ? (
          <ErrorBlock message="No se pudieron cargar los movimientos." onRetry={load} />
        ) : rangeError ? (
          <EmptyBlock icon={ArrowLeftRight} title="Corrija el rango de fechas para ver los movimientos." />
        ) : state.rows.length === 0 ? (
          <EmptyBlock
            icon={ArrowLeftRight}
            title={hasFilters ? 'Sin resultados para los filtros aplicados.' : 'No hay movimientos registrados.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Movimientos del almacén</caption>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th scope="col" className={thCls}>Fecha</th>
                  <th scope="col" className={thCls}>N° mov.</th>
                  <th scope="col" className={thCls}>Tipo</th>
                  <th scope="col" className={`${thCls} hidden md:table-cell`}>Código</th>
                  <th scope="col" className={thCls}>Ítem</th>
                  <th scope="col" className={`${thCls} text-right`}>Cant.</th>
                  <th scope="col" className={`${thCls} hidden sm:table-cell`}>Und.</th>
                  <th scope="col" className={thCls}>N° de vale</th>
                  <th scope="col" className={`${thCls} hidden lg:table-cell`}>Origen / Destino</th>
                  <th scope="col" className={`${thCls} hidden xl:table-cell`}>Almacén</th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">Vale</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.rows.map((mov) => {
                  const counterparty = mov.movement_type === 'EXIT'
                    ? (mov.destination_personal_name || mov.destination_detail)
                    : (mov.supplier_name || mov.internal_transfer);
                  return (
                    <tr key={mov.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {mov.movement_date
                          ? <span className="text-xs text-gray-700">{formatISODate(mov.movement_date)}</span>
                          : <Chip tone="amber">Fecha no registrada</Chip>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{mov.movement_number ?? mov.id}</td>
                      <td className="px-4 py-3"><MovTypeBadge type={mov.movement_type} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 hidden md:table-cell whitespace-nowrap">{mov.inventory_code ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium leading-snug min-w-[14rem]">
                        {/* Sin truncar: la talla («T: L») va al final y distingue ítems casi idénticos. */}
                        {mov.inventory_description ?? '—'}
                        {/* Lo que se oculta en pantallas angostas pasa a segunda línea. */}
                        {mov.inventory_code && (
                          <span className="block md:hidden font-mono text-xs font-normal text-gray-500">{mov.inventory_code}</span>
                        )}
                        {counterparty && (
                          <span className="block lg:hidden text-xs font-normal text-gray-600">
                            {mov.movement_type === 'EXIT' ? 'Destino' : 'Origen'}: {counterparty}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap tabular-nums">{formatQty(mov.quantity)}</td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell whitespace-nowrap">{mov.inventory_unit ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {mov.voucher_number
                          ? <span className="font-mono text-xs text-gray-700">{mov.voucher_number}</span>
                          : mov.movement_type === 'EXIT' ? <Chip tone="amber">Sin vale</Chip> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-600 min-w-[10rem]">{counterparty || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 hidden xl:table-cell whitespace-nowrap">{WAREHOUSE_LABELS[mov.warehouse] ?? mov.warehouse ?? '—'}</td>
                      <td className="px-3 py-3 text-right">
                        {mov.movement_type === 'EXIT' && (
                          <Link
                            to={`/almacen/salida/${mov.id}/voucher`}
                            aria-label={`Ver vale del movimiento ${mov.movement_number ?? mov.id}`}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                          >
                            <Printer size={15} aria-hidden="true" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {state.status !== 'loading' && state.status !== 'error' && !rangeError && state.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={state.total} noun="movimientos" onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
