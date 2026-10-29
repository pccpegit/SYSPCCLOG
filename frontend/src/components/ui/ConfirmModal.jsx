import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText  = 'Cancelar',
  confirmColor = 'bg-blue-600 hover:bg-blue-700',
  onConfirm,
  onCancel,
  icon: Icon,
  children,
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  // Unique per dialog (two can exist at once); `children` joins the description so a
  // screen reader that lands on "Cancelar" also hears the details the message points to.
  const uid = useId();
  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;
  const detailsId = `${uid}-details`;

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  // Focus: the safe button ("Cancelar") takes it when the dialog opens and the
  // element that opened the dialog gets it back when it closes.
  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus?.();
    };
  }, [isOpen]);

  // Keep Tab / Shift+Tab inside the dialog.
  function trapTab(e) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!isOpen) return null;

  // Rendered in <body>: the page wrapper keeps a `transform` after its enter
  // animation (.page-fade-in), which would make it the containing block of this
  // `fixed` overlay and center the dialog on the whole (scrolled) page instead
  // of on the viewport.
  return createPortal(
    <div
      ref={dialogRef}
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={children ? `${messageId} ${detailsId}` : messageId}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 animate-[fadeIn_0.2s_ease-out]">
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>

        {Icon && (
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200/80 flex items-center justify-center">
              <Icon size={26} className="text-gray-600" />
            </div>
          </div>
        )}

        <h2
          id={titleId}
          className="text-lg font-extrabold text-gray-900 mb-2 leading-tight font-display"
        >
          {title}
        </h2>

        <p id={messageId} className="text-sm text-gray-500 leading-relaxed mb-6">
          {message}
        </p>

        {children && <div id={detailsId} className="mb-6 -mt-3">{children}</div>}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 font-display"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm font-display ${confirmColor}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
