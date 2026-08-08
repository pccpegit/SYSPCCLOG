import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, AlertTriangle, XCircle, CheckCircle2,
  DollarSign, Building2, User, Calendar, TrendingUp,
} from 'lucide-react';
import { ROLES } from '../../data/constants';
import { getRequests, getRequest, getApprovals, performAction } from '../../api/requests';
import { getProject } from '../../api/core';
import { getQuotations } from '../../api/suppliers';
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
  return new Date(dateStr).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatQty(val) {
  const n = Number(val);
  if (isNaN(n)) return val;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function InfoRow({ icon: Icon, label, value, highlight }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}: </span>
        <span className={`text-sm font-semibold ${highlight ? 'text-red-700' : 'text-gray-800'}`}>{value || '—'}</span>
      </div>
    </div>
  );
}

export default function CostOverrunReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [req, setReq] = useState(null);
  const [project, setProject] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
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
          const results = data.results ?? [];
          if (results.length > 0) {
            const { data: full } = await getRequest(results[0].id);
            requestData = full;
          }
        }
        if (!requestData) { setNotFound(true); return; }
        setReq(requestData);

        const projectId = requestData.project ?? requestData.projectId;
        const [projRes, approvalsRes, quotsRes] = await Promise.allSettled([
          projectId ? getProject(projectId) : Promise.reject('no project'),
          getApprovals(requestData.id),
          getQuotations(requestData.id),
        ]);
        if (projRes.status === 'fulfilled') setProject(projRes.value.data);
        if (approvalsRes.status === 'fulfilled') setApprovals(approvalsRes.value.data.results ?? approvalsRes.value.data ?? []);
        if (quotsRes.status === 'fulfilled') {
          const quotList = quotsRes.value.data.results ?? quotsRes.value.data ?? [];
          const selected = quotList.find((q) => q.is_selected);
          if (selected) setSelectedQuotation(selected);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  async function handleDecision(approved) {
    setSubmitting(true);
    try {
      await performAction(req.id, {
        action: approved ? 'COST_OVERRUN_APPROVED' : 'COST_OVERRUN_REJECTED',
        acting_role: ROLES.GENERAL_MANAGER,
        comments: notes.trim() || (approved ? 'Sobrecosto aprobado por Gerencia General.' : 'Sobrecosto rechazado por Gerencia General.'),
      });
      showToast({
        type: approved ? 'success' : 'info',
        message: approved
          ? 'Sobrecosto aprobado. Logística procederá a generar la Orden de Compra.'
          : 'Sobrecosto rechazado. El requerimiento no procederá.',
      });
      setTimeout(() => navigate('/rq/approvals'), 250);
    } catch (err) {
      const detail = err?.response?.data?.detail ?? 'Error al procesar la acción.';
      showToast({ type: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" /></div>;
  if (notFound || !req) return (
    <div className="max-w-xl mx-auto mt-20 text-center">
      <p className="text-gray-500">Requerimiento no encontrado.</p>
      <button onClick={() => navigate('/rq/approvals')} className="mt-4 text-red-600 font-medium hover:underline">Volver</button>
    </div>
  );

  const rqNumber = req.rq_number ?? req.rqNumber;
  const totalBudget = project?.total_budget ?? 0;
  const quotationAmount = selectedQuotation ? Number(selectedQuotation.total_amount) : 0;
  const overAmount = totalBudget > 0 ? Math.max(0, quotationAmount - totalBudget * 0.1) : quotationAmount;

  return (
    <>
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/rq/approvals')} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-2">
          <ArrowLeft size={14} /> Bandeja de Aprobaciones
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Revisión de Sobrecosto</h1>
            <p className="text-sm text-gray-500 mt-1">
              <span className="font-semibold text-red-700">{rqNumber}</span> — {req.description || ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityBadge priority={req.priority} />
            <StatusBadge status={req.status} />
          </div>
        </div>
      </div>

      {/* Alert */}
      <div className="rounded-xl border-2 bg-red-50 border-red-300 px-5 py-4 flex items-start gap-3">
        <AlertTriangle size={22} className="text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-800">
            La cotización seleccionada excede el presupuesto aprobado
          </p>
          <p className="text-xs mt-1 text-red-700 opacity-80">
            Control de Proyecto ha determinado que el costo de la cotización supera el monto presupuestado. Se requiere su autorización para proceder con la compra.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left */}
        <div className="lg:col-span-3 space-y-6">
          {/* Request info */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-3">Información del Requerimiento</h2>
            <InfoRow icon={Building2} label="Proyecto" value={req.project_code ? `${req.project_code} — ${req.project_name}` : req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—'} />
            <InfoRow icon={User} label="Solicitante" value={req.requested_by_name} />
            <InfoRow icon={Calendar} label="Fecha Requerida" value={formatDate(req.fecha_necesidad)} />
            <InfoRow icon={DollarSign} label="Costo Estimado" value={formatCurrency(req.estimated_cost)} />
          </div>

          {/* Quotation */}
          {selectedQuotation && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-red-50 border-b border-red-200">
                <h2 className="text-base font-semibold text-red-800">Cotización que Excede Presupuesto</h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <p className="text-lg font-bold text-gray-800">{selectedQuotation.supplier_name}</p>
                    <p className="text-xs text-gray-400">RUC: {selectedQuotation.supplier_ruc ?? '—'}</p>
                  </div>
                  <p className="text-2xl font-bold text-red-700 shrink-0">{formatCurrency(selectedQuotation.total_amount)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedQuotation.delivery_days && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Entrega: {selectedQuotation.delivery_days} días</span>
                  )}
                  {selectedQuotation.payment_terms && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Pago: {selectedQuotation.payment_terms}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {selectedQuotation.items?.map((qi, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800">{qi.request_item_description ?? `Ítem ${idx + 1}`}</p>
                        <p className="text-xs text-gray-400">{formatQty(qi.quantity)} und × {formatCurrency(qi.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-800 shrink-0 ml-3">{formatCurrency(qi.total_price)}</p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-red-50 rounded-lg px-4 py-3 border border-red-200">
                    <p className="text-sm font-bold text-red-800">TOTAL COTIZACIÓN</p>
                    <p className="text-lg font-bold text-red-700">{formatCurrency(selectedQuotation.total_amount)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}


        </div>

        {/* Right */}
        <div className="lg:col-span-2 space-y-4">
          {/* Budget impact */}
          {totalBudget > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-red-500" />
                Impacto Presupuestal
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-xs text-gray-400 mb-1">Presupuesto</p>
                  <p className="text-sm font-bold text-gray-800">{formatCurrency(totalBudget)}</p>
                </div>
                <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
                  <p className="text-xs text-red-600 mb-1">Cotización</p>
                  <p className="text-sm font-bold text-red-700">{formatCurrency(quotationAmount)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <label className="block text-sm font-semibold text-gray-800 mb-2">Notas de Gerencia</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Condiciones para la aprobación del sobrecosto, instrucciones..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 hover:border-gray-400 transition-colors resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Decisión de Gerencia</h2>

            <button
              type="button"
              onClick={() => requestConfirm({
                title: 'Aprobar Sobrecosto',
                message: '¿Autoriza el sobrecosto? Logística procederá a generar la Orden de Compra con el monto cotizado.',
                confirmText: 'Sí, Autorizar Sobrecosto',
                confirmColor: 'bg-green-600 hover:bg-green-700',
                icon: CheckCircle2,
                onConfirm: () => handleDecision(true),
              })}
              disabled={submitting}
              className="w-full flex flex-col items-center gap-1 px-4 py-4 bg-green-600 text-white rounded-xl hover:bg-green-700 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
            >
              <CheckCircle2 size={22} />
              <span className="text-base font-bold">Autorizar Sobrecosto</span>
              <span className="text-xs opacity-80">Proceder con la Orden de Compra</span>
            </button>

            <button
              type="button"
              onClick={() => requestConfirm({
                title: 'Rechazar Sobrecosto',
                message: '¿Está seguro de rechazar el sobrecosto? El requerimiento no procederá con esta cotización.',
                confirmText: 'Sí, Rechazar',
                confirmColor: 'bg-red-600 hover:bg-red-700',
                icon: XCircle,
                onConfirm: () => handleDecision(false),
              })}
              disabled={submitting}
              className="w-full flex flex-col items-center gap-1 px-4 py-4 bg-red-600 text-white rounded-xl hover:bg-red-700 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
            >
              <XCircle size={22} />
              <span className="text-base font-bold">Rechazar Sobrecosto</span>
              <span className="text-xs opacity-80">No autorizar esta compra</span>
            </button>

            <p className="text-xs text-gray-400 text-center pt-1">
              Esta decisión queda registrada con su autorización.
            </p>
          </div>
        </div>
      </div>

      {/* Historial section - full width */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Historial del Requerimiento</h2>
        <ApprovalChain approvals={approvals} />
      </div>
    </div>

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
