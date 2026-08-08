import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Search,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
import {
  getProveedores,
  createProveedor,
  buscarRuc,
} from '../../api/administracion';
import { useToast } from '../../context/ToastContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return '\u2014';
  const d = new Date(str);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

// ── Proveedor Modal ───────────────────────────────────────────────────────────

function ProveedorModal({ onClose, onSuccess }) {
  const { showToast } = useToast();

  const [ruc, setRuc]               = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [rucSearching, setRucSearching] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [errors, setErrors]           = useState({});

  const handleRucSearch = async () => {
    if (ruc.length < 11) return;
    setRucSearching(true);
    try {
      const res = await buscarRuc(ruc);
      if (res.data?.razon_social) {
        setRazonSocial(res.data.razon_social);
        showToast({ type: 'info', message: 'Razon social encontrada y cargada.' });
      } else {
        showToast({ type: 'info', message: 'RUC no encontrado. Ingrese la razon social manualmente.' });
      }
    } catch {
      showToast({ type: 'error', message: 'No se pudo consultar el RUC.' });
    } finally {
      setRucSearching(false);
    }
  };

  const validate = () => {
    const errs = {};
    if (!ruc || ruc.length !== 11) errs.ruc         = 'El RUC debe tener 11 digitos.';
    if (!razonSocial.trim())        errs.razon_social = 'La razon social es obligatoria.';
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await createProveedor({ ruc, razon_social: razonSocial.trim() });
      showToast({ type: 'success', message: 'Proveedor registrado correctamente.' });
      onSuccess();
    } catch (err) {
      const msg = err.response?.data?.ruc?.[0]
        ?? err.response?.data?.detail
        ?? 'No se pudo registrar el proveedor.';
      showToast({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-gray-100 shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center">
              <Building2 size={17} className="text-indigo-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Nuevo proveedor</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* RUC */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              RUC <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                value={ruc}
                onChange={(e) => setRuc(e.target.value.replace(/\D/g, '').slice(0, 11))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleRucSearch())}
                maxLength={11}
                placeholder="20XXXXXXXXX"
                className={inputCls(!!errors.ruc)}
              />
              <button
                type="button"
                onClick={handleRucSearch}
                disabled={rucSearching || ruc.length < 11}
                className="px-3.5 rounded-xl border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors disabled:opacity-40"
                title="Buscar en SUNAT"
              >
                {rucSearching
                  ? <span className="animate-spin block w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full" />
                  : <Search size={16} />
                }
              </button>
            </div>
            {errors.ruc && <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.ruc}</p>}
          </div>

          {/* Razon social */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Razon social <span className="text-red-400">*</span>
            </label>
            <input
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="Nombre o razon social del proveedor"
              className={inputCls(!!errors.razon_social)}
            />
            {errors.razon_social && (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.razon_social}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex gap-3 justify-end rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-60"
          >
            {saving
              ? <><span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> Guardando...</>
              : <><Check size={16} /> Registrar proveedor</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [modalOpen, setModalOpen]     = useState(false);

  const fetchProveedores = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search) params.search = search;
      const res  = await getProveedores(params);
      const data = res.data?.results ?? res.data ?? [];
      setProveedores(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudieron cargar los proveedores.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => fetchProveedores(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchProveedores, search]);

  // Filter locally by search (in case API doesn't support search param)
  const filteredProveedores = search
    ? proveedores.filter(
        (p) =>
          p.ruc?.includes(search) ||
          (p.razon_social ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : proveedores;

  return (
    <>
      <div className="space-y-5 max-w-4xl mx-auto">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Proveedores</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Empresas de transporte y aerolineas registradas.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-600/20 w-full sm:w-auto"
          >
            <Plus size={16} /> Nuevo proveedor
          </button>
        </div>

        {/* ── Search ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por RUC o razon social..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-indigo-600" />
            </div>
          ) : filteredProveedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Building2 size={28} strokeWidth={1.2} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {search ? 'Sin resultados para la busqueda' : 'No hay proveedores registrados'}
              </p>
              {!search && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Registrar primer proveedor
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">#</th>
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">RUC</th>
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Razon social</th>
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Fecha registro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredProveedores.map((p, idx) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 sm:px-6 py-3.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                      <td className="px-5 sm:px-6 py-3.5 font-mono text-sm text-gray-700 font-semibold whitespace-nowrap">
                        {p.ruc}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-800 font-medium">{p.razon_social}</td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-400 text-xs hidden sm:table-cell whitespace-nowrap">
                        {formatDate(p.created_at ?? p.fecha_registro)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Count footer */}
          {!loading && filteredProveedores.length > 0 && (
            <div className="px-5 sm:px-6 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">{filteredProveedores.length} proveedores</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <ProveedorModal
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            setModalOpen(false);
            fetchProveedores();
          }}
        />
      )}
    </>
  );
}
