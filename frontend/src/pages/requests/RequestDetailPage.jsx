import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  User,
  Building2,
  Package,
  Clock,
  AlertCircle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  DollarSign,
  FileText,
  Printer,
} from 'lucide-react';
import { STATUS_CONFIG, ROLES, STATUS } from '../../data/constants';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getRequests, getRequest, getApprovals, performAction } from '../../api/requests';
import ConfirmModal from '../../components/ui/ConfirmModal';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import LifecycleBar from '../../components/requests/LifecycleBar';
import ApprovalChain from '../../components/requests/ApprovalChain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(val) {
  if (!val && val !== 0) return '—';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// NextAction — contextual message about what happens next
// ---------------------------------------------------------------------------

function NextAction({ status }) {
  const messages = {
    // Fase 1
    DRAFT:                'El solicitante debe enviar el requerimiento para iniciar el flujo de aprobación.',
    SUBMITTED:            'Pendiente de revisión técnica por el Residente de Proyecto.',
    // Fase 2 — Operaciones
    TECHNICAL_REVIEW:     'El Residente de Proyecto debe revisar técnicamente y aprobar o rechazar.',
    TECHNICAL_APPROVED:   'Pendiente de clasificación presupuestal por Control de Proyecto.',
    TECHNICAL_REJECTED:   'Rechazado técnicamente. El solicitante puede corregir y reenviar.',
    BUDGET_REVIEW:        'Control de Proyecto debe revisar el presupuesto y clasificar el requerimiento.',
    WITHIN_PROPOSAL:      'Clasificado como Dentro de Propuesta. Pasará a validación y luego a Logística.',
    ADDITIONAL_REQ:       'Clasificado como Adicional. Requiere aprobación del Gerente General.',
    // Fase 2 — Administración
    SUPERVISOR_REVIEW:    'El Jefe Directo debe verificar y aprobar o rechazar el requerimiento.',
    SUPERVISOR_APPROVED:  'Aprobado por el Jefe Directo. Pendiente de revisión presupuestal por el Gte. Administrativo.',
    SUPERVISOR_REJECTED:  'Rechazado por el Jefe Directo. El proceso ha finalizado.',
    ADMIN_BUDGET_REVIEW:  'El Gerente Administrativo está revisando el requerimiento contra el Plan Anual.',
    WITHIN_ANNUAL_PLAN:   'Dentro del Plan Anual. El requerimiento será validado para atención.',
    OUT_OF_ANNUAL_PLAN:   'Fuera del Plan Anual. Requiere aprobación del Gerente General.',
    // Fase 2 — Común
    GM_REVIEW:            'El Gerente General debe revisar y aprobar este requerimiento.',
    GM_APPROVED:          'Aprobado por Gerencia General. El requerimiento será validado.',
    GM_REJECTED:          'Rechazado por Gerencia General. El proceso ha finalizado.',
    VALIDATED:            'Requerimiento validado. Logística debe iniciar la gestión de stock o compra.',
    // Fase 3
    STOCK_CHECK:          'Logística verificando disponibilidad de stock en almacén.',
    IN_STOCK:             'Materiales disponibles en stock. Se procederá al despacho directo.',
    REQUIRES_PURCHASE:    'Sin stock disponible. Logística debe iniciar el proceso de cotización.',
    QUOTING:              'Logística solicitando cotizaciones a proveedores.',
    QUOTE_COMPARISON:     'El Jefe Logístico está comparando las propuestas recibidas.',
    QUOTE_SELECTED:       'Proveedor seleccionado. Pendiente de verificación de costos y generación de Orden de Compra.',
    COST_OVERRUN_REVIEW:  'La cotización excede el presupuesto estimado. Requiere aprobación del Gerente General.',
    COST_OVERRUN_APPROVED:'Sobrecosto aprobado. Se procederá a generar la Orden de Compra.',
    COST_OVERRUN_REJECTED:'Sobrecosto rechazado por Gerencia. El proceso ha finalizado.',
    PO_GENERATED:         'Orden de Compra generada. Pendiente de recepción de materiales en almacén.',
    // Fase 4 — Operaciones
    RECEIVING:            'Materiales siendo recibidos en almacén central. Pendiente control de calidad.',
    QUALITY_CHECK:        'Control de calidad en proceso. Verificando especificaciones del material.',
    QUALITY_APPROVED:     'Calidad aprobada. Materiales listos para despacho a obra.',
    QUALITY_REJECTED:     'Materiales rechazados por calidad. Se generó reclamo al proveedor.',
    DISPATCHED_TO_SITE:   'Materiales despachados hacia el almacén de obra.',
    DELIVERED:            'Materiales entregados. Pendiente de conformidad del usuario.',
    // Fase 4 — Administración
    RECEPTION_CONFORMITY: 'Recepción conforme verificada. Pendiente de entrega al solicitante.',
    RECEPTION_CLAIM:      'Reclamo al proveedor por no conformidad en recepción.',
    WAREHOUSE_UPDATED:    'Almacén ha actualizado sus registros. Pendiente de conformidad del usuario.',
    // Fase 5
    USER_CONFORMITY:      'El solicitante debe confirmar la conformidad de lo recibido.',
    USER_CLAIM:           'El usuario ha registrado un reclamo. Logística gestionará el cambio.',
    CLAIM_IN_REVIEW:      'El reclamo está siendo revisado por Logística.',
    CLAIM_RESOLVED:       'Reclamo resuelto. El producto será reemplazado o corregido.',
    CLOSED:               'Requerimiento cerrado exitosamente. Ciclo completado.',
    CANCELLED:            'Requerimiento cancelado.',
  };
  return (
    <p className="text-sm text-gray-500 leading-relaxed">
      {messages[status] ?? 'Estado en procesamiento.'}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Document Header — SYSPCC / PCC-ADM-FOR-01
// ---------------------------------------------------------------------------

function DocumentHeader({ req }) {
  return (
    <div className="flex border-b border-gray-400">
      {/* Logo cell */}
      <div className="w-28 shrink-0 flex items-center justify-center border-r border-gray-400 p-2">
        <img
          src="/images/azul.jpg"
          alt="PCC - Proyectos, Construcción & Comisionamiento"
          className="h-14 w-auto object-contain"
        />
      </div>

      {/* Title cell */}
      <div className="flex-1 flex items-center justify-center border-r border-gray-400 p-3">
        <div className="text-center">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-0.5">
            Formato
          </p>
          <p className="text-base font-black text-gray-900 uppercase tracking-wide leading-tight">
            Requerimiento de Materiales
          </p>
          <p className="text-base font-black text-gray-900 uppercase tracking-wide leading-tight">
            y/o Equipos
          </p>
        </div>
      </div>

      {/* Metadata cell */}
      <div className="w-52 shrink-0">
        <table className="w-full text-xs border-collapse">
          <tbody>
            <tr className="border-b border-gray-400">
              <td className="px-2 py-1 font-semibold text-gray-600 border-r border-gray-400 bg-gray-50 whitespace-nowrap">
                CÓDIGO:
              </td>
              <td className="px-2 py-1 text-gray-900 font-mono font-bold">
                PCC-ADM-FOR-01
              </td>
            </tr>
            <tr className="border-b border-gray-400">
              <td className="px-2 py-1 font-semibold text-gray-600 border-r border-gray-400 bg-gray-50">
                REVISIÓN:
              </td>
              <td className="px-2 py-1 text-gray-900">02</td>
            </tr>
            <tr className="border-b border-gray-400">
              <td className="px-2 py-1 font-semibold text-gray-600 border-r border-gray-400 bg-gray-50">
                FECHA:
              </td>
              <td className="px-2 py-1 text-gray-900">{formatDateShort(req.createdAt)}</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold text-gray-600 border-r border-gray-400 bg-gray-50">
                PÁGINA:
              </td>
              <td className="px-2 py-1 text-gray-900">1 de 1</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form Field — label + value cell pair used inside the fields grid
// ---------------------------------------------------------------------------

function FormCell({ label, value, className = '' }) {
  return (
    <div className={`px-3 py-2 ${className}`}>
      <p className="text-xs font-semibold uppercase text-gray-500 tracking-wide leading-none mb-1">
        {label}
      </p>
      <p className="text-sm text-gray-900 leading-snug font-medium">{value || '—'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form Fields Section — rows 1–5 of PCC-ADM-FOR-01
// ---------------------------------------------------------------------------

function DocumentFields({ req }) {
  return (
    <div className="border-b border-gray-400">
      {/* Row 1 */}
      <div className="flex border-b border-gray-300">
        <div className="flex-1 border-r border-gray-300">
          <FormCell label="Requerido por:" value={req.requestedByName} />
        </div>
        <div className="w-56 shrink-0">
          <FormCell
            label="N° Requerimiento:"
            value={
              <span className="font-mono font-bold text-blue-700 dark:text-blue-300">{req.rqNumber}</span>
            }
          />
        </div>
      </div>

      {/* Row 2 */}
      <div className="flex border-b border-gray-300">
        <div className="flex-1 border-r border-gray-300">
          <FormCell
            label="Uso específico:"
            value={req.usoEspecifico ?? req.description}
          />
        </div>
        <div className="w-56 shrink-0">
          <FormCell
            label="Fecha de requerimiento:"
            value={formatDateShort(req.createdAt)}
          />
        </div>
      </div>

      {/* Row 3 */}
      <div className="flex border-b border-gray-300">
        <div className="flex-1 border-r border-gray-300">
          <FormCell label="Área:" value={req.area ?? '—'} />
        </div>
        <div className="w-56 shrink-0">
          <FormCell label="Frente:" value={req.frente ?? '—'} />
        </div>
      </div>

      {/* Row 4 */}
      <div className="flex border-b border-gray-300">
        <div className="flex-1 border-r border-gray-300">
          <FormCell
            label="Fecha entrega requerida:"
            value={formatDateShort(req.fechaEntrega ?? req.requiredDate)}
          />
        </div>
        <div className="w-56 shrink-0">
          <FormCell label="Servicio:" value={req.servicio ?? '—'} />
        </div>
      </div>

      {/* Row 5 — full width project info */}
      <div className="flex">
        <div className="flex-1">
          <FormCell
            label="Proyecto:"
            value={`${req.projectCode} — ${req.projectName}`}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items Table — full PCC-ADM-FOR-01 columns
// ---------------------------------------------------------------------------

const TABLE_HEADERS = [
  { label: 'Item',                      className: 'w-10 text-center' },
  { label: 'Equipos / Materiales',      className: 'min-w-[160px]' },
  { label: 'Unidad de Medida',          className: 'w-24 text-center' },
  { label: 'Cantidad',                  className: 'w-20 text-center' },
  { label: 'Stock Almacén Obra',        className: 'w-24 text-center' },
  { label: 'Stock Almacén Principal',   className: 'w-24 text-center' },
  { label: 'X Atender',                 className: 'w-20 text-center' },
  { label: 'Presup. / Adic.',           className: 'w-20 text-center' },
  { label: 'RFI / FWO',                 className: 'w-24 text-center' },
  { label: 'Estatus / Guía',            className: 'w-28 text-center' },
  { label: 'Comentarios',              className: 'min-w-[120px]' },
];

function DocumentItemsTable({ items = [] }) {
  return (
    <div className="border-b border-gray-400 overflow-x-auto">
      <table
        className="w-full text-xs"
        style={{ borderCollapse: 'collapse' }}
      >
        <thead>
          <tr className="bg-gray-100">
            {TABLE_HEADERS.map((h) => (
              <th
                key={h.label}
                className={`border border-gray-400 px-2 py-2 font-bold text-gray-700 uppercase tracking-wide text-center leading-tight ${h.className}`}
                style={{ fontSize: '10px' }}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td
                colSpan={TABLE_HEADERS.length}
                className="border border-gray-300 px-3 py-4 text-center text-gray-400 italic"
              >
                Sin ítems registrados.
              </td>
            </tr>
          )}
          {items.map((item, idx) => (
            <tr
              key={item.lineNumber ?? idx}
              className={idx % 2 !== 0 ? 'bg-gray-50' : 'bg-white'}
            >
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-500 font-mono">
                {item.lineNumber ?? idx + 1}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-gray-800 font-medium leading-snug">
                {item.description}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-600 font-mono">
                {item.unit ?? '—'}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-800 font-semibold">
                {item.quantity ?? 0}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-600">
                {item.stockAlmacenObra ?? 0}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-600">
                {item.stockAlmacenPrincipal ?? 0}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-700 font-semibold">
                {item.xAtender ?? item.quantity ?? 0}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded font-bold text-xs ${
                    (item.presupuestadoAdicional ?? 'P') === 'A'
                      ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
                      : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                  }`}
                >
                  {item.presupuestadoAdicional ?? 'P'}
                </span>
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-600 font-mono">
                {item.rfiFwo || '—'}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-center text-gray-600 font-mono text-xs">
                {item.estatusGuia || '—'}
              </td>
              <td className="border border-gray-300 px-2 py-2 text-gray-500 leading-snug text-xs">
                {item.comentarios || '—'}
              </td>
            </tr>
          ))}
          {/* Fill empty rows to reach at least 5 visible rows for a printed feel */}
          {Array.from({ length: Math.max(0, 5 - items.length) }).map((_, i) => (
            <tr key={`empty-${i}`} className={i % 2 !== 0 ? 'bg-gray-50' : 'bg-white'}>
              {TABLE_HEADERS.map((h, j) => (
                <td key={j} className="border border-gray-300 px-2 py-3 text-gray-200">
                  &nbsp;
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signature Section
// ---------------------------------------------------------------------------

function SignatureBox({ title, approval }) {
  const name = approval?.performed_by_name ?? approval?.by ?? null;
  const date = approval?.performed_at ?? approval?.date ?? null;
  const hasSignature = !!name;
  return (
    <div className="flex-1 border-b border-r-0 sm:border-b-0 sm:border-r border-gray-400 last:border-b-0 sm:last:border-r-0 px-3 pt-2 pb-3">
      <p
        className="text-center font-bold uppercase text-gray-700 leading-tight mb-3"
        style={{ fontSize: '10px' }}
      >
        {title}
      </p>

      <div className="h-14 border border-gray-300 rounded bg-gray-50 flex items-end justify-center pb-1 mb-2">
        {hasSignature && (
          <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold italic tracking-wide">
            {name}
          </p>
        )}
      </div>

      <div className="border-t border-gray-400 pt-1.5 text-center min-h-[28px]">
        {hasSignature ? (
          <>
            <p className="text-xs font-semibold text-gray-800 leading-tight">
              {name}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDateShort(date)}
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-300 italic">Pendiente</p>
        )}
      </div>
    </div>
  );
}

function DocumentSignatures({ approvals = [] }) {
  const find = (role) => approvals.find((a) => a.role === role) ?? null;

  const requester = find('REQUESTER');
  const resident  = find('PROJECT_RESIDENT') ?? find('DIRECT_SUPERVISOR');
  const control   = find('PROJECT_CONTROL') ?? find('ADMIN_MANAGER') ?? find('GENERAL_MANAGER');
  const logistics = find('LOGISTICS_COORDINATOR') ?? find('LOGISTICS_SUPERVISOR');

  return (
    <div className="flex flex-col sm:flex-row border-t border-gray-400">
      <SignatureBox title="Realizado por:" approval={requester} />
      <SignatureBox title="Validado por:" approval={resident} />
      <SignatureBox title="Revisado y Aprobado por:" approval={control} />
      <SignatureBox title="Verificado por: Logística" approval={logistics} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function RequestDetailPage() {
  const { id }          = useParams();
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }  = useToast();

  const [req,       setReq]       = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [notFound,  setNotFound]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimText, setClaimText] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let requestData = null;

        // id could be a numeric DB id or a rq_number string like "RQ-2026-0001"
        if (/^\d+$/.test(id)) {
          const { data } = await getRequest(id);
          requestData = data;
        } else {
          // Try searching by rq_number
          const { data } = await getRequests({ rq_number: id, page_size: 1 });
          const results = data.results ?? [];
          if (results.length > 0) {
            requestData = results[0];
            // Fetch full detail to get items
            const { data: fullData } = await getRequest(requestData.id);
            requestData = fullData;
          }
        }

        if (!requestData) {
          setNotFound(true);
          return;
        }

        // Normalize snake_case API fields to the camelCase names used in the UI,
        // keeping originals as fallback so both shapes work.
        const normalized = {
          ...requestData,
          rqNumber:            requestData.rq_number             ?? requestData.rqNumber,
          requestedByName:     requestData.requested_by_name     ?? requestData.requestedByName,
          projectCode:         requestData.project_code          ?? requestData.projectCode,
          projectName:         requestData.project_name          ?? requestData.projectName,
          requiredDate:        requestData.required_date         ?? requestData.requiredDate,
          estimatedCost:       requestData.estimated_cost        ?? requestData.estimatedCost,
          finalCost:           requestData.final_cost            ?? requestData.finalCost,
          budgetClassification:requestData.budget_classification ?? requestData.budgetClassification,
          poNumber:            requestData.po_number             ?? requestData.poNumber,
          createdAt:           requestData.created_at            ?? requestData.createdAt,
          updatedAt:           requestData.updated_at            ?? requestData.updatedAt,
          usoEspecifico:       requestData.uso_especifico        ?? requestData.usoEspecifico,
          fechaEntrega:        requestData.fecha_entrega         ?? requestData.fechaEntrega,
          workLocation:        requestData.work_location         ?? requestData.workLocation,
          justification:       requestData.justification         ?? requestData.justification,
          items:               (requestData.items ?? []).map((item) => ({
            ...item,
            lineNumber:    item.line_number    ?? item.lineNumber,
            description:   item.description,
            unit:          item.unit,
            quantity:      item.quantity,
            estimatedCost: item.estimated_cost ?? item.estimatedCost,
            specifications:item.specifications,
            stockAlmacenObra:      item.stock_almacen_obra      ?? item.stockAlmacenObra,
            stockAlmacenPrincipal: item.stock_almacen_principal ?? item.stockAlmacenPrincipal,
            xAtender:      item.x_atender      ?? item.xAtender,
            presupuestadoAdicional: item.presupuestado_adicional ?? item.presupuestadoAdicional,
            rfiFwo:        item.rfi_fwo        ?? item.rfiFwo,
            estatusGuia:   item.estatus_guia   ?? item.estatusGuia,
            comentarios:   item.comentarios,
          })),
        };
        setReq(normalized);

        // Fetch approvals
        const approvalsRes = await getApprovals(requestData.id);
        setApprovals(approvalsRes.data.results ?? approvalsRes.data ?? []);
      } catch (err) {
        console.error('Error fetching request detail:', err);
        if (err?.response?.status === 404) {
          setNotFound(true);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600 dark:border-t-blue-400" />
      </div>
    );
  }

  if (notFound || !req) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-96 text-center">
        <AlertCircle size={48} className="text-red-300 mb-4" />
        <h2 className="text-xl font-extrabold text-gray-800 font-display">Requerimiento no encontrado</h2>
        <p className="text-gray-500 mt-2 text-sm">
          El ID "{id}" no corresponde a ningún requerimiento.
        </p>
        <button
          onClick={() => navigate('/rq/requests')}
          className="mt-5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 font-display"
        >
          Volver a la lista
        </button>
      </div>
    );
  }

  const role      = primaryRole;
  const statusCfg = STATUS_CONFIG[req.status] ?? {};
  const totalCost = req.items?.reduce((s, i) => s + (i.estimated_cost ?? i.estimatedCost ?? 0), 0)
    ?? req.estimated_cost
    ?? req.estimatedCost
    ?? 0;

  const rqId = req.rq_number ?? req.rqNumber ?? req.id;

  // Inline approval action button per role/status
  function ApprovalActions() {
    if (role === ROLES.PROJECT_RESIDENT && req.status === 'TECHNICAL_REVIEW') {
      return (
        <button
          onClick={() => navigate(`/rq/approvals/tech-review/${rqId}`)}
          className="inline-flex items-center gap-2 px-5 py-3 bg-yellow-500 text-white text-base font-bold rounded-xl hover:bg-yellow-600 hover:shadow-lg transition-all duration-200 shadow-md"
        >
          Revisar Técnicamente <ChevronRight size={15} />
        </button>
      );
    }
    if (role === ROLES.PROJECT_CONTROL && req.status === 'BUDGET_REVIEW') {
      return (
        <button
          onClick={() => navigate(`/rq/approvals/budget-review/${rqId}`)}
          className="inline-flex items-center gap-2 px-5 py-3 bg-purple-600 text-white text-base font-bold rounded-xl hover:bg-purple-700 hover:shadow-lg transition-all duration-200 shadow-md"
        >
          Revisar Presupuesto <ChevronRight size={15} />
        </button>
      );
    }
    if (
      role === ROLES.GENERAL_MANAGER &&
      ['GM_REVIEW', 'COST_OVERRUN_REVIEW', 'ADDITIONAL_REQ'].includes(req.status)
    ) {
      return (
        <button
          onClick={() => navigate(`/rq/approvals/manager/${rqId}`)}
          className="inline-flex items-center gap-2 px-5 py-3 bg-gray-800 text-white text-base font-bold rounded-xl hover:bg-gray-900 hover:shadow-lg transition-all duration-200 shadow-md"
        >
          Aprobar como Gerencia <ChevronRight size={15} />
        </button>
      );
    }
    return null;
  }

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-5">

      {/* ── Top bar: back + print ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver
        </button>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        >
          <Printer size={15} />
          Imprimir
        </button>
      </div>

      {/* ── Status / Progress header card ── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          {/* Left: RQ number + badges + title */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 dark:text-blue-300 dark:bg-blue-500/10 dark:border-blue-500/30">
                {req.rqNumber}
              </span>
              <PriorityBadge priority={req.priority} />
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 mt-2 leading-tight font-display">
              {req.description}
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Building2 size={14} className="text-gray-400" />
                {req.projectCode
                  ? `${req.projectCode} — ${req.projectName}`
                  : req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—'}
              </span>
              <span className="flex items-center gap-1.5">
                <User size={14} className="text-gray-400" />
                {req.requestedByName}
              </span>
              {req.requiredDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar size={14} className="text-gray-400" />
                  Requerido: {formatDate(req.requiredDate)}
                </span>
              )}
            </div>
          </div>

          {/* Right: status badge + action button */}
          <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
            <StatusBadge status={req.status} />
            <ApprovalActions />
          </div>
        </div>

        {/* Lifecycle bar */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-4 font-display">
            Progreso del Requerimiento
          </p>
          <LifecycleBar currentStatus={req.status} />
        </div>
      </div>

      {/* ── Conformity Panel (Step 17-18) — shown to REQUESTER when DELIVERED ── */}
      {role === ROLES.REQUESTER && req.status === STATUS.DELIVERED && !showClaimForm && (
        <div className="bg-white rounded-xl border-2 border-teal-300 dark:border-teal-500/30 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-teal-50 border-b border-teal-200 dark:bg-teal-500/10 dark:border-teal-500/30 flex items-center gap-3">
            <Package size={20} className="text-teal-600 dark:text-teal-400" />
            <div>
              <h2 className="text-base font-bold text-teal-800 dark:text-teal-300">Recepción y Conformidad del RQ</h2>
              <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">Los materiales han sido entregados. ¿Está todo conforme?</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              Verifique que los materiales recibidos coincidan con lo solicitado en cantidad,
              calidad y especificaciones. Si todo está correcto, confirme la conformidad.
              Si hay algún problema, registre un reclamo.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal({
                  title:        'Confirmar Conformidad',
                  message:      '¿Confirma que los materiales recibidos son conformes con lo solicitado? Esta acción cerrará el proceso de entrega.',
                  confirmText:  'Sí, Todo Conforme',
                  confirmColor: 'bg-green-600 hover:bg-green-700',
                  icon:         CheckCircle2,
                  onConfirm:    async () => {
                    setSubmitting(true);
                    try {
                      await performAction(req.id, {
                        action: 'USER_CONFIRMED',
                        acting_role: ROLES.REQUESTER,
                        comments: 'Conformidad confirmada por el solicitante. Materiales recibidos correctamente.',
                      });
                      showToast({ type: 'success', message: 'Conformidad registrada. El requerimiento será cerrado por Logística.' });
                      setTimeout(() => window.location.reload(), 500);
                    } catch (err) {
                      const detail = err?.response?.data?.detail ?? 'Error al procesar.';
                      showToast({ type: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
                    } finally {
                      setSubmitting(false);
                    }
                  },
                })}
                disabled={submitting}
                className="flex flex-col items-center gap-2 px-4 py-5 bg-green-600 text-white rounded-xl hover:bg-green-700 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
              >
                <CheckCircle2 size={28} />
                <span className="text-base font-bold">Sí, Todo Conforme</span>
                <span className="text-xs opacity-80">Materiales recibidos correctamente</span>
              </button>

              <button
                type="button"
                onClick={() => setShowClaimForm(true)}
                disabled={submitting}
                className="flex flex-col items-center gap-2 px-4 py-5 bg-red-600 text-white rounded-xl hover:bg-red-700 hover:shadow-lg transition-all shadow-md disabled:opacity-50"
              >
                <XCircle size={28} />
                <span className="text-base font-bold">No Conforme</span>
                <span className="text-xs opacity-80">Registrar reclamo y solicitar cambio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Claim Form (Step 18.1) — shown when requester clicks "No Conforme" ── */}
      {role === ROLES.REQUESTER && req.status === STATUS.DELIVERED && showClaimForm && (
        <div className="bg-white rounded-xl border-2 border-red-300 dark:border-red-500/30 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-red-50 border-b border-red-200 dark:bg-red-500/10 dark:border-red-500/30 flex items-center gap-3">
            <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
            <div>
              <h2 className="text-base font-bold text-red-800 dark:text-red-300">Registrar Reclamo — Solicitar Cambio</h2>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                Describa las inconformidades. Se enviará a Logística para gestionar el cambio con el proveedor.
              </p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Motivo del Reclamo</label>
              <select
                value={claimText.split('\n')[0]?.startsWith('Motivo:') ? claimText.split('\n')[0].replace('Motivo: ', '') : ''}
                onChange={(e) => {
                  const lines = claimText.split('\n').filter(l => !l.startsWith('Motivo:'));
                  setClaimText(e.target.value ? `Motivo: ${e.target.value}\n${lines.join('\n')}`.trim() : lines.join('\n').trim());
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">— Seleccione —</option>
                <option value="Cantidad incorrecta">Cantidad incorrecta</option>
                <option value="Material dañado">Material dañado</option>
                <option value="Especificaciones no coinciden">Especificaciones no coinciden</option>
                <option value="Material equivocado">Material equivocado</option>
                <option value="Calidad deficiente">Calidad deficiente</option>
                <option value="Entrega incompleta">Entrega incompleta</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Descripción Detallada</label>
              <textarea
                value={claimText}
                onChange={(e) => setClaimText(e.target.value)}
                rows={5}
                placeholder="Describa en detalle qué materiales presentan problemas, qué cantidad falta, qué daños tienen, qué espera recibir como cambio..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowClaimForm(false); setClaimText(''); }}
                className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setConfirmModal({
                  title:        'Confirmar Reclamo',
                  message:      '¿Está seguro de generar un reclamo? Se enviará a Logística para gestionar la revisión y el cambio con el proveedor.',
                  confirmText:  'Sí, Enviar Reclamo',
                  confirmColor: 'bg-red-600 hover:bg-red-700',
                  icon:         XCircle,
                  onConfirm:    async () => {
                    setSubmitting(true);
                    try {
                      await performAction(req.id, {
                        action: 'USER_CLAIMED',
                        acting_role: ROLES.REQUESTER,
                        comments: claimText.trim(),
                      });
                      showToast({ type: 'info', message: 'Reclamo registrado. Logística gestionará el cambio con el proveedor.' });
                      setTimeout(() => window.location.reload(), 500);
                    } catch (err) {
                      const detail = err?.response?.data?.detail ?? 'Error al procesar.';
                      showToast({ type: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
                    } finally {
                      setSubmitting(false);
                    }
                  },
                })}
                disabled={submitting || !claimText.trim()}
                className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all disabled:opacity-50 shadow-md"
              >
                Enviar Reclamo y Solicitar Cambio
              </button>
            </div>
            {!claimText.trim() && (
              <p className="text-xs text-red-500 dark:text-red-400 text-center">Debe describir el motivo del reclamo.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Claim in review notice ── */}
      {role === ROLES.REQUESTER && req.status === STATUS.USER_CLAIM && (
        <div className="bg-amber-50 rounded-xl border-2 border-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30 p-6 flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-bold text-amber-800 dark:text-amber-300">Reclamo en Proceso</h2>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
              Su reclamo fue registrado y enviado a Logística. El equipo gestionará la revisión y
              el cambio con el proveedor. Será notificado cuando se resuelva.
            </p>
          </div>
        </div>
      )}

      {/* ── Conformity confirmed notice ── */}
      {role === ROLES.REQUESTER && req.status === STATUS.USER_CONFORMITY && (
        <div className="bg-green-50 rounded-xl border-2 border-green-300 dark:bg-green-500/10 dark:border-green-500/30 p-6 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-bold text-green-800 dark:text-green-300">Conformidad Confirmada</h2>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1 leading-relaxed">
              Ha confirmado la recepción conforme del requerimiento. Logística procederá al cierre.
            </p>
          </div>
        </div>
      )}

      {/* ── PCC-ADM-FOR-01 Document ── */}
      <div className="bg-white border border-gray-300 shadow-sm rounded-xl overflow-hidden">

        {/* Document label */}
        <div className="px-6 pt-5 pb-3 border-b border-gray-200 flex items-center gap-2">
          <FileText size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
            Documento PCC-ADM-FOR-01
          </span>
        </div>

        {/* Document body — paper-like inner container */}
        <div className="mx-2 sm:mx-6 my-3 sm:my-5 border border-gray-400 rounded-sm overflow-hidden text-sm">

          {/* 1. Header row */}
          <DocumentHeader req={req} />

          {/* 2. Form fields */}
          <DocumentFields req={req} />

          {/* 3. Items table */}
          <DocumentItemsTable items={req.items ?? []} />

          {/* 4. Signatures */}
          <DocumentSignatures approvals={approvals} />
        </div>
      </div>

      {/* ── Bottom section: side panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* LEFT panel */}
        <div className="space-y-5">

          {/* Justification */}
          {req.justification && (
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
              <h2 className="text-sm font-extrabold text-gray-800 mb-3 flex items-center gap-2 font-display">
                <FileText size={15} className="text-gray-400" />
                Justificación
              </h2>
              <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
            </div>
          )}

          {/* Budget info */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
            <h2 className="text-sm font-extrabold text-gray-800 mb-4 flex items-center gap-2 font-display">
              <DollarSign size={15} className="text-gray-400" />
              Información Presupuestal
            </h2>
            <dl className="space-y-3">
              <div className="flex justify-between text-sm border-b border-gray-50 pb-2">
                <dt className="text-gray-500">Costo estimado</dt>
                <dd className="font-semibold text-gray-800">
                  {formatCurrency(req.estimatedCost)}
                </dd>
              </div>
              <div className="flex justify-between text-sm border-b border-gray-50 pb-2">
                <dt className="text-gray-500">Costo final</dt>
                <dd className="font-semibold text-gray-800">
                  {formatCurrency(req.finalCost)}
                </dd>
              </div>
              {req.budgetClassification && (
                <div className="flex justify-between text-sm border-b border-gray-50 pb-2">
                  <dt className="text-gray-500">Clasificación presupuestal</dt>
                  <dd className="font-medium text-gray-700">{
                    ({
                      BC_WITHIN_PROPOSAL: 'Dentro de la Propuesta',
                      BC_ADDITIONAL: 'Requerimiento Adicional',
                      BC_WITHIN_ANNUAL_PLAN: 'Dentro del Plan Anual',
                      BC_OUT_OF_ANNUAL_PLAN: 'Fuera del Plan Anual',
                    })[req.budgetClassification] ?? req.budgetClassification
                  }</dd>
                </div>
              )}
              {req.poNumber && (
                <div className="flex justify-between text-sm border-b border-gray-50 pb-2">
                  <dt className="text-gray-500">N° Orden de Compra</dt>
                  <dd className="font-mono font-bold text-gray-800">{req.poNumber}</dd>
                </div>
              )}
              {req.supplier && (
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">Proveedor</dt>
                  <dd className="font-medium text-gray-700 text-right max-w-[180px] leading-snug">
                    {req.supplier}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* RIGHT panel */}
        <div className="space-y-5">

          {/* Current status card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
            <h2 className="text-sm font-extrabold text-gray-800 mb-4 flex items-center gap-2 font-display">
              <Package size={15} className="text-gray-400" />
              Estado Actual
            </h2>
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${statusCfg.bg ?? 'bg-gray-100'}`}
              >
                <Package size={22} className={statusCfg.text ?? 'text-gray-500'} />
              </div>
              <div>
                <StatusBadge status={req.status} />
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <Clock size={11} />
                  {formatDate(req.updatedAt ?? req.createdAt)}
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 font-display">
                Proxima Accion
              </p>
              <NextAction status={req.status} />
            </div>
          </div>


        </div>
      </div>

      {/* Historial section - full width */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6">
        <h2 className="text-sm font-extrabold text-gray-800 mb-4 font-display">
          Historial del Requerimiento
        </h2>
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
