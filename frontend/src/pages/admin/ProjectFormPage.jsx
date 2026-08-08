import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  FolderPlus,
  Save,
  AlertTriangle,
  Users,
  Info,
} from 'lucide-react';
import { getProject } from '../../api/core';
import { createProject, updateProject } from '../../api/projects';
import { useToast } from '../../context/ToastContext';
import { extractFieldErrors, extractErrorMessage } from '../../utils/apiErrors';
import NumberInput from '../../components/ui/NumberInput';

const EMPTY_FORM = {
  code: '',
  name: '',
  location: '',
  client: '',
  frente: '',
  total_budget: '',
  start_date: '',
  end_date: '',
  is_active: true,
};

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

// Visual/tab order of fields whose ref we can programmatically focus on a
// failed submit. `total_budget` is intentionally excluded — it's rendered
// via <NumberInput> (out of this ticket's scope), which doesn't forward a
// ref, so it can't be focused this way; its errors still show inline.
const FIELD_ORDER = ['code', 'name', 'client', 'location', 'frente', 'start_date', 'end_date'];

function Field({ label, required, id, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-[11px] text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );
}

export default function ProjectFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading]     = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [residents, setResidents] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');

  // Refs for focus management on failed submit (see FIELD_ORDER above).
  const fieldRefs = {
    code: useRef(null),
    name: useRef(null),
    client: useRef(null),
    location: useRef(null),
    frente: useRef(null),
    start_date: useRef(null),
    end_date: useRef(null),
  };
  const formErrorRef = useRef(null);

  const focusFirstError = (errs) => {
    // Deferred: refs only attach once React commits the re-render
    // triggered by setFieldErrors/setFormError just before this is called.
    requestAnimationFrame(() => {
      const firstKey = FIELD_ORDER.find((k) => errs[k]);
      const target = firstKey ? fieldRefs[firstKey]?.current : formErrorRef.current;
      target?.focus();
    });
  };

  const loadProject = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await getProject(id);
      setForm({
        code:         data.code ?? '',
        name:         data.name ?? '',
        location:     data.location ?? '',
        client:       data.client ?? '',
        frente:       data.frente ?? '',
        total_budget: data.total_budget != null ? String(data.total_budget) : '',
        start_date:   data.start_date ?? '',
        end_date:     data.end_date ?? '',
        is_active:    data.is_active ?? true,
      });
      setResidents(data.residents ?? []);
    } catch {
      setLoadError('No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const setF = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = () => {
    const errs = {};
    if (!form.code.trim()) errs.code = 'El código es obligatorio.';
    if (!form.name.trim()) errs.name = 'El nombre es obligatorio.';
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      errs.end_date = 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      focusFirstError(errs);
      return;
    }

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      location: form.location.trim(),
      client: form.client.trim(),
      frente: form.frente.trim(),
      total_budget: form.total_budget ? Number(form.total_budget) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateProject(id, payload);
        showToast({ type: 'success', message: 'Proyecto actualizado correctamente.' });
      } else {
        await createProject(payload);
        showToast({ type: 'success', message: 'Proyecto creado correctamente.' });
      }
      navigate('/admin/proyectos');
    } catch (err) {
      const errs = extractFieldErrors(err);
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        focusFirstError(errs);
      } else {
        setFormError(extractErrorMessage(err, 'No se pudo guardar el proyecto.'));
        focusFirstError({});
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-indigo-600" aria-hidden="true" />
        <span className="sr-only">Cargando proyecto…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="max-w-2xl mx-auto bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> {loadError}</span>
        <button onClick={loadProject} className="font-semibold underline underline-offset-2 shrink-0">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/admin/proyectos')}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Volver a Proyectos"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="w-9 h-9 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center shrink-0">
          {isEdit ? <Building2 size={17} className="text-indigo-600" aria-hidden="true" /> : <FolderPlus size={17} className="text-indigo-600" aria-hidden="true" />}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}
          </h1>
          <p className="text-sm text-gray-400">Datos de la obra en el sistema.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">

        {formError && (
          <div
            ref={formErrorRef}
            tabIndex={-1}
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> {formError}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Datos del proyecto</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Código" required id="code" hint="Ej: PROY-2026-001" error={fieldErrors.code}>
              <input
                id="code"
                ref={fieldRefs.code}
                value={form.code}
                onChange={(e) => setF('code', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.code}
                aria-describedby={fieldErrors.code ? 'code-error' : undefined}
                className={inputCls(!!fieldErrors.code)}
              />
            </Field>
            <Field label="Nombre" required id="name" error={fieldErrors.name}>
              <input
                id="name"
                ref={fieldRefs.name}
                value={form.name}
                onChange={(e) => setF('name', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                className={inputCls(!!fieldErrors.name)}
              />
            </Field>
            <Field label="Cliente" id="client" error={fieldErrors.client}>
              <input
                id="client"
                ref={fieldRefs.client}
                value={form.client}
                onChange={(e) => setF('client', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.client}
                aria-describedby={fieldErrors.client ? 'client-error' : undefined}
                className={inputCls(!!fieldErrors.client)}
              />
            </Field>
            <Field label="Ubicación" id="location" error={fieldErrors.location}>
              <input
                id="location"
                ref={fieldRefs.location}
                value={form.location}
                onChange={(e) => setF('location', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.location}
                aria-describedby={fieldErrors.location ? 'location-error' : undefined}
                className={inputCls(!!fieldErrors.location)}
              />
            </Field>
            <Field label="Frente" id="frente" hint="Ej: MINERA YANACOCHA" error={fieldErrors.frente}>
              <input
                id="frente"
                ref={fieldRefs.frente}
                value={form.frente}
                onChange={(e) => setF('frente', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.frente}
                aria-describedby={fieldErrors.frente ? 'frente-error' : undefined}
                className={inputCls(!!fieldErrors.frente)}
              />
            </Field>
            <Field label="Presupuesto total (S/)" id="total_budget" error={fieldErrors.total_budget}>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold select-none">S/</span>
                <NumberInput
                  id="total_budget"
                  value={form.total_budget}
                  onChange={(v) => setF('total_budget', v)}
                  className={`${inputCls(!!fieldErrors.total_budget)} pl-8`}
                  placeholder="0.00"
                  disabled={saving}
                  aria-invalid={!!fieldErrors.total_budget}
                  aria-describedby={fieldErrors.total_budget ? 'total_budget-error' : undefined}
                />
              </div>
            </Field>
            <Field label="Fecha de inicio" id="start_date" error={fieldErrors.start_date}>
              <input
                id="start_date"
                ref={fieldRefs.start_date}
                type="date"
                value={form.start_date}
                onChange={(e) => setF('start_date', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.start_date}
                aria-describedby={fieldErrors.start_date ? 'start_date-error' : undefined}
                className={inputCls(!!fieldErrors.start_date)}
              />
            </Field>
            <Field label="Fecha de fin" id="end_date" error={fieldErrors.end_date}>
              <input
                id="end_date"
                ref={fieldRefs.end_date}
                type="date"
                value={form.end_date}
                onChange={(e) => setF('end_date', e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.end_date}
                aria-describedby={fieldErrors.end_date ? 'end_date-error' : undefined}
                className={inputCls(!!fieldErrors.end_date)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-3 cursor-pointer group pt-1 select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setF('is_active', e.target.checked)}
              disabled={saving}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">Proyecto activo</span>
          </label>
        </div>

        {/* Residentes asignados — read-only, edit mode only */}
        {isEdit && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Users size={15} className="text-gray-400" aria-hidden="true" /> Residentes asignados
              </p>
              <Link
                to={`/admin/usuarios?project=${id}`}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                Ver en Usuarios
              </Link>
            </div>
            {residents.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Sin residente de proyecto asignado.</p>
            ) : (
              <ul className="space-y-1.5">
                {residents.map((r) => (
                  <li key={r.id} className="text-sm text-gray-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                    {r.full_name || r.username}
                    <span className="text-xs text-gray-400 font-mono">@{r.username}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3.5 py-2.5">
              <Info size={13} className="shrink-0 mt-0.5 text-blue-500" aria-hidden="true" />
              <p className="text-[11px] text-blue-700 leading-relaxed">
                La asignación de residentes se hace desde la ficha del usuario (rol Residente de Proyecto), no aquí.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin/proyectos')}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-60"
          >
            {saving
              ? <><span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" aria-hidden="true" /> Guardando...</>
              : <><Save size={16} aria-hidden="true" /> {isEdit ? 'Guardar cambios' : 'Crear proyecto'}</>
            }
          </button>
        </div>
      </form>
    </div>
  );
}
