import { AlertCircle, RefreshCw, SearchX, X } from 'lucide-react';

export function LoadingState({ label = 'Cargando…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-56 text-sm text-gray-500">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600 dark:border-t-blue-400" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry, extra }) {
  return (
    <div role="alert" className="py-14 px-6 text-center">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
        <AlertCircle size={26} className="text-red-600 dark:text-red-400" aria-hidden="true" />
      </div>
      <p className="text-base font-extrabold text-gray-700 font-display">No se pudo mostrar el Master</p>
      <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">{message}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 shadow-sm font-display"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Reintentar
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

export function EmptyState({ filtered, onClear, title = 'No hay ítems para mostrar', hint }) {
  return (
    <div className="py-16 text-center px-6">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
        <SearchX size={28} className="text-gray-400" aria-hidden="true" />
      </div>
      <p className="text-lg font-extrabold text-gray-600 font-display">{title}</p>
      <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
        {hint ?? (filtered
          ? 'Ninguno coincide con los filtros aplicados. Pruebe cambiando o limpiando los filtros.'
          : 'Aún no hay requerimientos con ítems que usted pueda ver.')}
      </p>
      {filtered && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 inline-flex min-h-11 items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 shadow-sm font-display"
        >
          <X size={15} aria-hidden="true" />
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
