import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  XCircle,
  CheckCircle2,
  CheckCircle,
  DollarSign,
  Building2,
  User,
  Calendar,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { ROLES } from '../../data/constants';
import { getRequests, getRequest, getApprovals, performAction } from '../../api/requests';
import { getProject } from '../../api/core';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ApprovalChain from '../../components/requests/ApprovalChain';
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

function InfoRow({ icon: Icon, label, value, highlight }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}: </span>
        <span className={`text-sm font-semibold ${highlight ? 'text-orange-700' : 'text-gray-800'}`}>
          {value || '—'}
        </span>
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

export default function ManagerApprovalPage() {
  const { id }        = useParams();
  const navigate      = useNavigate();
  const { showToast } = useToast();

  const [req,          setReq]          = useState(null);
  const [project,      setProject]      = useState(null);
  const [approvals,    setApprovals]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState(null);
  const [notes,        setNotes]        = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

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

        // Fetch project and approvals in parallel
        const projectId = requestData.project ?? requestData.projectId;
        const [projRes, approvalsRes] = await Promise.allSettled([
          projectId ? getProject(projectId) : Promise.reject('no project'),
          getApprovals(requestData.id),
        ]);

        if (projRes.status === 'fulfilled') setProject(projRes.value.data);
        if (approvalsRes.status === 'fulfilled') {
          setApprovals(approvalsRes.value.data.results ?? approvalsRes.value.data ?? []);
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

  async function handleDecision(approved) {
    setSubmitting(true);
    setError(null);
    try {
      await performAction(req.id, {
        action:      approved ? 'GM_APPROVED' : 'GM_REJECTED',
        acting_role: ROLES.GENERAL_MANAGER,
        comments:    notes.trim() || (approved ? 'Aprobado por Gerencia General.' : 'Rechazado por Gerencia General.'),
      });
      showToast({
        type:    approved ? 'success' : 'info',
        message: approved
          ? 'Aprobación de Gerencia registrada. El requerimiento avanza al proceso de adquisición.'
          : 'Rechazo de Gerencia registrado. El equipo de proyecto será notificado.',
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

  const rqNumber   = req.rq_number   ?? req.rqNumber;
  const items      = req.items       ?? [];
  const reqCost    = req.estimated_cost ?? req.estimatedCost ?? 0;
  const budgClass  = req.budget_classification ?? req.budgetClassification;

  // Budget impact
  const totalBudget  = project?.total_budget  ?? project?.totalBudget  ?? 0;
  const spentBudget  = project?.spent_budget  ?? project?.spentBudget  ?? 0;
  const available    = totalBudget - spentBudget;
  const newSpent     = spentBudget + reqCost;
  const usedPct      = totalBudget > 0 ? Math.min(Math.round((spentBudget / totalBudget) * 100), 100) : 0;
  const projectedPct = totalBudget > 0 ? Math.min(Math.round((newSpent / totalBudget) * 100), 100) : 0;
  const overBudget   = newSpent > totalBudget;

  const isAdditional         = budgClass === 'Requerimiento Adicional' || budgClass === 'ADDITIONAL';
  const isCostOverrun        = req.status === 'COST_OVERRUN_REVIEW';
  const classificationLabel  = isAdditional ? 'REQUERIMIENTO ADICIONAL' : 'SOBRECOSTO';
  const bannerColor = isAdditional
    ? { banner: 'bg-amber-50 border-amber-300', icon: 'text-amber-600', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800 border-amber-300' }
    : { banner: 'bg-red-50 border-red-300',     icon: 'text-red-600',   text: 'text-red-800',   badge: 'bg-red-100 text-red-800 border-red-300' };

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

      {/* Alert banner */}
      <div className={`rounded-xl border-2 ${bannerColor.banner} px-5 py-4 flex items-start gap-3`}>
        <AlertTriangle size={22} className={`${bannerColor.icon} shrink-0 mt-0.5`} />
        <div>
          <p className={`text-sm font-bold ${bannerColor.text}`}>
            Este requerimiento ha sido clasificado como:{' '}
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border font-bold ${bannerColor.badge}`}>
              {isAdditional ? <Zap size={12} /> : <AlertTriangle size={12} />}
              {classificationLabel}
            </span>
          </p>
          <p className={`text-xs mt-1 ${bannerColor.text} opacity-80`}>
            {isAdditional
              ? 'El costo supera el presupuesto aprobado para este proyecto. Se requiere su aprobación como Gerente General para proceder con la adquisición.'
              : 'El costo cotizado supera el estimado inicial. Control de Proyecto ha escalado este requerimiento para su revisión y aprobación.'}
          </p>
        </div>
      </div>

      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <CheckCircle size={26} className="text-gray-700" />
            Aprobación Gerencia General
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
        {/* LEFT: Request detail + approval chain */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Información del Requerimiento</h2>
            <InfoRow icon={Building2}  label="Proyecto"       value={`${req.project_code ?? req.projectCode ?? ''} — ${req.project_name ?? req.projectName ?? ''}`} />
            <InfoRow icon={User}       label="Solicitante"    value={req.requested_by_name ?? req.requestedByName} />
            <InfoRow icon={Calendar}   label="Fecha Requerida"value={formatDate(req.required_date ?? req.requiredDate)} />
            <InfoRow icon={DollarSign} label="Costo Estimado" value={formatCurrency(reqCost)} highlight />
            <InfoRow icon={DollarSign} label="Clasificación"  value={budgClass ?? 'Sin clasificar'} highlight />
            {req.justification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Justificación del Solicitante</p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                Ítems del Requerimiento ({items.length})
              </h2>
              <span className="text-sm font-bold text-gray-800">{formatCurrency(reqCost)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cant.</th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 hidden md:table-cell">Costo Est.</th>
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
                      <td className="py-3 px-4 text-right font-medium text-gray-700 hidden md:table-cell">
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
              </table>
            </div>
          </div>

          {/* Approval chain */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Cadena de Aprobaciones (hasta ahora)</h2>
            <ApprovalChain approvals={approvals} />
          </div>
        </div>

        {/* RIGHT: Impact + action */}
        <div className="lg:col-span-2 space-y-5">
          {/* Classification badge */}
          <div className={`bg-white rounded-xl border-2 ${bannerColor.banner} shadow-sm p-6`}>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Clasificación</h2>
            <div className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border ${bannerColor.badge} text-sm font-bold`}>
              {isAdditional ? <Zap size={16} /> : <AlertTriangle size={16} />}
              {classificationLabel}
            </div>
            <p className="mt-3 text-xs text-gray-500 leading-relaxed">
              {isAdditional
                ? 'Requerimiento fuera del alcance del presupuesto original. Su aprobación implica un incremento en el costo total del proyecto.'
                : 'El costo de adquisición supera el monto estimado inicialmente aprobado.'}
            </p>
          </div>

          {/* Budget impact — only if project data is available */}
          {totalBudget > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-orange-500" />
                Impacto Presupuestal — {projectCode}
              </h2>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-xs text-gray-400 mb-1">Presupuesto Total</p>
                  <p className="text-sm font-bold text-gray-800">{formatCurrency(totalBudget)}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 text-center">
                  <p className="text-xs text-amber-600 mb-1">Ya Ejecutado</p>
                  <p className="text-sm font-bold text-amber-700">{formatCurrency(spentBudget)}</p>
                </div>
              </div>

              <div className={`p-3 rounded-lg border mb-4 ${overBudget ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                <p className="text-xs font-semibold text-gray-600 mb-1">Este requerimiento</p>
                <p className={`text-lg font-bold ${overBudget ? 'text-red-700' : 'text-orange-700'}`}>
                  + {formatCurrency(reqCost)}
                </p>
                {overBudget && (
                  <p className="text-xs text-red-600 mt-1">
                    Supera el presupuesto en {formatCurrency(newSpent - totalBudget)}
                  </p>
                )}
              </div>

              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>Actual: {usedPct}%</span>
                <span className={`font-semibold ${overBudget ? 'text-red-600' : 'text-orange-600'}`}>
                  Con RQ: {projectedPct}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-4 relative overflow-hidden">
                <div
                  className={`${usedPct >= 90 ? 'bg-red-400' : usedPct >= 70 ? 'bg-amber-400' : 'bg-green-400'} h-4 rounded-full transition-all`}
                  style={{ width: `${usedPct}%` }}
                />
                <div
                  className={`absolute top-0 h-4 ${overBudget ? 'bg-red-600' : 'bg-orange-500'} opacity-70`}
                  style={{ left: `${usedPct}%`, width: `${Math.min(projectedPct - usedPct, 100 - usedPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>S/ 0</span>
                <span>{formatCurrency(totalBudget)}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Notas de Gerencia
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Condiciones de aprobación, observaciones para el equipo de proyecto, instrucciones especiales..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-600 hover:border-gray-400 transition-colors resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Decisión de Gerencia</h2>

            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Rechazo de Gerencia',
                message:      '¿Está seguro de rechazar este requerimiento? El equipo de proyecto será notificado y el proceso de adquisición quedará detenido.',
                confirmText:  'Sí, Rechazar',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon:         XCircle,
                onConfirm:    () => handleDecision(false),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              <XCircle size={20} />
              Rechazar
            </button>

            <button
              type="button"
              onClick={() => requestConfirm({
                title:        'Confirmar Aprobación de Gerencia',
                message:      '¿Está seguro de aprobar este requerimiento? El pedido avanzará al proceso de adquisición. Esta acción queda registrada con su autorización.',
                confirmText:  'Sí, Aprobar',
                confirmColor: 'bg-gray-800 hover:bg-gray-900',
                icon:         CheckCircle2,
                onConfirm:    () => handleDecision(true),
              })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-gray-800 text-white text-base font-bold rounded-xl hover:bg-gray-900 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
            >
              <CheckCircle2 size={20} />
              {submitting ? 'Guardando...' : 'Aprobar'}
            </button>

            <p className="text-xs text-gray-400 text-center pt-1">
              Esta acción queda registrada con su firma digital en el historial del requerimiento.
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
