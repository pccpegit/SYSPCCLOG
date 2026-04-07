import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  User,
  Building2,
  Calendar,
  MapPin,
  Truck,
  ShoppingCart,
  FileSearch,
  Package,
  ClipboardCheck,
  ArrowRight,
  Info,
} from 'lucide-react';
import { ROLES, STATUS } from '../../data/constants';
import { useAuth } from '../../context/AuthContext';
import { getRequest, getRequests, performAction } from '../../api/requests';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../context/ToastContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatCurrency(val) {
  if (!val && val !== 0) return '—';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}: </span>
        <span className="text-sm text-gray-800 font-medium">{value || '—'}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress stepper — shows logistics pipeline position
// ─────────────────────────────────────────────────────────────────────────────

const LOGISTICS_STEPS = [
  {
    key:      'stock',
    label:    'Verificación de Stock',
    statuses: [STATUS.VALIDATED, STATUS.STOCK_CHECK, STATUS.IN_STOCK],
    icon:     FileSearch,
  },
  {
    key:      'purchase',
    label:    'Solicitud de Compra',
    statuses: [STATUS.REQUIRES_PURCHASE],
    icon:     ShoppingCart,
  },
  {
    key:      'quoting',
    label:    'Cotizaciones',
    statuses: [STATUS.QUOTING],
    icon:     ClipboardCheck,
  },
  {
    key:      'quote_selected',
    label:    'Selección y Orden de Compra',
    statuses: [STATUS.QUOTE_SELECTED, STATUS.COST_OVERRUN_REVIEW],
    icon:     Package,
  },
  {
    key:      'po',
    label:    'Orden de Compra',
    statuses: [STATUS.PO_GENERATED],
    icon:     Truck,
  },
];

function getStepIndex(status) {
  return LOGISTICS_STEPS.findIndex((s) => s.statuses.includes(status));
}

function LogisticsProgressBar({ currentStatus }) {
  const activeIdx = getStepIndex(currentStatus);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
        Etapa Logística
      </p>
      <div className="flex items-center gap-0">
        {LOGISTICS_STEPS.map((step, idx) => {
          const StepIcon  = step.icon;
          const isDone    = idx < activeIdx;
          const isActive  = idx === activeIdx;
          const isPending = idx > activeIdx;

          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
              {/* Step circle */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                    isDone
                      ? 'bg-teal-500 border-teal-500'
                      : isActive
                        ? 'bg-teal-600 border-teal-600 ring-4 ring-teal-100'
                        : 'bg-white border-gray-200'
                  }`}
                >
                  <StepIcon
                    size={16}
                    className={
                      isDone || isActive ? 'text-white' : 'text-gray-300'
                    }
                  />
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium text-center leading-tight max-w-[70px] ${
                    isActive
                      ? 'text-teal-700'
                      : isDone
                        ? 'text-teal-500'
                        : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line — omit after last step */}
              {idx < LOGISTICS_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 mt-[-1.25rem] ${
                    isDone ? 'bg-teal-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Items table — stock check variant
// ─────────────────────────────────────────────────────────────────────────────

function ItemsTable({ items, showStock }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">
          Ítems del Requerimiento ({items.length})
        </h2>
        {showStock && (
          <p className="text-xs text-gray-400 mt-0.5">
            Verifique las existencias en almacén antes de tomar una decisión.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
              <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cant. Req.</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
              {showStock && (
                <>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 hidden lg:table-cell">
                    Stk. Obra
                  </th>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 hidden lg:table-cell">
                    Stk. Central
                  </th>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 hidden md:table-cell">
                    x Atender
                  </th>
                </>
              )}
              {!showStock && (
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">
                  Especificaciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr
                key={item.line_number ?? item.lineNumber ?? idx}
                className={`border-b border-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}
              >
                <td className="py-3 px-4 text-gray-400 font-mono text-xs">
                  {item.line_number ?? item.lineNumber ?? idx + 1}
                </td>
                <td className="py-3 px-4 text-gray-800 font-medium leading-snug">
                  {item.description}
                </td>
                <td className="py-3 px-4 text-right text-gray-700 font-semibold">
                  {item.quantity}
                </td>
                <td className="py-3 px-4">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                    {item.unit}
                  </span>
                </td>
                {showStock && (
                  <>
                    <td className="py-3 px-4 text-right hidden lg:table-cell">
                      <span className={`text-sm font-semibold ${
                        (item.stock_almacen_obra ?? 0) > 0
                          ? 'text-teal-600'
                          : 'text-gray-400'
                      }`}>
                        {item.stock_almacen_obra ?? 0}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right hidden lg:table-cell">
                      <span className={`text-sm font-semibold ${
                        (item.stock_almacen_central ?? 0) > 0
                          ? 'text-blue-600'
                          : 'text-gray-400'
                      }`}>
                        {item.stock_almacen_central ?? 0}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right hidden md:table-cell">
                      <span className="text-sm font-mono text-gray-600">
                        {item.x_atender ?? item.quantity}
                      </span>
                    </td>
                  </>
                )}
                {!showStock && (
                  <td className="py-3 px-4 text-gray-500 text-xs hidden md:table-cell leading-snug">
                    {item.specifications}
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={showStock ? 7 : 5}
                  className="py-8 text-center text-gray-400 italic text-sm"
                >
                  Sin ítems registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action panels per status
// ─────────────────────────────────────────────────────────────────────────────

function NotesField({ value, onChange }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <label className="block text-sm font-semibold text-gray-800 mb-2">
        Notas / Comentarios
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Observaciones, condiciones, referencias de cotización..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 hover:border-gray-400 transition-colors resize-none"
      />
      <p className="mt-1 text-xs text-gray-400">{value.length} / 500 caracteres</p>
    </div>
  );
}

// VALIDATED — stock check decision
function StockCheckPanel({ submitting, notes, onNotes, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-teal-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-teal-800">Verificación de Stock</p>
          <p className="text-xs text-teal-700 mt-0.5 leading-relaxed">
            Revise las existencias en almacén de obra y almacén central para todos los ítems.
            Luego indique si hay stock disponible o si se requiere compra.
          </p>
        </div>
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Decisión de Stock</h2>

        <button
          type="button"
          onClick={() => onAction(true)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <CheckCircle2 size={20} />
          {submitting ? 'Procesando...' : 'Hay Stock Disponible'}
        </button>

        <button
          type="button"
          onClick={() => onAction(false)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-orange-500 text-white text-base font-bold rounded-xl hover:bg-orange-600 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <ShoppingCart size={20} />
          {submitting ? 'Procesando...' : 'Sin Stock — Requiere Compra'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          Esta decisión quedará registrada en el historial del requerimiento.
        </p>
      </div>
    </div>
  );
}

// REQUIRES_PURCHASE — send to quoting
function RequestQuotesPanel({ submitting, notes, onNotes, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-orange-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-orange-800">Requiere Compra</p>
          <p className="text-xs text-orange-700 mt-0.5 leading-relaxed">
            No hay stock suficiente. Solicite cotizaciones a los proveedores para los ítems
            requeridos.
          </p>
        </div>
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Acción</h2>

        <button
          type="button"
          onClick={onAction}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <ClipboardCheck size={20} />
          {submitting ? 'Procesando...' : 'Solicitar Cotizaciones'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          El requerimiento pasará al estado "Cotizando".
        </p>
      </div>
    </div>
  );
}

// QUOTING — select quote / provider
function SelectQuotePanel({ submitting, notes, onNotes, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Cotizaciones Recibidas</p>
          <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
            Evalúe las cotizaciones recibidas de los proveedores y seleccione la más conveniente.
          </p>
        </div>
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Acción</h2>

        <button
          type="button"
          onClick={onAction}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-indigo-600 text-white text-base font-bold rounded-xl hover:bg-indigo-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <CheckCircle2 size={20} />
          {submitting ? 'Procesando...' : 'Seleccionar Proveedor / Cotización'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          El requerimiento avanzará a "Cotización Seleccionada".
        </p>
      </div>
    </div>
  );
}

// QUOTE_SELECTED — generate PO
function GeneratePOPanel({ submitting, notes, onNotes, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-indigo-800">Cotización Seleccionada</p>
          <p className="text-xs text-indigo-700 mt-0.5 leading-relaxed">
            Genere la Orden de Compra. Si el monto supera el presupuesto aprobado, se derivará
            a revisión de la Gerencia General.
          </p>
        </div>
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Generar Orden de Compra</h2>

        <button
          type="button"
          onClick={() => onAction(true)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <Package size={20} />
          {submitting ? 'Procesando...' : 'Generar Orden de Compra'}
        </button>

        <button
          type="button"
          onClick={() => onAction(false)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-amber-500 text-white text-base font-bold rounded-xl hover:bg-amber-600 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <AlertCircle size={20} />
          {submitting ? 'Procesando...' : 'Excede Presupuesto — Requiere Aprobación GG'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          Esta acción quedará registrada en el historial del requerimiento.
        </p>
      </div>
    </div>
  );
}

// IN_STOCK — informational, no action
function InStockPanel({ navigate }) {
  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-300 rounded-xl p-6 flex flex-col items-center text-center gap-3">
        <CheckCircle2 size={40} className="text-teal-500" />
        <p className="text-base font-bold text-teal-800">Stock Disponible</p>
        <p className="text-sm text-teal-700 max-w-xs leading-relaxed">
          El pedido ha sido derivado al Almacén para su atención y despacho a obra.
        </p>
        <button
          type="button"
          onClick={() => navigate('/rq/logistics')}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors"
        >
          Volver al Panel Logístico
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// PO_GENERATED — informational, no action
function POGeneratedPanel({ navigate }) {
  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-300 rounded-xl p-6 flex flex-col items-center text-center gap-3">
        <Package size={40} className="text-indigo-500" />
        <p className="text-base font-bold text-indigo-800">Orden de Compra Generada</p>
        <p className="text-sm text-indigo-700 max-w-xs leading-relaxed">
          La orden de compra ha sido registrada. El flujo continua con la recepción en almacén.
        </p>
        <button
          type="button"
          onClick={() => navigate('/rq/logistics')}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Volver al Panel Logístico
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONABLE_STATUSES = new Set([
  STATUS.VALIDATED,
  STATUS.STOCK_CHECK,
  STATUS.REQUIRES_PURCHASE,
  STATUS.QUOTING,
  STATUS.QUOTE_SELECTED,
]);

export default function LogisticsActionPage() {
  const { id }          = useParams();
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }   = useToast();

  const [req,          setReq]          = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [notes,        setNotes]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

  // Derive acting role — prefer user's primary role; fall back to LOGISTICS_COORDINATOR
  const actingRole =
    primaryRole === ROLES.LOGISTICS_SUPERVISOR
      ? ROLES.LOGISTICS_SUPERVISOR
      : ROLES.LOGISTICS_COORDINATOR;

  useEffect(() => {
    const fetchReq = async () => {
      try {
        let requestData = null;

        if (/^\d+$/.test(id)) {
          const { data } = await getRequest(id);
          requestData = data;
        } else {
          const { data } = await getRequests({ rq_number: id, page_size: 1 });
          const results  = data.results ?? [];
          if (results.length > 0) {
            const { data: full } = await getRequest(results[0].id);
            requestData = full;
          }
        }

        if (!requestData) {
          setNotFound(true);
        } else {
          setReq(requestData);
        }
      } catch (err) {
        console.error('Error fetching request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchReq();
  }, [id]);

  // ── Action dispatchers ──────────────────────────────────────────────────

  async function doAction(actionData, successMessage) {
    setSubmitting(true);
    setError(null);
    try {
      await performAction(req.id, {
        ...actionData,
        acting_role: actingRole,
        comments:    notes.trim() || actionData.comments || '',
      });
      showToast({ type: 'success', message: successMessage });
      setTimeout(() => navigate('/rq/logistics'), 250);
    } catch (err) {
      console.error('Error performing action:', err);
      const detail =
        err?.response?.data?.detail ??
        err?.response?.data ??
        'Error al procesar la acción.';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      setError(msg);
      showToast({ type: 'error', message: msg });
      setSubmitting(false);
    }
  }

  function handleStockCheck(hasStock) {
    requestConfirm({
      title:        hasStock ? 'Confirmar Stock Disponible' : 'Confirmar Sin Stock',
      message:      hasStock
        ? '¿Confirma que hay stock disponible en almacén para todos los ítems de este requerimiento? El pedido será derivado al Almacén.'
        : '¿Confirma que no hay stock disponible? El requerimiento pasará a estado "Requiere Compra" para iniciar el proceso de adquisición.',
      confirmText:  hasStock ? 'Sí, Hay Stock' : 'Sí, Sin Stock',
      confirmColor: hasStock ? 'bg-teal-600 hover:bg-teal-700' : 'bg-orange-500 hover:bg-orange-600',
      icon:         hasStock ? CheckCircle2 : ShoppingCart,
      onConfirm:    () => doAction(
        {
          action:     'STOCK_CHECKED',
          extra_data: { has_stock: hasStock },
          comments:   hasStock
            ? 'Stock verificado — hay disponibilidad en almacén.'
            : 'Sin stock disponible. Se requiere compra.',
        },
        hasStock
          ? 'Stock confirmado. El pedido ha sido derivado al Almacén.'
          : 'Registrado como Requiere Compra. Puede proceder a solicitar cotizaciones.'
      ),
    });
  }

  function handleQuoteRequested() {
    requestConfirm({
      title:        'Confirmar Solicitud de Cotizaciones',
      message:      '¿Está seguro de solicitar cotizaciones a proveedores? El requerimiento pasará al estado "Cotizando".',
      confirmText:  'Sí, Solicitar',
      confirmColor: 'bg-blue-600 hover:bg-blue-700',
      icon:         ClipboardCheck,
      onConfirm:    () => doAction(
        {
          action:   'QUOTE_REQUESTED',
          comments: 'Cotizaciones solicitadas a proveedores.',
        },
        'Solicitud de cotizaciones registrada. El requerimiento pasa a estado Cotizando.'
      ),
    });
  }

  function handleQuoteSelected() {
    requestConfirm({
      title:        'Confirmar Selección de Cotización',
      message:      '¿Está seguro de seleccionar este proveedor y cotización? El requerimiento avanzará a "Cotización Seleccionada".',
      confirmText:  'Sí, Seleccionar',
      confirmColor: 'bg-indigo-600 hover:bg-indigo-700',
      icon:         CheckCircle2,
      onConfirm:    () => doAction(
        {
          action:   'QUOTE_SELECTED',
          comments: 'Proveedor y cotización seleccionados.',
        },
        'Cotización seleccionada. Puede proceder a generar la Orden de Compra.'
      ),
    });
  }

  function handlePOGenerated(withinBudget) {
    requestConfirm({
      title:        withinBudget ? 'Confirmar Generación de Orden de Compra' : 'Confirmar Exceso de Presupuesto',
      message:      withinBudget
        ? '¿Está seguro de generar la Orden de Compra? El monto está dentro del presupuesto aprobado.'
        : '¿Confirma que el monto supera el presupuesto aprobado? Se derivará al Gerente General para revisión de sobrecosto.',
      confirmText:  withinBudget ? 'Sí, Generar Orden' : 'Sí, Derivar a GG',
      confirmColor: withinBudget ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-500 hover:bg-amber-600',
      icon:         withinBudget ? Package : AlertCircle,
      onConfirm:    () => doAction(
        {
          action:     'PO_GENERATED',
          extra_data: { within_budget: withinBudget },
          comments:   withinBudget
            ? 'Orden de compra generada dentro del presupuesto.'
            : 'Monto supera presupuesto aprobado. Requiere aprobación de Gerencia General.',
        },
        withinBudget
          ? 'Orden de Compra generada correctamente.'
          : 'Derivado a Revisión de Sobrecosto por Gerencia General.'
      ),
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;

  if (notFound || !req) {
    return (
      <div className="flex flex-col items-center justify-center min-h-96 text-center">
        <AlertCircle size={48} className="text-red-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Requerimiento no encontrado</h2>
        <button
          onClick={() => navigate('/rq/logistics')}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          Volver al Panel Logístico
        </button>
      </div>
    );
  }

  const rqNumber  = req.rq_number ?? req.rqNumber;
  const items     = req.items ?? [];
  const reqStatus = req.status;

  // Show stock columns only when doing the stock check step
  const showStock = [STATUS.VALIDATED, STATUS.STOCK_CHECK].includes(reqStatus);

  // Determine which action panel to render
  function renderActionPanel() {
    switch (reqStatus) {
      case STATUS.VALIDATED:
      case STATUS.STOCK_CHECK:
        return (
          <StockCheckPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleStockCheck}
          />
        );
      case STATUS.REQUIRES_PURCHASE:
        return (
          <RequestQuotesPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleQuoteRequested}
          />
        );
      case STATUS.QUOTING:
        return (
          <SelectQuotePanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleQuoteSelected}
          />
        );
      case STATUS.QUOTE_SELECTED:
        return (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <h3 className="text-base font-bold text-blue-900">Proveedor Seleccionado</h3>
            <p className="text-sm text-blue-700">
              La cotización fue enviada a <strong>Control de Proyecto</strong> para verificar si está dentro del presupuesto.
            </p>
            <p className="text-xs text-blue-500">
              Cuando Control apruebe, podrás generar la Orden de Compra.
            </p>
            <button
              onClick={() => navigate('/rq/logistics')}
              className="mt-3 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Volver a Logística
            </button>
          </div>
        );
      case 'COST_OVERRUN_APPROVED':
        return (
          <GeneratePOPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handlePOGenerated}
          />
        );
      case STATUS.PO_GENERATED:
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Recepción del Requerimiento</h3>
            <p className="text-sm text-gray-500">El proveedor entregó los materiales. Registre la recepción.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones de recepción, N° guía del proveedor..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Recepción de Materiales',
                message:      '¿Confirma que los materiales han sido recibidos del proveedor? Se registrará la recepción y pasará a verificación de conformidad.',
                confirmText:  'Sí, Registrar Recepción',
                confirmColor: 'bg-teal-600 hover:bg-teal-700',
                icon:         Package,
                onConfirm:    () => doAction(
                  { action: 'RECEIVED', comments: notes.trim() || 'Materiales recibidos del proveedor.' },
                  'Recepción registrada. Proceda a verificar conformidad.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Registrando...' : 'Registrar Recepción de Materiales'}
            </button>
          </div>
        );
      case STATUS.RECEIVING:
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Verificación de Conformidad</h3>
            <p className="text-sm text-gray-500">Verifique que los materiales recibidos cumplan con lo solicitado en la Orden de Compra.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones del control de conformidad..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Conformidad',
                message:      '¿Confirma que los materiales recibidos son conformes con la Orden de Compra? Se procederá a la entrega al Almacén.',
                confirmText:  'Sí, Conforme',
                confirmColor: 'bg-green-600 hover:bg-green-700',
                icon:         CheckCircle2,
                onConfirm:    () => doAction(
                  { action: 'QUALITY_APPROVED', comments: notes.trim() || 'Materiales conformes. Todo correcto.' },
                  'Conformidad aprobada. Proceda a entregar a Almacén.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Conforme — Entregar a Almacén'}
            </button>
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar No Conformidad',
                message:      '¿Confirma que los materiales no cumplen con los requisitos? Se generará un reclamo al proveedor.',
                confirmText:  'Sí, Generar Reclamo',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon:         XCircle,
                onConfirm:    () => doAction(
                  { action: 'QUALITY_REJECTED', comments: notes.trim() || 'Materiales no conformes. Reclamo al proveedor.' },
                  'Reclamo registrado. Se gestionará el cambio con el proveedor.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'No Conforme — Reclamo al Proveedor'}
            </button>
          </div>
        );
      case STATUS.QUALITY_APPROVED:
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Entrega a Almacén</h3>
            <p className="text-sm text-gray-500">Los materiales están conformes. Entregue al Almacén Central para su registro.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="N° guía de despacho, observaciones..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Entrega a Almacén',
                message:      '¿Confirma la entrega de los materiales al Almacén Central? El control pasará al equipo de almacén.',
                confirmText:  'Sí, Entregar',
                confirmColor: 'bg-blue-600 hover:bg-blue-700',
                icon:         Truck,
                onConfirm:    () => doAction(
                  { action: 'DISPATCHED', comments: notes.trim() || 'Materiales entregados a Almacén Central.' },
                  'Entrega registrada. Almacén tomará control de los materiales.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Entregar a Almacén Central'}
            </button>
          </div>
        );
      case STATUS.QUALITY_REJECTED:
        return (
          <div className="bg-white rounded-xl border-2 border-red-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-red-100">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-red-900">Materiales No Conformes</h3>
                <p className="text-xs text-red-600">Gestione el reclamo al proveedor</p>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalle del reclamo: qué items fallaron, motivo..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Envío de Reclamo',
                message:      '¿Está seguro de enviar un reclamo formal al proveedor? Se registrará el rechazo y se iniciará el proceso de reposición.',
                confirmText:  'Sí, Enviar Reclamo',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon:         XCircle,
                onConfirm:    () => doAction(
                  { action: 'SUPPLIER_CLAIM_SENT', comments: notes.trim() || 'Reclamo formal enviado al proveedor.' },
                  'Reclamo enviado al proveedor. Esperando respuesta.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Enviando...' : 'Enviar Reclamo al Proveedor'}
            </button>
          </div>
        );
      case 'SUPPLIER_CLAIM_SENT':
        return (
          <div className="bg-white rounded-xl border-2 border-amber-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-amber-100">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-amber-900">Reclamo Enviado</h3>
                <p className="text-xs text-amber-600">Esperando respuesta del proveedor</p>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Actualización del estado: respuesta del proveedor, fecha estimada de reposición..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Actualización de Reclamo',
                message:      '¿Desea actualizar el estado del reclamo con las notas ingresadas?',
                confirmText:  'Sí, Actualizar',
                confirmColor: 'bg-amber-500 hover:bg-amber-600',
                onConfirm:    () => doAction(
                  { action: 'SUPPLIER_CLAIM_UPDATED', comments: notes.trim() || 'Estado del reclamo actualizado.' },
                  'Estado actualizado. Pendiente de reposición.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 transition-all disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Actualizar Estado del Reclamo'}
            </button>
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Recepción de Reposición',
                message:      '¿Confirma que el proveedor ha enviado los materiales de reemplazo? Se procederá a verificar la calidad.',
                confirmText:  'Sí, Registrar',
                confirmColor: 'bg-teal-600 hover:bg-teal-700',
                icon:         Package,
                onConfirm:    () => doAction(
                  { action: 'SUPPLIER_REPLACEMENT_RECEIVED', comments: notes.trim() || 'Reposición recibida del proveedor.' },
                  'Reposición recibida. Verifique la calidad.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white text-sm font-bold rounded-xl hover:bg-teal-700 transition-all disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Proveedor Envió Reposición — Recibir'}
            </button>
          </div>
        );
      case 'SUPPLIER_CLAIM_PENDING':
        return (
          <div className="bg-white rounded-xl border-2 border-amber-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-amber-100">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-amber-900">Pendiente de Reposición</h3>
                <p className="text-xs text-amber-600">Esperando que el proveedor envíe los materiales de reemplazo</p>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Notas sobre la reposición..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Reposición Recibida',
                message:      '¿Confirma que el proveedor ha entregado los materiales de reemplazo? Se procederá a verificar la calidad nuevamente.',
                confirmText:  'Sí, Registrar Reposición',
                confirmColor: 'bg-teal-600 hover:bg-teal-700',
                icon:         Package,
                onConfirm:    () => doAction(
                  { action: 'SUPPLIER_REPLACEMENT_RECEIVED', comments: notes.trim() || 'Reposición recibida del proveedor.' },
                  'Reposición recibida. Verifique la calidad.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Reposición Recibida del Proveedor'}
            </button>
          </div>
        );
      case 'SUPPLIER_REPLACEMENT_RECEIVED':
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Verificación de Reposición</h3>
            <p className="text-sm text-gray-500">El proveedor envió materiales de reemplazo. Verifique la calidad nuevamente.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones de la verificación..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Conformidad de Reposición',
                message:      '¿Confirma que los materiales de reemplazo son conformes? Se procederá a la entrega al Almacén.',
                confirmText:  'Sí, Aceptar',
                confirmColor: 'bg-green-600 hover:bg-green-700',
                icon:         CheckCircle2,
                onConfirm:    () => doAction(
                  { action: 'QUALITY_APPROVED', comments: notes.trim() || 'Reposición conforme. Materiales aceptados.' },
                  'Calidad aprobada. Proceda a entregar a Almacén.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'Conforme — Aceptar Reposición'}
            </button>
            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Rechazo de Reposición',
                message:      '¿Confirma que los materiales de reemplazo tampoco son conformes? Se generará un segundo reclamo al proveedor.',
                confirmText:  'Sí, Rechazar',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon:         XCircle,
                onConfirm:    () => doAction(
                  { action: 'QUALITY_REJECTED', comments: notes.trim() || 'Reposición no conforme. Segundo reclamo.' },
                  'Rechazado nuevamente. Se generará otro reclamo.'
                ),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              {submitting ? 'Guardando...' : 'No Conforme — Rechazar Nuevamente'}
            </button>
          </div>
        );
      case STATUS.IN_STOCK:
        return <InStockPanel navigate={navigate} />;
      default:
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-500">
              No hay acciones disponibles para el estado actual de este requerimiento.
            </p>
            <button
              onClick={() => navigate('/rq/logistics')}
              className="mt-4 text-sm text-blue-600 hover:underline"
            >
              Volver al Panel Logístico
            </button>
          </div>
        );
    }
  }

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate('/rq/logistics')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />
        Panel Logístico
      </button>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700">Error al procesar la acción</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red-400 hover:text-red-600"
          >
            <XCircle size={18} />
          </button>
        </div>
      )}

      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <Truck size={26} className="text-teal-600" />
            Gestión Logística
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-mono font-semibold text-teal-700">{rqNumber}</span>
            {' '}— {req.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PriorityBadge priority={req.priority} />
          <StatusBadge status={reqStatus} />
        </div>
      </div>

      {/* Progress bar */}
      <LogisticsProgressBar currentStatus={reqStatus} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: RQ details */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              Información del Requerimiento
            </h2>
            <InfoRow
              icon={Building2}
              label="Proyecto"
              value={`${req.project_code ?? req.projectCode ?? ''} — ${req.project_name ?? req.projectName ?? ''}`}
            />
            <InfoRow
              icon={User}
              label="Solicitante"
              value={req.requested_by_name ?? req.requestedByName}
            />
            <InfoRow
              icon={Calendar}
              label="Fecha Requerida"
              value={formatDate(req.fecha_necesidad ?? req.required_date ?? req.requiredDate)}
            />
            {(req.work_location ?? req.workLocation) && (
              <InfoRow
                icon={MapPin}
                label="Ubicación"
                value={req.work_location ?? req.workLocation}
              />
            )}
            {(req.estimated_cost ?? req.estimatedCost) && (
              <InfoRow
                icon={Package}
                label="Costo Estimado"
                value={formatCurrency(req.estimated_cost ?? req.estimatedCost)}
              />
            )}
            {req.justification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Justificación
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items table */}
          <ItemsTable items={items} showStock={showStock} />
        </div>

        {/* RIGHT: Action panel */}
        <div className="lg:col-span-2">
          {renderActionPanel()}
        </div>
      </div>
    </div>

    {/* Confirm modal */}
    {confirmModal && (
      <ConfirmModal
        isOpen
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        confirmColor={confirmModal.confirmColor}
        icon={confirmModal.icon}
        onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
        onCancel={() => setConfirmModal(null)}
      />
    )}
    </>
  );
}
