import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

// Shared counter so nested dialogs (drawer + confirmation) restore the page
// scroll only when the last one closes, whatever the unmount order.
let scrollLocks = 0;
let savedOverflow = '';
function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}
function unlockBodyScroll() {
  if (typeof document === 'undefined' || scrollLocks === 0) return;
  scrollLocks -= 1;
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog (SYSPCC-022): role="dialog" + aria-modal, initial
 * focus inside, Tab trap, Escape closes and focus returns to the opener.
 * `initialFocusRef` focuses a specific field (e.g. the void reason); by
 * default the first control is focused.
 * SYSPCC-023: `variant="drawer"` renders a right-side panel (scrollable body,
 * sticky footer) with the same focus trap/Esc/return-focus behavior; its
 * initial focus goes to the title (`titleRef` also lets the caller refocus it).
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
  variant = 'modal',
  titleRef,
}) {
  const isDrawer = variant === 'drawer';
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
    lockBodyScroll();

    const panel = panelRef.current;
    const target =
      initialFocusRef?.current
      ?? (isDrawer ? panel?.querySelector(`[id="${titleId}"]`) : panel?.querySelector(FOCUSABLE))
      ?? panel;
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
      unlockBodyScroll();
      returnFocusRef.current?.focus?.();
    };
    // initialFocusRef is a stable ref; we only react to open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      disabled={busy}
      className="absolute top-2 right-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-40"
      aria-label="Cerrar"
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
  const heading = (
    <h2
      id={titleId}
      ref={titleRef}
      tabIndex={isDrawer ? -1 : undefined}
      className={`text-lg font-extrabold text-gray-900 leading-tight font-display ${isDrawer ? 'focus:outline-none' : 'mb-2 pr-10'}`}
    >
      {title}
    </h2>
  );
  const descriptionNode = description && (
    <p id={descId} className="text-sm text-gray-500 leading-relaxed mb-4">
      {description}
    </p>
  );

  return (
    <div className={isDrawer ? 'fixed inset-0 z-50 flex justify-end' : 'fixed inset-0 z-50 flex items-center justify-center p-4'}>
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
        className={
          isDrawer
            ? 'relative flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-xl focus:outline-none'
            : 'relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 focus:outline-none'
        }
      >
        {closeButton}
        {isDrawer ? (
          <>
            <div className="shrink-0 px-6 pt-6 pr-14 pb-3">
              {heading}
              {descriptionNode}
            </div>
            {/* The footer lives inside the scroll area: sticky on tall screens, plain
                (scrolls with the content) on short ones so zoom/landscape keep room (WCAG 1.4.10). */}
            <div className="flex flex-1 flex-col overflow-y-auto px-6 scroll-pb-28">
              <div className="flex-1 pb-6">{children}</div>
              {footer && (
                <div className="sticky bottom-0 -mx-6 flex flex-col gap-2 border-t border-gray-100 bg-white px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center [@media(max-height:500px)]:static">
                  {footer}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {heading}
            {descriptionNode}
            {children}
            {footer && <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3">{footer}</div>}
          </>
        )}
      </div>
    </div>
  );
}
