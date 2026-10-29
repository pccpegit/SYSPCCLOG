import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, ChevronRight, FileUp,
  MapPinOff, Package, PackageX, Receipt, Scale, Boxes,
} from 'lucide-react';
import { getAlerts, getMovementSummary, getMovements, getSummary } from '../../api/almacen';
import { useAuth } from '../../context/AuthContext';
import { ASSIGN_LOCATION_ROLES, COUNTER_ROLES, IMPORT_ROLES } from '../../data/almacenRoles';
import { addDaysISO, formatQty, hasAnyRole, localISODate } from '../../utils/almacen';
import { Banner, Card, EmptyBlock, ErrorBlock, PageHeader } from '../../components/almacen/ui';
import { TONES, btnPrimary } from '../../components/almacen/uiStyles';

function KpiCard({ label, value, icon, tone, loading, to, hint }) {
  const Icon = icon;
  const body = (
    <Card className="p-5 h-full hover:border-gray-200 transition-colors">
      <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center mb-3 ${TONES[tone] ?? TONES.gray}`}>
        <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      </div>
      {loading ? (
        <div className="space-y-2" role="status" aria-label={`Cargando ${label}`}>
          <div className="h-8 w-20 bg-gray-100 animate-pulse rounded-lg" />
          <div className="h-4 w-28 bg-gray-50 animate-pulse rounded" />
        </div>
      ) : (
        <>
          <p className="text-3xl font-bold text-gray-900 tracking-tight font-display tabular-nums">{value == null ? '—' : formatQty(value)}</p>
          <p className="text-sm text-gray-600 mt-1 font-display">{label}</p>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </>
      )}
    </Card>
  );
  return to
    ? <Link to={to} className="block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{body}</Link>
    : body;
}

function QuickAction({ to, label, description, icon, primary }) {
  const Icon = icon;
  return (
    <Link
      to={to}
      className={`group flex items-center gap-4 px-5 py-4 rounded-2xl text-left transition-all duration-150 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
        primary
          ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg shadow-emerald-700/20'
          : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-800'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${primary ? 'bg-white/15' : 'bg-gray-100'}`}>
        <Icon size={19} strokeWidth={1.8} className={primary ? 'text-white' : 'text-gray-600'} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold font-display">{label}</p>
        <p className={`text-xs mt-0.5 ${primary ? 'text-white/95' : 'text-gray-500'}`}>{description}</p>
      </div>
      <ChevronRight size={16} className="ml-auto shrink-0 opacity-50 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
    </Link>
  );
}

function AlertTable({ title, tone, icon, rows, to, emptyText, loading = false }) {
  const Icon = icon;
  return (
    <Card className="overflow-hidden" role="region" aria-label={title}>
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl ring-1 flex items-center justify-center ${TONES[tone]}`}>
            <Icon size={17} aria-hidden="true" />
          </div>
          <h2 className="text-sm sm:text-base font-semibold text-gray-900 font-display">
            {title} {!loading && <span className="text-gray-500 font-normal tabular-nums">({rows.length})</span>}
          </h2>
        </div>
        <Link to={to} className="text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 font-semibold flex items-center gap-1 font-display">
          Ver todos <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {loading ? (
        // While the alerts are on their way, never claim that nothing is wrong (empty-state copy is a statement of fact).
        <div role="status" aria-label={`Cargando ${title}`} className="p-5 space-y-3">
          <div className="h-4 w-2/3 bg-gray-100 animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-gray-100 animate-pulse rounded" />
          <div className="h-4 w-3/5 bg-gray-100 animate-pulse rounded" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyBlock icon={Package} title={emptyText} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="bg-gray-50 text-left">
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Código</th>
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Descripción</th>
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Stock</th>
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right hidden sm:table-cell">Mín.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.slice(0, 8).map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <Link to={`/almacen/inventario/${item.id}`} className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">{item.product_code}</Link>
                  </td>
                  <td className="px-5 py-3 text-gray-800">{item.description}</td>
                  <td className="px-5 py-3 text-right font-bold tabular-nums text-gray-900">{formatQty(item.current_stock)}</td>
                  <td className="px-5 py-3 text-right text-gray-500 tabular-nums hidden sm:table-cell">{formatQty(item.min_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AlmacenDashboardPage() {
  const { userRoles } = useAuth();
  const canCounter = hasAnyRole(userRoles, COUNTER_ROLES);
  const canImport = hasAnyRole(userRoles, IMPORT_ROLES);
  const canAssign = hasAnyRole(userRoles, ASSIGN_LOCATION_ROLES);

  const [state, setState] = useState({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const since = addDaysISO(localISODate(), -30);
    const [summary, alerts, units, noVoucher] = await Promise.allSettled([
      getSummary(),
      getAlerts(),
      getMovementSummary({ page_size: 1 }),
      getMovements({ no_voucher: 'true', date_from: since, page_size: 1 }),
    ]);
    if (summary.status === 'rejected') {
      setState({ status: 'error' });
      return;
    }
    const alertRows = alerts.status === 'fulfilled'
      ? (Array.isArray(alerts.value.data) ? alerts.value.data : (alerts.value.data?.results ?? []))
      : null;
    setState({
      status: 'ready',
      summary: summary.value.data,
      alerts: alertRows,
      units: units.status === 'fulfilled' ? units.value.data?.meta?.totals?.closing ?? null : null,
      noVoucher: noVoucher.status === 'fulfilled' ? noVoucher.value.data?.count ?? null : null,
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const loading = state.status === 'loading';
  const summary = state.summary;
  const alertRows = state.alerts ?? [];
  const noStock = alertRows.filter((a) => Number(a.current_stock) <= 0);
  const lowStock = alertRows.filter((a) => Number(a.current_stock) > 0);

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" subtitle="Resumen del inventario y de los movimientos del día." />

      {state.status === 'error' && (
        <Card><ErrorBlock message="No se pudieron cargar los datos del dashboard." onRetry={load} /></Card>
      )}

      {state.status !== 'error' && (
        <>
          {summary?.undated_movements > 0 && (
            <Banner tone="amber">
              {formatQty(summary.undated_movements)} {summary.undated_movements === 1 ? 'movimiento no tiene' : 'movimientos no tienen'} fecha registrada.{' '}
              <Link to="/almacen/movimientos?sin_fecha=1" className="font-semibold underline">Revisarlos</Link>
            </Banner>
          )}

          {canAssign && summary?.pending_location_count > 0 && (
            <Banner tone="amber">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <p>
                  Sin ubicación exacta: {formatQty(summary.pending_location_count)}. Asigne pabellón, sección y nivel a cada ítem
                  para encontrarlos al preparar pedidos.
                </p>
                <Link to="/almacen/inventario?pendientes=1&ubicar=1" className={`${btnPrimary} shrink-0`}>
                  <MapPinOff size={15} aria-hidden="true" /> Empezar a ubicar
                </Link>
              </div>
            </Banner>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <KpiCard label="Ítems" value={summary?.total_items} icon={Boxes} tone="emerald" loading={loading} to="/almacen/inventario" />
            <KpiCard label="Unidades en stock" value={state.units} icon={Package} tone="blue" loading={loading} to="/almacen/resumen" />
            <KpiCard label="Pendientes de ubicar" value={summary?.pending_location_count} icon={MapPinOff} tone="amber" loading={loading} to="/almacen/inventario?pendientes=1" />
            <KpiCard label="Ingresos hoy" value={summary?.today_entries} icon={ArrowDownToLine} tone="emerald" loading={loading} />
            <KpiCard label="Egresos hoy" value={summary?.today_exits} icon={ArrowUpFromLine} tone="red" loading={loading} />
            <KpiCard label="Egresos sin vale" hint="Últimos 30 días" value={state.noVoucher} icon={Receipt} tone="violet" loading={loading} to="/almacen/movimientos?sin_vale=1" />
          </div>

          <section aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1 font-display">Accesos rápidos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <QuickAction to="/almacen/entrada" label="Registrar ingreso" description="Recepción de material" icon={ArrowDownToLine} primary />
              {canCounter && <QuickAction to="/almacen/salida" label="Registrar entrega" description="Entrega de EPP con vale" icon={ArrowUpFromLine} primary />}
              {canCounter && <QuickAction to="/almacen/transferencia" label="Transferencia interna" description="Entre el 1er y el 2do piso" icon={ArrowRightLeft} />}
              <QuickAction to="/almacen/resumen" label="Resumen de movimiento" description="Inicial, ingresos, egresos y stock" icon={Scale} />
              <QuickAction to="/almacen/inventario" label="Ver inventario" description="Consultar ítems y ubicaciones" icon={Package} />
              {canImport && <QuickAction to="/almacen/importar" label="Importar Excel" description="Cargar el libro de inventario" icon={FileUp} />}
            </div>
          </section>

          {state.alerts === null && !loading ? (
            <Banner tone="red" live>No se pudieron cargar las alertas de stock.</Banner>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <AlertTable
                title="Bajo mínimo"
                tone="amber"
                icon={AlertTriangle}
                rows={lowStock}
                loading={loading}
                to="/almacen/inventario?estado=low"
                emptyText="Ningún ítem está bajo su stock mínimo."
              />
              <AlertTable
                title="Sin stock"
                tone="red"
                icon={PackageX}
                rows={noStock}
                loading={loading}
                to="/almacen/inventario?estado=none"
                emptyText="Todos los ítems tienen stock."
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
