import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Package, FileSearch, ShoppingCart, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import { STATUS } from '../../data/constants';
import { getRequests } from '../../api/requests';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';

function formatCurrency(val) {
  if (!val && val !== 0) return 'S/ 0';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

const LOGISTICS_STATUSES = [
  STATUS.VALIDATED,
  STATUS.STOCK_CHECK,
  STATUS.REQUIRES_PURCHASE,
  STATUS.QUOTING,
  STATUS.QUOTE_COMPARISON,
  STATUS.QUOTE_SELECTED,
  STATUS.QUOTE_COST_APPROVED,
  STATUS.COST_OVERRUN_REVIEW,
  STATUS.COST_OVERRUN_APPROVED,
  STATUS.PO_GENERATED,
  STATUS.RECEIVING,
  STATUS.QUALITY_APPROVED,
  STATUS.QUALITY_REJECTED,
  STATUS.USER_CONFORMITY,
  STATUS.CLAIM_IN_REVIEW,
  'SUPPLIER_CLAIM_SENT',
  'SUPPLIER_CLAIM_PENDING',
  'SUPPLIER_REPLACEMENT_RECEIVED',
];

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 dark:border-teal-400" />
    </div>
  );
}

export default function LogisticsPage() {
  const navigate = useNavigate();

  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await getRequests({
          status_in: LOGISTICS_STATUSES.join(','),
          page_size: 200,
          ordering: '-created_at',
        });
        setRequests(data.results ?? []);
      } catch (err) {
        console.error('Error fetching logistics requests:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const stats = {
    validated:   requests.filter((r) => r.status === STATUS.VALIDATED).length,
    stockCheck:  requests.filter((r) => r.status === STATUS.STOCK_CHECK).length,
    quoting:     requests.filter((r) => [STATUS.QUOTING, STATUS.QUOTE_SELECTED].includes(r.status)).length,
    poGenerated: requests.filter((r) => r.status === STATUS.PO_GENERATED).length,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
          <Truck size={28} className="text-teal-600 dark:text-teal-400" />
          Panel de Logística
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Gestión de inventario, cotizaciones y órdenes de compra
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-teal-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-500/10 flex items-center justify-center">
              <CheckCircle size={20} className="text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Validados</p>
              <p className="text-2xl font-bold text-gray-900">{stats.validated}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-cyan-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-500/10 flex items-center justify-center">
              <FileSearch size={20} className="text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Verif. Stock</p>
              <p className="text-2xl font-bold text-gray-900">{stats.stockCheck}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-indigo-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center">
              <ShoppingCart size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Cotizando</p>
              <p className="text-2xl font-bold text-gray-900">{stats.quoting}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
              <Package size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium">Orden de Compra</p>
              <p className="text-2xl font-bold text-gray-900">{stats.poGenerated}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Requerimientos en Gestión Logística</h2>
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
            <p className="text-sm text-gray-400">No hay requerimientos pendientes de gestión logística.</p>
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
                  <th className="py-3 px-4 text-right text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Costo Est.</th>
                  <th className="py-3 px-4 text-center text-xs font-semibold text-gray-500 uppercase">Acción</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req, idx) => {
                  const rqId = req.rq_number ?? req.rqNumber ?? req.id;
                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/rq/logistics/${rqId}`)}
                      className={`border-b border-gray-50 hover:bg-teal-50/60 dark:hover:bg-teal-500/10 cursor-pointer transition-all duration-150 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-blue-700 dark:text-blue-300 text-xs">{rqId}</td>
                      <td className="py-3 px-4 text-gray-800 max-w-xs">
                        <span className="line-clamp-1">{req.description}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 hidden md:table-cell">{req.project_code ?? req.projectCode ?? (req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—')}</td>
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
    </div>
  );
}
