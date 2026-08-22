import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, Plus, Package, ChevronRight, X, AlertTriangle,
  MapPin, Download,
} from 'lucide-react';
import {
  getInventory, getCategories, createInventoryItem,
  exportInventoryUrl,
} from '../../api/almacen';
import { useToast } from '../../context/ToastContext';

import { fmtNum, ucFirst } from '../../utils/format';
import {
  ITEM_TYPES, ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, WAREHOUSE_LABELS,
} from '../../data/almacenConstants';

// ── Stock Badge ──────────────────────────────────────────────────────────────

function StockBadge({ stock, minStock }) {
  if (stock === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        Sin stock
      </span>
    );
  }
  if (stock <= minStock) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Bajo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      OK
    </span>
  );
}

// ── Stock bar visual ─────────────────────────────────────────────────────────

function StockBar({ stock, minStock }) {
  if (minStock <= 0) return null;
  const pct = Math.min((stock / minStock) * 100, 200);
  const ratio = stock / minStock;
  const color = ratio <= 0
    ? 'bg-red-500'
    : ratio <= 1
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct / 2, 100)}%` }} />
    </div>
  );
}

// ── Warehouse stock pills ────────────────────────────────────────────────────

function StockPills({ stocks }) {
  if (!stocks || stocks.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {stocks.map((s, i) => {
        const label = WAREHOUSE_LABELS[s.warehouse_type] ?? s.warehouse_type;
        const project = s.project_code ? ` (${s.project_code})` : '';
        return (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[10px] text-gray-500 font-medium ring-1 ring-gray-100">
            {label}{project}: <span className="font-bold text-gray-700">{fmtNum(s.quantity)}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── New item modal ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  product_code: '', description: '', item_type: 'MATERIAL',
  unit: '', category: '', brand: '', model_name: '', location: '', min_stock: 0,
};

function NewItemModal({ onClose, onCreated, categories }) {
  const { showToast } = useToast();
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const validate = () => {
    const errs = {};
    if (!form.product_code.trim()) errs.product_code = 'Requerido';
    if (!form.description.trim())  errs.description = 'Requerido';
    if (!form.unit.trim())         errs.unit = 'Requerido';
    if (!form.category.trim())     errs.category = 'Requerido';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const res = await createInventoryItem(form);
      showToast({ type: 'success', message: 'Item creado correctamente.' });
      onCreated(res.data);
    } catch (err) {
      const msg = err.response?.data?.detail ?? err.response?.data?.product_code?.[0] ?? 'No se pudo crear el item.';
      showToast({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (field) =>
    `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
      errors[field] ? 'border-red-300 dark:border-red-500/30 focus:ring-red-400 focus:border-red-400' : 'border-gray-200 focus:ring-emerald-500 focus:border-emerald-500'
    } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

  const Field = ({ label, id, error, children }) => (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-100">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900 font-display">Nuevo item de inventario</h2>
            <p className="text-xs text-gray-400 mt-0.5">Complete los campos requeridos para registrar un nuevo item.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Codigo *" id="product_code" error={errors.product_code}>
              <input id="product_code" value={form.product_code} onChange={(e) => set('product_code', e.target.value)} className={inputCls('product_code')} placeholder="MAT-CEM-001" />
            </Field>
            <Field label="Tipo *" id="item_type">
              <select id="item_type" value={form.item_type} onChange={(e) => set('item_type', e.target.value)} className={inputCls('item_type')}>
                {ITEM_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Descripcion *" id="description" error={errors.description}>
            <input id="description" value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls('description')} placeholder="Nombre o descripcion del item" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Unidad *" id="unit" error={errors.unit}>
              <input id="unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} className={inputCls('unit')} placeholder="UND, KG, M3, SACO" />
            </Field>
            <Field label="Categoria *" id="category" error={errors.category}>
              <input id="category" value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls('category')} list="cats" placeholder="Ferreteria, Bombas, etc." />
              <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Marca" id="brand">
              <input id="brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} className={inputCls('brand')} placeholder="Opcional" />
            </Field>
            <Field label="Modelo" id="model_name">
              <input id="model_name" value={form.model_name} onChange={(e) => set('model_name', e.target.value)} className={inputCls('model_name')} placeholder="Opcional" />
            </Field>
            <Field label="Stock minimo" id="min_stock">
              <input id="min_stock" type="number" min="0" step="any" value={form.min_stock} onChange={(e) => set('min_stock', Number(e.target.value))} className={inputCls('min_stock')} />
            </Field>
          </div>

          <Field label="Ubicacion fisica" id="location">
            <input id="location" value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls('location')} placeholder="Estante A-3, Rack B, Zona 2" />
          </Field>

          <div className="flex gap-3 pt-3 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 font-display">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-all duration-150 disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.97] active:shadow-md font-display">
              {saving ? <><span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />Guardando...</> : 'Crear item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InventarioPage() {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [items, setItems]           = useState([]);
  const [categories, setCategories] = useState([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [searching, setSearching]   = useState(false);
  const [error, setError]           = useState('');
  const [showModal, setShowModal]   = useState(false);
  const searchingTimer = useRef(null);

  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState('');
  const [itemType, setItemType] = useState('');
  const [lowStock, setLowStock] = useState(location.state?.lowStock ?? false);
  const [page, setPage]         = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchItems = useCallback(async () => {
    // Only show searching indicator if request takes > 150ms (avoids flicker)
    searchingTimer.current = setTimeout(() => setSearching(true), 150);
    setError('');
    try {
      const params = { page, page_size: 25 };
      if (search)   params.search    = search;
      if (category) params.category  = category;
      if (itemType) params.item_type = itemType;
      if (lowStock) params.low_stock = true;
      const res = await getInventory(params);
      const data  = res.data?.results ?? res.data ?? [];
      const count = res.data?.count   ?? (Array.isArray(data) ? data.length : 0);
      setItems(Array.isArray(data) ? data : []);
      setTotalCount(count);
    } catch {
      setError('No se pudo cargar el inventario.');
    } finally {
      clearTimeout(searchingTimer.current);
      setSearching(false);
      setInitialLoad(false);
    }
  }, [search, category, itemType, lowStock, page]);

  useEffect(() => {
    getCategories().then((res) => {
      const cats = res.data?.results ?? res.data ?? [];
      setCategories(Array.isArray(cats) ? cats : []);
    }).catch(() => {});
  }, []);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [search, category, itemType, lowStock]);

  useEffect(() => {
    const timer = setTimeout(() => fetchItems(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchItems, search]);

  const handleCreated = (newItem) => {
    setShowModal(false);
    setItems((prev) => [newItem, ...prev]);
  };

  // Summary stats (computed from current page)
  const totalItems    = items.length;
  const totalStock    = items.reduce((acc, i) => acc + Number(i.total_stock ?? 0), 0);
  const lowStockCount = items.filter(i => (i.total_stock ?? 0) <= Number(i.min_stock ?? 0)).length;

  return (
    <>
      <div className="space-y-5 max-w-7xl mx-auto">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">Inventario</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {initialLoad ? 'Cargando...' : `${totalCount} item${totalCount !== 1 ? 's' : ''} registrados`}
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <a
              href={exportInventoryUrl({ category, item_type: itemType, search, low_stock: lowStock ? 'true' : '' })}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 active:scale-[0.97] transition-all duration-150"
              download
            >
              <Download size={16} /> Exportar
            </a>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-all duration-150 shadow-lg shadow-emerald-600/20 active:scale-[0.97] active:shadow-md flex-1 sm:flex-none justify-center font-display"
            >
              <Plus size={16} strokeWidth={2.5} />
              Nuevo item
            </button>
          </div>
        </div>

        {/* ── Summary pills ───────────────────────────────── */}
        {!initialLoad && totalItems > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-100 text-sm">
              <Package size={14} className="text-emerald-500" />
              <span className="text-gray-500">Total stock:</span>
              <span className="font-bold text-gray-800">{totalStock.toLocaleString()}</span>
            </span>
            {lowStockCount > 0 && (
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/30 text-sm">
                <AlertTriangle size={14} className="text-amber-500" />
                <span className="text-amber-700 dark:text-amber-300 font-medium">{lowStockCount} item{lowStockCount !== 1 ? 's' : ''} con stock bajo</span>
              </span>
            )}
          </div>
        )}

        {/* ── Filters ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${searching ? 'text-emerald-400' : 'text-gray-300'}`} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por codigo, descripcion o marca..."
                className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50/50 focus:bg-white transition-colors"
              />
              {searching && (
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-200 border-t-emerald-500" />
                </div>
              )}
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors">
              <option value="">Todas las categorias</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={itemType} onChange={(e) => setItemType(e.target.value)} className="px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50/50 focus:bg-white transition-colors">
              {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 transition-colors select-none">
              <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} className="w-4 h-4 text-amber-500 rounded border-gray-300 focus:ring-amber-400" />
              <AlertTriangle size={14} className="text-amber-500" />
              <span className="text-sm text-gray-600">Stock bajo</span>
            </label>
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        {/* ── Table ───────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden relative">
          {/* Subtle progress bar at top when searching */}
          {searching && !initialLoad && (
            <div className="absolute top-0 left-0 right-0 h-0.5 z-10 bg-emerald-100 dark:bg-emerald-500/10 overflow-hidden">
              <div className="h-full w-1/3 bg-emerald-500 rounded-full animate-[searchbar_1s_ease-in-out_infinite]" />
              <style>{`@keyframes searchbar{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
            </div>
          )}

          {initialLoad ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600 dark:border-t-emerald-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Package size={32} strokeWidth={1} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">No se encontraron items</p>
              <p className="text-xs text-gray-400">Intenta con otros filtros o crea un nuevo item.</p>
            </div>
          ) : (
            <div className={`overflow-x-auto transition-opacity duration-200 ${searching && !initialLoad ? 'opacity-50' : 'opacity-100'}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-5 sm:px-6 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Tipo</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Categoria</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Ubicacion</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Stock</th>
                    <th className="px-4 py-3.5 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="px-3 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => {
                    const stock = item.total_stock ?? 0;
                    const minSt = Number(item.min_stock ?? 0);
                    const typeColor = ITEM_TYPE_COLORS[item.item_type] ?? 'bg-gray-50 text-gray-600 ring-gray-100';

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                        onClick={() => navigate(`/almacen/inventario/${item.id}`)}
                      >
                        {/* Item: code + description + unit + stock pills */}
                        <td className="px-5 sm:px-6 py-4">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                              <Package size={16} className="text-gray-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">{item.product_code}</span>
                                <span className="text-[10px] text-gray-300 hidden sm:inline">\u00B7</span>
                                <span className="text-[11px] text-gray-400 hidden sm:inline">{ucFirst(item.unit)}</span>
                              </div>
                              <p className="text-sm text-gray-900 font-medium mt-0.5 leading-snug">{item.description}</p>
                              {item.brand && (
                                <p className="text-[11px] text-gray-400 mt-0.5">{item.brand}{item.model_name ? ` \u00B7 ${item.model_name}` : ''}</p>
                              )}
                              {/* Stock breakdown pills - mobile */}
                              <div className="lg:hidden">
                                <StockPills stocks={item.stocks} />
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Type badge */}
                        <td className="px-4 py-4 hidden md:table-cell">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-bold ring-1 ${typeColor}`}>
                            {ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}
                          </span>
                        </td>

                        {/* Category */}
                        <td className="px-4 py-4 text-gray-500 hidden lg:table-cell whitespace-nowrap text-xs">
                          {item.category || '\u2014'}
                        </td>

                        {/* Location */}
                        <td className="px-4 py-4 hidden lg:table-cell">
                          {item.location ? (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <MapPin size={11} className="text-gray-400" />
                              {item.location}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">\u2014</span>
                          )}
                        </td>

                        {/* Stock number + bar */}
                        <td className="px-4 py-4 text-right">
                          <div className="inline-flex flex-col items-end min-w-[60px]">
                            <span className="text-base font-bold text-gray-900 tabular-nums">{fmtNum(stock)}</span>
                            <StockBar stock={stock} minStock={minSt} />
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4 text-center">
                          <StockBadge stock={stock} minStock={minSt} />
                        </td>

                        {/* Arrow */}
                        <td className="px-3 py-4 text-right">
                          <ChevronRight size={15} className="text-gray-200 group-hover:text-emerald-400 transition-colors inline-block" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination ── */}
          {!initialLoad && totalCount > 0 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">{totalCount} items en total</p>
              <div className="flex gap-2 items-center">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all duration-150"
                >
                  Anterior
                </button>
                <span className="px-3 py-1.5 text-xs text-gray-500">Pag. {page}</span>
                <button
                  disabled={items.length < 25}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all duration-150"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showModal && <NewItemModal onClose={() => setShowModal(false)} onCreated={handleCreated} categories={categories} />}
    </>
  );
}
