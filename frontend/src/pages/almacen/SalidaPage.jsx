import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpFromLine, Check, CheckCircle, Download, History, Loader2, Plus, Printer, RotateCcw, Trash2,
} from 'lucide-react';
import {
  deliverRqItems, downloadGroupPdf, getInventory, getMovements, getRqPicking, registerEppDelivery,
  registerExitBatch,
} from '../../api/almacen';
import { useAuth } from '../../context/useAuth';
import { useToast } from '../../context/useToast';
import useFileDownload from '../../hooks/useFileDownload';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import NumberInput from '../../components/ui/NumberInput';
import ClearFormDialog from '../../components/almacen/ClearFormDialog';
import ItemCombobox from '../../components/almacen/ItemCombobox';
import RqCombobox from '../../components/almacen/RqCombobox';
import RqDeliveryLines from '../../components/almacen/RqDeliveryLines';
import WorkerCombobox from '../../components/almacen/WorkerCombobox';
import { LocationChip } from '../../components/almacen/chips';
import { Banner, Card, ErrorBlock, Field, FocusHeading, LoadingBlock, PageHeader } from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls } from '../../components/almacen/uiStyles';
import { COUNTER_ROLES } from '../../data/almacenRoles';
import { EXIT_MODES, WAREHOUSES } from '../../data/almacenConstants';
import {
  availableStock, compact, countErrors, describeExitError, formatISODate, formatQty, hasAnyRole, localISODate, nextLineId,
  stockShortageMessage, validateMovementDate, validateQuantity,
} from '../../utils/almacen';
import {
  NOTES_MAX_LENGTH, RQ_STAGE_LABELS, describeDeliveryError, describePickingLoadError, initRqSelection,
  mergeRqSelection, roleList, validateRqSelection,
} from '../../utils/rqPicking';

const newLine = (inventory = '') => ({ id: nextLineId(), inventory, quantity: '' });

const DESTINATION_PLACEHOLDER = {
  PROJECT: 'Ej.: Proyecto Arequipa',
  DEPARTMENT: 'Ej.: Administración',
  ADJUSTMENT: 'Motivo del ajuste',
};

/** Aviso informativo: última entrega del ítem al trabajador elegido (solo si está vinculado a Personal). */
function LastDelivery({ workerId, item }) {
  const [info, setInfo] = useState({ key: '', text: '' });
  const key = workerId && item ? `${workerId}:${item.id}` : '';

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await getMovements({
          destination_personal: workerId, movement_type: 'EXIT', search: item.product_code, page_size: 1,
        });
        const last = (res?.data?.results ?? [])[0];
        const text = last
          ? `Última entrega de este ítem al trabajador: ${last.movement_date ? formatISODate(last.movement_date) : 'sin fecha'} (${formatQty(last.quantity)} ${last.inventory_unit ?? ''})`.trim()
          : '';
        if (alive) setInfo({ key, text });
      } catch {
        if (alive) setInfo({ key, text: '' });
      }
    })();
    return () => { alive = false; };
  }, [key, workerId, item]);

  if (!key || info.key !== key || !info.text) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300">
      <History size={12} aria-hidden="true" /> {info.text}
    </p>
  );
}

export default function SalidaPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { userRoles } = useAuth();
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('item') ?? '';
  const download = useFileDownload();

  const canCounter = hasAnyRole(userRoles, COUNTER_ROLES);
  const siteOnly = canCounter && !userRoles.includes('CENTRAL_WAREHOUSE');
  const modes = canCounter ? EXIT_MODES : EXIT_MODES.filter((m) => m.value !== 'EMPLOYEE');

  const makeHeader = useCallback(() => ({
    mode: modes[0].value,
    movement_date: localISODate(),
    warehouse: siteOnly ? 'SITE' : 'CENTRAL',
    worker: null,
    destination_detail: '',
    requested_by: '',
    notes: '',
  }), [modes, siteOnly]);

  const [header, setHeader] = useState(makeHeader);
  const [lines, setLines] = useState(() => [newLine(preselected)]);
  const [catalog, setCatalog] = useState({ status: 'loading', items: [] });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [rq, setRq] = useState(null);
  const [rqLoad, setRqLoad] = useState({ key: '', status: 'loading', picking: null, error: null });
  const [rqReload, setRqReload] = useState(0);
  const [selection, setSelection] = useState({});
  const [rqLineErrors, setRqLineErrors] = useState({});
  const [minDate, setMinDate] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [duplicateExit, setDuplicateExit] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [result, setResult] = useState(null);
  const inFlight = useRef(false);
  const addButtonRef = useRef(null);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();

  const rqId = rq?.id ?? null;
  // Con un RQ elegido la salida es una entrega de ese requerimiento: modo, destino y trabajador no aplican.
  const employee = !rq && header.mode === 'EMPLOYEE';
  const rqKey = `${rqId}:${rqReload}`;
  const rqReady = Boolean(rq) && rqLoad.key === rqKey && rqLoad.status === 'ready';
  const rqStatus = !rq ? 'idle' : (rqLoad.key === rqKey ? rqLoad.status : 'loading');
  const rqPicking = rqReady ? rqLoad.picking : null;
  const rqCanDeliver = Boolean(rqPicking?.request?.deliverable_state && rqPicking?.request?.can_deliver);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await getInventory({ no_page: true });
      const data = res.data?.results ?? res.data ?? [];
      setCatalog({ status: 'ready', items: Array.isArray(data) ? data : [] });
    } catch {
      setCatalog({ status: 'error', items: [] });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadCatalog, 0);
    return () => clearTimeout(timer);
  }, [loadCatalog]);

  useEffect(() => {
    if (rqId == null) return undefined;
    let alive = true;
    const key = `${rqId}:${rqReload}`;
    getRqPicking(rqId)
      .then((res) => {
        if (!alive) return;
        setRqLoad({ key, status: 'ready', picking: res.data, error: null });
        setSelection(initRqSelection(res.data?.items));
        setRqLineErrors({});
      })
      .catch((err) => {
        if (alive) setRqLoad({ key, status: 'error', picking: null, error: describePickingLoadError(err) });
      });
    return () => { alive = false; };
  }, [rqId, rqReload]);

  // RQ elegido "ahora": una recarga tardía de otro RQ (ya quitado) no debe escribir en el actual.
  const rqIdRef = useRef(rqId);
  useEffect(() => { rqIdRef.current = rqId; }, [rqId]);

  /** Recarga el picking sin perder lo que el usuario ya tecleó (el stock o lo pendiente cambió). */
  const reloadRqPicking = async () => {
    if (rqId == null) return;
    try {
      const res = await getRqPicking(rqId);
      if (rqIdRef.current !== rqId) return;
      setRqLoad({ key: `${rqId}:${rqReload}`, status: 'ready', picking: res.data, error: null });
      setSelection((prev) => mergeRqSelection(res.data?.items, prev));
    } catch {
      // El aviso del error original ya está en pantalla; «Actualizar» queda disponible.
    }
  };

  const chooseRq = (next) => {
    setRq(next);
    setSelection({});
    setRqLineErrors({});
    setMinDate('');
    setErrors({});
    setSubmitError('');
    setRqLoad({ key: '', status: 'loading', picking: null, error: null });
  };

  const itemById = (id) => catalog.items.find((i) => String(i.id) === String(id));
  const setH = (field) => (e) => {
    setHeader((prev) => ({ ...prev, [field]: e.target.value }));
  };
  const updateLine = (id, field, value) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  // Al quitar una fila el foco pasa a la fila vecina (o a «Agregar ítem»): no se pierde en el body.
  const removeLine = (id) => {
    const idx = lines.findIndex((l) => l.id === id);
    const neighbour = lines[idx - 1] ?? lines[idx + 1];
    setLines((prev) => prev.filter((l) => l.id !== id));
    setTimeout(() => {
      const target = neighbour ? document.getElementById(`exit-item-${neighbour.id}`) : null;
      (target ?? addButtonRef.current)?.focus();
    }, 0);
  };
  const addLine = () => {
    const line = newLine();
    setLines((prev) => [...prev, line]);
    setTimeout(() => document.getElementById(`exit-item-${line.id}`)?.focus(), 0);
  };
  // Ctrl+Enter (o Cmd+Enter) en «Cantidad» agrega otro ítem si el actual está completo.
  // Enter a secas envía el formulario, igual que en el resto de los campos.
  const onQuantityKeyDown = (line) => (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (line.inventory && Number(line.quantity) > 0) addLine();
  };

  const stockOf = useCallback((item) => availableStock(item, header.warehouse), [header.warehouse]);

  // Stock insuficiente en vivo: la cantidad total pedida de cada ítem contra lo disponible.
  const requestedByItem = {};
  lines.forEach((l) => {
    if (l.inventory && Number(l.quantity) > 0) {
      requestedByItem[l.inventory] = (requestedByItem[l.inventory] ?? 0) + Number(l.quantity);
    }
  });
  const shortage = (line) => {
    const item = itemById(line.inventory);
    if (!item || !(Number(line.quantity) > 0)) return '';
    const requested = requestedByItem[line.inventory];
    const available = stockOf(item);
    return requested > available ? stockShortageMessage(item.product_code, available, requested) : '';
  };
  const hasShortage = lines.some((l) => shortage(l));

  const dateCheck = validateMovementDate(header.movement_date);
  const dirty = Boolean(rq) || lines.some((l) => l.inventory || l.quantity)
    || Boolean(header.worker || header.destination_detail.trim() || header.requested_by.trim() || header.notes.trim());

  const validate = () => {
    const errs = { lines: {} };
    if (dateCheck.error) errs.movement_date = dateCheck.error;
    if (employee && !header.worker) errs.worker = 'Seleccione o escriba el trabajador que recibe.';
    if (!employee && !header.destination_detail.trim()) {
      errs.destination_detail = header.mode === 'ADJUSTMENT' ? 'Indique el motivo del ajuste.' : 'Ingrese el destino.';
    }
    lines.forEach((line) => {
      const item = itemById(line.inventory);
      const lineErrs = {};
      if (!line.inventory) lineErrs.item = 'Seleccione un ítem.';
      else if (!item) lineErrs.item = 'El ítem seleccionado no existe.';
      const qtyError = validateQuantity(line.quantity, item?.unit);
      if (qtyError) lineErrs.qty = qtyError;
      if (Object.keys(lineErrs).length) errs.lines[line.id] = lineErrs;
    });
    return errs;
  };

  const errorCount = countErrors(errors) + Object.keys(rqLineErrors).length;

  const send = async () => {
    const items = lines.map((l) => ({ inventory: Number(l.inventory), quantity: Number(l.quantity) }));
    const common = { warehouse: header.warehouse, movement_date: header.movement_date, items };

    if (employee) {
      // Un trabajador siempre va por la entrega de EPP; el N° de guía lo genera el servidor.
      const { worker } = header;
      return registerEppDelivery({
        ...common,
        recipient: worker.kind === 'personal' ? { personal: worker.id } : { name: worker.name },
        ...compact({ notes: header.notes }),
      });
    }
    const requestedBy = header.requested_by.trim();
    const notes = [requestedBy && `Solicitado por: ${requestedBy}`, header.notes.trim()].filter(Boolean).join('. ');
    return registerExitBatch({
      ...common,
      destination_type: header.mode,
      destination_detail: header.destination_detail.trim(),
      ...compact({ notes }),
    });
  };

  /** Aviso pasajero: «Egreso registrado. Guía GR-…» (o el vale interno si el servidor no mandó guía). */
  const announce = (registered, guideNumber, groupNumber) => {
    let tail = '.';
    if (guideNumber) tail = `. Guía ${guideNumber}`;
    else if (groupNumber) tail = `. Vale interno ${groupNumber}`;
    showToast({ type: 'success', message: `${registered}${tail}` });
  };

  const submitFree = async ({ another = false } = {}) => {
    if (catalog.status !== 'ready') return;
    if (hasShortage) {
      focusFirstInvalid();
      return;
    }
    const errs = validate();
    setErrors(errs);
    if (errs.movement_date || errs.worker || errs.destination_detail || Object.keys(errs.lines).length) {
      focusFirstInvalid();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    setSubmitError('');
    setDuplicateExit(false);
    try {
      const { data } = await send();
      const groupNumber = data?.group_number ?? '';
      const guideNumber = data?.internal_guide_number ?? data?.guide_number ?? '';
      // «Entrega registrada» / «Egreso registrado» (gender agrees).
      announce(employee ? 'Entrega registrada' : 'Egreso registrado', guideNumber, groupNumber);
      loadCatalog();
      if (another) {
        setHeader((prev) => ({ ...makeHeader(), movement_date: prev.movement_date, warehouse: prev.warehouse, mode: prev.mode }));
        setLines([newLine()]);
        setErrors({});
        setTimeout(() => document.getElementById('exit-worker')?.focus(), 0);
      } else {
        setResult({
          groupId: data?.id,
          groupNumber,
          guideNumber,
          movementId: data?.movements?.[0]?.id,
          count: lines.length,
          employee,
          rq: null,
        });
      }
    } catch (err) {
      // Además del aviso pasajero, queda un mensaje fijo junto a los botones hasta el próximo intento.
      const failure = describeExitError(err);
      const { message } = failure;
      setSubmitError(message);
      setDuplicateExit(failure.duplicate);
      showToast({ type: 'error', message, duration: 8000 });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const submitRq = async () => {
    if (!rqReady || !rqCanDeliver) return;
    const errs = {};
    if (dateCheck.error) errs.movement_date = dateCheck.error;
    else if (minDate && header.movement_date < minDate) {
      errs.movement_date = `La fecha no puede ser anterior al ${formatISODate(minDate)}.`;
    }
    const notes = header.notes.trim();
    if (notes.length > NOTES_MAX_LENGTH) errs.notes = `La observación admite hasta ${NOTES_MAX_LENGTH} caracteres.`;
    const check = validateRqSelection(rqPicking.items, selection);
    setErrors(errs);
    setRqLineErrors(check.lineErrors);
    if (!check.valid || Object.keys(errs).length) {
      if (!check.valid && Object.keys(check.lineErrors).length === 0) {
        setSubmitError('Marque al menos una línea con cantidad para entregar.');
      } else {
        setSubmitError('');
      }
      focusFirstInvalid();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    setSubmitError('');
    try {
      const { data } = await deliverRqItems(rqId, {
        lines: check.lines,
        movement_date: header.movement_date,
        ...(notes ? { notes } : {}),
      });
      const delivery = data?.delivery ?? {};
      const guideNumber = delivery.dispatch_guide_number ?? '';
      const groupNumber = delivery.dispatch_number ?? '';
      announce('Entrega registrada', guideNumber, groupNumber);
      setResult({
        groupId: delivery.movement_group_id,
        groupNumber,
        guideNumber,
        movementId: delivery.first_movement_id,
        count: check.lines.length,
        employee: false,
        rq: { id: rqId, number: rq.rq_number },
      });
    } catch (err) {
      const d = describeDeliveryError(err);
      setRqLineErrors(d.lineErrors);
      if (d.fieldErrors.movement_date) setErrors((prev) => ({ ...prev, movement_date: d.fieldErrors.movement_date }));
      if (d.minDate) setMinDate(d.minDate);
      setSubmitError(d.message);
      showToast({ type: 'error', message: d.message, duration: 8000 });
      focusFirstInvalid();
      if (d.refresh) reloadRqPicking();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const submit = async (options) => {
    if (inFlight.current) return;
    if (rq) await submitRq();
    else await submitFree(options);
  };

  const reset = () => {
    setHeader(makeHeader());
    setLines([newLine()]);
    setErrors({});
    setSubmitError('');
    setDuplicateExit(false);
    setResult(null);
    chooseRq(null);
  };

  const toggleLine = (id, include) => {
    setSelection((prev) => ({ ...prev, [id]: { ...prev[id], include } }));
    setRqLineErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const setLineQuantity = (id, quantity) => {
    setSelection((prev) => ({ ...prev, [id]: { ...prev[id], quantity } }));
    setRqLineErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const suggestAll = () => { setSelection(initRqSelection(rqPicking?.items)); setRqLineErrors({}); };
  const clearAll = () => {
    setSelection((prev) => Object.fromEntries(Object.entries(prev).map(([id, v]) => [id, { ...v, include: false }])));
    setRqLineErrors({});
  };
  const submitBlocked = saving || (rq ? !rqReady || !rqCanDeliver : hasShortage || catalog.status !== 'ready');
  const includedCount = Object.values(selection).filter((v) => v.include).length;

  // «Limpiar formulario» no es un cancelar: borra lo cargado, así que con datos pide confirmación.
  const requestClear = () => {
    if (dirty) setClearOpen(true);
    else reset();
  };

  if (result) {
    return (
      <div className="max-w-lg mx-auto mt-8 sm:mt-16">
        <Card className="p-8 sm:p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-rose-500" aria-hidden="true" />
          </div>
          <FocusHeading>{result.employee || result.rq ? 'Entrega registrada' : 'Egreso registrado'}</FocusHeading>
          <p className="text-sm text-gray-600">
            {result.count} {result.count === 1 ? 'ítem' : 'ítems'}
            {result.rq && <> del requerimiento <strong className="font-mono">{result.rq.number}</strong></>}.
            {result.groupNumber && <> Vale interno <strong className="font-mono">{result.groupNumber}</strong>.</>}
          </p>
          {result.guideNumber && (
            <div
              role="group"
              aria-label="Guía generada"
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-4 py-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300 font-display">N° de guía</p>
              <p className="mt-0.5 text-2xl font-black font-mono tabular-nums text-gray-900">{result.guideNumber}</p>
              <p className="mt-1 text-xs text-gray-600">Se generó automáticamente. Es un documento interno; no reemplaza la guía de remisión electrónica.</p>
            </div>
          )}
          {result.rq && (
            <p className="mt-3 text-xs text-gray-600">
              Lo entregado ya descuenta lo pendiente y actualiza el avance en el Master de RQ.{' '}
              <Link to={`/almacen/pendientes/${result.rq.id}/picking`} className="font-semibold underline">Ver el picking del requerimiento</Link>.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {result.movementId && (
              <button type="button" onClick={() => navigate(`/almacen/salida/${result.movementId}/voucher`)} className={`${btnPrimary} flex-1`}>
                <Printer size={16} aria-hidden="true" /> Imprimir vale
              </button>
            )}
            {result.groupId && (
              <button
                type="button"
                onClick={() => download.run(() => downloadGroupPdf(result.groupId), `${result.guideNumber || result.groupNumber || 'vale'}.pdf`, 'No se pudo descargar el PDF. Intente nuevamente.')}
                aria-disabled={download.busy}
                className={`${btnSecondary} flex-1`}
              >
                <Download size={16} aria-hidden="true" /> Descargar PDF
              </button>
            )}
          </div>
          <button type="button" onClick={reset} className={`${btnSecondary} w-full mt-3`}>
            <RotateCcw size={16} aria-hidden="true" /> {result.employee || result.rq ? 'Registrar otra entrega' : 'Registrar otro egreso'}
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Entrega / Egreso de material"
        subtitle="Registre lo que sale del almacén y descuente el stock (picking y despacho)."
        icon={ArrowUpFromLine}
      />

      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="space-y-5">
        <Card className="p-5 sm:p-7 space-y-5">
          {!siteOnly && (
            <Field label="RQ pendiente por entregar (opcional)" id="exit-rq">
              <RqCombobox value={rq} onChange={chooseRq} disabled={saving} />
            </Field>
          )}

          {!rq && (
          <fieldset>
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display mb-2">Tipo de egreso</legend>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {modes.map((m) => (
                <label key={m.value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="exit-mode"
                    value={m.value}
                    checked={header.mode === m.value}
                    onChange={() => {
                      setErrors({});
                      setHeader((prev) => ({ ...prev, mode: m.value }));
                    }}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-11 items-center justify-center gap-1.5 text-center px-2 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 peer-checked:bg-rose-50 peer-checked:border-rose-400 peer-checked:ring-2 peer-checked:ring-rose-400 peer-checked:font-bold peer-checked:text-rose-700 dark:peer-checked:bg-rose-500/10 dark:peer-checked:border-rose-500/50 dark:peer-checked:ring-rose-500/50 dark:peer-checked:text-rose-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rose-500 font-display">
                    {header.mode === m.value && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                    {m.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Fecha" required error={errors.movement_date}>
              <input type="date" value={header.movement_date} min={rq ? minDate || undefined : undefined} max={localISODate()} onChange={setH('movement_date')} className={inputCls(!!errors.movement_date)} />
            </Field>
            <Field
              label="Almacén"
              required
              hint={rq ? 'La entrega de un requerimiento sale siempre del Almacén Central.' : undefined}
            >
              <select value={rq ? 'CENTRAL' : header.warehouse} onChange={setH('warehouse')} disabled={siteOnly || Boolean(rq)} className={inputCls()}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
          </div>
          {dateCheck.warning && <Banner tone="amber" live>{dateCheck.warning}</Banner>}

          {rq ? null : employee ? (
            <Field label="Trabajador" required error={errors.worker} id="exit-worker">
              <WorkerCombobox
                value={header.worker}
                onChange={(worker) => setHeader((prev) => ({ ...prev, worker }))}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label={header.mode === 'ADJUSTMENT' ? 'Motivo del ajuste' : 'Destino'} required error={errors.destination_detail}>
                <input value={header.destination_detail} onChange={setH('destination_detail')} className={inputCls(!!errors.destination_detail)} placeholder={DESTINATION_PLACEHOLDER[header.mode]} />
              </Field>
              <Field label="Solicitado por">
                <input value={header.requested_by} onChange={setH('requested_by')} className={inputCls()} placeholder="Nombre del solicitante" />
              </Field>
            </div>
          )}

          <Field label="Observación" error={errors.notes}>
            <textarea rows={2} value={header.notes} onChange={setH('notes')} className={`${inputCls()} resize-none`} placeholder="Opcional" />
          </Field>
        </Card>

        {rq ? (
          <Card className="p-5 sm:p-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display">
                Líneas del requerimiento {rq.rq_number}
                {rqReady && <span className="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 font-bold">{includedCount} de {rqPicking.items.filter((i) => i.can_deliver).length}</span>}
              </h2>
              {rqReady && rqCanDeliver && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={suggestAll} className={btnSecondary}>Completar con lo sugerido</button>
                  <button type="button" onClick={clearAll} className={btnSecondary}>Quitar todas</button>
                </div>
              )}
            </div>

            {rqStatus === 'loading' && <LoadingBlock label="Cargando los ítems pendientes…" className="h-24" />}
            {rqStatus === 'error' && (
              <ErrorBlock
                message={rqLoad.error?.message}
                onRetry={['INVALID_STATE', 'NOT_FOUND', 'FORBIDDEN'].includes(rqLoad.error?.code) ? undefined : () => setRqReload((k) => k + 1)}
              />
            )}
            {rqReady && !rqCanDeliver && (
              <Banner tone="amber">
                {rqPicking.request.deliverable_state
                  ? `Solo lectura: registrar entregas en este estado corresponde a ${roleList(rqPicking.request.deliver_roles) || 'otro rol'}.`
                  : `El requerimiento está en «${RQ_STAGE_LABELS[rqPicking.request.status] ?? rqPicking.request.status}» y ya no admite nuevas entregas.`}
              </Banner>
            )}
            {rqReady && rqPicking.items.length === 0 && (
              <p className="text-sm text-gray-600">El requerimiento no tiene líneas por entregar.</p>
            )}
            {rqReady && rqPicking.items.length > 0 && (
              <RqDeliveryLines
                items={rqPicking.items}
                selection={selection}
                errors={rqLineErrors}
                disabled={saving || !rqCanDeliver}
                onToggle={toggleLine}
                onQuantity={setLineQuantity}
              />
            )}
            {rqReady && (
              <p className="text-xs text-gray-500">
                Cantidad sugerida = lo menor entre lo pendiente y el stock del Almacén Central. No puede entregar más que eso.
              </p>
            )}
          </Card>
        ) : (
        <Card className="p-5 sm:p-7 space-y-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display">
            Ítems a entregar <span className="ml-1.5 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 font-bold">{lines.length}</span>
          </h2>

          {catalog.status === 'loading' && <LoadingBlock label="Cargando ítems…" className="h-24" />}
          {catalog.status === 'error' && <ErrorBlock message="No se pudo cargar el catálogo de ítems." onRetry={loadCatalog} />}

          {catalog.status === 'ready' && (
            <ul className="space-y-3">
              {lines.map((line, idx) => {
                const item = itemById(line.inventory);
                const lineErr = errors.lines?.[line.id] ?? {};
                const short = shortage(line);
                const available = item ? stockOf(item) : 0;
                return (
                  <li key={line.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div role="group" aria-label={`Ítem ${idx + 1}`} className="flex gap-3 items-start">
                      <div className="flex-1 min-w-0 space-y-3">
                        <Field label={`Ítem ${idx + 1}`} id={`exit-item-${line.id}`} required error={lineErr.item}>
                          <ItemCombobox
                            items={catalog.items}
                            value={line.inventory}
                            requireStock
                            getStock={stockOf}
                            onChange={(v) => updateLine(line.id, 'inventory', v)}
                          />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                          <div onKeyDown={onQuantityKeyDown(line)}>
                            <Field label={`Cantidad${item?.unit ? ` (${item.unit})` : ''}`} id={`exit-qty-${line.id}`} required error={lineErr.qty ?? short}>
                              <NumberInput value={line.quantity} onChange={(v) => updateLine(line.id, 'quantity', v)} className={inputCls(!!(lineErr.qty || short))} placeholder="0" />
                            </Field>
                          </div>
                          {item && (
                            <div className="sm:col-span-2 space-y-1 pt-1 sm:pt-6">
                              <p className="text-xs text-gray-600">
                                Disponible: <strong className={`tabular-nums ${available > 0 ? 'text-gray-900' : 'text-red-600 dark:text-red-400'}`}>{formatQty(available)}</strong>
                                {item.unit ? ` ${item.unit}` : ''}
                              </p>
                              <p className="text-xs text-gray-600 flex items-center gap-1.5">Ubicación: <LocationChip item={item} /></p>
                            </div>
                          )}
                        </div>
                        {employee && header.worker?.kind === 'personal' && item && (
                          <LastDelivery workerId={header.worker.id} item={item} />
                        )}
                      </div>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          aria-label={`Quitar ítem ${idx + 1}`}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {catalog.status === 'ready' && (
            <>
              <button ref={addButtonRef} type="button" onClick={addLine} className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-rose-300 dark:border-rose-500/30 text-sm font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-display">
                <Plus size={16} aria-hidden="true" /> Agregar ítem
              </button>
              <p className="text-xs text-gray-500">Atajo: Ctrl+Enter en «Cantidad» agrega otro ítem.</p>
            </>
          )}
        </Card>
        )}

        {errorCount > 0 && (
          <Banner tone="red" live="assertive">
            Revise {errorCount} {errorCount === 1 ? 'campo marcado' : 'campos marcados'} en rojo antes de registrar.
          </Banner>
        )}
        {submitError && (
          <Banner tone="red" live>
            <p className="font-medium">No se registró {employee || rq ? 'la entrega' : 'el egreso'}.</p>
            <p>{submitError}</p>
            {duplicateExit && (
              <p className="mt-2">
                <Link to="/almacen/movimientos" className="font-semibold underline">Ver movimientos recientes</Link>
              </p>
            )}
          </Banner>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" onClick={requestClear} disabled={saving} className={btnSecondary}>Limpiar formulario</button>
          {employee && (
            <button
              type="button"
              onClick={() => submit({ another: true })}
              aria-disabled={submitBlocked}
              className={btnSecondary}
            >
              Registrar y agregar otra entrega
            </button>
          )}
          <button
            type="submit"
            aria-disabled={submitBlocked}
            className={`${btnPrimary} sm:ml-auto`}
          >
            {saving
              ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Registrando…</>
              : <><ArrowUpFromLine size={16} aria-hidden="true" /> {rq ? 'Registrar entrega del requerimiento' : employee ? 'Registrar entrega' : 'Registrar egreso'}</>}
          </button>
        </div>
        {!rq && hasShortage && (
          <p role="status" className="text-xs text-red-600 dark:text-red-400 font-medium">
            Hay ítems con stock insuficiente. Corrija las cantidades para continuar.
          </p>
        )}
        {rq ? (
          <p className="text-xs text-gray-500">
            Esta entrega se registra contra el requerimiento: descuenta lo pendiente y actualiza su avance en el Master de RQ.
            No cambia el estado del flujo.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            Las entregas de EPP no cambian el estado de ningún RQ. Para despachar un RQ, elíjalo arriba o use{' '}
            <Link to="/almacen/pendientes" className="font-semibold underline">RQ Pendientes</Link>.
          </p>
        )}
      </form>

      <ClearFormDialog
        open={clearOpen}
        onKeep={() => setClearOpen(false)}
        onClear={() => { setClearOpen(false); reset(); }}
      />
    </div>
  );
}
