import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Activity,
} from 'lucide-react';
import { getSummary, getAlerts } from '../../api/almacen';

import { fmtNum } from '../../utils/format';

// ── Helpers ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color, loading }) {
  const colorMap = {
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-100 dark:ring-emerald-500/30' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-500/10',     icon: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-100 dark:ring-amber-500/30'   },
    teal:    { bg: 'bg-teal-50 dark:bg-teal-500/10',       icon: 'text-teal-600 dark:text-teal-400',       ring: 'ring-teal-100 dark:ring-teal-500/30'    },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-500/10',       icon: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-100 dark:ring-rose-500/30'    },
  };
  const c = colorMap[color] ?? colorMap.emerald;

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-100 hover:border-gray-200 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${c.bg} ring-1 ${c.ring} flex items-center justify-center`}>
          <Icon size={20} className={c.icon} strokeWidth={1.8} />
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-20 bg-gray-100 animate-pulse rounded-lg" />
          <div className="h-4 w-28 bg-gray-50 animate-pulse rounded" />
        </div>
      ) : (
        <>
          <p className="text-3xl font-bold text-gray-900 tracking-tight font-display">{fmtNum(value ?? 0)}</p>
          <p className="text-[13px] text-gray-500 mt-1 font-display">{label}</p>
        </>
      )}
    </div>
  );
}

function QuickAction({ label, description, icon: Icon, color, onClick }) {
  const colorMap = {
    emerald: 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20',
    rose:    'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20',
    gray:    'bg-white hover:bg-gray-50 shadow-none border border-gray-200 !text-gray-700 !shadow-sm',
  };

  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-4 px-5 py-4 rounded-2xl text-white text-left transition-all duration-150 shadow-lg active:scale-[0.97] active:shadow-md ${colorMap[color]}`}
    >
      <div className={`w-10 h-10 rounded-xl ${color === 'gray' ? 'bg-gray-100' : 'bg-white/15'} flex items-center justify-center shrink-0`}>
        <Icon size={20} className={color === 'gray' ? 'text-gray-500' : 'text-white'} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold font-display ${color === 'gray' ? 'text-gray-800' : ''}`}>{label}</p>
        <p className={`text-xs mt-0.5 ${color === 'gray' ? 'text-gray-400' : 'text-white/60'}`}>{description}</p>
      </div>
      <ChevronRight size={16} className={`ml-auto shrink-0 opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all ${color === 'gray' ? 'text-gray-400' : ''}`} />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AlmacenDashboardPage() {
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts]   = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingAlerts, setLoadingAlerts]   = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [summaryRes, alertsRes] = await Promise.all([
          getSummary(),
          getAlerts(),
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data);
        const alertData = alertsRes.data?.results ?? alertsRes.data ?? [];
        setAlerts(Array.isArray(alertData) ? alertData : []);
      } catch {
        if (!cancelled) setError('No se pudieron cargar los datos del dashboard.');
      } finally {
        if (!cancelled) {
          setLoadingSummary(false);
          setLoadingAlerts(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">

      {/* ── Page header ─────────────────────────────────────── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          Resumen del inventario y movimientos del dia.
        </p>
      </div>

      {/* ── Error banner ────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Total de items"        value={summary?.total_items}    icon={Package}         color="emerald" loading={loadingSummary} />
        <KpiCard label="Alertas stock bajo"    value={summary?.low_stock_count} icon={AlertTriangle}   color="amber"   loading={loadingSummary} />
        <KpiCard label="Entradas hoy"          value={summary?.today_entries}  icon={ArrowDownToLine} color="teal"    loading={loadingSummary} />
        <KpiCard label="Salidas hoy"           value={summary?.today_exits}    icon={ArrowUpFromLine} color="rose"    loading={loadingSummary} />
      </div>

      {/* ── Quick actions ───────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1 font-display">
          Acciones rapidas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickAction
            label="Registrar Entrada"
            description="Ingreso de materiales"
            icon={ArrowDownToLine}
            color="emerald"
            onClick={() => navigate('/almacen/entrada')}
          />
          <QuickAction
            label="Registrar Salida"
            description="Despacho de materiales"
            icon={ArrowUpFromLine}
            color="rose"
            onClick={() => navigate('/almacen/salida')}
          />
          <QuickAction
            label="Ver Inventario"
            description="Consultar items y stock"
            icon={Package}
            color="gray"
            onClick={() => navigate('/almacen/inventario')}
          />
        </div>
      </div>

      {/* ── Low stock alerts ────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-100 dark:ring-amber-500/30 flex items-center justify-center">
              <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-gray-900 font-display">Alertas de stock bajo</h2>
              <p className="text-xs text-gray-400 hidden sm:block">Items que necesitan reposicion</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/almacen/inventario', { state: { lowStock: true } })}
            className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-semibold flex items-center gap-1 transition-all active:scale-95 font-display"
          >
            Ver todos
            <ChevronRight size={14} />
          </button>
        </div>

        {loadingAlerts ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600 dark:border-t-emerald-400" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
              <Package size={22} className="text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-gray-600">Sin alertas</p>
            <p className="text-xs text-gray-400 mt-1">Todos los items tienen stock suficiente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Codigo</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Descripcion</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Categoria</th>
                  <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Stock</th>
                  <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Min.</th>
                  <th className="px-5 sm:px-6 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {alerts.slice(0, 8).map((item) => {
                  const stock  = item.total_stock ?? 0;
                  const minSt  = item.min_stock ?? 0;
                  const isCrit = stock === 0;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-amber-50/40 dark:hover:bg-amber-500/10 cursor-pointer transition-colors group"
                      onClick={() => navigate(`/almacen/inventario/${item.id}`)}
                    >
                      <td className="px-5 sm:px-6 py-3.5 font-mono text-xs text-gray-500 font-medium">
                        {item.product_code}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-800 font-medium">
                        {item.description}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-400 hidden md:table-cell">
                        {item.category ?? '\u2014'}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right">
                        <span className={`text-sm font-bold ${isCrit ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {fmtNum(stock)}
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right text-gray-400 hidden sm:table-cell">
                        {fmtNum(minSt)}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide ${
                          isCrit
                            ? 'bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30'
                            : 'bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isCrit ? 'bg-red-500' : 'bg-amber-500'}`} />
                          {isCrit ? 'Sin stock' : 'Bajo'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
