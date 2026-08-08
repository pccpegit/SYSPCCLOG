import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpFromLine, Printer, Search, CheckCircle, RotateCcw, Plus, Trash2, Download } from 'lucide-react';
import { getInventory, registerExitBatch } from '../../api/almacen';
import { useToast } from '../../context/ToastContext';
import NumberInput from '../../components/ui/NumberInput';
import { ucFirst, fmtNum } from '../../utils/format';
import { WAREHOUSES } from '../../data/almacenConstants';

const DESTINATION_TYPES = [
  { value: 'PROJECT',    label: 'Proyecto / Obra' },
  { value: 'DEPARTMENT', label: 'Area / Depto.'   },
  { value: 'EMPLOYEE',   label: 'Colaborador'     },
];

const EMPTY_HEADER = {
  warehouse: 'CENTRAL',
  destination_type: 'PROJECT',
  destination_detail: '',
  requested_by: '',
  notes: '',
};

const newItemRow = () => ({ id: crypto.randomUUID(), inventory_item: '', quantity: '' });

// ── Item search ──────────────────────────────────────────────────────────────

function ItemSearchSelect({ allItems, value, onChange, loading }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const selected = allItems.find((i) => String(i.id) === String(value));
  const filtered = query
    ? allItems.filter((i) =>
        (i.product_code ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (i.description ?? '').toLowerCase().includes(query.toLowerCase()))
    : allItems;

  return (
    <div className="relative">
      {selected && !open ? (
        <div
          className="flex items-center justify-between w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-white cursor-pointer hover:border-rose-400 transition-colors"
          onClick={() => { setOpen(true); setQuery(''); }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-gray-400 shrink-0">{selected.product_code}</span>
            <span className="text-gray-800 font-medium truncate">{selected.description}</span>
          </div>
          <span className={`text-xs ml-2 shrink-0 font-medium ${(selected.total_stock ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            Stock: {fmtNum(selected.total_stock ?? 0)} {ucFirst(selected.unit)}
          </span>
        </div>
      ) : (
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            autoFocus={open}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar item..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 bg-gray-50/50 focus:bg-white transition-colors"
          />
        </div>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl shadow-black/8 z-20 max-h-56 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-4 text-sm text-gray-400 text-center">Cargando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtered.map((item) => {
                const hasStock = (item.total_stock ?? 0) > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!hasStock}
                    onClick={() => { onChange(String(item.id)); setQuery(''); setOpen(false); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors first:rounded-t-xl last:rounded-b-xl ${
                      hasStock ? 'hover:bg-rose-50' : 'opacity-35 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs text-gray-400 shrink-0">{item.product_code}</span>
                      <span className="text-gray-800 truncate">{item.description}</span>
                    </div>
                    <span className={`text-xs ml-2 shrink-0 font-medium ${hasStock ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmtNum(item.total_stock ?? 0)} {ucFirst(item.unit)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared form helpers ───────────────────────────────────────────────────────

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-rose-500 focus:border-rose-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

function Field({ label, required, id, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SalidaPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [header, setHeader]       = useState(EMPTY_HEADER);
  const [lineItems, setLineItems] = useState([newItemRow()]);
  const [allItems, setAllItems]   = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [saving, setSaving]       = useState(false);
  const [savingStep, setSavingStep] = useState('');
  const [errors, setErrors]       = useState({});
  const [successId, setSuccessId] = useState(null);

  useEffect(() => {
    getInventory({ no_page: true })
      .then((res) => {
        const data = res.data?.results ?? res.data ?? [];
        setAllItems(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => setLoadingItems(false));
  }, []);

  const setH = (field, value) => setHeader((prev) => ({ ...prev, [field]: value }));

  const addItem = () => setLineItems((prev) => [...prev, newItemRow()]);
  const removeItem = (id) => setLineItems((prev) => prev.filter((i) => i.id !== id));
  const updateItem = (id, field, value) =>
    setLineItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));

  const validate = () => {
    const errs = {};
    if (!header.destination_detail.trim()) errs.destination_detail = 'Ingrese el destino.';
    if (!header.requested_by.trim()) errs.requested_by = 'Ingrese quien solicita.';

    lineItems.forEach((row, idx) => {
      if (!row.inventory_item) {
        errs[`item_${idx}_inventory`] = 'Seleccione un item.';
      }
      if (!row.quantity || Number(row.quantity) <= 0) {
        errs[`item_${idx}_qty`] = 'Cantidad invalida.';
      } else if (row.inventory_item) {
        const invItem = allItems.find((i) => String(i.id) === String(row.inventory_item));
        const available = invItem?.total_stock ?? 0;
        if (Number(row.quantity) > available) {
          errs[`item_${idx}_qty`] = `Stock insuficiente (max. ${fmtNum(available)}).`;
        }
      }
    });

    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    setSavingStep('registering');
    try {
      const stepTimer  = setTimeout(() => setSavingStep('generating'), 800);
      const stepTimer2 = setTimeout(() => setSavingStep('uploading'), 2000);

      const combinedNotes = header.requested_by
        ? `Solicitado por: ${header.requested_by}${header.notes ? '. ' + header.notes : ''}`
        : header.notes || undefined;

      const res = await registerExitBatch({
        items: lineItems.map((row) => ({
          inventory: Number(row.inventory_item),
          quantity:  Number(row.quantity),
        })),
        warehouse:          header.warehouse,
        destination_type:   header.destination_type,
        destination_detail: header.destination_detail,
        notes:              combinedNotes,
      });

      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);

      const gId = res.data?.id;

      // Auto-download PDF
      if (gId) {
        try {
          const pdfUrl = `/api/v1/warehouse/movements/groups/${gId}/pdf/`;
          const link = document.createElement('a');
          link.href = pdfUrl;
          link.download = '';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch { /* silent */ }
      }

      showToast({ type: 'success', message: 'Salida registrada correctamente.' });
      setSuccessId(gId ?? res.data?.movement_id ?? 'batch');
    } catch (err) {
      showToast({ type: 'error', message: err.response?.data?.detail ?? 'No se pudo registrar la salida.' });
    } finally {
      setSaving(false);
      setSavingStep('');
    }
  };

  const handleReset = () => {
    setHeader(EMPTY_HEADER);
    setLineItems([newItemRow()]);
    setErrors({});
    setSuccessId(null);
  };

  if (successId) {
    return (
      <div className="max-w-lg mx-auto mt-8 sm:mt-16">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 sm:p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2 font-display">Salida registrada</h2>
          <p className="text-sm text-gray-500 mb-6">
            {lineItems.length} item{lineItems.length !== 1 ? 's' : ''} registrado{lineItems.length !== 1 ? 's' : ''} correctamente.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {successId && successId !== 'batch' && (
              <a
                href={`/api/v1/warehouse/movements/groups/${successId}/pdf/`}
                download
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-all duration-150 shadow-lg shadow-rose-600/20 active:scale-[0.97] active:shadow-md font-display"
              >
                <Download size={16} /> Descargar vale
              </a>
            )}
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 font-display"
            >
              <RotateCcw size={16} /> Otra salida
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-rose-50 ring-1 ring-rose-100 flex items-center justify-center">
          <ArrowUpFromLine size={20} className="text-rose-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">Registrar Salida</h1>
          <p className="text-sm text-gray-400">Despacho de materiales del almacen</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── Header fields ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-7 space-y-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-display">Datos generales</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Almacen" required id="warehouse">
              <select id="warehouse" value={header.warehouse} onChange={(e) => setH('warehouse', e.target.value)} className={inputCls(false)}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Tipo de destino" required id="destination_type">
              <div className="grid grid-cols-3 gap-2">
                {DESTINATION_TYPES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setH('destination_type', d.value)}
                    className={`px-2 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-150 active:scale-[0.95] font-display ${
                      header.destination_type === d.value
                        ? 'bg-rose-50 border-rose-300 text-rose-700 ring-1 ring-rose-200'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Destino" required id="destination_detail" error={errors.destination_detail}>
              <input
                id="destination_detail"
                value={header.destination_detail}
                onChange={(e) => setH('destination_detail', e.target.value)}
                className={inputCls(!!errors.destination_detail)}
                placeholder={
                  header.destination_type === 'PROJECT'    ? 'Ej: Proyecto Arequipa' :
                  header.destination_type === 'DEPARTMENT' ? 'Ej: Administracion' :
                  'Ej: Juan Perez'
                }
              />
            </Field>
            <Field label="Solicitado por" required id="requested_by" error={errors.requested_by}>
              <input
                id="requested_by"
                value={header.requested_by}
                onChange={(e) => setH('requested_by', e.target.value)}
                className={inputCls(!!errors.requested_by)}
                placeholder="Nombre del solicitante"
              />
            </Field>
          </div>

          <Field label="Notas" id="notes">
            <textarea
              id="notes"
              value={header.notes}
              onChange={(e) => setH('notes', e.target.value)}
              rows={2}
              className={`${inputCls(false)} resize-none`}
              placeholder="Observaciones (opcional)"
            />
          </Field>
        </div>

        {/* ── Item list ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-7 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-display">
              Items a despachar <span className="ml-1.5 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold font-display">{lineItems.length}</span>
            </p>
          </div>

          <div className="space-y-3">
            {lineItems.map((row, idx) => {
              const invItem = allItems.find((i) => String(i.id) === String(row.inventory_item));
              const available = invItem?.total_stock ?? 0;
              const unit = invItem ? ucFirst(invItem.unit) : '';

              return (
                <div key={row.id} className="relative rounded-xl border border-gray-100 bg-gray-50/40 p-4">
                  <span className="absolute -top-2.5 left-3.5 px-2 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] font-bold text-gray-400">
                    #{idx + 1}
                  </span>

                  <div className="flex gap-3 items-start">
                    <div className="flex-1 min-w-0 space-y-3">
                      <div>
                        {errors[`item_${idx}_inventory`] && (
                          <p className="text-[11px] text-red-500 mb-1 font-medium">{errors[`item_${idx}_inventory`]}</p>
                        )}
                        <ItemSearchSelect
                          allItems={allItems}
                          value={row.inventory_item}
                          onChange={(v) => updateItem(row.id, 'inventory_item', v)}
                          loading={loadingItems}
                        />
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-48">
                          <NumberInput
                            value={row.quantity}
                            onChange={(v) => updateItem(row.id, 'quantity', v)}
                            className={inputCls(!!errors[`item_${idx}_qty`])}
                            placeholder="Cantidad"
                          />
                          {errors[`item_${idx}_qty`] && (
                            <p className="text-[11px] text-red-500 mt-1 font-medium">{errors[`item_${idx}_qty`]}</p>
                          )}
                        </div>
                        {invItem && (() => {
                          const stock = Number(available);
                          const qty = Number(row.quantity) || 0;
                          const remaining = stock - qty;
                          const isOver = qty > 0 && remaining < 0;
                          const isLow = qty > 0 && remaining >= 0 && remaining <= Number(invItem.min_stock ?? 0);
                          return (
                            <div className="flex flex-col gap-1 pt-1.5 min-w-[130px]">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-gray-400">Disponible:</span>
                                <span className={`font-bold tabular-nums ${stock > 0 ? 'text-gray-700' : 'text-red-500'}`}>{fmtNum(stock)}</span>
                              </div>
                              {qty > 0 && (
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className={isOver ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-rose-400'}>Restante:</span>
                                  <span className={`font-bold tabular-nums ${isOver ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-rose-600'}`}>{fmtNum(remaining)}</span>
                                </div>
                              )}
                              {qty > 0 && isLow && !isOver && (
                                <span className="text-[10px] text-amber-500 font-medium">Quedara bajo minimo</span>
                              )}
                              <span className="text-[10px] text-gray-300">{unit}</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(row.id)}
                        className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 active:scale-90 transition-all duration-150 shrink-0 mt-1"
                        title="Quitar item"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-rose-300 text-sm font-medium text-rose-600 hover:bg-rose-50 hover:border-rose-400 active:scale-[0.98] transition-all duration-150 font-display"
          >
            <Plus size={16} /> Agregar item
          </button>
        </div>

        {/* ── Progress overlay ── */}
        {saving && (
          <div className="rounded-2xl bg-gray-900/95 p-6 text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-rose-400" />
              <span className="text-white font-semibold text-sm">
                {savingStep === 'registering' && 'Registrando movimiento...'}
                {savingStep === 'generating'  && 'Generando documento PDF...'}
                {savingStep === 'uploading'   && 'Subiendo a OneDrive...'}
                {!savingStep                  && 'Procesando...'}
              </span>
            </div>
            <div className="flex items-center gap-2 justify-center">
              {['registering', 'generating', 'uploading'].map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                    step === savingStep ? 'bg-rose-400 animate-pulse' :
                    ['registering', 'generating', 'uploading'].indexOf(savingStep) > i ? 'bg-rose-400' : 'bg-white/20'
                  }`} />
                  {i < 2 && <div className={`w-6 h-0.5 transition-colors duration-300 ${
                    ['registering', 'generating', 'uploading'].indexOf(savingStep) > i ? 'bg-rose-400' : 'bg-white/10'
                  }`} />}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/40">No cierre esta ventana</p>
          </div>
        )}

        {!saving && (
          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 font-display"
            >
              Limpiar
            </button>
            <button
              type="submit"
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 active:scale-[0.97] active:shadow-md font-display"
            >
              <ArrowUpFromLine size={16} /> Registrar salida
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
