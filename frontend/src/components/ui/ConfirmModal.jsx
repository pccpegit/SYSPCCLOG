import { useEffect } from 'react';
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
}) {
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
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-[fadeIn_0.2s_ease-out]">
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
          id="confirm-modal-title"
          className="text-lg font-extrabold text-gray-900 mb-2 leading-tight font-display"
        >
          {title}
        </h2>

        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          {message}
        </p>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button
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
    </div>
  );
}
