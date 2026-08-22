import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Building2,
  User,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getRequests, getRequest, getApprovals, performAction } from '../../api/requests';
import { getProject } from '../../api/core';
import { getQuotations } from '../../api/suppliers';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ConfirmModal from '../../components/ui/ConfirmModal';
import ApprovalChain from '../../components/requests/ApprovalChain';
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

function formatQty(val) {
  const n = Number(val);
  if (isNaN(n)) return val;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
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
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 dark:border-purple-400" />
    </div>
  );
}

export default function QuoteCostReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { primaryRole } = useAuth();
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

  async function handleDecision(withinBudget) {
    setSubmitting(true);
    try {
      const action = withinBudget ? 'QUOTE_COST_APPROVED' : 'QUOTE_COST_REJECTED';
      const successMsg = withinBudget
        ? 'Cotización aprobada. Logística procederá a generar la Orden de Compra.'
        : 'Cotización excede presupuesto. Se enviará al Gerente General para revisión.';

      await performAction(req.id, {
        action,
        acting_role: primaryRole,
        comments: notes.trim() || successMsg,
        extra_data: {},
      });

      showToast({ type: withinBudget ? 'success' : 'info', message: successMsg });
      setTimeout(() => navigate('/rq/approvals'), 250);
    } catch (err) {
      const detail = err?.response?.data?.detail ?? 'Error al procesar la acción.';
      showToast({ type: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (notFound || !req) return (
    <div className="max-w-xl mx-auto mt-20 text-center">
      <p className="text-gray-500">Requerimiento no encontrado.</p>
      <button onClick={() => navigate('/rq/approvals')} className="mt-4 text-purple-600 dark:text-purple-400 font-medium hover:underline">Volver</button>
    </div>
  );

  const rqNumber = req.rq_number ?? req.rqNumber;
  const items = req.items ?? [];
  const totalBudget = project?.total_budget ?? 0;
  const quotationAmount = selectedQuotation ? Number(selectedQuotation.total_amount) : 0;
  const budgetPct = totalBudget > 0 ? ((quotationAmount / totalBudget) * 100).toFixed(2) : null;

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
            <h1 className="text-2xl font-bold text-gray-900">Verificación de Costos</h1>
            <p className="text-sm text-gray-500 mt-1">
              <span className="font-semibold text-purple-700 dark:text-purple-300">{rqNumber}</span> — {req.description || ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityBadge priority={req.priority} />
            <StatusBadge status={req.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column - Info */}
        <div className="lg:col-span-3 space-y-6">
          {/* Request info */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-3">Información del Requerimiento</h2>
            <InfoRow icon={Building2} label="Proyecto" value={req.project_code ? `${req.project_code} — ${req.project_name}` : req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—'} />
            <InfoRow icon={User} label="Solicitante" value={req.requested_by_name} />
            <InfoRow icon={Calendar} label="Fecha Requerida" value={formatDate(req.fecha_necesidad)} />
            <InfoRow icon={DollarSign} label="Costo Estimado RQ" value={formatCurrency(req.estimated_cost)} />
          </div>

          {/* Selected quotation */}
          <div className="bg-white rounded-xl border border-indigo-200 dark:border-indigo-500/30 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-200 dark:border-indigo-500/30">
              <h2 className="text-base font-semibold text-indigo-800 dark:text-indigo-300">Cotización Seleccionada por Logística</h2>
            </div>
            {selectedQuotation ? (
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold text-gray-800">{selectedQuotation.supplier_name}</p>
                      <p className="text-xs text-gray-400">RUC: {selectedQuotation.supplier_ruc ?? '—'}</p>
                    </div>
                    <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300 shrink-0">{formatCurrency(selectedQuotation.total_amount)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedQuotation.delivery_days && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Entrega: {selectedQuotation.delivery_days} días</span>
                    )}
                    {selectedQuotation.payment_terms && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Pago: {selectedQuotation.payment_terms}</span>
                    )}
                  </div>
                </div>

                {/* Items */}
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
                  <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-500/10 rounded-lg px-4 py-3 border border-indigo-200 dark:border-indigo-500/30">
                    <p className="text-sm font-bold text-indigo-800 dark:text-indigo-300">TOTAL COTIZACIÓN</p>
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{formatCurrency(selectedQuotation.total_amount)}</p>
                  </div>
                </div>

                {/* Budget comparison */}
                {totalBudget > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Comparación con Presupuesto del Proyecto</p>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-white rounded-lg border border-gray-200 p-3">
                        <p className="text-xs text-gray-400">Presupuesto</p>
                        <p className="text-sm font-bold text-gray-700">{formatCurrency(totalBudget)}</p>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-200 p-3">
                        <p className="text-xs text-gray-400">Cotización</p>
                        <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{formatCurrency(quotationAmount)}</p>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-200 p-3">
                        <p className="text-xs text-gray-400">% del Presup.</p>
                        <p className={`text-sm font-bold ${Number(budgetPct) > 10 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                          {budgetPct}%
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-gray-400 text-sm">
                Cargando información de la cotización...
              </div>
            )}
          </div>
        </div>

        {/* Right column - Decision */}
        <div className="lg:col-span-2 space-y-4">
          {/* Decision */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">¿La cotización está dentro del presupuesto?</h2>

            <div className="space-y-3 mb-4">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title: 'Aprobar Cotización',
                  message: '¿Confirma que la cotización está dentro del presupuesto aprobado? Logística procederá a generar la Orden de Compra.',
                  confirmText: 'Sí, Aprobar',
                  confirmColor: 'bg-green-600 hover:bg-green-700',
                  icon: CheckCircle2,
                  onConfirm: () => handleDecision(true),
                })}
                disabled={submitting}
                className="w-full flex flex-col items-center gap-1 px-4 py-4 bg-green-600 text-white rounded-xl hover:bg-green-700 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
              >
                <CheckCircle2 size={22} />
                <span className="text-base font-bold">Dentro del Presupuesto</span>
                <span className="text-xs opacity-80">Aprobar — Generar Orden de Compra</span>
              </button>

              <button
                type="button"
                onClick={() => requestConfirm({
                  title: 'Cotización Excede Presupuesto',
                  message: '¿Confirma que la cotización excede el presupuesto aprobado? Se enviará al Gerente General para su revisión y autorización del sobrecosto.',
                  confirmText: 'Sí, Enviar a Gerencia',
                  confirmColor: 'bg-amber-500 hover:bg-amber-600',
                  icon: AlertCircle,
                  onConfirm: () => handleDecision(false),
                })}
                disabled={submitting}
                className="w-full flex flex-col items-center gap-1 px-4 py-4 bg-amber-500 text-white rounded-xl hover:bg-amber-600 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
              >
                <AlertCircle size={22} />
                <span className="text-base font-bold">Excede Presupuesto</span>
                <span className="text-xs opacity-80">Enviar a Gerente General</span>
              </button>
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
              placeholder="Observaciones sobre la cotización, comparación con presupuesto..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 hover:border-gray-400 transition-colors resize-none"
            />
          </div>

          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
              Si aprueba, Logística generará la Orden de Compra. Si excede el presupuesto, el Gerente General deberá autorizar el sobrecosto.
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
