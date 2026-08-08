import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const ToastContext = createContext(null);

// ─────────────────────────────────────────────────────────────────────────────
// Single toast item
// ─────────────────────────────────────────────────────────────────────────────

const ICON_MAP = {
  success: CheckCircle,
  error:   XCircle,
  info:    Info,
};

const COLOR_MAP = {
  success: {
    bg:     'bg-green-50',
    border: 'border-green-300',
    icon:   'text-green-600',
    title:  'text-green-900',
    msg:    'text-green-700',
    close:  'text-green-500 hover:text-green-700 hover:bg-green-100',
  },
  error: {
    bg:     'bg-red-50',
    border: 'border-red-300',
    icon:   'text-red-600',
    title:  'text-red-900',
    msg:    'text-red-700',
    close:  'text-red-400 hover:text-red-700 hover:bg-red-100',
  },
  info: {
    bg:     'bg-blue-50',
    border: 'border-blue-300',
    icon:   'text-blue-600',
    title:  'text-blue-900',
    msg:    'text-blue-700',
    close:  'text-blue-400 hover:text-blue-700 hover:bg-blue-100',
  },
};

function ToastItem({ toast, onRemove }) {
  const colors    = COLOR_MAP[toast.type] ?? COLOR_MAP.info;
  const IconComp  = ICON_MAP[toast.type]  ?? Info;

  return (
    <div
      className={`
        flex items-start gap-3 w-full max-w-sm rounded-xl border shadow-lg p-4
        ${colors.bg} ${colors.border}
        animate-[slideInRight_0.25s_ease-out]
      `}
      role="alert"
    >
      <IconComp size={20} className={`shrink-0 mt-0.5 ${colors.icon}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-snug ${colors.title}`}>
          {toast.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className={`shrink-0 p-1 rounded-lg transition-colors ${colors.close}`}
        aria-label="Cerrar notificacion"
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Container rendered inside provider
// ─────────────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

let _nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const showToast = useCallback(({ type = 'info', message, duration = 4000 }) => {
    const id = _nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
