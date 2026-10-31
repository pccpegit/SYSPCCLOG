import { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Info, Loader2, XCircle } from 'lucide-react';
import { TONES, btnSecondary, cardCls } from './uiStyles';

// SYSPCC-025 — piezas de interfaz compartidas por las pantallas de /almacen.
// Todo aviso lleva icono + texto (nunca solo color).

const BANNER_ICONS = { amber: AlertTriangle, red: XCircle, emerald: CheckCircle, blue: Info };

/** Aviso en línea. `live` lo anuncia a lectores de pantalla (role="status"/"alert"). */
export function Banner({ tone = 'blue', live, className = '', children }) {
  const Icon = BANNER_ICONS[tone] ?? Info;
  const role = live === 'assertive' ? 'alert' : live ? 'status' : undefined;
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ${TONES[tone] ?? TONES.blue} ${className}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Etiqueta corta con icono opcional. */
export function Chip({ tone = 'gray', icon, className = '', children }) {
  const Icon = icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ring-1 ${TONES[tone] ?? TONES.gray} ${className}`}
    >
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, icon, actions }) {
  const Icon = icon;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-11 h-11 shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/30 flex items-center justify-center">
            <Icon size={20} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 font-display tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 w-full sm:w-auto">{actions}</div>}
    </div>
  );
}

/**
 * Título de una pantalla de resultado o de un paso: recibe el foco al aparecer
 * (para lectores de pantalla y teclado). `autoFocus={false}` lo deja sin foco
 * (p. ej. el primer paso en la carga inicial de la página).
 */
export function FocusHeading({
  children, className = 'text-xl font-bold text-gray-900 mb-2 font-display', autoFocus = true, ...rest
}) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <h2 ref={ref} tabIndex={-1} className={`${className} focus:outline-none`} {...rest}>
      {children}
    </h2>
  );
}

export function Card({ className = '', children, ...rest }) {
  return <div className={`${cardCls} ${className}`} {...rest}>{children}</div>;
}

export function LoadingBlock({ label = 'Cargando…', className = 'h-48' }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <Loader2 size={26} className="animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-14 px-4 text-center">
      <XCircle size={30} className="text-red-500" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={btnSecondary}>Reintentar</button>
      )}
    </div>
  );
}

export function EmptyBlock({ icon, title, hint, children }) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 px-4 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-1">
          <Icon size={26} strokeWidth={1.3} className="text-gray-400" aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  );
}

/**
 * Etiqueta + control + ayuda/error. Inyecta `id`, `aria-invalid`,
 * `aria-describedby` y `aria-required` en el único hijo (input, select o un
 * combobox que reenvíe esas props). La etiqueta lleva el id `<id>-label` para
 * los controles que no son etiquetables (p. ej. el valor elegido de
 * `WorkerCombobox`, que usa `aria-labelledby`).
 */
export function Field({ label, id, required = false, error, hint, className = '', children }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const control = Children.count(children) === 1 && isValidElement(children)
    ? cloneElement(children, {
        id: fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })
    : children;

  return (
    <div className={className}>
      <label id={`${fieldId}-label`} htmlFor={fieldId} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">
        {label}
        {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && <p id={hintId} className="text-xs text-gray-500 mt-1">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">{error}</p>}
    </div>
  );
}

/** Paginación con total conocido (el servidor entrega `count`). */
export function Pagination({ page, pageSize, total, onPage, noun = 'registros' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-gray-100">
      <p className="text-xs text-gray-500">{total.toLocaleString('es-PE')} {noun}</p>
      <div className="flex gap-2 items-center">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${btnSecondary} !min-h-9 !px-3 !py-1.5 text-xs`}
        >
          <ChevronLeft size={14} aria-hidden="true" /> Anterior
        </button>
        <span className="px-2 text-xs text-gray-600" aria-current="page">Página {page} de {pages}</span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className={`${btnSecondary} !min-h-9 !px-3 !py-1.5 text-xs`}
        >
          Siguiente <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/** Indicador numérico de la cabecera de una pantalla. */
export function Stat({ label, value, tone = 'gray', icon, hint }) {
  const Icon = icon;
  return (
    <div className={`${cardCls} px-4 py-3 flex items-center gap-3`}>
      {Icon && (
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ring-1 ${TONES[tone] ?? TONES.gray}`}>
          <Icon size={16} aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 tabular-nums font-display leading-tight">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}
