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
  Package,
  ClipboardCheck,
  Truck,
  ArrowRight,
  Info,
  Warehouse,
  ShieldCheck,
  ShieldX,
  SendHorizonal,
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
// Loading spinner
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoRow
// ─────────────────────────────────────────────────────────────────────────────

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
// Warehouse progress bar — 4 steps
// ─────────────────────────────────────────────────────────────────────────────

const WAREHOUSE_STEPS = [
  {
    key:      'reception',
    label:    'Recepción',
    statuses: [STATUS.PO_GENERATED, STATUS.IN_STOCK, STATUS.RECEIVING],
    icon:     Package,
  },
  {
    key:      'qc',
    label:    'Control Calidad',
    statuses: [STATUS.QUALITY_APPROVED, STATUS.QUALITY_REJECTED],
    icon:     ClipboardCheck,
  },
  {
    key:      'dispatch',
    label:    'Despacho',
    statuses: [STATUS.DISPATCHED_TO_SITE],
    icon:     Truck,
  },
  {
    key:      'delivery',
    label:    'Entrega',
    statuses: [STATUS.DELIVERED, STATUS.WAREHOUSE_UPDATED],
    icon:     CheckCircle2,
  },
];

function getWarehouseStepIndex(status) {
  // Completed statuses map to the step they finished, so mark the NEXT step as active
  if ([STATUS.DELIVERED, STATUS.WAREHOUSE_UPDATED].includes(status)) return 4; // all done
  if ([STATUS.DISPATCHED_TO_SITE].includes(status)) return 3;       // delivery is active
  if ([STATUS.QUALITY_APPROVED, STATUS.QUALITY_REJECTED].includes(status)) return 2; // dispatch active
  if ([STATUS.RECEIVING].includes(status)) return 1;                // QC is active
  // PO_GENERATED, IN_STOCK — reception is active
  return 0;
}

function WarehouseProgressBar({ currentStatus }) {
  const activeIdx = getWarehouseStepIndex(currentStatus);
  const allDone   = activeIdx >= WAREHOUSE_STEPS.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
        Etapa de Almacén
      </p>
      <div className="flex items-center gap-0">
        {WAREHOUSE_STEPS.map((step, idx) => {
          const StepIcon  = step.icon;
          const isDone    = allDone || idx < activeIdx;
          const isActive  = !allDone && idx === activeIdx;

          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
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
                    className={isDone || isActive ? 'text-white' : 'text-gray-300'}
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

              {idx < WAREHOUSE_STEPS.length - 1 && (
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
// Items table — warehouse variant (no stock columns needed here)
// ─────────────────────────────────────────────────────────────────────────────

function ItemsTable({ items, qcChecked, onQcToggle, showQC }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">
          Ítems del Requerimiento ({items.length})
        </h2>
        {showQC && (
          <p className="text-xs text-gray-400 mt-0.5">
            Marque los ítems con observaciones de calidad.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {showQC && (
                <th className="py-2.5 px-4 text-center text-xs font-semibold text-gray-500 w-10">
                  Obs.
                </th>
              )}
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
              <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cantidad</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">
                Especificaciones
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const lineNum = item.line_number ?? item.lineNumber ?? idx + 1;
              const hasIssue = qcChecked?.has(lineNum);
              return (
                <tr
                  key={lineNum}
                  className={`border-b border-gray-50 ${
                    hasIssue ? 'bg-red-50/60' : idx % 2 !== 0 ? 'bg-gray-50/40' : ''
                  }`}
                >
                  {showQC && (
                    <td className="py-3 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={hasIssue || false}
                        onChange={() => onQcToggle(lineNum)}
                        className="w-4 h-4 rounded border-gray-300 text-red-500 focus:ring-red-400 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="py-3 px-4 text-gray-400 font-mono text-xs">{lineNum}</td>
                  <td className="py-3 px-4 text-gray-800 font-medium leading-snug">
                    {item.description}
                    {hasIssue && (
                      <span className="ml-2 text-xs font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                        Con observacion
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-700 font-semibold">
                    {item.quantity}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                      {item.unit}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs hidden md:table-cell leading-snug">
                    {item.specifications ?? '—'}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={showQC ? 6 : 5}
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
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function NotesField({ value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Notas / Observaciones
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder ?? 'Observaciones, condiciones, referencias...'}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 hover:border-gray-400 transition-colors resize-none"
      />
      <p className="mt-1 text-xs text-gray-400">{value.length} / 500 caracteres</p>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 hover:border-gray-400 transition-colors"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action panels
// ─────────────────────────────────────────────────────────────────────────────

// PO_GENERATED or IN_STOCK — register physical reception
function ReceptionPanel({ submitting, notes, onNotes, guideNumber, onGuide, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Recepcion Pendiente</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Registre la recepcion fisica de los materiales. Ingrese el numero de guia de
            remision del proveedor.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Datos de Recepcion</h2>

        <TextField
          label="Numero de guia de remision *"
          value={guideNumber}
          onChange={onGuide}
          placeholder="Ej. GR-2024-00123"
        />

        <NotesField
          value={notes}
          onChange={onNotes}
          placeholder="Estado del embalaje, condiciones de entrega, proveedor transportista..."
        />

        <button
          type="button"
          onClick={onAction}
          disabled={submitting || !guideNumber.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <Warehouse size={20} />
          {submitting ? 'Procesando...' : 'Registrar Recepcion de Materiales'}
        </button>

        {!guideNumber.trim() && (
          <p className="text-xs text-amber-600 text-center">
            Ingrese el numero de guia de remision para continuar.
          </p>
        )}
      </div>
    </div>
  );
}

// RECEIVING — quality control per item
function QualityControlPanel({ submitting, notes, onNotes, qcChecked, onQcToggle, onApprove, onReject }) {
  const hasIssues = qcChecked.size > 0;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Control de Calidad</p>
          <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
            Revise cada item de la tabla. Marque los items con observaciones. Si todo esta
            conforme, apruebe la calidad. Si hay problemas graves, genere el reclamo.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Resultado del Control de Calidad</h2>

        {hasIssues && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle size={14} className="text-red-500 shrink-0" />
            <p className="text-xs text-red-700 font-medium">
              {qcChecked.size} item{qcChecked.size !== 1 ? 's' : ''} con observaciones marcado{qcChecked.size !== 1 ? 's' : ''}.
            </p>
          </div>
        )}

        <NotesField
          value={notes}
          onChange={onNotes}
          placeholder="Observaciones generales del control de calidad, condicion de los materiales..."
        />

        <button
          type="button"
          onClick={onApprove}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <ShieldCheck size={20} />
          {submitting ? 'Procesando...' : 'Calidad Aprobada - Todo Conforme'}
        </button>

        <button
          type="button"
          onClick={onReject}
          disabled={submitting || !hasIssues}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <ShieldX size={20} />
          {submitting ? 'Procesando...' : 'Calidad Rechazada - Generar Reclamo'}
        </button>

        {!hasIssues && (
          <p className="text-xs text-gray-400 text-center">
            Para rechazar por calidad, marque al menos un item con observaciones en la tabla.
          </p>
        )}
      </div>
    </div>
  );
}

// QUALITY_APPROVED — dispatch to site
function DispatchPanel({ submitting, notes, onNotes, dispatchNumber, onDispatch, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-indigo-800">Calidad Aprobada - Listo para Despacho</p>
          <p className="text-xs text-indigo-700 mt-0.5 leading-relaxed">
            Los materiales pasaron el control de calidad. Registre el despacho al almacen de obra
            con la guia de despacho correspondiente.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Datos de Despacho</h2>

        <TextField
          label="Numero de guia de despacho *"
          value={dispatchNumber}
          onChange={onDispatch}
          placeholder="Ej. GD-2024-00456"
        />

        <NotesField
          value={notes}
          onChange={onNotes}
          placeholder="Transportista, vehiculo, observaciones de carga..."
        />

        <button
          type="button"
          onClick={onAction}
          disabled={submitting || !dispatchNumber.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <Truck size={20} />
          {submitting ? 'Procesando...' : 'Despachar a Almacen de Obra'}
        </button>

        {!dispatchNumber.trim() && (
          <p className="text-xs text-amber-600 text-center">
            Ingrese el numero de guia de despacho para continuar.
          </p>
        )}
      </div>
    </div>
  );
}

// DISPATCHED_TO_SITE — site warehouse confirms delivery
function SiteReceptionPanel({ submitting, notes, onNotes, onAction }) {
  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3">
        <Info size={16} className="text-teal-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-teal-800">Materiales en Camino - Confirmar Recepcion en Obra</p>
          <p className="text-xs text-teal-700 mt-0.5 leading-relaxed">
            Los materiales han sido despachados desde almacen central. Confirme la recepcion
            fisica en la obra y actualice los registros del almacen de obra.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Confirmacion de Recepcion en Obra</h2>

        <NotesField
          value={notes}
          onChange={onNotes}
          placeholder="Estado de los materiales al llegar, ubicacion en obra, responsable de recepcion..."
        />

        <button
          type="button"
          onClick={onAction}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <SendHorizonal size={20} />
          {submitting ? 'Procesando...' : 'Confirmar Recepcion en Obra'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Esta accion cierra el ciclo de entrega y actualiza los registros del almacen.
        </p>
      </div>
    </div>
  );
}

// Terminal states — success
function DeliveredPanel({ navigate }) {
  return (
    <div className="bg-green-50 border border-green-300 rounded-xl p-6 flex flex-col items-center text-center gap-3">
      <CheckCircle2 size={44} className="text-green-500" />
      <p className="text-base font-bold text-green-800">Materiales entregados exitosamente</p>
      <p className="text-sm text-green-700 max-w-xs leading-relaxed">
        La entrega ha sido confirmada y los registros del almacen de obra han sido actualizados.
      </p>
      <button
        type="button"
        onClick={() => navigate('/rq/warehouse')}
        className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors"
      >
        Volver al Panel de Almacen
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

// Terminal state — quality rejected
function QualityRejectedPanel({ navigate }) {
  return (
    <div className="bg-red-50 border border-red-300 rounded-xl p-6 flex flex-col items-center text-center gap-3">
      <ShieldX size={44} className="text-red-400" />
      <p className="text-base font-bold text-red-800">Materiales rechazados por calidad</p>
      <p className="text-sm text-red-700 max-w-xs leading-relaxed">
        Se ha generado un reclamo al proveedor. El equipo de logistica gestionara la devolucion
        o reposicion de los materiales.
      </p>
      <button
        type="button"
        onClick={() => navigate('/rq/warehouse')}
        className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors"
      >
        Volver al Panel de Almacen
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function WarehouseActionPage() {
  const { id }          = useParams();
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }   = useToast();

  const [req,             setReq]             = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [notFound,        setNotFound]        = useState(false);
  const [notes,           setNotes]           = useState('');
  const [guideNumber,     setGuideNumber]     = useState('');
  const [dispatchNumber,  setDispatchNumber]  = useState('');
  const [qcChecked,       setQcChecked]       = useState(new Set());
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState(null);
  const [confirmModal,    setConfirmModal]    = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

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

  // QC checkbox toggle
  function handleQcToggle(lineNum) {
    setQcChecked((prev) => {
      const next = new Set(prev);
      if (next.has(lineNum)) {
        next.delete(lineNum);
      } else {
        next.add(lineNum);
      }
      return next;
    });
  }

  // Central action dispatcher
  async function doAction(actionData, successMessage) {
    setSubmitting(true);
    setError(null);
    try {
      await performAction(req.id, {
        ...actionData,
        comments: actionData.comments || notes.trim() || '',
      });
      showToast({ type: 'success', message: successMessage });
      setTimeout(() => navigate('/rq/warehouse'), 250);
    } catch (err) {
      console.error('Error performing action:', err);
      const detail =
        err?.response?.data?.detail ??
        err?.response?.data ??
        'Error al procesar la accion.';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      setError(msg);
      showToast({ type: 'error', message: msg });
      setSubmitting(false);
    }
  }

  // Determine acting role for each action
  function getActingRole(forceRole) {
    if (forceRole) return forceRole;
    return primaryRole ?? ROLES.CENTRAL_WAREHOUSE;
  }

  // Action handlers
  function handleReceived() {
    requestConfirm({
      title:        'Confirmar Recepcion en Almacen',
      message:      '¿Confirma la recepcion de los materiales en el Almacen Central? Se registrara la guia y la recepcion.',
      confirmText:  'Sí, Registrar Recepcion',
      confirmColor: 'bg-teal-600 hover:bg-teal-700',
      icon:         Package,
      onConfirm:    () => doAction(
        {
          action:      'RECEIVED',
          acting_role: getActingRole(ROLES.CENTRAL_WAREHOUSE),
          comments:    `Recibido. Guia: ${guideNumber.trim()}. ${notes.trim()}`.trim(),
        },
        'Recepcion de materiales registrada correctamente.'
      ),
    });
  }

  function handleQualityApproved() {
    requestConfirm({
      title:        'Confirmar Aprobacion de Calidad',
      message:      '¿Confirma que los materiales pasan el control de calidad y son conformes? El requerimiento avanzara a despacho.',
      confirmText:  'Sí, Aprobar Calidad',
      confirmColor: 'bg-green-600 hover:bg-green-700',
      icon:         ShieldCheck,
      onConfirm:    () => doAction(
        {
          action:      'QUALITY_APPROVED',
          acting_role: getActingRole(ROLES.CENTRAL_WAREHOUSE),
          comments:    notes.trim() || 'Control de calidad aprobado. Materiales conformes.',
        },
        'Calidad aprobada. El requerimiento avanza a despacho.'
      ),
    });
  }

  function handleQualityRejected() {
    requestConfirm({
      title:        'Confirmar Rechazo de Calidad',
      message:      '¿Confirma que los materiales no pasan el control de calidad? Se generara un reclamo al proveedor.',
      confirmText:  'Sí, Rechazar',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      icon:         ShieldX,
      onConfirm:    () => doAction(
        {
          action:      'QUALITY_REJECTED',
          acting_role: getActingRole(ROLES.CENTRAL_WAREHOUSE),
          comments:    notes.trim() || `Materiales rechazados. Items con observaciones: ${Array.from(qcChecked).join(', ')}.`,
        },
        'Calidad rechazada. Reclamo generado al proveedor.'
      ),
    });
  }

  function handleDispatched() {
    requestConfirm({
      title:        'Confirmar Despacho a Obra',
      message:      '¿Confirma el despacho de los materiales al almacen de obra? Se registrara la guia de despacho.',
      confirmText:  'Sí, Despachar',
      confirmColor: 'bg-blue-600 hover:bg-blue-700',
      icon:         SendHorizonal,
      onConfirm:    () => doAction(
        {
          action:      'DISPATCHED',
          acting_role: getActingRole(ROLES.CENTRAL_WAREHOUSE),
          comments:    `Despachado. Guia: ${dispatchNumber.trim()}. ${notes.trim()}`.trim(),
        },
        'Despacho a almacen de obra registrado correctamente.'
      ),
    });
  }

  function handleSiteReceived() {
    requestConfirm({
      title:        'Confirmar Recepcion en Obra',
      message:      '¿Confirma la recepcion de los materiales en el almacen de obra? Esta accion completara la entrega del requerimiento.',
      confirmText:  'Sí, Confirmar Entrega',
      confirmColor: 'bg-teal-600 hover:bg-teal-700',
      icon:         CheckCircle2,
      onConfirm:    () => doAction(
        {
          action:      'WAREHOUSE_RECORDS_UPDATED',
          acting_role: getActingRole(ROLES.SITE_WAREHOUSE),
          comments:    notes.trim() || 'Recibido en obra y registrado en almacen de obra.',
        },
        'Recepcion en obra confirmada. Entrega completada.'
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
          onClick={() => navigate('/rq/warehouse')}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          Volver al Panel de Almacen
        </button>
      </div>
    );
  }

  const rqNumber  = req.rq_number ?? req.rqNumber;
  const items     = req.items ?? [];
  const reqStatus = req.status;

  const showQC = reqStatus === STATUS.RECEIVING;

  function renderActionPanel() {
    switch (reqStatus) {
      case STATUS.PO_GENERATED:
      case STATUS.IN_STOCK:
        return (
          <ReceptionPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            guideNumber={guideNumber}
            onGuide={setGuideNumber}
            onAction={handleReceived}
          />
        );

      case STATUS.RECEIVING:
        return (
          <QualityControlPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            qcChecked={qcChecked}
            onQcToggle={handleQcToggle}
            onApprove={handleQualityApproved}
            onReject={handleQualityRejected}
          />
        );

      case STATUS.QUALITY_APPROVED:
        return (
          <DispatchPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            dispatchNumber={dispatchNumber}
            onDispatch={setDispatchNumber}
            onAction={handleDispatched}
          />
        );

      case STATUS.DISPATCHED_TO_SITE:
        return (
          <SiteReceptionPanel
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleSiteReceived}
          />
        );

      case STATUS.DELIVERED:
      case STATUS.WAREHOUSE_UPDATED:
        return <DeliveredPanel navigate={navigate} />;

      case STATUS.QUALITY_REJECTED:
        return <QualityRejectedPanel navigate={navigate} />;

      default:
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-500">
              No hay acciones disponibles para el estado actual de este requerimiento.
            </p>
            <button
              onClick={() => navigate('/rq/warehouse')}
              className="mt-4 text-sm text-blue-600 hover:underline"
            >
              Volver al Panel de Almacen
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
        onClick={() => navigate('/rq/warehouse')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />
        Panel de Almacen
      </button>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700">Error al procesar la accion</p>
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
            <Warehouse size={26} className="text-teal-600" />
            Gestion de Almacen
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
      <WarehouseProgressBar currentStatus={reqStatus} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: RQ details + items */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              Informacion del Requerimiento
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
                label="Ubicacion en Obra"
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
                  Justificacion
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items table */}
          <ItemsTable
            items={items}
            qcChecked={qcChecked}
            onQcToggle={handleQcToggle}
            showQC={showQC}
          />
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
