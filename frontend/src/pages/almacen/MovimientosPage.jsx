import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Printer,
  Calendar,
  Filter,
  Download,
  ChevronDown,
} from 'lucide-react';
import { getMovements, exportMovementsUrl } from '../../api/almacen';
import { fmtNum, formatDate } from '../../utils/format';
import { MOVEMENT_CONFIG, WAREHOUSE_LABELS } from '../../data/almacenConstants';

// ── Constants ────────────────────────────────────────────────────────────────

const MOVEMENT_TYPES = [
  { value: '',           label: 'Todos' },
  { value: 'ENTRY',      label: 'Entrada' },
  { value: 'EXIT',       label: 'Salida' },
  { value: 'TRANSFER',   label: 'Traslado' },
  { value: 'ADJUSTMENT', label: 'Ajuste' },
];

const WAREHOUSES = [
  { value: '',        label: 'Todos' },
  { value: 'CENTRAL', label: 'Central' },
  { value: 'SITE',    label: 'Obra' },
  { value: 'OFFICE',  label: 'Oficina' },
];


function MovTypeBadge({ type }) {
  const cfg = MOVEMENT_CONFIG[type] ?? { label: type, bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-100' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${cfg.bg} ${cfg.text} ring-1 ${cfg.ring}`}>
      {Icon && <Icon size={12} />}
      {cfg.label}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MovimientosPage() {
  const navigate = useNavigate();

  const [movements, setMovements]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [page, setPage]             = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Basic filters
  const [movType,   setMovType]   = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [search,    setSearch]    = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [supplier,     setSupplier]     = useState('');
  const [qtyMin,       setQtyMin]       = useState('');
  const [qtyMax,       setQtyMax]       = useState('');

  // Reset page when any filter changes
  useEffect(() => {
    setPage(1);
  }, [movType, warehouse, search, dateFrom, dateTo, supplier, qtyMin, qtyMax]);

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, page_size: 25 };
      if (movType)   params.movement_type = movType;
      if (warehouse) params.warehouse     = warehouse;
      if (search)    params.search        = search;
      if (dateFrom)  params.date_from     = dateFrom;
      if (dateTo)    params.date_to       = dateTo;
      if (supplier)  params.supplier      = supplier;
      if (qtyMin)    params.qty_min       = qtyMin;
      if (qtyMax)    params.qty_max       = qtyMax;
      const res = await getMovements(params);
      const data  = res.data?.results ?? res.data ?? [];
      const count = res.data?.count   ?? (Array.isArray(data) ? data.length : 0);
      setMovements(Array.isArray(data) ? data : []);
      setTotalCount(count);
    } catch {
      setError('No se pudieron cargar los movimientos.');
    } finally {
      setLoading(false);
    }
  }, [movType, warehouse, search, dateFrom, dateTo, supplier, qtyMin, qtyMax, page]);

  useEffect(() => {
    const timer = setTimeout(() => fetchMovements(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchMovements, search]);

  const hasFilters = movType || warehouse || search || dateFrom || dateTo || supplier || qtyMin || qtyMax;

  // Build current filters object for export URL
  const currentFilters = {};
  if (movType)   currentFilters.movement_type = movType;
  if (warehouse) currentFilters.warehouse     = warehouse;
  if (search)    currentFilters.search        = search;
  if (dateFrom)  currentFilters.date_from     = dateFrom;
  if (dateTo)    currentFilters.date_to       = dateTo;
  if (supplier)  currentFilters.supplier      = supplier;
  if (qtyMin)    currentFilters.qty_min       = qtyMin;
  if (qtyMax)    currentFilters.qty_max       = qtyMax;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">Movimientos</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Historial de entradas, salidas, traslados y ajustes.
          </p>
        </div>
        <a
          href={exportMovementsUrl(currentFilters)}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 w-full sm:w-auto justify-center"
          download
        >
          <Download size={16} /> Exportar
        </a>
      </div>

      {/* ── Filters ───────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-col gap-3">
          {/* Row 1: Search + type pills */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por codigo, item o N. movimiento..."
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50/50 focus:bg-white transition-colors"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {MOVEMENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setMovType(movType === t.value ? '' : t.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150 active:scale-[0.93] whitespace-nowrap font-display ${
                    movType === t.value
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Warehouse + dates */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex gap-1.5">
              {WAREHOUSES.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setWarehouse(warehouse === w.value ? '' : w.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150 active:scale-[0.93] whitespace-nowrap font-display ${
                    warehouse === w.value
                      ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-1 sm:justify-end">
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors" title="Desde" />
              </div>
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors" title="Hasta" />
              </div>
            </div>
          </div>

          {/* Row 3: Advanced filters toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Filter size={12} />
              Filtros avanzados
              <ChevronDown size={12} className={`transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">Proveedor</label>
                  <input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Nombre del proveedor"
                    className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">Cant. minima</label>
                  <input
                    type="number"
                    min="0"
                    value={qtyMin}
                    onChange={(e) => setQtyMin(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">Cant. maxima</label>
                  <input
                    type="number"
                    min="0"
                    value={qtyMax}
                    onChange={(e) => setQtyMax(e.target.value)}
                    placeholder="999999"
                    className="w-full px-3.5 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600" />
          </div>
        ) : movements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
              <ArrowLeftRight size={28} strokeWidth={1.2} className="text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">
              {hasFilters ? 'Sin resultados para los filtros aplicados' : 'No hay movimientos registrados'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Fecha</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">N. Mov.</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Codigo</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                  <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cant.</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Und.</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Almacen</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Registrado por</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-5 sm:px-6 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(mov.created_at ?? mov.date)}</td>
                    <td className="px-5 sm:px-6 py-3.5 font-mono text-xs text-gray-500 whitespace-nowrap">{mov.movement_number ?? mov.id}</td>
                    <td className="px-5 sm:px-6 py-3.5"><MovTypeBadge type={mov.movement_type} /></td>
                    <td className="px-5 sm:px-6 py-3.5 font-mono text-xs text-gray-400 hidden md:table-cell whitespace-nowrap">{mov.inventory_code ?? '\u2014'}</td>
                    <td className="px-5 sm:px-6 py-3.5 text-gray-800 font-medium max-w-[200px] truncate">{mov.inventory_description ?? '\u2014'}</td>
                    <td className="px-5 sm:px-6 py-3.5 text-right font-bold text-gray-800 whitespace-nowrap tabular-nums">{fmtNum(mov.quantity)}</td>
                    <td className="px-5 sm:px-6 py-3.5 text-gray-400 hidden sm:table-cell whitespace-nowrap">{mov.inventory_unit ?? '\u2014'}</td>
                    <td className="px-5 sm:px-6 py-3.5 text-gray-500 hidden lg:table-cell whitespace-nowrap">{WAREHOUSE_LABELS[mov.warehouse] ?? mov.warehouse ?? '\u2014'}</td>
                    <td className="px-5 sm:px-6 py-3.5 text-gray-400 text-xs hidden xl:table-cell whitespace-nowrap">{mov.registered_by_name ?? mov.registered_by ?? '\u2014'}</td>
                    <td className="px-3 py-3.5 text-right">
                      {mov.movement_type === 'EXIT' && (
                        <button
                          onClick={() => navigate(`/almacen/salida/${mov.id}/voucher`)}
                          title="Ver vale"
                          className="p-1.5 rounded-lg text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Printer size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">{totalCount} movimientos</p>
            <div className="flex gap-2 items-center">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all duration-150"
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-500">Pag. {page}</span>
              <button
                disabled={movements.length < 25}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all duration-150"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
