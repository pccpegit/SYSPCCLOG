import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Pencil, Printer, Warehouse,
} from 'lucide-react';
import { getKardex, getCategories } from '../../api/almacen';
import { useAuth } from '../../context/AuthContext';
import { MOVEMENT_CONFIG, WAREHOUSE_LABELS_FULL, ITEM_TYPE_LABELS } from '../../data/almacenConstants';
import { ASSIGN_LOCATION_ROLES } from '../../data/almacenRoles';
import { formatISODate, formatQty, hasAnyRole } from '../../utils/almacen';
import ItemFormModal from '../../components/almacen/ItemFormModal';
import { LocationChip } from '../../components/almacen/chips';
import {
  Banner, Card, Chip, EmptyBlock, ErrorBlock, LoadingBlock,
} from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls, thCls } from '../../components/almacen/uiStyles';

const DATE_ORDER_ERROR = 'La fecha inicial no puede ser posterior a la final.';

function SummaryCard({ label, value, tone }) {
  const toneCls = {
    default: 'text-gray-900',
    in: 'text-emerald-700 dark:text-emerald-400',
    out: 'text-rose-600 dark:text-rose-400',
  }[tone ?? 'default'];
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tabular-nums font-display mt-1 ${toneCls}`}>{value}</p>
    </Card>
  );
}

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** Fecha operativa de un movimiento (o la marca de "sin fecha"). */
function MovementDate({ movement }) {
  if (!movement.movement_date) return <Chip tone="amber">Fecha no registrada</Chip>;
  return <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{formatISODate(movement.movement_date)}</span>;
}

export default function KardexPage() {
  const { id } = useParams();
  const { userRoles } = useAuth();
  const canAssign = hasAnyRole(userRoles, ASSIGN_LOCATION_ROLES);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);

  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? DATE_ORDER_ERROR : '';

  const load = useCallback(async () => {
    if (rangeError) return;
    const mine = ++seq.current;
    setState((prev) => ({ ...prev, status: prev.data ? 'refreshing' : 'loading' }));
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const res = await getKardex(id, params);
      if (mine === seq.current) setState({ status: 'ready', data: res.data });
    } catch {
      if (mine === seq.current) setState({ status: 'error', data: null });
    }
  }, [id, dateFrom, dateTo, rangeError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load, reloadKey]);

  useEffect(() => {
    if (!editing || categories.length) return undefined;
    let alive = true;
    getCategories().then((res) => {
      const cats = res.data?.results ?? res.data ?? [];
      if (alive) setCategories(Array.isArray(cats) ? cats : []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [editing, categories.length]);

  if (state.status === 'loading') return <LoadingBlock label="Cargando kardex…" className="h-64" />;

  if (state.status === 'error') {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/almacen/inventario" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} aria-hidden="true" /> Volver al inventario
        </Link>
        <Card><ErrorBlock message="No se pudo cargar la información del ítem." onRetry={() => setReloadKey((k) => k + 1)} /></Card>
      </div>
    );
  }

  const { item, movements = [], opening_stock: opening = 0, closing_stock: closing = 0 } = state.data;
  const entries = movements.reduce((acc, m) => acc + (m.delta > 0 ? m.delta : 0), 0);
  const exits = movements.reduce((acc, m) => acc + (m.delta < 0 ? -m.delta : 0), 0);
  const negative = movements.find((m) => m.balance_after < 0);
  const periodFiltered = Boolean(dateFrom || dateTo);
  const unit = item.unit ?? '';

  return (
    <>
      <div className="space-y-5 max-w-7xl mx-auto">
        <Link to="/almacen/inventario" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} aria-hidden="true" /> Volver al inventario
        </Link>

        {/* ── Encabezado ── */}
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold tracking-wider text-emerald-700 dark:text-emerald-400">{item.product_code}</p>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 leading-snug font-display tracking-tight">{item.description}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Chip tone="emerald">{item.category || ITEM_TYPE_LABELS[item.item_type] || 'Sin categoría'}</Chip>
                <Chip>{unit || 'Sin unidad'}</Chip>
                {item.size && <Chip>Talla {item.size}</Chip>}
                <LocationChip item={item} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/almacen/entrada?item=${item.id}`} className={btnSecondary}>
                <ArrowDownToLine size={15} aria-hidden="true" /> Registrar ingreso
              </Link>
              <Link to={`/almacen/salida?item=${item.id}`} className={btnSecondary}>
                <ArrowUpFromLine size={15} aria-hidden="true" /> Registrar entrega
              </Link>
              <button type="button" onClick={() => setEditing(true)} className={btnPrimary}>
                <Pencil size={15} aria-hidden="true" /> Editar ítem
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-5 pt-5 border-t border-gray-100">
            <Detail label="OC">{item.purchase_order_ref}</Detail>
            <Detail label="Packing list">{item.packing_list}</Detail>
            <Detail label="N° de orden">{item.order_number}</Detail>
            <Detail label="Marca">{item.brand}</Detail>
            <Detail label="Modelo">{item.model_name}</Detail>
            <Detail label="Proyecto">{item.project_name || item.project_code}</Detail>
            <Detail label="Stock mínimo">{Number(item.min_stock) > 0 ? formatQty(item.min_stock) : ''}</Detail>
            <div className="col-span-2 sm:col-span-3 lg:col-span-5">
              <Detail label="Observación">{item.observation}</Detail>
            </div>
          </dl>
        </Card>

        {/* ── Tarjetas del periodo ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Inv. inicial" value={formatQty(opening)} />
          <SummaryCard label="Ingresos" value={formatQty(entries)} tone="in" />
          <SummaryCard label="Egresos" value={formatQty(exits)} tone="out" />
          <SummaryCard label={periodFiltered && dateTo ? 'Stock al cierre' : 'Stock actual'} value={formatQty(closing)} />
        </div>

        {(item.stocks ?? []).length > 0 && (
          <Card className="px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Stock por almacén</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {item.stocks.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <Warehouse size={13} className="text-gray-400" aria-hidden="true" />
                  {WAREHOUSE_LABELS_FULL[s.warehouse_type] ?? s.warehouse_type}
                  {s.project_code ? ` — ${s.project_code}` : ''}:
                  <strong className="tabular-nums">{formatQty(s.quantity)}</strong>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {negative && (
          <Banner tone="red" live="assertive">
            {negative.movement_date
              ? `El saldo es negativo el ${formatISODate(negative.movement_date)}: revise las fechas de los movimientos.`
              : 'El saldo es negativo en un movimiento sin fecha: revise las fechas de los movimientos.'}
          </Banner>
        )}

        {/* ── Historial ── */}
        <section aria-labelledby="kardex-title" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 id="kardex-title" className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display">Historial</h2>
              <span className="text-xs text-gray-500 tabular-nums">
                {movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="kardex-from" className="block text-xs font-semibold text-gray-600 mb-1">Desde</label>
                <input id="kardex-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={inputCls(!!rangeError)} />
              </div>
              <div>
                <label htmlFor="kardex-to" className="block text-xs font-semibold text-gray-600 mb-1">Hasta</label>
                <input id="kardex-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={inputCls(!!rangeError)} />
              </div>
              {periodFiltered && (
                <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} className={btnSecondary}>Limpiar fechas</button>
              )}
            </div>
          </div>
          {rangeError && <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{rangeError}</p>}

          <Card className={`overflow-hidden ${state.status === 'refreshing' ? 'opacity-60' : ''}`} aria-busy={state.status === 'refreshing'}>
            {movements.length === 0 ? (
              <EmptyBlock
                icon={ArrowLeftRight}
                title={periodFiltered ? 'No hay movimientos en el periodo seleccionado.' : 'Este ítem aún no tiene movimientos.'}
                hint="Los ingresos y egresos aparecerán aquí con su saldo."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Historial de movimientos del ítem con saldo corrido</caption>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left">
                      <th scope="col" className={thCls}>Fecha</th>
                      <th scope="col" className={thCls}>N° mov.</th>
                      <th scope="col" className={thCls}>Tipo</th>
                      <th scope="col" className={`${thCls} text-right`}>Cantidad</th>
                      <th scope="col" className={`${thCls} text-right`}>Saldo</th>
                      <th scope="col" className={thCls}>N° de vale</th>
                      <th scope="col" className={`${thCls} hidden lg:table-cell`}>Origen / Destino</th>
                      <th scope="col" className={`${thCls} hidden xl:table-cell`}>Observación</th>
                      <th scope="col" className="px-3 py-3"><span className="sr-only">Vale</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {movements.map((mov) => {
                      const cfg = MOVEMENT_CONFIG[mov.movement_type] ?? MOVEMENT_CONFIG.ENTRY;
                      const Icon = cfg.icon;
                      const origin = mov.movement_type === 'EXIT'
                        ? (mov.destination_personal_name || mov.destination_detail)
                        : (mov.supplier_name || mov.internal_transfer);
                      return (
                        <tr key={mov.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <MovementDate movement={mov} />
                            {/* Lo que se oculta en pantallas angostas pasa a segunda línea. */}
                            {origin && (
                              <span className="block lg:hidden mt-1 text-xs text-gray-600">
                                {mov.movement_type === 'EXIT' ? 'Destino' : 'Origen'}: {origin}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{mov.movement_number}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cfg.text}`}>
                              <Icon size={13} className={cfg.iconColor} aria-hidden="true" /> {cfg.label}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-right font-bold tabular-nums ${mov.delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                            {mov.delta > 0 ? '+' : mov.delta < 0 ? '−' : ''}{formatQty(Math.abs(mov.delta ?? mov.quantity))}
                          </td>
                          <td className={`px-4 py-3 text-right font-bold tabular-nums ${mov.balance_after < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900'}`}>
                            {formatQty(mov.balance_after)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {mov.voucher_number
                              ? <span className="font-mono text-xs text-gray-700">{mov.voucher_number}</span>
                              : mov.movement_type === 'EXIT' ? <Chip tone="amber">Sin vale</Chip> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-600">{origin || '—'}</td>
                          <td className="px-4 py-3 hidden xl:table-cell text-xs text-gray-600 max-w-[16rem] break-words">{mov.notes || '—'}</td>
                          <td className="px-3 py-3 text-right">
                            {mov.movement_type === 'EXIT' && (
                              <Link
                                to={`/almacen/salida/${mov.id}/voucher`}
                                aria-label={`Ver vale del movimiento ${mov.movement_number}`}
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
          </Card>
        </section>
      </div>

      {editing && (
        <ItemFormModal
          item={item}
          categories={categories}
          canAssignLocation={canAssign}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadKey((k) => k + 1); }}
        />
      )}
    </>
  );
}
