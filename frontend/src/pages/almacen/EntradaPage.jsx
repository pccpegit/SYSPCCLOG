import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Search, CheckCircle, RotateCcw, Plus, Trash2, Download } from 'lucide-react';
import { getInventory, registerEntryBatch } from '../../api/almacen';
import { useToast } from '../../context/ToastContext';
import NumberInput from '../../components/ui/NumberInput';
import { ucFirst, fmtNum } from '../../utils/format';
import { WAREHOUSES } from '../../data/almacenConstants';

const SOURCE_TYPES = [
  { value: 'PURCHASE',     label: 'Compra'            },
  { value: 'RETURN',       label: 'Devolucion'        },
  { value: 'TRANSFER_IN',  label: 'Traslado entrante' },
  { value: 'INITIAL_LOAD', label: 'Carga inicial'     },
];

const EMPTY_HEADER = {
  warehouse: 'CENTRAL',
  source_type: 'PURCHASE',
  supplier_name: '',
  invoice_number: '',
  notes: '',
};

const newItemRow = () => ({ id: crypto.randomUUID(), inventory_item: '', quantity: '' });

// ── Item search ──────────────────────────────────────────────────────────────

function ItemSearchSelect({ allItems, value, onChange, loading, accentColor = 'emerald' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const selected = allItems.find((i) => String(i.id) === String(value));
  const filtered = query
    ? allItems.filter((i) =>
        (i.product_code ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (i.description ?? '').toLowerCase().includes(query.toLowerCase()))
    : allItems;

  const focusCls = accentColor === 'emerald'
    ? 'focus:ring-emerald-500 focus:border-emerald-500'
    : 'focus:ring-rose-500 focus:border-rose-500';
  const hoverCls = accentColor === 'emerald' ? 'hover:border-emerald-400' : 'hover:border-rose-400';
  const rowHoverCls = accentColor === 'emerald' ? 'hover:bg-emerald-50' : 'hover:bg-rose-50';

  return (
    <div className="relative">
      {selected && !open ? (
        <div
          className={`flex items-center justify-between w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-white cursor-pointer ${hoverCls} transition-colors`}
          onClick={() => { setOpen(true); setQuery(''); }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-gray-400 shrink-0">{selected.product_code}</span>
            <span className="text-gray-800 font-medium truncate">{selected.description}</span>
          </div>
          <span className="text-xs text-gray-400 ml-2 shrink-0">{ucFirst(selected.unit)}</span>
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
            className={`w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 ${focusCls} bg-gray-50/50 focus:bg-white transition-colors`}
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
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onChange(String(item.id)); setQuery(''); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm ${rowHoverCls} text-left transition-colors first:rounded-t-xl last:rounded-b-xl`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-gray-400 shrink-0">{item.product_code}</span>
                    <span className="text-gray-800 truncate">{item.description}</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                    Stock: {item.total_stock ?? 0} {ucFirst(item.unit)}
                  </span>
                </button>
              ))
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
    hasError ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-emerald-500 focus:border-emerald-500'
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

export default function EntradaPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [header, setHeader]   = useState(EMPTY_HEADER);
  const [lineItems, setLineItems] = useState([newItemRow()]);
  const [allItems, setAllItems]   = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [saving, setSaving]       = useState(false);
  const [savingStep, setSavingStep] = useState('');
  const [errors, setErrors]       = useState({});
  const [success, setSuccess]     = useState(false);
  const [groupId, setGroupId]     = useState(null);

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
    if (!header.warehouse) errs.warehouse = 'Seleccione almacen.';
    lineItems.forEach((row, idx) => {
      if (!row.inventory_item) errs[`item_${idx}_inventory`] = 'Seleccione un item.';
      if (!row.quantity || Number(row.quantity) <= 0) errs[`item_${idx}_qty`] = 'Cantidad invalida.';
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

      const res = await registerEntryBatch({
        items: lineItems.map((row) => ({
          inventory: Number(row.inventory_item),
          quantity:  Number(row.quantity),
        })),
        warehouse:      header.warehouse,
        source_type:    header.source_type,
        supplier_name:  header.supplier_name  || undefined,
        invoice_number: header.invoice_number || undefined,
        notes:          header.notes          || undefined,
      });

      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);

      const gId = res.data?.id;
      setGroupId(gId);

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

      showToast({ type: 'success', message: 'Entrada registrada correctamente.' });
      setSuccess(true);
    } catch (err) {
      showToast({ type: 'error', message: err.response?.data?.detail ?? 'No se pudo registrar la entrada.' });
    } finally {
      setSaving(false);
      setSavingStep('');
    }
  };

  const handleReset = () => {
    setHeader(EMPTY_HEADER);
    setLineItems([newItemRow()]);
    setErrors({});
    setSuccess(false);
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-8 sm:mt-16">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 sm:p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2 font-display">Entrada registrada</h2>
          <p className="text-sm text-gray-500 mb-6">
            {lineItems.length} item{lineItems.length !== 1 ? 's' : ''} registrado{lineItems.length !== 1 ? 's' : ''} correctamente en el sistema.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {groupId && (
              <a
                href={`/api/v1/warehouse/movements/groups/${groupId}/pdf/`}
                download
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-all duration-150 shadow-lg shadow-emerald-600/20 active:scale-[0.97] active:shadow-md font-display"
              >
                <Download size={16} /> Descargar vale
              </a>
            )}
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 font-display"
            >
              <RotateCcw size={16} /> Nueva entrada
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
        <div className="w-11 h-11 rounded-xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
          <ArrowDownToLine size={20} className="text-emerald-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">Registrar Entrada</h1>
          <p className="text-sm text-gray-400">Ingreso de materiales al almacen</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── Header fields ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-7 space-y-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-display">Datos generales</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Almacen" required id="warehouse" error={errors.warehouse}>
              <select id="warehouse" value={header.warehouse} onChange={(e) => setH('warehouse', e.target.value)} className={inputCls(!!errors.warehouse)}>
                {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Tipo de origen" required id="source_type">
              <div className="grid grid-cols-2 gap-2">
                {SOURCE_TYPES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setH('source_type', s.value)}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-150 active:scale-[0.95] font-display ${
                      header.source_type === s.value
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Proveedor" id="supplier_name">
              <input id="supplier_name" value={header.supplier_name} onChange={(e) => setH('supplier_name', e.target.value)} className={inputCls(false)} placeholder="Nombre (opcional)" />
            </Field>
            <Field label="N. Factura / Guia" id="invoice_number">
              <input id="invoice_number" value={header.invoice_number} onChange={(e) => setH('invoice_number', e.target.value)} className={inputCls(false)} placeholder="F001-000123 (opcional)" />
            </Field>
          </div>

          <Field label="Notas" id="notes">
            <textarea id="notes" value={header.notes} onChange={(e) => setH('notes', e.target.value)} rows={2} className={`${inputCls(false)} resize-none`} placeholder="Observaciones adicionales (opcional)" />
          </Field>
        </div>

        {/* ── Item list ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-7 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide font-display">
              Items a ingresar <span className="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold font-display">{lineItems.length}</span>
            </p>
          </div>

          <div className="space-y-3">
            {lineItems.map((row, idx) => (
              <div key={row.id} className="relative rounded-xl border border-gray-100 bg-gray-50/40 p-4">
                {/* Row number */}
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
                        accentColor="emerald"
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
                      {(() => {
                        const inv = allItems.find((i) => String(i.id) === String(row.inventory_item));
                        if (!inv) return null;
                        const stock = Number(inv.total_stock ?? 0);
                        const qty = Number(row.quantity) || 0;
                        const newStock = stock + qty;
                        return (
                          <div className="flex flex-col gap-1 pt-1.5 min-w-[120px]">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-gray-400">Stock actual:</span>
                              <span className="font-bold text-gray-700 tabular-nums">{fmtNum(stock)}</span>
                            </div>
                            {qty > 0 && (
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-emerald-500">Despues:</span>
                                <span className="font-bold text-emerald-600 tabular-nums">{fmtNum(newStock)}</span>
                              </div>
                            )}
                            <span className="text-[10px] text-gray-300">{ucFirst(inv.unit)}</span>
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
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-emerald-300 text-sm font-medium text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 active:scale-[0.98] transition-all duration-150 font-display"
          >
            <Plus size={16} /> Agregar item
          </button>
        </div>

        {/* ── Progress overlay ── */}
        {saving && (
          <div className="rounded-2xl bg-gray-900/95 p-6 text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-emerald-400" />
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
                    step === savingStep ? 'bg-emerald-400 animate-pulse' :
                    ['registering', 'generating', 'uploading'].indexOf(savingStep) > i ? 'bg-emerald-400' : 'bg-white/20'
                  }`} />
                  {i < 2 && <div className={`w-6 h-0.5 transition-colors duration-300 ${
                    ['registering', 'generating', 'uploading'].indexOf(savingStep) > i ? 'bg-emerald-400' : 'bg-white/10'
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
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.97] active:shadow-md font-display"
            >
              <ArrowDownToLine size={16} /> Registrar entrada
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
