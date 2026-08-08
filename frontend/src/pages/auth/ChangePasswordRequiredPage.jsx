import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldAlert, AlertCircle, KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import * as authApi from '../../api/auth';
import { extractFieldErrors, extractErrorMessage } from '../../utils/apiErrors';

const EMPTY_FORM = { oldPassword: '', newPassword: '', newPasswordConfirm: '' };

// Visual/tab order — also the priority order used to decide which field
// gets focus after a failed submit (client-side validation or a
// server-returned field error, e.g. old_password incorrecta).
const FIELD_ORDER = ['old_password', 'new_password', 'new_password_confirm'];

export default function ChangePasswordRequiredPage() {
  const { currentUser, isAuthenticated, isLoading: authLoading, switchRole, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY_FORM);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const oldPasswordRef = useRef(null);
  const newPasswordRef = useRef(null);
  const newPasswordConfirmRef = useRef(null);
  const fieldRefs = {
    old_password: oldPasswordRef,
    new_password: newPasswordRef,
    new_password_confirm: newPasswordConfirmRef,
  };

  const focusFirstError = (errs) => {
    requestAnimationFrame(() => {
      const firstKey = FIELD_ORDER.find((k) => errs[k]);
      fieldRefs[firstKey]?.current?.focus();
    });
  };

  // Navigation must happen in an effect, not during render: calling
  // `navigate()` synchronously while this component itself is rendering
  // updates an ancestor (the router) mid-render, which React Router warns
  // against ("You should call navigate() in a React.useEffect()") and is
  // not reliable — see the same pattern in AdminMenuPage.jsx.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    // Nothing forces this user through the flow — don't let them linger here.
    if (!currentUser?.must_change_password) {
      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, currentUser, navigate]);

  // While the session is being restored, avoid a flash of the form.
  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#f0f2f5]" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-indigo-600" aria-hidden="true" />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser?.must_change_password) {
    return null;
  }

  const setF = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = () => {
    const errs = {};
    if (!form.oldPassword) errs.old_password = 'Ingrese su contraseña temporal actual.';
    if (!form.newPassword) {
      errs.new_password = 'Ingrese una nueva contraseña.';
    } else if (form.newPassword.length < 8) {
      errs.new_password = 'La nueva contraseña debe tener al menos 8 caracteres.';
    }
    if (!form.newPasswordConfirm) {
      errs.new_password_confirm = 'Confirme la nueva contraseña.';
    } else if (form.newPassword && form.newPassword !== form.newPasswordConfirm) {
      errs.new_password_confirm = 'Las contraseñas no coinciden.';
    }
    return errs;
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      focusFirstError(errs);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(form.oldPassword, form.newPassword, form.newPasswordConfirm);
      // Server has cleared must_change_password — mirror that locally so
      // RequirePasswordChangeLayout lets the next navigation through.
      switchRole({ ...currentUser, must_change_password: false });
      showToast({ type: 'success', message: 'Contraseña actualizada correctamente.' });
      navigate('/', { replace: true });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      } else {
        // No specific field to blame (e.g. a network/server error) — the
        // toast already covers the general-error announcement (it renders
        // in ToastContext's aria-live region with role="alert" per toast).
        showToast({ type: 'error', message: extractErrorMessage(err, 'No se pudo actualizar la contraseña.') });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#f0f2f5] p-5">
      <div className="w-full max-w-[440px]">

        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <img src="/images/azul.jpg" alt="PCC" className="h-11 w-auto" />
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors px-2 py-1.5"
          >
            <LogOut size={14} aria-hidden="true" /> Cerrar sesión
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl p-7 sm:p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-50 ring-1 ring-amber-100 flex items-center justify-center shrink-0">
              <ShieldAlert size={19} className="text-amber-600" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-extrabold text-gray-900 tracking-tight font-display">
              Actualiza tu contraseña
            </h1>
          </div>
          <p className="text-gray-400 text-sm mt-2 mb-7 leading-relaxed">
            Por seguridad, debes establecer una nueva contraseña antes de continuar.
            Ingresa la contraseña temporal que te compartió el administrador y define una nueva.
          </p>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

            {/* Old password */}
            <div className="flex flex-col gap-2">
              <label htmlFor="old_password" className="text-sm font-semibold text-gray-700 font-display">
                Contraseña actual (temporal)
              </label>
              <div className="relative">
                <input
                  id="old_password"
                  ref={oldPasswordRef}
                  type={showOld ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoFocus
                  value={form.oldPassword}
                  onChange={(e) => setF('oldPassword', e.target.value)}
                  disabled={submitting}
                  aria-invalid={!!errors.old_password}
                  aria-describedby={errors.old_password ? 'old_password_error' : undefined}
                  className={`w-full rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 bg-white border ${errors.old_password ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500'} placeholder:text-gray-300 focus:outline-none focus:ring-2 disabled:opacity-50`}
                />
                <button
                  type="button"
                  onClick={() => setShowOld((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                  aria-label={showOld ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showOld ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
              {errors.old_password && (
                <p id="old_password_error" role="alert" className="text-[11px] text-red-500 font-medium">{errors.old_password}</p>
              )}
            </div>

            {/* New password */}
            <div className="flex flex-col gap-2">
              <label htmlFor="new_password" className="text-sm font-semibold text-gray-700 font-display">
                Nueva contraseña
              </label>
              <div className="relative">
                <input
                  id="new_password"
                  ref={newPasswordRef}
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={(e) => setF('newPassword', e.target.value)}
                  disabled={submitting}
                  aria-invalid={!!errors.new_password}
                  aria-describedby={errors.new_password ? 'new_password_error' : undefined}
                  className={`w-full rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 bg-white border ${errors.new_password ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500'} placeholder:text-gray-300 focus:outline-none focus:ring-2 disabled:opacity-50`}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                  aria-label={showNew ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showNew ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
              {errors.new_password && (
                <p id="new_password_error" role="alert" className="text-[11px] text-red-500 font-medium">{errors.new_password}</p>
              )}
            </div>

            {/* Confirm new password */}
            <div className="flex flex-col gap-2">
              <label htmlFor="new_password_confirm" className="text-sm font-semibold text-gray-700 font-display">
                Confirmar nueva contraseña
              </label>
              <input
                id="new_password_confirm"
                ref={newPasswordConfirmRef}
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.newPasswordConfirm}
                onChange={(e) => setF('newPasswordConfirm', e.target.value)}
                disabled={submitting}
                aria-invalid={!!errors.new_password_confirm}
                aria-describedby={errors.new_password_confirm ? 'new_password_confirm_error' : undefined}
                className={`w-full rounded-xl px-4 py-3 text-sm text-gray-900 bg-white border ${errors.new_password_confirm ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500'} placeholder:text-gray-300 focus:outline-none focus:ring-2 disabled:opacity-50`}
              />
              {errors.new_password_confirm && (
                <p id="new_password_confirm_error" role="alert" className="text-[11px] text-red-500 font-medium">{errors.new_password_confirm}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="mt-1 flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 active:scale-[0.98] shadow-lg shadow-indigo-600/20 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 font-display"
            >
              {submitting ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" aria-hidden="true" />
                  Actualizando...
                </>
              ) : (
                <>
                  <KeyRound size={16} aria-hidden="true" />
                  Actualizar contraseña
                </>
              )}
            </button>
          </form>

          <div className="flex items-start gap-2 mt-6 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-blue-500" aria-hidden="true" />
            <p className="text-[11.5px] text-blue-700 leading-relaxed">
              No podrás acceder al sistema hasta completar este paso.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
