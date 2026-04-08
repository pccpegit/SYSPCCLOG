import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  XCircle,
  CheckCircle2,
  DollarSign,
  Building2,
  User,
  Calendar,
  TrendingUp,
  CheckCircle,
  PlusCircle,
} from 'lucide-react';
import { ROLES } from '../../data/constants';
import { useAuth } from '../../context/AuthContext';
import { getRequests, getRequest, performAction } from '../../api/requests';
import { getProject } from '../../api/core';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../context/ToastContext';

function formatCurrency(val) {
  if (!val && val !== 0) return 'S/ 0';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

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

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

export default function BudgetReviewPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }   = useToast();

  const [req,       setReq]       = useState(null);
  const [project,   setProject]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [notFound,  setNotFound]  = useState(false);
  const [submitting,setSubmitting]= useState(false);
  const [error,     setError]     = useState(null);

  const [estimatedCost,   setEstimatedCost]   = useState('');
  const [classification,  setClassification]  = useState('within'); // 'within' | 'additional'
  const [notes,           setNotes]           = useState('');
  const [confirmModal,    setConfirmModal]    = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

  useEffect(() => {
    const fetchData = async () => {
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
          return;
        }

        setReq(requestData);
        setEstimatedCost(String(requestData.estimated_cost ?? requestData.estimatedCost ?? ''));

        // Fetch project budget info
        const projectId = requestData.project ?? requestData.projectId;
        if (projectId) {
          try {
            const { data: proj } = await getProject(projectId);
            setProject(proj);
          } catch (_) {
            // Budget info unavailable — not fatal
          }
        }
      } catch (err) {
        console.error('Error fetching request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  // Detect if this is a quote cost review (QUOTE_SELECTED) or initial budget classification
  const isQuoteCostReview = req?.status === 'QUOTE_SELECTED';

  async function handleDecision(approved) {
    setSubmitting(true);
    setError(null);
    try {
      let action, actingRole, successMsg;

      if (isQuoteCostReview) {
        // Quote cost review — Control verifies if quoted price is within budget
        action = approved ? 'QUOTE_COST_APPROVED' : 'QUOTE_COST_REJECTED';
        actingRole = primaryRole;
        successMsg = approved
          ? 'Cotización aprobada. Logística procederá a generar la Orden de Compra.'
          : 'Cotización excede presupuesto. Se enviará al Gerente General para revisión.';
      } else {
        // Initial budget classification
        action = approved ? 'BUDGET_CLASSIFIED' : 'BUDGET_REJECTED';
        actingRole = primaryRole;
        const classLabel = classification === 'within' ? 'Dentro de Propuesta' : 'Requerimiento Adicional';
        successMsg = approved
          ? `Clasificación presupuestal: ${classLabel}. ${
              classification === 'additional'
                ? 'Pasará al Residente de Proyecto para reevaluar. Si aprueba, se enviará al Gerente General.'
                : 'Avanza a Logística.'
            }`
          : 'Rechazado presupuestalmente.';
      }

      const extraData = isQuoteCostReview
        ? {}
        : { classification: classification === 'within' ? 'BC_WITHIN_PROPOSAL' : 'BC_ADDITIONAL' };

      await performAction(req.id, {
        action,
        acting_role: actingRole,
        comments: notes.trim() || successMsg,
        extra_data: extraData,
      });

      showToast({ type: approved ? 'success' : 'info', message: successMsg });
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

  const rqNumber    = req.rq_number ?? req.rqNumber;
  const items       = req.items ?? [];
  const itemsTotal  = items.reduce((s, i) => s + (i.estimated_cost ?? i.estimatedCost ?? 0), 0);
  const reqCost     = req.estimated_cost ?? req.estimatedCost ?? 0;

  // Budget numbers
  const totalBudget  = project?.total_budget  ?? project?.totalBudget  ?? 0;
  const spentBudget  = project?.spent_budget  ?? project?.spentBudget  ?? 0;
  const available    = totalBudget - spentBudget;
  const usedPct      = totalBudget > 0 ? Math.min(Math.round((spentBudget / totalBudget) * 100), 100) : 0;
  const costNum      = parseFloat(estimatedCost) || 0;
  const projectedPct = totalBudget > 0 ? Math.min(Math.round(((spentBudget + costNum) / totalBudget) * 100), 100) : 0;
  const barColor     = usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-green-500';

  const projectCode = req.project_code ?? req.projectCode ?? project?.code ?? '';

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

      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <DollarSign size={26} className="text-purple-500" />
            Revisión Presupuestal
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
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: Request detail + items */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Información del Requerimiento</h2>
            <InfoRow icon={Building2} label="Proyecto"        value={`${req.project_code ?? req.projectCode ?? ''} — ${req.project_name ?? req.projectName ?? ''}`} />
            <InfoRow icon={User}      label="Solicitante"     value={req.requested_by_name ?? req.requestedByName} />
            <InfoRow icon={Calendar}  label="Fecha Requerida" value={formatDate(req.required_date ?? req.requiredDate)} />
            {req.justification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Justificación</p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items table with costs */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Ítems y Costos Estimados</h2>
              <span className="text-sm font-bold text-gray-800">{formatCurrency(itemsTotal || reqCost)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cant.</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Costo Est.</th>
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
                      <td className="py-3 px-4 text-right font-medium text-gray-700">
                        {(item.estimated_cost ?? item.estimatedCost) ? formatCurrency(item.estimated_cost ?? item.estimatedCost) : '—'}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-400 italic text-sm">Sin ítems.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td colSpan={4} className="py-3 px-4 text-right text-sm font-semibold text-gray-700">
                      Total Estimado
                    </td>
                    <td className="py-3 px-4 text-right text-sm font-bold text-gray-900">
                      {formatCurrency(itemsTotal || reqCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: Budget panel + actions */}
        <div className="lg:col-span-2 space-y-5">
          {/* Budget summary + cost input — only for quote cost review (step 12) */}
          {isQuoteCostReview && totalBudget > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-purple-500" />
                Resumen Presupuestal — {projectCode}
              </h2>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Presupuesto</p>
                  <p className="text-sm font-bold text-gray-800">{formatCurrency(totalBudget)}</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-xs text-amber-600 mb-1">Ejecutado</p>
                  <p className="text-sm font-bold text-amber-700">{formatCurrency(spentBudget)}</p>
                </div>
                <div className={`text-center p-3 rounded-lg ${available > 0 ? 'bg-green-50 border border-green-100' : 'bg-red-50 border border-red-100'}`}>
                  <p className={`text-xs mb-1 ${available > 0 ? 'text-green-600' : 'text-red-600'}`}>Disponible</p>
                  <p className={`text-sm font-bold ${available > 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(available)}
                  </p>
                </div>
              </div>

              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>Ejecución actual: {usedPct}%</span>
                {costNum > 0 && (
                  <span className="text-purple-600 font-medium">Con este RQ: {projectedPct}%</span>
                )}
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 relative overflow-hidden">
                <div className={`${barColor} h-3 rounded-full transition-all duration-300`} style={{ width: `${usedPct}%` }} />
                {costNum > 0 && (
                  <div
                    className="absolute top-0 h-3 bg-purple-400 opacity-50 rounded-r-full"
                    style={{ left: `${usedPct}%`, width: `${Math.min(projectedPct - usedPct, 100 - usedPct)}%` }}
                  />
                )}
              </div>
              {costNum > available && (
                <p className="mt-2 text-xs text-red-600 font-medium">
                  Este requerimiento supera el presupuesto disponible por {formatCurrency(costNum - available)}.
                </p>
              )}
            </div>
          )}

          {isQuoteCostReview && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Monto de la Cotización Seleccionada (S/)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">S/</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 hover:border-gray-400 transition-colors text-right font-medium"
                  placeholder="0.00"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Costo estimado original del RQ: {formatCurrency(reqCost)}
              </p>
            </div>
          )}

          {/* Classification */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              {isQuoteCostReview
                ? '¿La cotización está dentro del presupuesto?'
                : '¿Este requerimiento estaba contemplado en la propuesta del proyecto?'}
            </h2>
            <div className="space-y-3">
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                classification === 'within' ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}>
                <input
                  type="radio" name="classification" value="within"
                  checked={classification === 'within'}
                  onChange={() => setClassification('within')}
                  className="mt-1 accent-green-600"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle size={15} className="text-green-600" />
                    <span className="text-sm font-semibold text-green-800">Sí, está en la propuesta</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Los materiales/servicios solicitados estaban contemplados en la propuesta original del proyecto.
                  </p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                classification === 'additional' ? 'bg-orange-50 border-orange-300' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}>
                <input
                  type="radio" name="classification" value="additional"
                  checked={classification === 'additional'}
                  onChange={() => setClassification('additional')}
                  className="mt-1 accent-orange-600"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <PlusCircle size={15} className="text-orange-600" />
                    <span className="text-sm font-semibold text-orange-800">No, es un requerimiento adicional</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Este requerimiento NO estaba contemplado en la propuesta original. Se enviará al Residente de Proyecto para que evalúe si es necesario.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Notas de Control de Proyecto
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Justificación de la clasificación, observaciones, referencia a partida presupuestal..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 hover:border-gray-400 transition-colors resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {isQuoteCostReview ? 'Verificación de Costos' : 'Clasificación del Requerimiento'}
            </h2>

            {isQuoteCostReview ? (
              <>
                <button
                  type="button"
                  onClick={() => requestConfirm({
                    title:        'Confirmar Aprobación de Cotización',
                    message:      '¿Está seguro de aprobar esta cotización como dentro del presupuesto? Logística procederá a generar la Orden de Compra.',
                    confirmText:  'Sí, Aprobar',
                    confirmColor: 'bg-green-600 hover:bg-green-700',
                    icon:         CheckCircle2,
                    onConfirm:    () => handleDecision(true),
                  })}
                  disabled={submitting || classification !== 'within'}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-white text-base font-bold rounded-xl transition-all duration-200 shadow-md ${
                    classification === 'within'
                      ? 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                      : 'bg-gray-300 cursor-not-allowed'
                  } disabled:opacity-50`}
                >
                  <CheckCircle2 size={20} />
                  {submitting ? 'Guardando...' : 'Dentro de Presupuesto — Generar Orden de Compra'}
                </button>

                <button
                  type="button"
                  onClick={() => requestConfirm({
                    title:        'Confirmar Exceso de Presupuesto',
                    message:      '¿Está seguro de que esta cotización excede el presupuesto aprobado? Se enviará al Gerente General para su revisión.',
                    confirmText:  'Sí, Enviar a Gerencia',
                    confirmColor: 'bg-amber-500 hover:bg-amber-600',
                    icon:         AlertCircle,
                    onConfirm:    () => handleDecision(false),
                  })}
                  disabled={submitting || classification !== 'additional'}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-white text-base font-bold rounded-xl transition-all duration-200 shadow-md ${
                    classification === 'additional'
                      ? 'bg-amber-500 hover:bg-amber-600 hover:shadow-lg'
                      : 'bg-gray-300 cursor-not-allowed'
                  } disabled:opacity-50`}
                >
                  <AlertCircle size={20} />
                  {submitting ? 'Guardando...' : 'Excede Presupuesto — Enviar a Gerencia'}
                </button>

                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700 font-medium">
                    Seleccione arriba la clasificación presupuestal para habilitar la acción correspondiente.
                  </p>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => requestConfirm({
                    title:        'Confirmar Clasificación',
                    message:      classification === 'within'
                      ? '¿Confirma que este requerimiento ESTABA contemplado en la propuesta del proyecto? Avanzará a Logística para su gestión.'
                      : '¿Confirma que este requerimiento NO estaba en la propuesta original? Se enviará al Residente de Proyecto para que evalúe si es necesario.',
                    confirmText:  classification === 'within' ? 'Sí, está en la propuesta' : 'Sí, clasificar como adicional',
                    confirmColor: classification === 'within' ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-500 hover:bg-amber-600',
                    icon:         CheckCircle2,
                    onConfirm:    () => handleDecision(true),
                  })}
                  disabled={submitting || !classification}
                  className={`w-full flex flex-col items-center justify-center gap-1 px-4 py-4 text-white rounded-xl transition-all duration-200 shadow-md ${
                    !classification
                      ? 'bg-gray-300 cursor-not-allowed'
                      : classification === 'within'
                      ? 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                      : 'bg-amber-500 hover:bg-amber-600 hover:shadow-lg'
                  } disabled:opacity-50`}
                >
                  <CheckCircle2 size={22} />
                  <span className="text-base font-bold leading-tight text-center">
                    {submitting ? 'Guardando...' : !classification ? 'Seleccione una opción arriba' : classification === 'within' ? 'Confirmar — Está en la Propuesta' : 'Clasificar como Adicional'}
                  </span>
                  {!submitting && classification === 'additional' && (
                    <span className="text-xs font-medium opacity-90">Enviar a Residente de Proyecto</span>
                  )}
                </button>
              </>
            )}

            {!isQuoteCostReview && classification === 'additional' && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-xs text-orange-700 font-medium">
                  Al clasificar como adicional, el requerimiento volverá al Residente de Proyecto para reevaluar si es necesario o no. Si el Residente lo aprueba, pasará al Gerente General para una revisión minuciosa.
                </p>
              </div>
            )}
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
