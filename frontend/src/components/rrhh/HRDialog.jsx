import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog (SYSPCC-022): role="dialog" + aria-modal, initial
 * focus inside, Tab trap, Escape closes and focus returns to the opener.
 * `initialFocusRef` focuses a specific field (e.g. the void reason); by
 * default the first control is focused.
 */
export default function HRDialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  initialFocusRef,
  busy = false,
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;

    const panel = panelRef.current;
    const target =
      initialFocusRef?.current ?? panel?.querySelector(FOCUSABLE) ?? panel;
    target?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (!busyRef.current) onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus?.();
    };
    // initialFocusRef is a stable ref; we only react to open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => { if (!busy) onClose?.(); }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 focus:outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-40"
          aria-label="Cerrar"
        >
          <X size={18} aria-hidden="true" />
        </button>
        <h2 id={titleId} className="text-lg font-extrabold text-gray-900 mb-2 pr-8 leading-tight font-display">
          {title}
        </h2>
        {description && (
          <p id={descId} className="text-sm text-gray-500 leading-relaxed mb-4">
            {description}
          </p>
        )}
        {children}
        {footer && <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3">{footer}</div>}
      </div>
    </div>
  );
}
