import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, CheckCircle, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { getInventory, registerExitBatch } from '../../api/almacen';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import NumberInput from '../../components/ui/NumberInput';
import ClearFormDialog from '../../components/almacen/ClearFormDialog';
import ItemCombobox from '../../components/almacen/ItemCombobox';
import { LocationChip } from '../../components/almacen/chips';
import { Banner, Card, ErrorBlock, Field, FocusHeading, LoadingBlock, PageHeader } from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls } from '../../components/almacen/uiStyles';
import { FLOOR_OPTIONS, INTERNAL_TRANSFER_DESTINATION, WAREHOUSES } from '../../data/almacenConstants';
import { extractErrorMessage } from '../../utils/apiErrors';
import {
  availableStock, countErrors, floorLabel, formatQty, localISODate, nextLineId, stockShortageMessage,
  validateMovementDate, validateQuantity,
} from '../../utils/almacen';

const newLine = () => ({ id: nextLineId(), inventory: '', quantity: '' });

/**
 * Transferencia interna entre pisos (fase 6, registro de salida). Se registra como
 * una salida `TRANSFER_OUT` con destino «ALM - <piso>», igual que en su libro.
 */
export default function TransferenciaPage() {
  const { showToast } = useToast();
  const { userRoles } = useAuth();
  const siteOnly = !userRoles.includes('CENTRAL_WAREHOUSE');

  const makeHeader = useCallback(() => ({
    movement_date: localISODate(),
    warehouse: siteOnly ? 'SITE' : 'CENTRAL',
    origin_floor: '',
    destination_floor: '',
    notes: '',
  }), [siteOnly]);

  const [header, setHeader] = useState(makeHeader);
  const [lines, setLines] = useState(() => [newLine()]);
  const [catalog, setCatalog] = useState({ status: 'loading', items: [] });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const inFlight = useRef(false);
  const addButtonRef = useRef(null);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();

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
  const stockOf = useCallback((item) => availableStock(item, header.warehouse), [header.warehouse]);
  const setH = (field) => (e) => setHeader((prev) => ({ ...prev, [field]: e.target.value }));
  const updateLine = (id, field, value) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  // Al quitar una fila el foco pasa a la fila vecina (o a «Agregar ítem»): no se pierde en el body.
  const removeLine = (id) => {
    const idx = lines.findIndex((l) => l.id === id);
    const neighbour = lines[idx - 1] ?? lines[idx + 1];
    setLines((prev) => prev.filter((l) => l.id !== id));
    setTimeout(() => {
      const target = neighbour ? document.getElementById(`transfer-item-${neighbour.id}`) : null;
      (target ?? addButtonRef.current)?.focus();
    }, 0);
  };
  const addLine = () => {
    const line = newLine();
    setLines((prev) => [...prev, line]);
    setTimeout(() => document.getElementById(`transfer-item-${line.id}`)?.focus(), 0);
  };

  const requestedByItem = {};
  lines.forEach((l) => {
    if (l.inventory && Number(l.quantity) > 0) {
      requestedByItem[l.inventory] = (requestedByItem[l.inventory] ?? 0) + Number(l.quantity);
    }
  });
  const shortage = (line) => {
    const item = itemById(line.inventory);
    if (!item || !(Number(line.quantity) > 0)) return '';
    const available = stockOf(item);
    const requested = requestedByItem[line.inventory];
    return requested > available ? stockShortageMessage(item.product_code, available, requested) : '';
  };
  const hasShortage = lines.some((l) => shortage(l));

  const dateCheck = validateMovementDate(header.movement_date);
  const sameFloor = header.origin_floor && header.origin_floor === header.destination_floor;

  const validate = () => {
    const errs = { lines: {} };
    if (dateCheck.error) errs.movement_date = dateCheck.error;
    if (!header.origin_floor) errs.origin_floor = 'Indique el piso de origen.';
    if (!header.destination_floor) errs.destination_floor = 'Indique el piso de destino.';
    else if (sameFloor) errs.destination_floor = 'El piso de destino debe ser distinto del de origen.';
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

  const submit = async () => {
    if (inFlight.current || catalog.status !== 'ready') return;
    if (hasShortage) {
      focusFirstInvalid();
      return;
    }
    const errs = validate();
    setErrors(errs);
    if (errs.movement_date || errs.origin_floor || errs.destination_floor || Object.keys(errs.lines).length) {
      focusFirstInvalid();
      return;
    }

    const origin = Number(header.origin_floor);
    const destination = Number(header.destination_floor);
    inFlight.current = true;
    setSaving(true);
    setSubmitError('');
    try {
      const { data } = await registerExitBatch({
        items: lines.map((l) => ({ inventory: Number(l.inventory), quantity: Number(l.quantity) })),
        warehouse: header.warehouse,
        movement_date: header.movement_date,
        destination_type: 'TRANSFER_OUT',
        destination_detail: INTERNAL_TRANSFER_DESTINATION[destination],
        internal_transfer: `${floorLabel(origin)} → ${floorLabel(destination)}`,
        ...(header.notes.trim() ? { notes: header.notes.trim() } : {}),
      });
      const groupNumber = data?.group_number ?? '';
      // The voucher number only goes in the message when the server returned one.
      showToast({
        type: 'success',
        message: groupNumber ? `Transferencia registrada. Vale interno ${groupNumber}` : 'Transferencia registrada.',
      });
      setResult({ groupNumber, count: lines.length, origin, destination });
      loadCatalog();
    } catch (err) {
      // Además del aviso pasajero, queda un mensaje fijo junto a los botones hasta el próximo intento.
      const message = extractErrorMessage(err, 'No se pudo registrar la transferencia. Intente nuevamente.');
      setSubmitError(message);
      showToast({ type: 'error', message, duration: 8000 });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setHeader(makeHeader());
    setLines([newLine()]);
    setErrors({});
    setSubmitError('');
    setResult(null);
  };

  const dirty = lines.some((l) => l.inventory || l.quantity)
    || Boolean(header.origin_floor || header.destination_floor || header.notes.trim());
  // «Limpiar formulario» no es un cancelar: borra lo cargado, así que con datos pide confirmación.
  const requestClear = () => {
    if (dirty) setClearOpen(true);
    else reset();
  };
  const errorCount = countErrors(errors);

  if (result) {
    return (
      <div className="max-w-lg mx-auto mt-8 sm:mt-16">
        <Card className="p-8 sm:p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-blue-500" aria-hidden="true" />
          </div>
          <FocusHeading>Transferencia registrada</FocusHeading>
          <p className="text-sm text-gray-600">
            {result.count} {result.count === 1 ? 'ítem' : 'ítems'} del {floorLabel(result.origin)} al {floorLabel(result.destination)}.
            {result.groupNumber && <> Vale interno <strong className="font-mono">{result.groupNumber}</strong>.</>}
          </p>
          <Banner tone="blue" className="mt-4 text-left">
            Si el ítem cambia de pabellón, asigne la nueva ubicación en{' '}
            <Link to="/almacen/inventario" className="font-semibold underline">Inventario</Link>.
          </Banner>
          <button type="button" onClick={reset} className={`${btnSecondary} w-full mt-6`}>
            <RotateCcw size={16} aria-hidden="true" /> Registrar otra transferencia
          </button>
        </Card>
      </div>
    );
  }

  const readyToSummarize = header.origin_floor && header.destination_floor && !sameFloor;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Transferencia interna"
        subtitle="Mueva material entre el 1er y el 2do piso del almacén."
        icon={ArrowRightLeft}
      />

      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="space-y-5">
        <Card className="p-5 sm:p-7 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Fecha" required error={errors.movement_date}>
              <input type="date" value={header.movement_date} max={localISODate()} onChange={setH('movement_date')} className={inputCls(!!errors.movement_date)} />
            </Field>
            <Field label="Almacén" required>
              <select value={header.warehouse} onChange={setH('warehouse')} disabled={siteOnly} className={inputCls()}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Piso de origen" required error={errors.origin_floor}>
              <select value={header.origin_floor} onChange={setH('origin_floor')} className={inputCls(!!errors.origin_floor)}>
                <option value="">Seleccione…</option>
                {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Piso de destino" required error={sameFloor ? 'El piso de destino debe ser distinto del de origen.' : errors.destination_floor}>
              <select value={header.destination_floor} onChange={setH('destination_floor')} className={inputCls(!!errors.destination_floor || !!sameFloor)}>
                <option value="">Seleccione…</option>
                {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
          </div>
          {dateCheck.warning && <Banner tone="amber" live>{dateCheck.warning}</Banner>}
          <Field label="Observación">
            <textarea rows={2} value={header.notes} onChange={setH('notes')} className={`${inputCls()} resize-none`} placeholder="Opcional" />
          </Field>
          <Banner tone="blue">
            La transferencia se registra como un egreso del almacén: el sistema todavía no separa el stock por piso.
            Si el ítem cambia de pabellón, asigne la nueva ubicación en Inventario.
          </Banner>
        </Card>

        <Card className="p-5 sm:p-7 space-y-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display">Ítems a transferir</h2>
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
                        <Field label={`Ítem ${idx + 1}`} id={`transfer-item-${line.id}`} required error={lineErr.item}>
                          <ItemCombobox items={catalog.items} value={line.inventory} requireStock getStock={stockOf} onChange={(v) => updateLine(line.id, 'inventory', v)} />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                          <Field label={`Cantidad${item?.unit ? ` (${item.unit})` : ''}`} id={`transfer-qty-${line.id}`} required error={lineErr.qty ?? short}>
                            <NumberInput value={line.quantity} onChange={(v) => updateLine(line.id, 'quantity', v)} className={inputCls(!!(lineErr.qty || short))} placeholder="0" />
                          </Field>
                          {item && (
                            <div className="sm:col-span-2 space-y-1 pt-1 sm:pt-6">
                              <p className="text-xs text-gray-600">Disponible: <strong className="tabular-nums">{formatQty(available)}</strong>{item.unit ? ` ${item.unit}` : ''}</p>
                              <p className="text-xs text-gray-600 flex items-center gap-1.5">Ubicación actual: <LocationChip item={item} /></p>
                            </div>
                          )}
                        </div>
                      </div>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(line.id)} aria-label={`Quitar ítem ${idx + 1}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
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
            <button ref={addButtonRef} type="button" onClick={addLine} className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-blue-300 dark:border-blue-500/30 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 font-display">
              <Plus size={16} aria-hidden="true" /> Agregar ítem
            </button>
          )}
        </Card>

        {readyToSummarize && (
          <p role="status" className="text-sm font-medium text-gray-700">
            Transferir {lines.length} {lines.length === 1 ? 'ítem' : 'ítems'} del {floorLabel(Number(header.origin_floor))} al {floorLabel(Number(header.destination_floor))}.
          </p>
        )}

        {errorCount > 0 && (
          <Banner tone="red" live="assertive">
            Revise {errorCount} {errorCount === 1 ? 'campo marcado' : 'campos marcados'} en rojo antes de registrar.
          </Banner>
        )}
        {submitError && (
          <Banner tone="red" live>
            <p className="font-medium">No se registró la transferencia.</p>
            <p>{submitError}</p>
          </Banner>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" onClick={requestClear} disabled={saving} className={btnSecondary}>Limpiar formulario</button>
          <button type="submit" aria-disabled={saving || hasShortage || catalog.status !== 'ready'} className={`${btnPrimary} sm:ml-auto`}>
            {saving
              ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Registrando…</>
              : <><ArrowRightLeft size={16} aria-hidden="true" /> Registrar transferencia</>}
          </button>
        </div>
      </form>

      <ClearFormDialog
        open={clearOpen}
        onKeep={() => setClearOpen(false)}
        onClear={() => { setClearOpen(false); reset(); }}
      />
    </div>
  );
}
