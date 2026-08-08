import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  UserCog,
  UserPlus,
  Plus,
  Trash2,
  Star,
  Save,
  AlertTriangle,
} from 'lucide-react';
import { getUser, getProjects, getDepartments } from '../../api/core';
import { createUser, updateUser } from '../../api/users';
import { useToast } from '../../context/ToastContext';
import { ROLES, ROLE_LABELS } from '../../data/constants';
import { extractFieldErrors, extractErrorMessage } from '../../utils/apiErrors';
import TemporaryPasswordModal from '../../components/admin/TemporaryPasswordModal';

const EMPTY_FORM = {
  username: '',
  email: '',
  first_name: '',
  last_name: '',
  position: '',
  department: '',
  phone: '',
};

// Visual/tab order of the basic-data fields — also the priority order used
// to decide which field gets focus after a failed submit.
const FIELD_ORDER = ['username', 'email', 'first_name', 'last_name', 'position', 'department', 'phone'];

function newRoleRow() {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: '',
    project: '',
    department_obj: '',
    is_primary: false,
  };
}

const inputCls = (hasError) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50/50 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

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

export default function UserFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading]   = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [roles, setRoles]       = useState([newRoleRow()]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError]     = useState('');

  const [projects, setProjects]     = useState([]);
  const [departments, setDepartments] = useState([]);

  const [tempPasswordModal, setTempPasswordModal] = useState(null);

  // Refs for focus management on failed submit — every basic-data field
  // plus the general error banner (used when the only error is roles-level,
  // e.g. a duplicate role, which has no single field to focus).
  const fieldRefs = {
    username: useRef(null),
    email: useRef(null),
    first_name: useRef(null),
    last_name: useRef(null),
    position: useRef(null),
    department: useRef(null),
    phone: useRef(null),
  };
  const formErrorRef = useRef(null);

  const focusFirstError = (errs) => {
    // Deferred: the error banner/field may not exist in the DOM yet in this
    // same tick (its ref only attaches once React commits the re-render
    // triggered by setFieldErrors/setFormError above).
    requestAnimationFrame(() => {
      const firstKey = FIELD_ORDER.find((k) => errs[k]);
      const target = firstKey ? fieldRefs[firstKey]?.current : formErrorRef.current;
      target?.focus();
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [projRes, deptRes] = await Promise.all([
          getProjects({ page_size: 200 }),
          getDepartments({ page_size: 200 }),
        ]);
        if (!alive) return;
        setProjects(projRes.data?.results ?? projRes.data ?? []);
        setDepartments(deptRes.data?.results ?? deptRes.data ?? []);
      } catch {
        // Best-effort — role editor selects just show as empty.
      }
    })();
    return () => { alive = false; };
  }, []);

  const loadUser = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await getUser(id);
      setForm({
        username:   data.username ?? '',
        email:      data.email ?? '',
        first_name: data.first_name ?? '',
        last_name:  data.last_name ?? '',
        position:   data.position ?? '',
        department: data.department ?? '',
        phone:      data.phone ?? '',
      });
      const existingRoles = data.user_roles ?? data.roles ?? [];
      setRoles(
        existingRoles.length
          ? existingRoles.map((ur) => ({
              key: `existing-${ur.id}`,
              role: ur.role ?? '',
              project: ur.project ?? '',
              department_obj: ur.department_obj ?? '',
              is_primary: !!ur.is_primary,
            }))
          : [newRoleRow()],
      );
    } catch {
      setLoadError('No se pudo cargar el usuario.');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => { loadUser(); }, [loadUser]);

  const setF = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const setRoleField = (key, field, value) => {
    setRoles((prev) => prev.map((r) => {
      if (r.key !== key) return r;
      const next = { ...r, [field]: value };
      // Project and department are mutually exclusive scopes for a role.
      if (field === 'project' && value) next.department_obj = '';
      if (field === 'department_obj' && value) next.project = '';
      return next;
    }));
  };

  const addRoleRow = () => setRoles((prev) => [...prev, newRoleRow()]);
  const removeRoleRow = (key) => setRoles((prev) => prev.filter((r) => r.key !== key));

  const validate = () => {
    const errs = {};
    if (!form.username.trim())   errs.username = 'El usuario es obligatorio.';
    if (!form.email.trim())      errs.email = 'El email es obligatorio.';
    if (!form.first_name.trim()) errs.first_name = 'El nombre es obligatorio.';
    if (!form.last_name.trim())  errs.last_name = 'El apellido es obligatorio.';
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
      username: form.username.trim(),
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      position: form.position.trim(),
      department: form.department.trim(),
      phone: form.phone.trim(),
      roles: roles
        .filter((r) => r.role)
        .map((r) => ({
          role: r.role,
          project: r.project ? Number(r.project) : null,
          department_obj: r.department_obj ? Number(r.department_obj) : null,
          is_primary: !!r.is_primary,
        })),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateUser(id, payload);
        showToast({ type: 'success', message: 'Usuario actualizado correctamente.' });
        navigate('/admin/usuarios');
      } else {
        const { data } = await createUser(payload);
        setTempPasswordModal({ username: data.username, temporaryPassword: data.temporary_password });
      }
    } catch (err) {
      const errs = extractFieldErrors(err);
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        if (errs.roles) setFormError(errs.roles);
        focusFirstError(errs);
      } else {
        setFormError(extractErrorMessage(err, 'No se pudo guardar el usuario.'));
        // No field-level error to focus — send focus to the banner itself.
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
        <span className="sr-only">Cargando usuario…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="max-w-2xl mx-auto bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> {loadError}</span>
        <button onClick={loadUser} className="font-semibold underline underline-offset-2 shrink-0">Reintentar</button>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/usuarios')}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Volver a Usuarios"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center shrink-0">
            {isEdit ? <UserCog size={17} className="text-indigo-600" aria-hidden="true" /> : <UserPlus size={17} className="text-indigo-600" aria-hidden="true" />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
            </h1>
            <p className="text-sm text-gray-400">
              {isEdit ? 'Actualiza el perfil y los roles asignados.' : 'Se generará una contraseña temporal automáticamente.'}
            </p>
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

          {/* Datos básicos */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Datos del usuario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Usuario" required id="username" error={fieldErrors.username}>
                <input
                  id="username"
                  ref={fieldRefs.username}
                  value={form.username}
                  onChange={(e) => setF('username', e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.username}
                  aria-describedby={fieldErrors.username ? 'username-error' : undefined}
                  className={inputCls(!!fieldErrors.username)}
                />
              </Field>
              <Field label="Email" required id="email" error={fieldErrors.email}>
                <input
                  id="email"
                  ref={fieldRefs.email}
                  type="email"
                  value={form.email}
                  onChange={(e) => setF('email', e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  className={inputCls(!!fieldErrors.email)}
                />
              </Field>
              <Field label="Nombres" required id="first_name" error={fieldErrors.first_name}>
                <input
                  id="first_name"
                  ref={fieldRefs.first_name}
                  value={form.first_name}
                  onChange={(e) => setF('first_name', e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.first_name}
                  aria-describedby={fieldErrors.first_name ? 'first_name-error' : undefined}
                  className={inputCls(!!fieldErrors.first_name)}
                />
              </Field>
              <Field label="Apellidos" required id="last_name" error={fieldErrors.last_name}>
                <input
                  id="last_name"
                  ref={fieldRefs.last_name}
                  value={form.last_name}
                  onChange={(e) => setF('last_name', e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.last_name}
                  aria-describedby={fieldErrors.last_name ? 'last_name-error' : undefined}
                  className={inputCls(!!fieldErrors.last_name)}
                />
              </Field>
              <Field label="Cargo" id="position" error={fieldErrors.position}>
                <input
                  id="position"
                  ref={fieldRefs.position}
                  value={form.position}
                  onChange={(e) => setF('position', e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.position}
                  aria-describedby={fieldErrors.position ? 'position-error' : undefined}
                  className={inputCls(!!fieldErrors.position)}
                />
              </Field>
              <Field label="Área / departamento" id="department" hint="Texto libre, solo referencial." error={fieldErrors.department}>
                <input
                  id="department"
                  ref={fieldRefs.department}
                  value={form.department}
                  onChange={(e) => setF('department', e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.department}
                  aria-describedby={fieldErrors.department ? 'department-error' : undefined}
                  className={inputCls(!!fieldErrors.department)}
                />
              </Field>
              <Field label="Teléfono" id="phone" error={fieldErrors.phone}>
                <input
                  id="phone"
                  ref={fieldRefs.phone}
                  value={form.phone}
                  onChange={(e) => setF('phone', e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.phone}
                  aria-describedby={fieldErrors.phone ? 'phone-error' : undefined}
                  className={inputCls(!!fieldErrors.phone)}
                />
              </Field>
            </div>
          </div>

          {/* Roles */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Roles asignados</p>
                <p className="text-xs text-gray-400 mt-0.5">Cada rol puede acotarse a un proyecto o un departamento (opcional).</p>
              </div>
              <button
                type="button"
                onClick={addRoleRow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <Plus size={14} aria-hidden="true" /> Agregar rol
              </button>
            </div>

            <div className="space-y-3">
              {roles.map((row, idx) => (
                <fieldset key={row.key} className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50/40">
                  <legend className="sr-only">Rol {idx + 1} de {roles.length}</legend>
                  <select
                    value={row.role}
                    onChange={(e) => setRoleField(row.key, 'role', e.target.value)}
                    disabled={saving}
                    className={`${inputCls(false)} sm:flex-1`}
                    aria-label={`Rol (fila ${idx + 1})`}
                  >
                    <option value="">Seleccionar rol...</option>
                    {Object.values(ROLES).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <select
                    value={row.project}
                    onChange={(e) => setRoleField(row.key, 'project', e.target.value)}
                    disabled={saving}
                    className={`${inputCls(false)} sm:flex-1`}
                    aria-label={`Proyecto (fila ${idx + 1})`}
                  >
                    <option value="">Sin proyecto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                  <select
                    value={row.department_obj}
                    onChange={(e) => setRoleField(row.key, 'department_obj', e.target.value)}
                    disabled={saving}
                    className={`${inputCls(false)} sm:flex-1`}
                    aria-label={`Departamento (fila ${idx + 1})`}
                  >
                    <option value="">Sin departamento</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 whitespace-nowrap cursor-pointer select-none px-1">
                    <input
                      type="checkbox"
                      checked={row.is_primary}
                      onChange={(e) => setRoleField(row.key, 'is_primary', e.target.checked)}
                      disabled={saving}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <Star size={12} className={row.is_primary ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} aria-hidden="true" />
                    Primario
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRoleRow(row.key)}
                    disabled={saving}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    aria-label={`Quitar rol (fila ${idx + 1})`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </fieldset>
              ))}
              {roles.length === 0 && (
                <p className="text-xs text-gray-400 italic">Sin roles. El usuario podrá acceder pero no verá módulos asignados.</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/admin/usuarios')}
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
                : <><Save size={16} aria-hidden="true" /> {isEdit ? 'Guardar cambios' : 'Crear usuario'}</>
              }
            </button>
          </div>
        </form>
      </div>

      {tempPasswordModal && (
        <TemporaryPasswordModal
          username={tempPasswordModal.username}
          temporaryPassword={tempPasswordModal.temporaryPassword}
          onClose={() => { setTempPasswordModal(null); navigate('/admin/usuarios'); }}
        />
      )}
    </>
  );
}
