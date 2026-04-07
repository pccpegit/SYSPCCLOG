import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckSquare,
  Square,
  AlertCircle,
  XCircle,
  CheckCircle2,
  User,
  Building2,
  Calendar,
  MapPin,
  Paperclip,
  ClipboardList,
} from 'lucide-react';
import { ROLES } from '../../data/constants';
import { useAuth } from '../../context/AuthContext';
import { getRequests, getRequest, performAction } from '../../api/requests';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../context/ToastContext';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
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

const CHECKLIST_ITEMS = [
  { key: 'specsReviewed',     label: 'Especificaciones técnicas revisadas y conformes'      },
  { key: 'quantitiesOk',      label: 'Cantidades verificadas contra el metrado / expediente' },
  { key: 'feasible',          label: 'Ítems técnicamente factibles para la etapa de obra'   },
  { key: 'needsModification', label: 'Requiere modificación o corrección antes de aprobar' },
];

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

export default function TechReviewPage() {
  const { id }          = useParams();
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }   = useToast();

  const [req,       setReq]       = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [notFound,  setNotFound]  = useState(false);
  const [checklist, setChecklist] = useState({
    specsReviewed:     false,
    quantitiesOk:      false,
    feasible:          false,
    needsModification: false,
  });
  const [notes,         setNotes]         = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState(null);
  const [confirmModal,  setConfirmModal]  = useState(null);

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

  function toggleCheck(key) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleDecision(approved) {
    setSubmitting(true);
    setError(null);
    try {
      await performAction(req.id, {
        action:      approved ? 'TECHNICAL_APPROVED' : 'TECHNICAL_REJECTED',
        acting_role: ROLES.PROJECT_RESIDENT,
        comments:    notes.trim() || (approved ? 'Aprobación técnica conforme.' : 'Rechazado técnicamente.'),
      });
      showToast({
        type:    approved ? 'success' : 'info',
        message: approved
          ? 'Aprobación técnica registrada. El requerimiento avanza a Revisión Presupuestal.'
          : 'Rechazo técnico registrado. El solicitante será notificado.',
      });
      setTimeout(() => navigate('/rq/approvals'), 250);
    } catch (err) {
      console.error('Error performing action:', err);
      const detail = err?.response?.data?.detail ?? err?.response?.data ?? 'Error al procesar la acción.';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      setError(msg);
      showToast({ type: 'error', message: msg });
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  if (notFound || !req) {
    return (
      <div className="flex flex-col items-center justify-center min-h-96 text-center">
        <AlertCircle size={48} className="text-red-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Requerimiento no encontrado</h2>
        <button onClick={() => navigate('/rq')} className="mt-4 text-sm text-blue-600 hover:underline">
          Ir al Dashboard
        </button>
      </div>
    );
  }

  const rqNumber = req.rq_number ?? req.rqNumber;
  const items    = req.items ?? [];
  const checkedCount = Object.values(checklist).filter(Boolean).length;
  const isAdditionalReview = req.status === 'ADDITIONAL_REQ';

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />
        Volver
      </button>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Additional review banner */}
      {isAdditionalReview && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl">
          <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">Requerimiento Adicional — No contemplado en la propuesta</p>
            <p className="text-xs text-amber-700 mt-1">
              Control de Proyecto ha clasificado este requerimiento como <strong>adicional</strong> (no estaba en la propuesta original del proyecto).
              Como Residente, debe evaluar si este requerimiento es <strong>necesario para la operación</strong> a pesar de no estar presupuestado.
            </p>
          </div>
        </div>
      )}

      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <ClipboardList size={26} className={isAdditionalReview ? 'text-amber-500' : 'text-yellow-500'} />
            {isAdditionalReview ? 'Evaluación de Necesidad — Adicional' : 'Revisión Técnica'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-mono font-semibold text-blue-700">{rqNumber}</span>
            {' '}— {req.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={req.priority} />
          <StatusBadge status={req.status} />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5" id="tech-review-layout">
        {/* LEFT: Request detail (read-only) */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Información del Requerimiento</h2>
            <InfoRow
              icon={Building2}
              label="Proyecto"
              value={`${req.project_code ?? req.projectCode ?? ''} — ${req.project_name ?? req.projectName ?? ''}`}
            />
            <InfoRow icon={User}     label="Solicitante"     value={req.requested_by_name ?? req.requestedByName} />
            <InfoRow icon={Calendar} label="Fecha Requerida" value={formatDate(req.fecha_necesidad ?? req.required_date ?? req.requiredDate)} />
            {(req.work_location ?? req.workLocation) && (
              <InfoRow icon={MapPin} label="Ubicación" value={req.work_location ?? req.workLocation} />
            )}
            {req.justification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Justificación</p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-800">
                Ítems a Revisar ({items.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cant.</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">Especificaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.line_number ?? item.lineNumber ?? idx} className={`border-b border-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}>
                      <td className="py-3 px-4 text-gray-400 font-mono text-xs">{item.line_number ?? item.lineNumber ?? idx + 1}</td>
                      <td className="py-3 px-4 text-gray-800 font-medium leading-snug">{item.description}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{item.quantity}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{item.unit}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs hidden md:table-cell leading-snug">
                        {item.specifications}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-400 italic text-sm">
                        Sin ítems registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Attachments placeholder */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Paperclip size={16} className="text-gray-400" />
              Documentos Adjuntos
            </h2>
            <div className="border-2 border-dashed border-gray-200 rounded-lg py-8 text-center">
              <Paperclip size={24} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No hay documentos adjuntos en este requerimiento.</p>
              <p className="text-xs text-gray-300 mt-1">Los planos y memorias descriptivas se adjuntan en el sistema ERP.</p>
            </div>
          </div>
        </div>

        {/* RIGHT: Review panel */}
        <div className="lg:col-span-2 space-y-5">
          {/* Checklist */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-1">Lista de Verificación Técnica</h2>
            <p className="text-xs text-gray-400 mb-4">
              {checkedCount} de {CHECKLIST_ITEMS.length} ítems verificados
            </p>

            <div className="space-y-3">
              {CHECKLIST_ITEMS.map((item) => {
                const checked = checklist[item.key];
                const isWarning = item.key === 'needsModification';
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleCheck(item.key)}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                      checked
                        ? isWarning
                          ? 'bg-red-50 border-red-200'
                          : 'bg-green-50 border-green-200'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {checked ? (
                      isWarning
                        ? <XCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                        : <CheckSquare size={18} className="text-green-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square size={18} className="text-gray-300 shrink-0 mt-0.5" />
                    )}
                    <span className={`text-sm leading-snug ${
                      checked
                        ? isWarning ? 'text-red-700 font-medium' : 'text-green-700 font-medium'
                        : 'text-gray-700'
                    }`}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Notas del Residente
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Observaciones técnicas, condiciones de aprobación, correcciones solicitadas..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-400 transition-colors resize-none"
            />
            <p className="mt-1 text-xs text-gray-400">{notes.length} / 500 caracteres</p>
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {isAdditionalReview ? 'Evaluación de Necesidad' : 'Decisión de Revisión'}
            </h2>

            <button
              type="button"
              onClick={() => requestConfirm({
                title:        isAdditionalReview ? 'Confirmar que NO es necesario' : 'Confirmar Rechazo Técnico',
                message:      isAdditionalReview
                  ? '¿Confirma que este requerimiento adicional NO es necesario para la operación? El proceso finalizará.'
                  : '¿Está seguro de rechazar técnicamente este requerimiento? El solicitante será notificado.',
                confirmText:  isAdditionalReview ? 'No es necesario — Finalizar' : 'Sí, Rechazar',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon:         XCircle,
                onConfirm:    () => handleDecision(false),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              <XCircle size={20} />
              {isAdditionalReview ? 'No es Necesario — Rechazar' : 'Rechazar Técnicamente'}
            </button>

            <button
              type="button"
              onClick={() => requestConfirm({
                title:        isAdditionalReview ? 'Confirmar que SÍ es necesario' : 'Confirmar Aprobación Técnica',
                message:      isAdditionalReview
                  ? '¿Confirma que este requerimiento es NECESARIO a pesar de no estar en la propuesta? Se enviará al Gerente General para su autorización.'
                  : '¿Está seguro de aprobar técnicamente? El pedido avanzará a la clasificación presupuestal.',
                confirmText:  isAdditionalReview ? 'Sí, es necesario — Enviar a Gerencia' : 'Sí, Aprobar',
                confirmColor: isAdditionalReview ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700',
                icon:         CheckCircle2,
                onConfirm:    () => handleDecision(true),
              })}
              disabled={submitting || (!isAdditionalReview && checklist.needsModification)}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-white text-base font-bold rounded-xl hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md ${
                isAdditionalReview ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              <CheckCircle2 size={20} />
              {submitting ? 'Guardando...' : isAdditionalReview ? 'Sí es Necesario — Enviar a Gerencia' : 'Aprobar Técnicamente'}
            </button>

            {!isAdditionalReview && checklist.needsModification && (
              <p className="text-xs text-red-600 text-center">
                Ha marcado que requiere modificación. Corrija o use "Rechazar".
              </p>
            )}

            <p className="text-xs text-gray-400 text-center pt-1">
              Esta acción quedará registrada en el historial del requerimiento.
            </p>
          </div>
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
