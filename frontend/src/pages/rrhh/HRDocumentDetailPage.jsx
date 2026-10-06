import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  BadgeCheck,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  FileCog,
  Trash2,
} from 'lucide-react';
import {
  deleteDocument,
  downloadDocument,
  getDocument,
  getDocumentEvents,
  getDocumentTypes,
  issueDocument,
  renderDocumentPdf,
  saveBlob,
  voidDocument,
} from '../../api/hr';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hrErrorCode, hrErrorMessage } from '../../utils/hrErrors';
import HRStatusBadge from '../../components/rrhh/HRStatusBadge';
import HRDialog from '../../components/rrhh/HRDialog';

const MIN_VOID_REASON = 10;
const CURRENCY_SYMBOL = { PEN: 'S/', USD: 'US$' };

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function formatValue(field, value, data) {
  if (value === null || value === undefined || value === '') return '—';
  if (field?.type === 'choice') {
    return field.choices?.find((c) => c.value === value)?.label ?? value;
  }
  if (field?.type === 'date') return formatIsoDate(value);
  if (field?.key === 'gross_salary') {
    const symbol = CURRENCY_SYMBOL[data.currency] ?? '';
    return `${symbol} ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`.trim();
  }
  return String(value);
}

const ACTION_BTN =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 disabled:cursor-not-allowed';

export default function HRDocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { userRoles } = useAuth();
  const canWrite = userRoles.includes('HR_MANAGER');

  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [doc, setDoc] = useState(null);
  const [events, setEvents] = useState({ status: 'loading', rows: [] });
  const [fields, setFields] = useState([]);
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [dialog, setDialog] = useState(null); // 'issue' | 'void' | 'delete' | null
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const reasonRef = useRef(null);

  const fetchDoc = useCallback(async () => {
    setLoad((s) => (s.status === 'ready' ? s : { status: 'loading', error: '' }));
    try {
      const { data } = await getDocument(id);
      setDoc(data);
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: hrErrorMessage(err, 'No se pudo cargar el documento.') });
    }
  }, [id]);

  const fetchEvents = useCallback(async () => {
    try {
      const { data } = await getDocumentEvents(id);
      setEvents({ status: 'ready', rows: Array.isArray(data) ? data : (data.results ?? []) });
    } catch {
      setEvents({ status: 'error', rows: [] });
    }
  }, [id]);

  useEffect(() => {
    fetchDoc();
    fetchEvents();
  }, [fetchDoc, fetchEvents]);

  // Field labels (non-critical: if this fails the raw keys are shown).
  useEffect(() => {
    let cancelled = false;
    getDocumentTypes()
      .then(({ data }) => {
        const spec = (data ?? []).find((t) => t.key === doc?.document_type);
        if (!cancelled && spec) setFields(spec.fields);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [doc?.document_type]);

  const fieldRows = useMemo(() => {
    if (!doc) return [];
    const data = doc.data ?? {};
    const known = fields.filter((f) => data[f.key] !== undefined && data[f.key] !== null && data[f.key] !== '');
    const knownKeys = new Set(known.map((f) => f.key));
    const extra = Object.keys(data).filter((k) => !knownKeys.has(k)).map((k) => ({ key: k, label: k }));
    return [...known, ...extra].map((f) => ({
      key: f.key,
      label: f.label,
      value: formatValue(f.type ? f : null, data[f.key], data),
      wide: f.type === 'text' || f.key === 'worker_address',
    }));
  }, [doc, fields]);

  function openDialog(kind) {
    setDialogError('');
    setReason('');
    setReasonError('');
    setDialog(kind);
  }

  function closeDialog() {
    if (!dialogBusy) setDialog(null);
  }

  async function refreshAll() {
    await Promise.all([fetchDoc(), fetchEvents()]);
  }

  async function runDialogAction(fn, successMsg, afterSuccess) {
    if (dialogBusy) return;
    setDialogBusy(true);
    setDialogError('');
    try {
      await fn();
      setDialog(null);
      showToast({ type: 'success', message: successMsg });
      if (afterSuccess) afterSuccess();
      else await refreshAll();
    } catch (err) {
      setDialogError(hrErrorMessage(err));
      if (hrErrorCode(err) === 'invalid_state') refreshAll();
    } finally {
      setDialogBusy(false);
    }
  }

  function confirmIssue() {
    return runDialogAction(() => issueDocument(id), 'Documento emitido correctamente.');
  }

  function confirmDelete() {
    return runDialogAction(
      () => deleteDocument(id),
      'Borrador eliminado.',
      () => navigate('/rrhh/documentos', { replace: true }),
    );
  }

  function confirmVoid() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_VOID_REASON) {
      setReasonError(`Escribe un motivo de al menos ${MIN_VOID_REASON} caracteres.`);
      reasonRef.current?.focus();
      return undefined;
    }
    setReasonError('');
    return runDialogAction(() => voidDocument(id, trimmed), 'Documento anulado.');
  }

  async function handleDownload(format) {
    if (downloading) return;
    setDownloading(format);
    setActionError('');
    try {
      const { blob, filename } = await downloadDocument(id, format);
      saveBlob(blob, filename);
      fetchEvents();
    } catch (err) {
      const message = hrErrorMessage(err, 'No se pudo descargar el archivo.');
      setActionError(message);
      showToast({ type: 'error', message });
    } finally {
      setDownloading('');
    }
  }

  async function handleGeneratePdf() {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    setActionError('');
    try {
      await renderDocumentPdf(id);
      showToast({ type: 'success', message: 'PDF generado correctamente.' });
      await refreshAll();
    } catch (err) {
      setActionError(hrErrorMessage(err, 'No se pudo generar el PDF.'));
      if (hrErrorCode(err) === 'invalid_state') refreshAll();
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-violet-600" />
          <p className="text-sm text-gray-400">Cargando documento…</p>
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{load.error}</span>
          <button type="button" onClick={fetchDoc} className="inline-flex items-center gap-1.5 font-semibold underline">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
        <Link to="/rrhh/documentos" className="text-sm font-semibold text-violet-600 dark:text-violet-300 underline">
          Volver a documentos
        </Link>
      </div>
    );
  }

  const isDraft = doc.status === 'DRAFT';
  const isIssued = doc.status === 'ISSUED';
  const canGeneratePdf = canWrite && !doc.pdf_available && doc.status !== 'VOIDED';
  const pdfHint = doc.pdf_available
    ? null
    : canGeneratePdf
      ? 'Aún no hay PDF. Puedes generarlo con «Generar PDF» si el entorno lo permite; si no, usa la descarga en Word.'
      : 'El PDF no está disponible para este documento. Usa la descarga en Word.';

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <Link to="/rrhh/documentos" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 mb-3 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <ArrowLeft size={14} aria-hidden="true" /> Volver a documentos
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 font-display break-words">
              {doc.document_type_label}: {doc.subject_name}
            </h1>
            <p className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-2">
              <HRStatusBadge status={doc.status} label={doc.status_label} />
              <span className="font-mono text-xs">{doc.reference_number || 'Sin número (se asigna al emitir)'}</span>
            </p>
          </div>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3">
          {actionError}
        </p>
      )}

      {doc.warnings?.length > 0 && (
        <section aria-label="Advertencias" className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={16} aria-hidden="true" /> Advertencias
          </p>
          <ul className="list-disc pl-6 mt-1 text-sm text-amber-800 dark:text-amber-200 space-y-0.5">
            {doc.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      )}

      {isIssued || doc.status === 'VOIDED' ? (
        <section aria-label="Estado del documento" className="text-sm text-gray-600 bg-white rounded-2xl border border-gray-100 p-5 space-y-1">
          {doc.issued_at && <p>Emitido el {formatDateTime(doc.issued_at)}{doc.issued_by_name ? ` por ${doc.issued_by_name}` : ''}.</p>}
          {doc.status === 'VOIDED' && (
            <p>
              Anulado el {formatDateTime(doc.voided_at)}. <span className="font-semibold">Motivo:</span> {doc.void_reason}
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="hr-doc-actions" className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <h2 id="hr-doc-actions" className="text-sm font-semibold text-gray-700 font-display mb-3">Acciones</h2>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleDownload('docx')}
            disabled={Boolean(downloading)}
            className={`${ACTION_BTN} border border-gray-200 text-gray-700 hover:bg-gray-50`}
          >
            {downloading === 'docx' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
            Descargar Word
          </button>
          <button
            type="button"
            onClick={() => handleDownload('pdf')}
            disabled={!doc.pdf_available || Boolean(downloading)}
            aria-describedby={pdfHint ? 'hr-pdf-hint' : undefined}
            className={`${ACTION_BTN} border border-gray-200 text-gray-700 hover:bg-gray-50`}
          >
            {downloading === 'pdf' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            Descargar PDF
          </button>

          {canGeneratePdf && (
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={generatingPdf}
              className={`${ACTION_BTN} border border-gray-200 text-gray-700 hover:bg-gray-50`}
            >
              {generatingPdf ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileCog size={16} aria-hidden="true" />}
              {generatingPdf ? 'Generando PDF…' : 'Generar PDF'}
            </button>
          )}

          {canWrite && isDraft && (
            <>
              <Link
                to={`/rrhh/documentos/${doc.id}/editar`}
                className={`${ACTION_BTN} border border-gray-200 text-gray-700 hover:bg-gray-50`}
              >
                <Pencil size={16} aria-hidden="true" /> Editar
              </Link>
              <button type="button" onClick={() => openDialog('issue')} className={`${ACTION_BTN} text-white bg-violet-600 hover:bg-violet-700`}>
                <BadgeCheck size={16} aria-hidden="true" /> Emitir
              </button>
              <button type="button" onClick={() => openDialog('delete')} className={`${ACTION_BTN} text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10`}>
                <Trash2 size={16} aria-hidden="true" /> Eliminar borrador
              </button>
            </>
          )}
          {canWrite && isIssued && (
            <button type="button" onClick={() => openDialog('void')} className={`${ACTION_BTN} text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10`}>
              <Ban size={16} aria-hidden="true" /> Anular
            </button>
          )}
        </div>
        {pdfHint && <p id="hr-pdf-hint" className="text-xs text-gray-500 mt-3">{pdfHint}</p>}
      </section>

      <section aria-labelledby="hr-doc-data" className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <h2 id="hr-doc-data" className="text-sm font-semibold text-gray-700 font-display mb-3">Datos del contrato</h2>
        <p className="text-xs text-gray-500 mb-4">
          Plantilla: <span className="font-semibold">{doc.template?.name}</span> · versión {doc.template?.version}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {fieldRows.map((row) => (
            <div key={row.key} className={row.wide ? 'sm:col-span-2' : ''}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{row.label}</dt>
              <dd className="text-sm text-gray-800 break-words whitespace-pre-line">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="hr-doc-events" className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <h2 id="hr-doc-events" className="text-sm font-semibold text-gray-700 font-display mb-3">Bitácora</h2>
        {events.status === 'loading' && <p role="status" className="text-sm text-gray-400">Cargando bitácora…</p>}
        {events.status === 'error' && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            No se pudo cargar la bitácora.{' '}
            <button type="button" onClick={fetchEvents} className="font-semibold underline">Reintentar</button>
          </p>
        )}
        {events.status === 'ready' && events.rows.length === 0 && (
          <p className="text-sm text-gray-400">Sin eventos registrados.</p>
        )}
        {events.status === 'ready' && events.rows.length > 0 && (
          <ol className="space-y-2">
            {events.rows.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="font-semibold text-gray-800">{ev.action_label ?? ev.action}</span>
                <span className="text-gray-500">{ev.actor_name || 'Sistema'}</span>
                <time dateTime={ev.created_at} className="text-xs text-gray-400">{formatDateTime(ev.created_at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Dialogs (only HR_MANAGER can open them) */}
      <HRDialog
        open={dialog === 'issue'}
        title="Emitir documento"
        description="Se asignará un número de referencia y el documento quedará inmutable. Confirma que ya revisaste los datos."
        onClose={closeDialog}
        busy={dialogBusy}
        footer={(
          <>
            <button type="button" onClick={closeDialog} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>Cancelar</button>
            <button type="button" onClick={confirmIssue} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 text-white bg-violet-600 hover:bg-violet-700`}>
              {dialogBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {dialogBusy ? 'Emitiendo…' : 'Emitir'}
            </button>
          </>
        )}
      >
        <div aria-live="assertive">
          {dialogError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{dialogError}</p>}
        </div>
      </HRDialog>

      <HRDialog
        open={dialog === 'delete'}
        title="Eliminar borrador"
        description="El borrador se eliminará definitivamente. Esta acción no se puede deshacer."
        onClose={closeDialog}
        busy={dialogBusy}
        footer={(
          <>
            <button type="button" onClick={closeDialog} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>Cancelar</button>
            <button type="button" onClick={confirmDelete} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 text-white bg-red-600 hover:bg-red-700`}>
              {dialogBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              Eliminar
            </button>
          </>
        )}
      >
        <div aria-live="assertive">
          {dialogError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{dialogError}</p>}
        </div>
      </HRDialog>

      <HRDialog
        open={dialog === 'void'}
        title="Anular documento"
        description="El documento emitido quedará anulado y no se podrá revertir. Indica el motivo; quedará en la bitácora."
        onClose={closeDialog}
        busy={dialogBusy}
        initialFocusRef={reasonRef}
        footer={(
          <>
            <button type="button" onClick={closeDialog} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>Cancelar</button>
            <button type="button" onClick={confirmVoid} disabled={dialogBusy} className={`${ACTION_BTN} flex-1 text-white bg-red-600 hover:bg-red-700`}>
              {dialogBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              Anular documento
            </button>
          </>
        )}
      >
        <label htmlFor="hr-void-reason" className="block text-xs font-semibold text-gray-600 mb-1">
          Motivo de la anulación <span className="text-red-500" aria-hidden="true">*</span>
          <span className="sr-only"> (obligatorio, mínimo {MIN_VOID_REASON} caracteres)</span>
        </label>
        <textarea
          id="hr-void-reason"
          ref={reasonRef}
          rows={3}
          value={reason}
          onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
          aria-required="true"
          aria-invalid={reasonError ? 'true' : undefined}
          aria-describedby={reasonError ? 'hr-void-reason-error' : undefined}
          disabled={dialogBusy}
          className={`w-full px-3 py-2.5 text-sm rounded-xl border bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 ${reasonError ? 'border-red-400 focus:ring-red-500' : 'border-gray-200 focus:ring-violet-500'}`}
        />
        <div aria-live="assertive">
          {reasonError && <p id="hr-void-reason-error" role="alert" className="text-[11px] font-medium text-red-600 dark:text-red-400 mt-1">{reasonError}</p>}
          {dialogError && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mt-2">{dialogError}</p>}
        </div>
      </HRDialog>
    </div>
  );
}
