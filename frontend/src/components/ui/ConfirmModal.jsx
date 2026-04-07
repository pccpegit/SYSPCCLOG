import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * ConfirmModal — reusable confirmation dialog
 *
 * Props:
 *   isOpen       boolean
 *   title        string
 *   message      string
 *   confirmText  string
 *   cancelText   string   (default "Cancelar")
 *   confirmColor string   (default "bg-blue-600 hover:bg-blue-700")
 *   onConfirm    () => void
 *   onCancel     () => void
 *   icon         optional lucide icon component
 */
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
}) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-[fadeIn_0.15s_ease-out]">
        {/* Close button */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>

        {/* Optional icon */}
        {Icon && (
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center">
              <Icon size={28} className="text-gray-600" />
            </div>
          </div>
        )}

        {/* Title */}
        <h2
          id="confirm-modal-title"
          className="text-lg font-bold text-gray-900 mb-2 leading-tight"
        >
          {title}
        </h2>

        {/* Message */}
        <p className="text-sm text-gray-600 leading-relaxed mb-6">
          {message}
        </p>

        {/* Buttons */}
        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors shadow-sm ${confirmColor}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
