import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Warehouse, Package, ClipboardCheck, Truck, ArrowRight, CheckCircle, LayoutGrid } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { STATUS, ROLES } from '../../data/constants';
import { getRequests } from '../../api/requests';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';

// ─────────────────────────────────────────────────────────────────────────────
// Demo inventory data — static until real inventory module is built
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_INVENTORY = [
  { id: 1, product: 'Cemento Portland Tipo I (42.5 kg)',  unit: 'Bolsa', central: 320, obra: 48,  minimum: 50  },
  { id: 2, product: 'Fierro corrugado 3/8" x 9m',        unit: 'Varilla', central: 85, obra: 12,  minimum: 20  },
  { id: 3, product: 'Tuberia PVC SAP 4" x 3m',           unit: 'Tubo',  central: 60, obra: 5,   minimum: 10  },
  { id: 4, product: 'Alambre negro N° 16 (1 kg)',         unit: 'Rollo', central: 200, obra: 75,  minimum: 30  },
  { id: 5, product: 'Ladrillo King Kong 18 huecos',       unit: 'Millar', central: 8,  obra: 2,   minimum: 3   },
  { id: 6, product: 'Pintura latex interior (4 gal)',     unit: 'Balde', central: 24, obra: 0,   minimum: 5   },
];

function formatCurrency(val) {
  if (!val && val !== 0) return 'S/ 0';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

const WAREHOUSE_STATUSES = [
  STATUS.IN_STOCK,
  STATUS.PO_GENERATED,
  STATUS.RECEIVING,
  STATUS.QUALITY_CHECK,
  STATUS.QUALITY_APPROVED,
  STATUS.QUALITY_REJECTED,
  STATUS.DISPATCHED_TO_SITE,
  STATUS.DELIVERED,
];

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 dark:border-orange-400" />
    </div>
  );
}

export default function WarehousePage() {
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();

  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const results = await Promise.all(
          WAREHOUSE_STATUSES.map((s) => getRequests({ status: s, page_size: 100, ordering: '-created_at' }))
        );
        const merged = results.flatMap((r) => r.data.results ?? []);
        const unique = [...new Map(merged.map((r) => [r.id, r])).values()];
        setRequests(unique);
      } catch (err) {
        console.error('Error fetching warehouse requests:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const stats = {
    porRecibir:  requests.filter((r) => r.status === STATUS.PO_GENERATED).length,
    enRecepcion: requests.filter((r) => [STATUS.RECEIVING, STATUS.QUALITY_CHECK].includes(r.status)).length,
    despachados: requests.filter((r) => r.status === STATUS.DISPATCHED_TO_SITE).length,
    entregados:  requests.filter((r) => r.status === STATUS.DELIVERED).length,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
          <Warehouse size={28} className="text-orange-600 dark:text-orange-400" />
          Panel de Almacén
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {primaryRole === ROLES.CENTRAL_WAREHOUSE
            ? 'Recepción de materiales y control de calidad'
            : 'Despacho y entrega a obra'}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
              <Package size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Por Recibir</p>
              <p className="text-2xl font-bold text-gray-900">{stats.porRecibir}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
              <ClipboardCheck size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">En Recepción/QC</p>
              <p className="text-2xl font-bold text-gray-900">{stats.enRecepcion}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-teal-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-500/10 flex items-center justify-center">
              <Truck size={20} className="text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Despachados</p>
              <p className="text-2xl font-bold text-gray-900">{stats.despachados}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-green-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/10 flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Entregados</p>
              <p className="text-2xl font-bold text-gray-900">{stats.entregados}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Requerimientos en Almacén</h2>
          {!loading && (
            <span className="text-sm text-gray-400">
              {requests.length} requerimiento{requests.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : requests.length === 0 ? (
          <div className="py-14 text-center">
            <Package size={40} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">No hay requerimientos pendientes en almacén.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase">RQ #</th>
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Descripción</th>
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Proyecto</th>
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase hidden sm:table-cell">Prioridad</th>
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                  <th className="py-3 px-4 text-right text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Costo</th>
                  <th className="py-3 px-4 text-center text-xs font-semibold text-gray-500 uppercase">Acción</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req, idx) => {
                  const rqId = req.rq_number ?? req.rqNumber ?? req.id;
                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/rq/warehouse/${rqId}`)}
                      className={`border-b border-gray-50 hover:bg-blue-50/60 dark:hover:bg-blue-500/10 cursor-pointer transition-all duration-150 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-blue-700 dark:text-blue-300 text-xs">{rqId}</td>
                      <td className="py-3 px-4 text-gray-800 max-w-xs">
                        <span className="line-clamp-1">{req.description}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 hidden md:table-cell">{req.project_code ?? req.projectCode}</td>
                      <td className="py-3 px-4 hidden sm:table-cell"><PriorityBadge priority={req.priority} /></td>
                      <td className="py-3 px-4"><StatusBadge status={req.status} /></td>
                      <td className="py-3 px-4 text-right font-medium text-gray-700 hidden lg:table-cell">
                        {formatCurrency(req.estimated_cost ?? req.estimatedCost)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
                          Ver <ArrowRight size={12} />
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

      {/* Demo Inventory Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-500/10 flex items-center justify-center shrink-0">
            <LayoutGrid size={16} className="text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800">Inventario Actual (Demo)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Vista rapida de stock en almacen central y almacen de obra. Datos de muestra.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Producto</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Unidad</th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-gray-500 uppercase">Stock Central</th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-gray-500 uppercase">Stock Obra</th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-gray-500 uppercase hidden sm:table-cell">Minimo</th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-gray-500 uppercase">Estado</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_INVENTORY.map((item, idx) => {
                const totalStock = item.central + item.obra;
                const isBelowMin = totalStock < item.minimum;
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}
                  >
                    <td className="py-3 px-4 text-gray-800 font-medium leading-snug">
                      {item.product}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                        {item.unit}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-semibold ${item.central > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400'}`}>
                        {item.central.toLocaleString('es-PE')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-semibold ${item.obra > 0 ? 'text-teal-700 dark:text-teal-300' : 'text-gray-400'}`}>
                        {item.obra.toLocaleString('es-PE')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-500 hidden sm:table-cell">
                      {item.minimum.toLocaleString('es-PE')}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {isBelowMin ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                          Bajo minimo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Suficiente
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Modulo de inventario completo en desarrollo. Los datos mostrados son de muestra para demo.
          </p>
        </div>
      </div>
    </div>
  );
}
