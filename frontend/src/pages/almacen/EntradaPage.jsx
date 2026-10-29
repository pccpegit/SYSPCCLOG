import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine, CheckCircle, Download, Loader2, MapPinOff, Plus, RotateCcw, Trash2,
} from 'lucide-react';
import { downloadGroupPdf, getInventory, registerEntryBatch } from '../../api/almacen';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import useFileDownload from '../../hooks/useFileDownload';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import NumberInput from '../../components/ui/NumberInput';
import ClearFormDialog from '../../components/almacen/ClearFormDialog';
import ItemCombobox from '../../components/almacen/ItemCombobox';
import { Banner, Card, ErrorBlock, Field, FocusHeading, LoadingBlock, PageHeader } from '../../components/almacen/ui';
import { btnPrimary, btnSecondary, inputCls } from '../../components/almacen/uiStyles';
import { ENTRY_SOURCES, FLOOR_OPTIONS, WAREHOUSES } from '../../data/almacenConstants';
import { LOGISTICS_ROLES } from '../../data/almacenRoles';
import { extractErrorMessage } from '../../utils/apiErrors';
import {
  compact, countErrors, formatQty, floorLabel, hasAnyRole, localISODate, nextLineId, validateMovementDate, validateQuantity,
} from '../../utils/almacen';

const newLine = (inventory = '') => ({ id: nextLineId(), inventory, quantity: '', tag: '', notes: '' });

const makeHeader = (siteOnly = false) => ({
  movement_date: localISODate(),
  warehouse: siteOnly ? 'SITE' : 'CENTRAL',
  source_type: 'PURCHASE',
  supplier_name: '',
  po_number: '',
  guide_number: '',
  invoice_number: '',
  internal: false,
  origin_floor: '',
  notes: '',
});

// Origen sin guía de remisión que aplicar (no hay documento de transporte).
const NO_GUIDE_SOURCES = new Set(['INITIAL_LOAD', 'ADJUSTMENT']);

/**
 * Ingreso de material (fases 1 a 3 del ciclo del almacén): fecha del movimiento,
 * documentos de recepción (PO/OC, guía de remisión, factura), TAG y observación.
 * La ubicación exacta se asigna después en Inventario (fase 3).
 */
export default function EntradaPage() {
  const { showToast } = useToast();
  const { userRoles } = useAuth();
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('item') ?? '';
  const download = useFileDownload();

  // Only «Almacén de Obra» (no Central role and no logistics role) is bound to the site warehouse:
  // the server answers 403 for any other warehouse, so don't let the form get filled in first.
  const siteOnly = userRoles.includes('SITE_WAREHOUSE')
    && !userRoles.includes('CENTRAL_WAREHOUSE')
    && !hasAnyRole(userRoles, LOGISTICS_ROLES);

  const [header, setHeader] = useState(() => makeHeader(siteOnly));
  const [lines, setLines] = useState(() => [newLine(preselected)]);
  const [catalog, setCatalog] = useState({ status: 'loading', items: [] });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
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
  const setH = (field) => (e) => setHeader((prev) => ({ ...prev, [field]: e.target.value }));
  const updateLine = (id, field, value) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const addLine = () => {
    const line = newLine();
    setLines((prev) => [...prev, line]);
    setTimeout(() => document.getElementById(`entry-item-${line.id}`)?.focus(), 0);
  };
  // Al quitar una fila el foco pasa a la fila vecina (o a «Agregar ítem»): no se pierde en el body.
  const removeLine = (id) => {
    const idx = lines.findIndex((l) => l.id === id);
    const neighbour = lines[idx - 1] ?? lines[idx + 1];
    setLines((prev) => prev.filter((l) => l.id !== id));
    setTimeout(() => {
      const target = neighbour ? document.getElementById(`entry-item-${neighbour.id}`) : null;
      (target ?? addButtonRef.current)?.focus();
    }, 0);
  };
  // Ctrl+Enter (o Cmd+Enter) en «Cantidad» agrega otro ítem si el actual está completo.
  // Enter a secas envía el formulario, igual que en el resto de los campos.
  const onQuantityKeyDown = (line) => (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (line.inventory && Number(line.quantity) > 0) addLine();
  };

  const effectiveSource = header.internal ? 'TRANSFER_IN' : header.source_type;
  const dateCheck = validateMovementDate(header.movement_date);
  const showGuideWarning = !header.guide_number.trim() && !NO_GUIDE_SOURCES.has(effectiveSource);

  const validate = () => {
    const errs = { lines: {} };
    if (dateCheck.error) errs.movement_date = dateCheck.error;
    if (header.internal && !header.origin_floor) errs.origin_floor = 'Indique el piso de origen.';
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

  const hasErrors = (errs) => Boolean(errs.movement_date || errs.origin_floor || Object.keys(errs.lines).length);

  const submit = async (another) => {
    if (inFlight.current || catalog.status !== 'ready') return;
    const errs = validate();
    setErrors(errs);
    if (hasErrors(errs)) {
      focusFirstInvalid();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    setSubmitError('');
    const touched = lines.map((l) => itemById(l.inventory)).filter(Boolean);
    try {
      const { data } = await registerEntryBatch({
        items: lines.map((l) => compact({
          inventory: Number(l.inventory),
          quantity: Number(l.quantity),
          tag: l.tag.trim(),
          notes: l.notes.trim(),
        })),
        ...compact({
          warehouse: header.warehouse,
          source_type: effectiveSource,
          movement_date: header.movement_date,
          supplier_name: header.supplier_name,
          po_number: header.po_number,
          guide_number: header.guide_number,
          invoice_number: header.invoice_number,
          internal_transfer: header.internal ? `Desde ${floorLabel(Number(header.origin_floor))}` : '',
          notes: header.notes,
        }),
      });
      const pending = new Set(touched.filter((i) => i.location_status !== 'EXACT').map((i) => i.id)).size;
      const groupNumber = data?.group_number ?? '';
      // The voucher number is only part of the message when the server returned one.
      showToast({ type: 'success', message: groupNumber ? `Ingreso registrado. Vale interno ${groupNumber}` : 'Ingreso registrado.' });
      loadCatalog();
      if (another) {
        setLines([newLine()]);
        setErrors({});
        setTimeout(() => document.querySelector('[id^="entry-item-"]')?.focus(), 0);
      } else {
        setResult({ groupId: data?.id, groupNumber, count: lines.length, pending });
      }
    } catch (err) {
      // Además del aviso pasajero, queda un mensaje fijo junto a los botones hasta el próximo intento.
      const message = extractErrorMessage(err, 'No se pudo registrar el ingreso. Intente nuevamente.');
      setSubmitError(message);
      showToast({ type: 'error', message, duration: 8000 });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setHeader(makeHeader(siteOnly));
    setLines([newLine()]);
    setErrors({});
    setSubmitError('');
    setResult(null);
  };

  const dirty = lines.some((l) => l.inventory || l.quantity || l.tag.trim() || l.notes.trim())
    || Boolean(header.supplier_name.trim() || header.po_number.trim() || header.guide_number.trim()
      || header.invoice_number.trim() || header.notes.trim() || header.internal);
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
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-emerald-500" aria-hidden="true" />
          </div>
          <FocusHeading>Ingreso registrado</FocusHeading>
          <p className="text-sm text-gray-600 mb-1">
            {result.count} {result.count === 1 ? 'ítem registrado' : 'ítems registrados'}.
            {result.groupNumber && <> Vale interno <strong className="font-mono">{result.groupNumber}</strong>.</>}
          </p>
          {result.pending > 0 && (
            <Banner tone="amber" className="mt-4 text-left">
              <span>
                {result.pending} {result.pending === 1 ? 'ítem quedó pendiente' : 'ítems quedaron pendientes'} de ubicar.{' '}
                <Link to="/almacen/inventario?pendientes=1" className="font-semibold underline">Asignar ubicación en Inventario</Link>
              </span>
            </Banner>
          )}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {result.groupId && (
              <button
                type="button"
                onClick={() => download.run(() => downloadGroupPdf(result.groupId), `${result.groupNumber || 'vale'}.pdf`, 'No se pudo descargar el vale. Intente nuevamente.')}
                aria-disabled={download.busy}
                className={`${btnPrimary} flex-1`}
              >
                <Download size={16} aria-hidden="true" /> Descargar vale
              </button>
            )}
            <button type="button" onClick={reset} className={`${btnSecondary} flex-1`}>
              <RotateCcw size={16} aria-hidden="true" /> Registrar otro ingreso
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Ingreso de material" subtitle="Registre lo recibido en el almacén (recepción, control y almacenamiento)." icon={ArrowDownToLine} />

      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate className="space-y-5">
        <Card className="p-5 sm:p-7 space-y-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display">Datos generales</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Fecha del ingreso" required error={errors.movement_date}>
              <input type="date" value={header.movement_date} max={localISODate()} onChange={setH('movement_date')} className={inputCls(!!errors.movement_date)} />
            </Field>
            <Field label="Almacén" required hint={siteOnly ? 'Su rol solo opera el almacén de obra.' : undefined}>
              <select value={header.warehouse} onChange={setH('warehouse')} disabled={siteOnly} className={inputCls()}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
          </div>
          {dateCheck.warning && <Banner tone="amber" live>{dateCheck.warning}</Banner>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Origen" required>
              <select value={effectiveSource} disabled={header.internal} onChange={setH('source_type')} className={inputCls()}>
                {ENTRY_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Proveedor">
              <input value={header.supplier_name} onChange={setH('supplier_name')} className={inputCls()} placeholder="Nombre (opcional)" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="PO / OC">
              <input value={header.po_number} onChange={setH('po_number')} className={inputCls()} placeholder="Opcional" />
            </Field>
            <Field label="Guía de remisión">
              <input value={header.guide_number} onChange={setH('guide_number')} className={inputCls()} placeholder="T001-000123" />
            </Field>
            <Field label="Factura">
              <input value={header.invoice_number} onChange={setH('invoice_number')} className={inputCls()} placeholder="F001-000123" />
            </Field>
          </div>
          {showGuideWarning && (
            <Banner tone="amber">Sin guía de remisión: se registrará, pero la recepción quedará sin documento.</Banner>
          )}

          <div className="space-y-3">
            <label className="flex items-center gap-2 min-h-11 cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={header.internal}
                onChange={(e) => setHeader((prev) => ({ ...prev, internal: e.target.checked, origin_floor: e.target.checked ? prev.origin_floor : '' }))}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Es transferencia interna</span>
            </label>
            {header.internal && (
              <Field label="Piso de origen" required error={errors.origin_floor} className="max-w-xs">
                <select value={header.origin_floor} onChange={setH('origin_floor')} className={inputCls(!!errors.origin_floor)}>
                  <option value="">Seleccione…</option>
                  {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
            )}
          </div>

          <Field label="Observación general">
            <textarea rows={2} value={header.notes} onChange={setH('notes')} className={`${inputCls()} resize-none`} placeholder="Observaciones, diferencias o daños detectados (opcional)" />
          </Field>
        </Card>

        <Card className="p-5 sm:p-7 space-y-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-display">
            Ítems a ingresar <span className="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 font-bold">{lines.length}</span>
          </h2>

          {catalog.status === 'loading' && <LoadingBlock label="Cargando ítems…" className="h-24" />}
          {catalog.status === 'error' && <ErrorBlock message="No se pudo cargar el catálogo de ítems." onRetry={loadCatalog} />}

          {catalog.status === 'ready' && (
            <ul className="space-y-3">
              {lines.map((line, idx) => {
                const item = itemById(line.inventory);
                const lineErr = errors.lines?.[line.id] ?? {};
                const stock = Number(item?.total_stock ?? 0);
                const qty = Number(line.quantity) || 0;
                return (
                  <li key={line.id} className="relative rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div role="group" aria-label={`Ítem ${idx + 1}`} className="flex gap-3 items-start">
                      <div className="flex-1 min-w-0 space-y-3">
                        <Field label={`Ítem ${idx + 1}`} id={`entry-item-${line.id}`} required error={lineErr.item}>
                          <ItemCombobox items={catalog.items} value={line.inventory} onChange={(v) => updateLine(line.id, 'inventory', v)} />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div onKeyDown={onQuantityKeyDown(line)}>
                            <Field label={`Cantidad ingresada${item?.unit ? ` (${item.unit})` : ''}`} id={`entry-qty-${line.id}`} required error={lineErr.qty}>
                              <NumberInput value={line.quantity} onChange={(v) => updateLine(line.id, 'quantity', v)} className={inputCls(!!lineErr.qty)} placeholder="0" />
                            </Field>
                          </div>
                          <Field label="TAG" id={`entry-tag-${line.id}`}>
                            <input value={line.tag} onChange={(e) => updateLine(line.id, 'tag', e.target.value)} className={inputCls()} placeholder="Opcional" />
                          </Field>
                          <Field label="Observación de línea" id={`entry-note-${line.id}`}>
                            <input value={line.notes} onChange={(e) => updateLine(line.id, 'notes', e.target.value)} className={inputCls()} placeholder="Opcional" />
                          </Field>
                        </div>
                        {item && (
                          <p className="text-xs text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span>Stock actual: <strong className="tabular-nums">{formatQty(stock)}</strong></span>
                            {qty > 0 && <span className="text-emerald-700 dark:text-emerald-400">Después del ingreso: <strong className="tabular-nums">{formatQty(stock + qty)}</strong></span>}
                            {item.location_status !== 'EXACT' && (
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><MapPinOff size={12} aria-hidden="true" /> Pendiente de ubicar</span>
                            )}
                          </p>
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
              <button ref={addButtonRef} type="button" onClick={addLine} className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-500/30 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 font-display">
                <Plus size={16} aria-hidden="true" /> Agregar ítem
              </button>
              <p className="text-xs text-gray-500">Atajo: Ctrl+Enter en «Cantidad ingresada» agrega otro ítem.</p>
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
            <p className="font-medium">No se registró el ingreso.</p>
            <p>{submitError}</p>
          </Banner>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" onClick={requestClear} disabled={saving} className={btnSecondary}>Limpiar formulario</button>
          <button
            type="button"
            onClick={() => submit(true)}
            aria-disabled={saving || catalog.status !== 'ready'}
            className={btnSecondary}
          >
            Registrar y agregar otro
          </button>
          <button type="submit" aria-disabled={saving || catalog.status !== 'ready'} className={`${btnPrimary} sm:ml-auto`}>
            {saving
              ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Registrando…</>
              : <><ArrowDownToLine size={16} aria-hidden="true" /> Registrar ingreso</>}
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
