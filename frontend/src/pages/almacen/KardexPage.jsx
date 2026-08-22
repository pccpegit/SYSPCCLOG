import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  MapPin,
  Tag,
  Layers,
  Warehouse,
  Hash,
  User,
} from 'lucide-react';
import { getInventoryItem, getKardex } from '../../api/almacen';
import { fmtNum, ucFirst, formatDate, formatTime } from '../../utils/format';
import {
  ITEM_TYPE_LABELS, MOVEMENT_CONFIG, WAREHOUSE_LABELS_FULL as WAREHOUSE_LABELS,
} from '../../data/almacenConstants';

const HERO_TYPE_COLORS = {
  MATERIAL:   { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-400/30' },
  TOOL:       { bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-400/30' },
  EQUIPMENT:  { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-400/30' },
  CONSUMABLE: { bg: 'bg-teal-500/20', text: 'text-teal-300', border: 'border-teal-400/30' },
};

export default function KardexPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [item, setItem]           = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [itemRes, kardexRes] = await Promise.all([getInventoryItem(id), getKardex(id)]);
        if (cancelled) return;
        setItem(itemRes.data);
        const movData = kardexRes.data?.movements ?? kardexRes.data?.results ?? [];
        setMovements(Array.isArray(movData) ? movData : []);
      } catch {
        if (!cancelled) setError('No se pudo cargar la informacion del item.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600 dark:border-t-emerald-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 active:scale-95 transition-all">
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
      </div>
    );
  }

  const stocks = item?.stocks ?? [];
  const totalStock = stocks.reduce((acc, s) => acc + Number(s.quantity ?? 0), 0);
  const minStock = Number(item?.min_stock ?? 0);
  const stockRatio = minStock > 0 ? totalStock / minStock : totalStock > 0 ? 2 : 0;
  const stockPct = Math.min(stockRatio * 100, 100);
  const stockColor = stockRatio <= 0 ? 'red' : stockRatio <= 1 ? 'amber' : 'emerald';

  const strokeColors = { red: '#ef4444', amber: '#f59e0b', emerald: '#10b981' };
  const statusConfig = {
    red:     { label: 'Sin stock', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-600 dark:text-red-400', ring: 'ring-red-100 dark:ring-red-500/30', dot: 'bg-red-500 animate-pulse' },
    amber:   { label: 'Stock bajo', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-100 dark:ring-amber-500/30', dot: 'bg-amber-500' },
    emerald: { label: 'Disponible', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-100 dark:ring-emerald-500/30', dot: 'bg-emerald-500' },
  };
  const sc = statusConfig[stockColor];
  const tc = HERO_TYPE_COLORS[item?.item_type] ?? HERO_TYPE_COLORS.MATERIAL;

  const details = [
    { icon: Layers, label: 'Unidad', value: ucFirst(item?.unit) },
    { icon: Tag, label: 'Categoria', value: item?.category },
    { icon: Tag, label: 'Marca', value: item?.brand },
    { icon: Tag, label: 'Modelo', value: item?.model_name ?? item?.model },
    { icon: MapPin, label: 'Ubicacion', value: item?.location },
  ].filter(d => d.value);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* ── Hero header ── */}
      <div className="relative bg-gradient-to-br from-[#0f1729] via-[#131d35] to-[#0c1220] rounded-2xl overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/[0.06] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-56 h-56 bg-teal-500/[0.04] rounded-full blur-2xl translate-y-1/2 -translate-x-1/4" />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-indigo-500/[0.03] rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />

        <div className="relative z-10 px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex items-start justify-between gap-4 mb-5">
            <button
              onClick={() => navigate('/almacen/inventario')}
              className="p-2 -ml-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 active:scale-90 transition-all duration-150"
            >
              <ArrowLeft size={20} />
            </button>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${tc.bg} ${tc.text} ${tc.border}`}>
              {ITEM_TYPE_LABELS[item?.item_type] ?? item?.item_type}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-emerald-400/80 font-semibold tracking-wider">{item?.product_code}</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1.5 leading-snug font-display tracking-tight">{item?.description ?? 'Item'}</h1>
              {item?.brand && (
                <p className="text-[11px] text-white/30 mt-2 font-medium">{item.brand}{item.model_name ? ` · ${item.model_name}` : ''}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => navigate('/almacen/entrada')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-400/20 hover:bg-emerald-500/30 active:scale-[0.97] transition-all"
                >
                  <ArrowDownToLine size={13} /> Entrada
                </button>
                <button
                  onClick={() => navigate('/almacen/salida')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-400/20 hover:bg-rose-500/30 active:scale-[0.97] transition-all"
                >
                  <ArrowUpFromLine size={13} /> Salida
                </button>
              </div>
            </div>

            {/* Stock ring */}
            <div className="flex items-center gap-4 bg-white/[0.06] backdrop-blur-sm rounded-xl px-5 py-4 border border-white/[0.08] shrink-0">
              <div className="relative w-20 h-20">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke={strokeColors[stockColor]}
                    strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 42}
                    strokeDashoffset={(2 * Math.PI * 42) - (stockPct / 100) * (2 * Math.PI * 42)}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`font-extrabold text-white tabular-nums font-display leading-none ${fmtNum(totalStock).length > 5 ? 'text-xs' : 'text-sm'}`}>{fmtNum(totalStock)}</span>
                  <span className="text-[8px] text-white/40 font-medium mt-0.5">{ucFirst(item?.unit)}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${stockColor === 'red' ? 'text-red-400' : stockColor === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>{sc.label}</span>
                </div>
                {minStock > 0 && (
                  <p className="text-[10px] text-white/30">Min: {fmtNum(minStock)} {ucFirst(item?.unit)}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Details + Stock grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Item details */}
        {details.length > 0 && (
          <div className={`${stocks.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display mb-3 block">Detalles del item</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-gray-100 rounded-xl overflow-hidden">
              {details.map((d, idx) => (
                <div key={d.label} className={`bg-white px-4 py-4 ${details.length % 2 !== 0 && idx === details.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <d.icon size={12} className="text-gray-300" />
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{d.label}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-800 pl-5">{d.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stock by warehouse */}
        {stocks.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display mb-3 block">Stock por almacen</span>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="divide-y divide-gray-50">
                {stocks.map((s) => {
                  const qty = Number(s.quantity ?? 0);
                  const pct = totalStock > 0 ? (qty / totalStock) * 100 : 0;
                  return (
                    <div key={`${s.warehouse_type}-${s.project ?? s.project_code ?? s.department ?? 'global'}`} className="px-4 py-3.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <Warehouse size={12} className="text-gray-300" />
                          <span className="text-xs text-gray-600 font-medium">
                            {WAREHOUSE_LABELS[s.warehouse_type] ?? s.warehouse_type}
                            {s.project_code ? ` — ${s.project_code}` : ''}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-gray-800 tabular-nums">{fmtNum(qty)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Kardex table ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Kardex</span>
            {movements.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 tabular-nums">
                {movements.length} movimiento{movements.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600 dark:border-t-emerald-400" />
            </div>
          ) : movements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <ArrowLeftRight size={28} strokeWidth={1.2} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">Sin movimientos registrados</p>
              <p className="text-xs text-gray-300">Los movimientos de entrada y salida apareceran aqui.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-100">
                      <th className="px-5 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fecha</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">N. Mov.</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tipo</th>
                      <th className="px-4 py-3.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cantidad</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Almacen</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Detalle</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Registrado por</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {movements.map((mov) => {
                      const cfg = MOVEMENT_CONFIG[mov.movement_type] ?? MOVEMENT_CONFIG.ENTRY;
                      const Icon = cfg.icon;
                      return (
                        <tr key={mov.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div>
                              <p className="text-xs font-medium text-gray-700">{formatDate(mov.created_at ?? mov.date)}</p>
                              <p className="text-[10px] text-gray-400">{formatTime(mov.created_at ?? mov.date)}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-[11px] text-gray-500 font-medium">{mov.movement_number ?? mov.id}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-md flex items-center justify-center ${cfg.bg}`}>
                                <Icon size={12} className={cfg.iconColor} strokeWidth={2.5} />
                              </div>
                              <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={`text-sm font-bold tabular-nums ${cfg.signColor}`}>
                              {cfg.sign}{fmtNum(mov.quantity)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs text-gray-500">{WAREHOUSE_LABELS[mov.warehouse] ?? mov.warehouse ?? '—'}</span>
                          </td>
                          <td className="px-4 py-3.5 hidden lg:table-cell">
                            <span className="text-xs text-gray-400">
                              {mov.source_type ?? mov.destination_type ?? '—'}
                              {(mov.source_detail ?? mov.destination_detail) ? ` — ${mov.source_detail ?? mov.destination_detail}` : ''}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 hidden xl:table-cell">
                            <span className="text-xs text-gray-400">{mov.registered_by_name ?? '—'}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {movements.map((mov) => {
                  const cfg = MOVEMENT_CONFIG[mov.movement_type] ?? MOVEMENT_CONFIG.ENTRY;
                  const Icon = cfg.icon;
                  return (
                    <div key={mov.id} className="px-4 py-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cfg.bg}`}>
                            <Icon size={13} className={cfg.iconColor} strokeWidth={2.5} />
                          </div>
                          <div>
                            <p className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</p>
                            <p className="text-[10px] text-gray-400">{formatDate(mov.created_at ?? mov.date)}</p>
                          </div>
                        </div>
                        <span className={`text-base font-bold tabular-nums ${cfg.signColor}`}>
                          {cfg.sign}{fmtNum(mov.quantity)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 pl-9 text-[10px] text-gray-400">
                        {mov.movement_number && (
                          <span className="flex items-center gap-1"><Hash size={9} /> {mov.movement_number}</span>
                        )}
                        {(mov.warehouse || WAREHOUSE_LABELS[mov.warehouse]) && (
                          <span className="flex items-center gap-1"><Warehouse size={9} /> {WAREHOUSE_LABELS[mov.warehouse] ?? mov.warehouse}</span>
                        )}
                        {mov.registered_by_name && (
                          <span className="flex items-center gap-1"><User size={9} /> {mov.registered_by_name}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
