import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Search,
  Download,
  AlertTriangle,
  CheckCircle,
  X,
} from 'lucide-react';
import { getPasajes, marcarPagado, exportPasajesUrl } from '../../api/administracion';
import { useToast } from '../../context/ToastContext';
import { fmtNum } from '../../utils/format';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return '\u2014';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function EstadoBadge({ estado }) {
  if (estado === 'PAGADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-green-50 text-green-700 ring-1 ring-green-100">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Pagado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-100">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Pendiente
    </span>
  );
}

const ESTADO_FILTERS = [
  { value: '',          label: 'Todos'     },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'PAGADO',    label: 'Pagado'    },
];

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

// ── Marcar Pagado Modal ───────────────────────────────────────────────────────

function PagoModal({ pasaje, onClose, onSuccess }) {
  const { showToast } = useToast();
  const [fechaPago, setFechaPago]     = useState(new Date().toISOString().split('T')[0]);
  const [nroOperacion, setNroOperacion] = useState('');
  const [saving, setSaving]           = useState(false);
  const [errors, setErrors]           = useState({});

  const validate = () => {
    const errs = {};
    if (!fechaPago)    errs.fecha_pago    = 'La fecha de pago es obligatoria.';
    if (!nroOperacion) errs.nro_operacion = 'El N. de operacion es obligatorio.';
    return errs;
  };

  const handleConfirm = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await marcarPagado(pasaje.id, {
        fecha_pago:    fechaPago,
        nro_operacion: nroOperacion,
      });
      showToast({ type: 'success', message: 'Pasaje marcado como pagado.' });
      onSuccess();
    } catch (err) {
      showToast({ type: 'error', message: err.response?.data?.detail ?? 'No se pudo registrar el pago.' });
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
            <div className="w-9 h-9 rounded-xl bg-green-50 ring-1 ring-green-100 flex items-center justify-center">
              <CheckCircle size={17} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Marcar como pagado</p>
              <p className="text-xs text-gray-400">{pasaje.nombres}</p>
            </div>
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
          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-4 text-sm">
            <div className="flex justify-between mb-1.5">
              <span className="text-gray-500">DNI:</span>
              <span className="font-mono font-semibold text-gray-800">{pasaje.dni}</span>
            </div>
            <div className="flex justify-between mb-1.5">
              <span className="text-gray-500">Factura:</span>
              <span className="font-mono font-semibold text-gray-800">{pasaje.factura ?? '\u2014'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total a pagar:</span>
              <span className="font-bold text-indigo-700 text-base">S/ {fmtNum(pasaje.total_soles ?? 0)}</span>
            </div>
          </div>

          {/* Fecha pago */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Fecha de pago <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              className={inputCls(!!errors.fecha_pago)}
            />
            {errors.fecha_pago && (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.fecha_pago}</p>
            )}
          </div>

          {/* N. operacion */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              N. de operacion <span className="text-red-400">*</span>
            </label>
            <input
              value={nroOperacion}
              onChange={(e) => setNroOperacion(e.target.value)}
              placeholder="Ej: 123456789"
              className={inputCls(!!errors.nro_operacion)}
            />
            {errors.nro_operacion && (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.nro_operacion}</p>
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
            onClick={handleConfirm}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-green-600/20 disabled:opacity-60"
          >
            {saving
              ? <><span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> Registrando...</>
              : <><CheckCircle size={16} /> Confirmar pago</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PagosPage() {
  const [pasajes, setPasajes]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [page, setPage]               = useState(1);
  const [totalCount, setTotalCount]   = useState(0);

  // Filters
  const [search,       setSearch]       = useState('');
  const [filterEstado, setFilterEstado] = useState('PENDIENTE');

  // Modal
  const [selectedPasaje, setSelectedPasaje] = useState(null);

  const fetchPasajes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, page_size: 25 };
      if (search)       params.search = search;
      if (filterEstado) params.estado = filterEstado;
      const res   = await getPasajes(params);
      const data  = res.data?.results ?? res.data ?? [];
      const count = res.data?.count   ?? (Array.isArray(data) ? data.length : 0);
      setPasajes(Array.isArray(data) ? data : []);
      setTotalCount(count);
    } catch {
      setError('No se pudieron cargar los pagos.');
    } finally {
      setLoading(false);
    }
  }, [page, search, filterEstado]);

  useEffect(() => { setPage(1); }, [search, filterEstado]);

  useEffect(() => {
    const timer = setTimeout(() => fetchPasajes(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchPasajes, search]);

  const exportFilters = {};
  if (search)       exportFilters.search = search;
  if (filterEstado) exportFilters.estado = filterEstado;

  return (
    <>
      <div className="space-y-5 max-w-7xl mx-auto">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Pagos</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Seguimiento de pagos de pasajes pendientes y realizados.
            </p>
          </div>
          <a
            href={exportPasajesUrl(exportFilters)}
            download
            className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors w-full sm:w-auto"
          >
            <Download size={16} /> Exportar Excel
          </a>
        </div>

        {/* ── Filters ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por DNI, nombre o factura..."
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50 focus:bg-white transition-colors"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ESTADO_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilterEstado(filterEstado === f.value ? '' : f.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${
                    filterEstado === f.value
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
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
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-indigo-600" />
            </div>
          ) : pasajes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <CreditCard size={28} strokeWidth={1.2} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {filterEstado === 'PENDIENTE' ? 'No hay pagos pendientes' : 'No hay registros'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">#</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">DNI</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Nombres</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Tipo</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Factura</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Proveedor</th>
                    <th className="px-4 sm:px-5 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total S/</th>
                    <th className="px-4 sm:px-5 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Fecha</th>
                    <th className="px-4 sm:px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">N. Operacion</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pasajes.map((p, idx) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs font-mono">
                        {(page - 1) * 25 + idx + 1}
                      </td>
                      <td className="px-4 sm:px-5 py-3.5 font-mono text-xs text-gray-600 whitespace-nowrap">{p.dni}</td>
                      <td className="px-4 sm:px-5 py-3.5 text-gray-800 font-medium max-w-[160px] truncate">{p.nombres}</td>
                      <td className="px-4 sm:px-5 py-3.5 text-gray-500 hidden md:table-cell whitespace-nowrap">
                        {p.tipo_pasaje === 'SB' ? 'S/B' : p.tipo_pasaje}
                      </td>
                      <td className="px-4 sm:px-5 py-3.5 font-mono text-xs text-gray-400 hidden sm:table-cell">{p.factura ?? '\u2014'}</td>
                      <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs hidden lg:table-cell max-w-[140px] truncate">{p.razon_social ?? '\u2014'}</td>
                      <td className="px-4 sm:px-5 py-3.5 text-right font-bold text-indigo-700 tabular-nums whitespace-nowrap">
                        S/ {fmtNum(p.total_soles ?? 0)}
                      </td>
                      <td className="px-4 sm:px-5 py-3.5 text-center">
                        <EstadoBadge estado={p.estado} />
                      </td>
                      <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs hidden md:table-cell whitespace-nowrap">
                        {p.estado === 'PAGADO'
                          ? formatDate(p.fecha_pago)
                          : formatDate(p.fecha_bajada ?? p.fecha_subida)
                        }
                      </td>
                      <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs font-mono hidden xl:table-cell">
                        {p.nro_operacion ?? '\u2014'}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        {p.estado === 'PENDIENTE' && (
                          <button
                            onClick={() => setSelectedPasaje(p)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap"
                          >
                            <CheckCircle size={13} /> Marcar pagado
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && totalCount > 0 && (
            <div className="flex items-center justify-between px-5 sm:px-6 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">{totalCount} registros</p>
              <div className="flex gap-2 items-center">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <span className="px-3 py-1.5 text-xs text-gray-500">Pag. {page}</span>
                <button
                  disabled={pasajes.length < 25}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Pago Modal ──────────────────────────────────────── */}
      {selectedPasaje && (
        <PagoModal
          pasaje={selectedPasaje}
          onClose={() => setSelectedPasaje(null)}
          onSuccess={() => {
            setSelectedPasaje(null);
            fetchPasajes();
          }}
        />
      )}
    </>
  );
}
