import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, CheckCircle, ClipboardList, Download, Hourglass, Loader2, MapPin, MapPinOff, PackageCheck,
  RefreshCw, Truck, Undo2,
} from 'lucide-react';
import { deliverRqItems, downloadGroupPdf, getRqPicking, reverseRqDelivery } from '../../api/almacen';
import { useToast } from '../../context/useToast';
import useFileDownload from '../../hooks/useFileDownload';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import HRDialog from '../../components/rrhh/HRDialog';
import {
  Banner, Card, Chip, EmptyBlock, ErrorBlock, Field, LoadingBlock, PageHeader, Stat,
} from '../../components/almacen/ui';
import { btnDanger, btnPrimary, btnSecondary, inputCls, thCls } from '../../components/almacen/uiStyles';
import { formatISODate, localISODate } from '../../utils/almacen';
import {
  BLOCK_REASON_LABELS, ITEM_STATUS_LABELS, NOTES_MAX_LENGTH, REASON_MAX_LENGTH,
  RQ_STAGE_LABELS, buildDeliveryLines, describeDeliveryError, describePickingLoadError, maxQtyText,
  pickingLocation, qtyWithUnit, roleList, validateDeliveryForm, validateReason,
} from '../../utils/rqPicking';

// SYSPCC-029 — Picking y entregas parciales de un RQ (Fase 04 del ciclo del almacén, pasos 1 y 2,
// más las salidas por tandas). El servidor decide qué se puede entregar y a quién se le permite;
// aquí solo se muestra y se valida para dar feedback inmediato.

const STATUS_CHIP = {
  PENDING: { tone: 'gray', icon: Hourglass },
  PARTIAL: { tone: 'amber', icon: PackageCheck },
  COMPLETE: { tone: 'emerald', icon: CheckCircle },
};

const LINK_CHIP = {
  PROPOSED: { tone: 'amber', label: 'Producto propuesto' },
  OFF_CATALOG: { tone: 'gray', label: 'Fuera de catálogo' },
  UNLINKED: { tone: 'gray', label: 'Sin vincular' },
};

const NO_ERRORS = { lines: {}, fields: {}, message: '' };

const timeFormatter = (() => {
  try {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Lima',
    });
  } catch {
    return null;
  }
})();

/** `2026-10-29T14:05:00-05:00` -> `29/10/2026, 14:05` (hora de Lima). */
function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return timeFormatter ? timeFormatter.format(date) : date.toLocaleString('es-PE');
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function SummaryRow({ summary }) {
  return (
    <section aria-label="Resumen del picking" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Completos" value={summary.complete} tone="emerald" icon={CheckCircle} />
      <Stat label="Parciales" value={summary.partial} tone="amber" icon={PackageCheck} />
      <Stat label="Pendientes" value={summary.pending} tone="gray" icon={Hourglass} />
      <Stat label="Bloqueados" value={summary.blocked} tone="red" icon={Ban} hint={`de ${summary.items_total} líneas`} />
    </section>
  );
}

function LocationCell({ item }) {
  const loc = pickingLocation(item);
  if (loc.exact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-gray-700">
        <MapPin size={12} className="text-gray-400" aria-hidden="true" />
        {loc.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
      <MapPinOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      {loc.text}
    </span>
  );
}

function StatusCell({ item }) {
  const cfg = STATUS_CHIP[item.status] ?? STATUS_CHIP.PENDING;
  const reason = item.blocked_reason && item.blocked_reason !== 'COMPLETE'
    ? BLOCK_REASON_LABELS[item.blocked_reason] ?? 'No se puede entregar ahora.'
    : '';
  return (
    <div className="space-y-1.5 min-w-40">
      <Chip tone={cfg.tone} icon={cfg.icon}>{ITEM_STATUS_LABELS[item.status] ?? item.status}</Chip>
      {reason && (
        <p className="flex items-start gap-1 text-xs text-gray-600">
          <Ban size={12} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
          <span>{reason}</span>
        </p>
      )}
    </div>
  );
}

function PickingTable({ items, canForm, quantities, lineErrors, onQuantity }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Lista de picking">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">
          Líneas del requerimiento con su ubicación, stock disponible, cantidades entregadas y estado.
        </caption>
        <thead className="bg-gray-50 text-left">
          <tr>
            <th scope="col" className={thCls}>Línea</th>
            <th scope="col" className={thCls}>Producto</th>
            <th scope="col" className={thCls}>Ubicación</th>
            <th scope="col" className={`${thCls} text-right`}>Disponible</th>
            <th scope="col" className={`${thCls} text-right`}>Solicitado</th>
            <th scope="col" className={`${thCls} text-right`}>Entregado</th>
            <th scope="col" className={`${thCls} text-right`}>Pendiente</th>
            <th scope="col" className={thCls}>Estado</th>
            {canForm && <th scope="col" className={thCls}>A entregar ahora</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const error = lineErrors[item.id];
            const linkChip = LINK_CHIP[item.link_status];
            const hintId = `qty-hint-${item.id}`;
            const errId = `qty-err-${item.id}`;
            return (
              <tr
                key={item.id}
                data-testid={`picking-row-${item.id}`}
                className={`align-top ${error ? 'bg-red-50 dark:bg-red-500/10' : ''}`}
              >
                <td className="px-4 py-3 font-mono text-xs text-gray-600 tabular-nums">{item.line_number}</td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="font-medium text-gray-900">{item.description}</p>
                  <p className="text-xs text-gray-500">
                    {item.product ? <span className="font-mono">{item.product.product_code}</span> : null}
                    {item.product && item.unit ? ' · ' : ''}
                    {item.unit}
                  </p>
                  {linkChip && <Chip tone={linkChip.tone} className="mt-1.5">{linkChip.label}</Chip>}
                </td>
                <td className="px-4 py-3"><LocationCell item={item} /></td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.available_central == null ? '—' : qtyWithUnit(item.available_central, item.unit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{qtyWithUnit(item.quantity, item.unit)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{qtyWithUnit(item.delivered, item.unit)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                  {qtyWithUnit(item.remaining, item.unit)}
                </td>
                <td className="px-4 py-3"><StatusCell item={item} /></td>
                {canForm && (
                  <td className="px-4 py-3">
                    {item.can_deliver ? (
                      <div className="w-36">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          data-qty
                          value={quantities[item.id] ?? ''}
                          onChange={(e) => onQuantity(item.id, e.target.value)}
                          aria-label={`Cantidad a entregar de la línea ${item.line_number}`}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={[error ? errId : null, hintId].filter(Boolean).join(' ')}
                          className={`${inputCls(!!error)} text-right tabular-nums`}
                        />
                        <p id={hintId} className="text-xs text-gray-500 mt-1">
                          Máximo {qtyWithUnit(item.max_deliverable, item.unit)}
                        </p>
                        {error && (
                          <p id={errId} className="text-xs text-red-700 dark:text-red-300 font-medium mt-1">{error}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500" aria-label="No se puede entregar">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReverseDialog({ rqId, delivery, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState({});
  const [serverMessage, setServerMessage] = useState('');
  const [minDate, setMinDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  const reasonRef = useRef(null);
  const today = localISODate();
  const { showToast } = useToast();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    const found = validateReason(reason, date, today, minDate);
    setErrors(found);
    setServerMessage('');
    if (Object.keys(found).length > 0) {
      setTimeout(() => document.querySelector('[role="dialog"] [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = { reason: reason.trim(), ...(date ? { movement_date: date } : {}) };
      const { data } = await reverseRqDelivery(rqId, delivery.id, payload);
      onDone(data);
    } catch (err) {
      const d = describeDeliveryError(err);
      if (!mounted.current) return;
      setErrors(d.fieldErrors);
      if (d.minDate) setMinDate(d.minDate);
      setServerMessage(d.message);
      showToast({ type: 'error', message: d.message, duration: 8000 });
      if (d.refresh) onDone(null, { refresh: true });
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <HRDialog
      open
      busy={submitting}
      onClose={onClose}
      initialFocusRef={reasonRef}
      title={`Anular entrega ${delivery.dispatch_number}`}
      description="Se devolverá al stock lo entregado y quedará una anulación en el historial. No se borra nada."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Motivo de la anulación" required error={errors.reason} hint={`Entre 5 y ${REASON_MAX_LENGTH} caracteres.`}>
          <textarea
            ref={reasonRef}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls(!!errors.reason)}
          />
        </Field>
        <Field label="Fecha de la anulación" error={errors.movement_date} hint="Opcional.">
          <input
            type="date"
            min={minDate || undefined}
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls(!!errors.movement_date)}
          />
        </Field>
        {serverMessage && <Banner tone="red">{serverMessage}</Banner>}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className={btnSecondary}>Cancelar</button>
          <button type="submit" aria-disabled={submitting || undefined} className={btnDanger}>
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Undo2 size={16} aria-hidden="true" />}
            {submitting ? 'Anulando…' : 'Anular entrega'}
          </button>
        </div>
      </form>
    </HRDialog>
  );
}

function DeliveryHistory({ deliveries, items, headingRef, onReverse }) {
  const download = useFileDownload();
  const numberById = new Map(deliveries.map((d) => [d.id, d.dispatch_number]));
  const unitById = new Map(items.map((i) => [i.id, i.unit]));
  const newestFirst = [...deliveries].reverse();
  return (
    <section aria-labelledby="picking-history-title" className="space-y-3">
      <h2
        id="picking-history-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-bold text-gray-900 font-display focus:outline-none"
      >
        Historial de entregas
      </h2>
      {newestFirst.length === 0 ? (
        <Card><EmptyBlock icon={Truck} title="Aún no se registró ninguna entrega" hint="Las entregas parciales aparecerán aquí." /></Card>
      ) : (
        <ol className="space-y-3">
          {newestFirst.map((d) => (
            <li
              key={d.id}
              className={`${d.is_reversal ? 'border-red-200 dark:border-red-500/30' : 'border-gray-100'} bg-white rounded-2xl border p-4 space-y-3`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-gray-900">{d.dispatch_number}</span>
                {d.is_reversal && (
                  <Chip tone="red" icon={Undo2}>
                    Anulación{d.reverses ? ` de ${numberById.get(d.reverses) ?? `#${d.reverses}`}` : ''}
                  </Chip>
                )}
                {d.reversed_by && (
                  <Chip tone="gray" icon={Ban}>
                    Anulada por {numberById.get(d.reversed_by) ?? `#${d.reversed_by}`}
                  </Chip>
                )}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                <div><dt className="text-gray-500">N° de guía</dt><dd className="font-medium text-gray-800 font-mono">{d.dispatch_guide_number || '—'}</dd></div>
                <div><dt className="text-gray-500">Fecha</dt><dd className="font-medium text-gray-800">{formatISODate(d.movement_date) || '—'}</dd></div>
                <div><dt className="text-gray-500">Registrada</dt><dd className="font-medium text-gray-800">{formatStamp(d.dispatched_at) || '—'}</dd></div>
                <div><dt className="text-gray-500">Responsable</dt><dd className="font-medium text-gray-800">{d.dispatched_by || '—'}</dd></div>
              </dl>
              {d.notes && <p className="text-sm text-gray-600"><span className="text-gray-500">Notas: </span>{d.notes}</p>}
              <ul className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-xl">
                {d.lines.map((line) => (
                  <li key={`${d.id}-${line.request_item_id}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-gray-700">
                      <span className="font-mono text-xs text-gray-500">L{line.line_number}</span>{' '}
                      {line.description}
                    </span>
                    <span className="tabular-nums font-semibold text-gray-900 shrink-0">
                      {d.is_reversal ? '− ' : ''}{qtyWithUnit(line.quantity, unitById.get(line.request_item_id))}
                    </span>
                  </li>
                ))}
              </ul>
              {(d.movement_group_id || d.can_reverse) && (
                <div className="flex flex-wrap gap-2">
                  {d.movement_group_id && (
                    <button
                      type="button"
                      onClick={() => download.run(
                        () => downloadGroupPdf(d.movement_group_id),
                        `${d.dispatch_guide_number || d.dispatch_number}.pdf`,
                        'No se pudo descargar el PDF de la entrega. Intente nuevamente.',
                      )}
                      aria-disabled={download.busy || undefined}
                      aria-label={`Descargar PDF de la entrega ${d.dispatch_number}`}
                      className={btnSecondary}
                    >
                      <Download size={16} aria-hidden="true" /> Descargar PDF
                    </button>
                  )}
                  {d.can_reverse && (
                    <button
                      type="button"
                      onClick={(e) => onReverse(d, e.currentTarget)}
                      aria-label={`Anular entrega ${d.dispatch_number}`}
                      className={btnSecondary}
                    >
                      <Undo2 size={16} aria-hidden="true" /> Anular entrega
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

function PickingScreen({ rqId }) {
  const { showToast } = useToast();
  const [load, setLoad] = useState({ status: 'loading', picking: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [date, setDate] = useState(() => localISODate());
  const [minDate, setMinDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [announce, setAnnounce] = useState('');
  const [reverseTarget, setReverseTarget] = useState(null);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  const historyHeadingRef = useRef(null);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const formId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    getRqPicking(rqId)
      .then((res) => { if (alive) setLoad({ status: 'ready', picking: res.data, error: null }); })
      .catch((err) => { if (alive) setLoad({ status: 'error', picking: null, error: describePickingLoadError(err) }); });
    return () => { alive = false; };
  }, [rqId, reloadKey]);

  const retry = () => {
    setLoad({ status: 'loading', picking: null, error: null });
    setReloadKey((k) => k + 1);
  };

  /** Recarga sin vaciar la pantalla; `report` avisa si falla (acción manual). */
  const reloadPicking = useCallback(async ({ report = false } = {}) => {
    setRefreshing(true);
    try {
      const res = await getRqPicking(rqId);
      if (mounted.current) setLoad({ status: 'ready', picking: res.data, error: null });
      if (report && mounted.current) setAnnounce('Lista de picking actualizada.');
    } catch (err) {
      if (report && mounted.current) {
        showToast({ type: 'error', message: describePickingLoadError(err).message, duration: 8000 });
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [rqId, showToast]);

  if (load.status === 'loading') return <LoadingBlock label="Cargando la lista de picking…" className="h-64" />;
  if (load.status === 'error') {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/almacen/pendientes" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline">
          <ArrowLeft size={14} aria-hidden="true" /> Volver a pendientes
        </Link>
        <Card>
          <ErrorBlock
            message={load.error?.message}
            onRetry={load.error?.code === 'INVALID_STATE' || load.error?.code === 'NOT_FOUND' || load.error?.code === 'FORBIDDEN' ? undefined : retry}
          />
        </Card>
      </div>
    );
  }

  const { picking } = load;
  const { request, items, summary, deliveries } = picking;
  const canForm = request.deliverable_state && request.can_deliver;
  const deliverable = items.filter((i) => i.can_deliver);
  const linesToSend = buildDeliveryLines(items, quantities);

  function setQuantity(itemId, value) {
    setQuantities((prev) => ({ ...prev, [itemId]: value }));
    if (errors.lines[itemId]) {
      setErrors((prev) => {
        const lines = { ...prev.lines };
        delete lines[itemId];
        return { ...prev, lines };
      });
    }
  }

  function fillAvailable() {
    const next = {};
    for (const item of deliverable) {
      const text = maxQtyText(item);
      if (text) next[item.id] = text;
    }
    setQuantities(next);
    setErrors(NO_ERRORS);
  }

  function resetForm() {
    setQuantities({});
    setDate(localISODate());
    setNotes('');
    setErrors(NO_ERRORS);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    setSuccess('');
    const check = validateDeliveryForm({ items, quantities, date, notes, minDate });
    if (!check.hasLines && Object.keys(check.fieldErrors).length === 0) {
      const message = 'Indique la cantidad a entregar en al menos una línea.';
      setErrors({ lines: {}, fields: {}, message });
      setAnnounce(message);
      setTimeout(() => formRef.current?.querySelector('input[data-qty]')?.focus(), 0);
      return;
    }
    if (!check.valid) {
      const message = !check.hasLines
        ? 'Indique la cantidad a entregar en al menos una línea y revise los datos marcados.'
        : 'Revise los datos marcados antes de registrar la entrega.';
      setErrors({ lines: check.lineErrors, fields: check.fieldErrors, message });
      setAnnounce(message);
      focusFirstInvalid();
      return;
    }
    setErrors(NO_ERRORS);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        lines: buildDeliveryLines(items, quantities),
        ...(date ? { movement_date: date } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const { data } = await deliverRqItems(rqId, payload);
      if (!mounted.current) return;
      setLoad({ status: 'ready', picking: data.picking, error: null });
      resetForm();
      const number = data.delivery?.dispatch_number;
      const guideNumber = data.delivery?.dispatch_guide_number;
      const message = `Entrega${number ? ` ${number}` : ''} registrada${guideNumber ? ` con la guía ${guideNumber}` : ''}.`;
      setSuccess(message);
      setAnnounce(message);
    } catch (err) {
      const d = describeDeliveryError(err);
      if (!mounted.current) return;
      setErrors({ lines: d.lineErrors, fields: d.fieldErrors, message: d.message });
      if (d.minDate) setMinDate(d.minDate);
      showToast({ type: 'error', message: d.message, duration: 8000 });
      focusFirstInvalid();
      if (d.refresh) reloadPicking();
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  function handleReverseDone(data, options = {}) {
    if (options.refresh) {
      setReverseTarget(null);
      reloadPicking();
      return;
    }
    if (data?.picking) setLoad({ status: 'ready', picking: data.picking, error: null });
    setReverseTarget(null);
    const number = data?.delivery?.dispatch_number;
    const message = `Entrega anulada${number ? `: se registró la anulación ${number}` : ''}.`;
    setSuccess(message);
    setAnnounce(message);
    // El botón que abrió el diálogo desaparece (la entrega ya está anulada): el foco va al historial.
    setTimeout(() => historyHeadingRef.current?.focus(), 0);
  }

  const stageLabel = RQ_STAGE_LABELS[request.status] ?? request.status;
  const origin = request.project
    ? `${request.project}${request.project_code ? ` · ${request.project_code}` : ''}`
    : request.department ?? '—';
  const needDate = formatISODate(request.fecha_necesidad);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Link to="/almacen/pendientes" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline">
        <ArrowLeft size={14} aria-hidden="true" /> Volver a pendientes
      </Link>

      <PageHeader
        icon={ClipboardList}
        title={`Picking y entrega · ${request.rq_number}`}
        subtitle={`${origin} · Solicitante: ${request.requested_by}${needDate ? ` · Necesidad: ${needDate}` : ''}`}
        actions={(
          <button
            type="button"
            onClick={() => reloadPicking({ report: true })}
            aria-disabled={refreshing || undefined}
            className={btnSecondary}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Actualizar
          </button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="blue">{stageLabel}</Chip>
        <Chip tone="gray">{request.flow === 'OPERATIONS' ? 'Operaciones' : 'Administración'}</Chip>
      </div>

      {/* Región viva siempre montada: el texto se escribe después (se anuncia de forma fiable). */}
      <p aria-live="polite" className="sr-only">{announce}</p>

      {success && <Banner tone="emerald">{success}</Banner>}

      {!request.deliverable_state && (
        <Banner tone="blue">
          El requerimiento está en «{stageLabel}» y ya no admite nuevas entregas. Puede consultar el historial.
        </Banner>
      )}
      {request.deliverable_state && !request.can_deliver && (
        <Banner tone="amber">
          Solo lectura: registrar entregas en este estado corresponde a {roleList(request.deliver_roles) || 'otro rol'}.
        </Banner>
      )}

      <SummaryRow summary={summary} />

      <form id={formId} ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900 font-display">Lista de picking</h2>
            {canForm && deliverable.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={fillAvailable} className={btnSecondary}>
                  Completar con lo disponible
                </button>
                <button type="button" onClick={() => { setQuantities({}); setErrors(NO_ERRORS); }} className={btnSecondary}>
                  Borrar cantidades
                </button>
              </div>
            )}
          </div>
          {items.length === 0 ? (
            <EmptyBlock icon={ClipboardList} title="El requerimiento no tiene líneas" />
          ) : (
            <PickingTable
              items={items}
              canForm={canForm}
              quantities={quantities}
              lineErrors={errors.lines}
              onQuantity={setQuantity}
            />
          )}
        </Card>

        {canForm && (
          <Card className="p-4 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 font-display">Registrar entrega parcial</h2>
            <p className="text-xs text-gray-600">El N° de guía se genera automáticamente al registrar la entrega.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Fecha de la entrega" error={errors.fields.movement_date}>
                <input
                  type="date"
                  min={minDate || undefined}
                  max={localISODate()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls(!!errors.fields.movement_date)}
                />
              </Field>
              <Field label="Notas" error={errors.fields.notes} hint={`Opcional. Hasta ${NOTES_MAX_LENGTH} caracteres.`}>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={NOTES_MAX_LENGTH}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputCls(!!errors.fields.notes)}
                />
              </Field>
            </div>
            {errors.message && <Banner tone="red">{errors.message}</Banner>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" aria-disabled={submitting || undefined} className={btnPrimary}>
                {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Truck size={16} aria-hidden="true" />}
                {submitting ? 'Registrando…' : 'Registrar entrega'}
              </button>
              <p className="text-xs text-gray-500">
                {linesToSend.length === 0
                  ? 'Ninguna línea con cantidad todavía.'
                  : `Se entregará${linesToSend.length === 1 ? ' 1 línea' : `n ${linesToSend.length} líneas`}. El estado del requerimiento no cambia.`}
              </p>
            </div>
          </Card>
        )}
      </form>

      <DeliveryHistory
        deliveries={deliveries}
        items={items}
        headingRef={historyHeadingRef}
        onReverse={(delivery) => setReverseTarget(delivery)}
      />

      {reverseTarget && (
        <ReverseDialog
          key={reverseTarget.id}
          rqId={rqId}
          delivery={reverseTarget}
          onClose={() => setReverseTarget(null)}
          onDone={handleReverseDone}
        />
      )}
    </div>
  );
}

export default function PickingPage() {
  const { id } = useParams();
  return <PickingScreen key={id} rqId={id} />;
}
