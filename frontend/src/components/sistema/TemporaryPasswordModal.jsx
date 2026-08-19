import { useEffect, useRef, useState } from 'react';
import { KeyRound, Copy, Check, ShieldAlert } from 'lucide-react';

/**
 * SYSPCC-018 — one-time display of a system-generated temporary password
 * (from `POST /users/` or `POST /users/{id}/reset-password/`). The backend
 * never stores or re-exposes this value, so the modal makes that explicit
 * and gives the admin a one-click copy before it's gone for good.
 *
 * Deliberately has no backdrop-click-to-dismiss — this is the only chance
 * to copy the value, so closing requires the explicit button (Escape still
 * works, for keyboard users who already copied).
 */
// Focusable-selector used by the manual Tab trap below — this modal has no
// backdrop-click-to-close (see file docblock), so without an explicit trap
// Tab/Shift+Tab would leak focus into the page behind the backdrop.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function TemporaryPasswordModal({ username, temporaryPassword, onClose }) {
  // 'idle' | 'copied' | 'error' — drives both the button label/icon and the
  // sr-only live announcement below (a visual icon swap alone is not
  // reliably announced to screen readers when focus doesn't move).
  const [copyStatus, setCopyStatus] = useState('idle');
  const copyButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    copyButtonRef.current?.focus();
    return () => {
      // Return focus to whatever triggered this modal (e.g. "Restablecer
      // contraseña" / "Crear usuario"), per the a11y modal contract.
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusables = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopyStatus('copied');
    } catch {
      // Clipboard API unavailable/denied — the password is still selectable
      // as plain text in the field below, so this isn't a dead end.
      setCopyStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="temp-password-title"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      <div ref={dialogRef} className="relative bg-white rounded-2xl border border-gray-100 shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center shrink-0">
            <KeyRound size={17} className="text-emerald-600" aria-hidden="true" />
          </div>
          <div>
            <p id="temp-password-title" className="text-sm font-semibold text-gray-900">
              Contraseña temporal generada
            </p>
            {username && <p className="text-xs text-gray-400">Para {username}</p>}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-sm font-mono font-semibold text-gray-800 tracking-wide select-all break-all">
              {temporaryPassword}
            </code>
            <button
              ref={copyButtonRef}
              type="button"
              onClick={handleCopy}
              className={`shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                copyStatus === 'copied'
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {copyStatus === 'copied'
                ? <><Check size={14} aria-hidden="true" /> Copiado</>
                : <><Copy size={14} aria-hidden="true" /> Copiar</>}
            </button>
          </div>

          {/* Announces the result of the copy action to screen readers —
              the button's own label change isn't reliably announced since
              focus stays on it and its accessible name changes silently. */}
          <div role="status" aria-live="polite" className="sr-only">
            {copyStatus === 'copied' && 'Contraseña copiada al portapapeles.'}
            {copyStatus === 'error' && 'No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.'}
          </div>

          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200/80 rounded-xl px-4 py-3">
            <ShieldAlert size={16} className="shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
            <p className="text-xs text-amber-800 leading-relaxed">
              Comparte esta contraseña con el usuario por un canal seguro. El sistema no la
              volverá a mostrar — si se pierde, deberás usar <strong>Restablecer contraseña</strong> para
              generar una nueva. El usuario deberá cambiarla en su primer inicio de sesión.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            Ya la copié, cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
