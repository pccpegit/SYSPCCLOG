import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpFromLine, Check, CheckCircle, Download, History, Loader2, Plus, Printer, RotateCcw, Trash2,
} from 'lucide-react';
import {
  downloadGroupPdf, getInventory, getMovements, registerEppDelivery, registerExitBatch,
} from '../../api/almacen';
import { useAuth } from '../../context/useAuth';
import { useToast } from '../../context/useToast';
import useFileDownload from '../../hooks/useFileDownload';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import NumberInput from '../../components/ui/NumberInput';
import ClearFormDialog from '../../components/almacen/ClearFormDialog';
import ItemCombobox from '../../components/almacen/ItemCombobox';
import WorkerCombobox from '../../components/almacen/WorkerCombobox';
import { LocationChip } from '../../components/almacen/chips';
import { Banner, Card, ErrorBlock, Field, FocusHeading, LoadingBlock, PageHeader } from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls } from '../../components/almacen/uiStyles';
import { COUNTER_ROLES } from '../../data/almacenRoles';
import { EXIT_MODES, WAREHOUSES } from '../../data/almacenConstants';
import { extractErrorMessage } from '../../utils/apiErrors';
import {
  availableStock, compact, countErrors, formatISODate, formatQty, hasAnyRole, localISODate, nextLineId,
  stockShortageMessage, validateMovementDate, validateQuantity,
} from '../../utils/almacen';

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
    voucher_number: '',
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
  const [duplicate, setDuplicate] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [result, setResult] = useState(null);
  const inFlight = useRef(false);
  const voucherRef = useRef(null);
  const addButtonRef = useRef(null);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();

  const employee = header.mode === 'EMPLOYEE';

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

  const itemById = (id) => catalog.items.find((i) => String(i.id) === String(id));
  const setH = (field) => (e) => {
    setDuplicate(false);
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
  const voucher = header.voucher_number.trim();
  const dirty = lines.some((l) => l.inventory || l.quantity)
    || Boolean(header.worker || voucher || header.destination_detail.trim() || header.requested_by.trim() || header.notes.trim());

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

  const errorCount = countErrors(errors);

  const send = async (allowDuplicate) => {
    const items = lines.map((l) => ({ inventory: Number(l.inventory), quantity: Number(l.quantity) }));
    const common = { warehouse: header.warehouse, movement_date: header.movement_date, items };

    if (employee && voucher) {
      const { worker } = header;
      return registerEppDelivery({
        ...common,
        voucher_number: voucher,
        recipient: worker.kind === 'personal' ? { personal: worker.id } : { name: worker.name },
        ...compact({ notes: header.notes }),
        ...(allowDuplicate ? { allow_duplicate_voucher: true } : {}),
      });
    }
    if (employee) {
      // Sin N° de vale: se guarda como «Sin vale» por la salida por lotes (el vale es opcional).
      const { worker } = header;
      return registerExitBatch({
        ...common,
        destination_type: 'EMPLOYEE',
        destination_detail: worker.name,
        ...(worker.kind === 'personal' ? { destination_personal: worker.id } : {}),
        ...compact({ notes: header.notes }),
      });
    }
    const requestedBy = header.requested_by.trim();
    const notes = [requestedBy && `Solicitado por: ${requestedBy}`, header.notes.trim()].filter(Boolean).join('. ');
    return registerExitBatch({
      ...common,
      destination_type: header.mode,
      destination_detail: header.destination_detail.trim(),
      ...compact({ voucher_number: voucher, notes }),
      ...(allowDuplicate ? { allow_duplicate_voucher: true } : {}),
    });
  };

  const submit = async ({ another = false, allowDuplicate = false } = {}) => {
    if (inFlight.current || catalog.status !== 'ready') return;
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
    setDuplicate(false);
    setSubmitError('');
    try {
      const { data } = await send(allowDuplicate);
      const groupNumber = data?.group_number ?? '';
      // «Entrega registrada» / «Egreso registrado» (gender agrees); the voucher number only when the server sent one.
      const registered = employee ? 'Entrega registrada' : 'Egreso registrado';
      showToast({
        type: 'success',
        message: groupNumber ? `${registered}. Vale interno ${groupNumber}` : `${registered}.`,
      });
      loadCatalog();
      if (another) {
        setHeader((prev) => ({ ...makeHeader(), movement_date: prev.movement_date, warehouse: prev.warehouse, mode: prev.mode }));
        setLines([newLine()]);
        setErrors({});
        setTimeout(() => voucherRef.current?.focus(), 0);
      } else {
        setResult({
          groupId: data?.id,
          groupNumber,
          movementId: data?.movements?.[0]?.id,
          count: lines.length,
          noVoucher: !voucher,
          employee,
        });
      }
    } catch (err) {
      if (err?.response?.status === 409 && err.response.data?.code === 'voucher_number_exists') {
        setDuplicate(true);
      } else {
        // Además del aviso pasajero, queda un mensaje fijo junto a los botones hasta el próximo intento.
        const message = extractErrorMessage(err, 'No se pudo registrar el egreso. Intente nuevamente.');
        setSubmitError(message);
        showToast({ type: 'error', message, duration: 8000 });
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setHeader(makeHeader());
    setLines([newLine()]);
    setErrors({});
    setDuplicate(false);
    setSubmitError('');
    setResult(null);
  };

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
          <FocusHeading>{result.employee ? 'Entrega registrada' : 'Egreso registrado'}</FocusHeading>
          <p className="text-sm text-gray-600">
            {result.count} {result.count === 1 ? 'ítem' : 'ítems'}.
            {result.groupNumber && <> Vale interno <strong className="font-mono">{result.groupNumber}</strong>.</>}
          </p>
          {result.noVoucher && (
            <Banner tone="amber" className="mt-4 text-left">Se guardó como «Sin vale»: falta el N° de vale físico.</Banner>
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
                onClick={() => download.run(() => downloadGroupPdf(result.groupId), `${result.groupNumber || 'vale'}.pdf`, 'No se pudo descargar el vale. Intente nuevamente.')}
                aria-disabled={download.busy}
                className={`${btnSecondary} flex-1`}
              >
                <Download size={16} aria-hidden="true" /> Descargar PDF
              </button>
            )}
          </div>
          <button type="button" onClick={reset} className={`${btnSecondary} w-full mt-3`}>
            <RotateCcw size={16} aria-hidden="true" /> {result.employee ? 'Registrar otra entrega' : 'Registrar otro egreso'}
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
                      setDuplicate(false);
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="Fecha" required error={errors.movement_date}>
              <input type="date" value={header.movement_date} max={localISODate()} onChange={setH('movement_date')} className={inputCls(!!errors.movement_date)} />
            </Field>
            <Field label="Almacén" required>
              <select value={header.warehouse} onChange={setH('warehouse')} disabled={siteOnly} className={inputCls()}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="N° de vale (físico)" hint="El número impreso en el vale firmado.">
              <input ref={voucherRef} value={header.voucher_number} onChange={setH('voucher_number')} className={inputCls()} placeholder="Ej.: 0123" />
            </Field>
          </div>
          {dateCheck.warning && <Banner tone="amber" live>{dateCheck.warning}</Banner>}
          {!voucher && (
            <Banner tone="amber">No indicó N° de vale. {employee ? 'La entrega' : 'El egreso'} se guardará como «Sin vale».</Banner>
          )}
          {duplicate && (
            <Banner tone="red" live="assertive">
              <p className="font-medium">Ya existe un egreso con ese N° de vale en este almacén.</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" onClick={() => voucherRef.current?.focus()} className={btnSecondary}>Corregir el N° de vale</button>
                <button type="button" onClick={() => submit({ allowDuplicate: true })} aria-disabled={saving} className={btnSecondary}>
                  Registrar de todos modos
                </button>
              </div>
            </Banner>
          )}

          {employee ? (
            <Field label="Trabajador" required error={errors.worker}>
              <WorkerCombobox
                value={header.worker}
                onChange={(worker) => { setDuplicate(false); setHeader((prev) => ({ ...prev, worker })); }}
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

          <Field label="Observación">
            <textarea rows={2} value={header.notes} onChange={setH('notes')} className={`${inputCls()} resize-none`} placeholder="Opcional" />
          </Field>
        </Card>

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

        {errorCount > 0 && (
          <Banner tone="red" live="assertive">
            Revise {errorCount} {errorCount === 1 ? 'campo marcado' : 'campos marcados'} en rojo antes de registrar.
          </Banner>
        )}
        {submitError && (
          <Banner tone="red" live>
            <p className="font-medium">No se registró {employee ? 'la entrega' : 'el egreso'}.</p>
            <p>{submitError}</p>
          </Banner>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" onClick={requestClear} disabled={saving} className={btnSecondary}>Limpiar formulario</button>
          {employee && (
            <button
              type="button"
              onClick={() => submit({ another: true })}
              aria-disabled={saving || hasShortage || catalog.status !== 'ready'}
              className={btnSecondary}
            >
              Registrar y agregar otra entrega
            </button>
          )}
          <button
            type="submit"
            aria-disabled={saving || hasShortage || catalog.status !== 'ready'}
            className={`${btnPrimary} sm:ml-auto`}
          >
            {saving
              ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Registrando…</>
              : <><ArrowUpFromLine size={16} aria-hidden="true" /> {employee ? 'Registrar entrega' : 'Registrar egreso'}</>}
          </button>
        </div>
        {hasShortage && (
          <p role="status" className="text-xs text-red-600 dark:text-red-400 font-medium">
            Hay ítems con stock insuficiente. Corrija las cantidades para continuar.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Las entregas de EPP no cambian el estado de ningún RQ. Para despachar un RQ, use{' '}
          <Link to="/almacen/pendientes" className="font-semibold underline">RQ Pendientes</Link>.
        </p>
      </form>

      <ClearFormDialog
        open={clearOpen}
        onKeep={() => setClearOpen(false)}
        onClear={() => { setClearOpen(false); reset(); }}
      />
    </div>
  );
}
