import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
import {
  getPoliticas,
  createPolitica,
  updatePolitica,
  deletePolitica,
} from '../../api/administracion';
import { useToast } from '../../context/ToastContext';
import NumberInput from '../../components/ui/NumberInput';
import { fmtNum } from '../../utils/format';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPO_TRABAJADOR_OPTIONS = [
  { value: '',       label: 'Todos'      },
  { value: 'STAFF',  label: 'Staff'      },
  { value: 'WORKER', label: 'Trabajador' },
];

const EMPTY_FORM = {
  tramo: '',
  tipo_trabajador: 'STAFF',
  monto_soles: '',
  monto_dolares: '',
  en_dolares: false,
  no_devolucion: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

function Field({ label, required, id, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );
}

// ── Politica Modal ────────────────────────────────────────────────────────────

function PoliticaModal({ politica, onClose, onSuccess }) {
  const { showToast } = useToast();
  const isEdit = !!politica?.id;

  const [form, setForm]     = useState(
    isEdit
      ? {
          tramo:          politica.tramo ?? '',
          tipo_trabajador: politica.tipo_trabajador ?? 'STAFF',
          monto_soles:    String(politica.monto_soles ?? ''),
          monto_dolares:  String(politica.monto_dolares ?? ''),
          en_dolares:     politica.en_dolares ?? false,
          no_devolucion:  politica.no_devolucion ?? false,
        }
      : { ...EMPTY_FORM },
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const setF = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const validate = () => {
    const errs = {};
    if (!form.tramo)           errs.tramo           = 'El tramo es obligatorio.';
    if (!form.tipo_trabajador) errs.tipo_trabajador  = 'Seleccione tipo de trabajador.';
    if (!form.no_devolucion && !form.monto_soles) {
      errs.monto_soles = 'El monto en soles es obligatorio.';
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const payload = {
        tramo:           form.tramo,
        tipo_trabajador: form.tipo_trabajador,
        en_dolares:      form.en_dolares,
        no_devolucion:   form.no_devolucion,
        monto_soles:     Number(form.monto_soles)   || 0,
        monto_dolares:   Number(form.monto_dolares) || 0,
      };
      if (isEdit) {
        await updatePolitica(politica.id, payload);
        showToast({ type: 'success', message: 'Politica actualizada.' });
      } else {
        await createPolitica(payload);
        showToast({ type: 'success', message: 'Politica creada correctamente.' });
      }
      onSuccess();
    } catch (err) {
      showToast({ type: 'error', message: err.response?.data?.detail ?? 'No se pudo guardar la politica.' });
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
              <Shield size={17} className="text-indigo-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {isEdit ? 'Editar politica' : 'Nueva politica de devolucion'}
            </p>
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
          <Field label="Tramo" required id="tramo" error={errors.tramo}>
            <input
              id="tramo"
              value={form.tramo}
              onChange={(e) => setF('tramo', e.target.value)}
              placeholder="Ej: Lima - Arequipa"
              className={inputCls(!!errors.tramo)}
            />
          </Field>

          <Field label="Tipo de trabajador" required id="tipo_trabajador" error={errors.tipo_trabajador}>
            <div className="flex gap-2">
              {TIPO_TRABAJADOR_OPTIONS.filter((t) => t.value).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all select-none ${
                    form.tipo_trabajador === opt.value
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <input
                    type="radio"
                    name="modal_tipo_trabajador"
                    value={opt.value}
                    checked={form.tipo_trabajador === opt.value}
                    onChange={() => setF('tipo_trabajador', opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto soles (S/)" required={!form.no_devolucion} id="monto_soles" error={errors.monto_soles}>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold select-none">S/</span>
                <NumberInput
                  value={form.monto_soles}
                  onChange={(v) => setF('monto_soles', v)}
                  className={`${inputCls(!!errors.monto_soles)} pl-8`}
                  placeholder="0.00"
                  disabled={form.no_devolucion}
                />
              </div>
            </Field>
            <Field label="Monto dolares ($)" id="monto_dolares">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold select-none">$</span>
                <NumberInput
                  value={form.monto_dolares}
                  onChange={(v) => setF('monto_dolares', v)}
                  className={`${inputCls(false)} pl-7`}
                  placeholder="0.00"
                  disabled={form.no_devolucion}
                />
              </div>
            </Field>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setF('en_dolares', !form.en_dolares)}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  form.en_dolares
                    ? 'bg-indigo-600 border-indigo-600'
                    : 'border-gray-300 group-hover:border-indigo-400'
                }`}
              >
                {form.en_dolares && <Check size={13} className="text-white" strokeWidth={3} />}
              </div>
              <span className="text-sm text-gray-700">Devolucion en dolares</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setF('no_devolucion', !form.no_devolucion)}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  form.no_devolucion
                    ? 'bg-red-500 border-red-500'
                    : 'border-gray-300 group-hover:border-red-400'
                }`}
              >
                {form.no_devolucion && <Check size={13} className="text-white" strokeWidth={3} />}
              </div>
              <span className="text-sm text-gray-700">Sin devolucion (tramo completo)</span>
            </label>
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
              : <><Check size={16} /> {isEdit ? 'Actualizar' : 'Crear politica'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PoliticasPage() {
  const { showToast } = useToast();

  const [politicas, setPoliticas]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  // Modal
  const [modalOpen, setModalOpen]         = useState(false);
  const [editingPolitica, setEditingPolitica] = useState(null);

  // Delete confirmation
  const [deletingId, setDeletingId]   = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchPoliticas = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filterTipo) params.tipo_trabajador = filterTipo;
      const res  = await getPoliticas(params);
      const data = res.data?.results ?? res.data ?? [];
      setPoliticas(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudieron cargar las politicas.');
    } finally {
      setLoading(false);
    }
  }, [filterTipo]);

  useEffect(() => { fetchPoliticas(); }, [fetchPoliticas]);

  const handleDelete = async (id) => {
    setDeleteLoading(true);
    try {
      await deletePolitica(id);
      showToast({ type: 'success', message: 'Politica eliminada.' });
      setDeletingId(null);
      fetchPoliticas();
    } catch {
      showToast({ type: 'error', message: 'No se pudo eliminar la politica.' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const openCreate = () => { setEditingPolitica(null); setModalOpen(true); };
  const openEdit   = (p) => { setEditingPolitica(p);   setModalOpen(true); };

  return (
    <>
      <div className="space-y-5 max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Politicas de devolucion</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Gestion de montos de devolucion por tramo y tipo de trabajador.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-600/20 w-full sm:w-auto"
          >
            <Plus size={16} /> Nueva politica
          </button>
        </div>

        {/* ── Filters ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 mr-1">Tipo:</span>
            {TIPO_TRABAJADOR_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setFilterTipo(filterTipo === t.value ? '' : t.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${
                  filterTipo === t.value
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </button>
            ))}
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
          ) : politicas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Shield size={28} strokeWidth={1.2} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">No hay politicas configuradas</p>
              <button
                onClick={openCreate}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                Crear primera politica
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tramo</th>
                    <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Monto S/</th>
                    <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Monto $</th>
                    <th className="px-5 sm:px-6 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">En $</th>
                    <th className="px-5 sm:px-6 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Sin devol.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {politicas.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-5 sm:px-6 py-3.5 text-gray-800 font-medium">{p.tramo}</td>
                      <td className="px-5 sm:px-6 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          p.tipo_trabajador === 'STAFF'
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                            : 'bg-orange-50 text-orange-700 ring-1 ring-orange-100'
                        }`}>
                          {p.tipo_trabajador === 'STAFF' ? 'Staff' : 'Trabajador'}
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right font-bold text-gray-800 tabular-nums">
                        {p.no_devolucion ? '\u2014' : `S/ ${fmtNum(p.monto_soles)}`}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right text-gray-500 tabular-nums hidden sm:table-cell">
                        {p.no_devolucion ? '\u2014' : `$ ${fmtNum(p.monto_dolares ?? 0)}`}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-center hidden md:table-cell">
                        {p.en_dolares
                          ? <span className="text-green-600 font-bold text-xs">Si</span>
                          : <span className="text-gray-300 text-xs">No</span>
                        }
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-center">
                        {p.no_devolucion
                          ? <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 ring-1 ring-red-100">Sin devol.</span>
                          : <span className="text-gray-300 text-xs">No</span>
                        }
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(p)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Editar"
                          >
                            <Pencil size={15} />
                          </button>
                          {deletingId === p.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleDelete(p.id)}
                                disabled={deleteLoading}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                              >
                                {deleteLoading ? '...' : 'Confirmar'}
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingId(p.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <PoliticaModal
          politica={editingPolitica}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            setModalOpen(false);
            fetchPoliticas();
          }}
        />
      )}
    </>
  );
}
