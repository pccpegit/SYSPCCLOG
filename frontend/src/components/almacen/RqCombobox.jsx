import { useEffect, useId, useRef, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { getDeliverableRequests } from '../../api/almacen';
import { extractErrorMessage } from '../../utils/apiErrors';
import { RQ_PAGE_SIZE, rqSummary } from '../../utils/rqSelector';
import { inputCls } from './uiStyles';

const DEBOUNCE_MS = 300;

const errorMessage = (err) => {
  const status = err?.response?.status;
  if (status === 429) return 'Demasiadas búsquedas seguidas. Espere unos segundos.';
  if (status === 403) return 'Su rol no puede ver los requerimientos pendientes de entrega.';
  return extractErrorMessage(err, 'No se pudo cargar los requerimientos pendientes. Intente nuevamente.');
};

/**
 * Selector OPCIONAL de «RQ pendientes por entregar» (SYSPCC-041).
 *
 * `value`: `null` | fila del servidor (`id`, `rq_number`, `project`, …). Vacío = la salida no es de un
 * requerimiento. Busca por N° de RQ, proyecto o solicitante con debounce; la lista se pide al abrir
 * el campo (sin escribir) y vive solo en el estado del componente.
 *
 * Teclado: flechas (abren y mueven), Enter elige, Escape cierra. Al elegir, el foco pasa al recuadro
 * del RQ elegido; «Quitar requerimiento» devuelve el foco al buscador.
 */
export default function RqCombobox({
  id,
  value,
  onChange,
  disabled = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const valueId = `${inputId}-value`;
  const hintId = `${inputId}-hint`;
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [lookup, setLookup] = useState({ term: null, status: 'idle', results: [], count: 0, error: '' });
  const inputRef = useRef(null);
  const valueRef = useRef(null);
  const focusAfter = useRef(null);

  const trimmed = term.trim();

  useEffect(() => {
    if (value || !open) return undefined;
    let cancelled = false;
    // Sin texto se pide enseguida (abrir el campo); con texto, tras una pausa al teclear.
    const timer = setTimeout(async () => {
      setLookup((prev) => (prev.term === trimmed && prev.status === 'done' ? prev : { ...prev, term: trimmed, status: 'loading', error: '' }));
      try {
        const { data } = await getDeliverableRequests({ ...(trimmed ? { search: trimmed } : {}), page_size: RQ_PAGE_SIZE });
        const list = Array.isArray(data) ? data : (data?.results ?? []);
        if (!cancelled) {
          setLookup({ term: trimmed, status: 'done', results: list, count: Number(data?.count ?? list.length), truncated: data?.truncated === true, error: '' });
        }
      } catch (err) {
        if (!cancelled) setLookup({ term: trimmed, status: 'error', results: [], count: 0, error: errorMessage(err) });
      }
    }, trimmed ? DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, value, open, retryKey]);

  useEffect(() => {
    if (focusAfter.current === 'value' && value) valueRef.current?.focus();
    else if (focusAfter.current === 'input' && !value) inputRef.current?.focus();
    focusAfter.current = null;
  }, [value]);

  // Los resultados solo valen para el texto con el que se pidieron.
  const fresh = lookup.term === trimmed;
  const status = !open ? 'idle' : (fresh ? lookup.status : 'loading');
  const results = fresh && lookup.status === 'done' ? lookup.results : [];
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  const pick = (index) => {
    const rq = results[index];
    if (!rq) return;
    focusAfter.current = 'value';
    setTerm('');
    setOpen(false);
    setActive(0);
    onChange(rq);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      setActive((cur) => (Math.min(cur, results.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (event.key === 'Enter' && open) {
      // Con la lista abierta Enter nunca envía el formulario de Salida; solo elige si ya hay resultados.
      event.preventDefault();
      if (results.length > 0 && status === 'done') pick(activeIndex);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div
        id={inputId}
        ref={valueRef}
        role="group"
        tabIndex={-1}
        aria-labelledby={`${inputId}-label ${valueId}`}
        aria-describedby={ariaDescribedBy}
        className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-4 py-2.5 min-h-11 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
      >
        <span className="flex items-start gap-2.5 min-w-0">
          <ClipboardList size={17} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <span id={valueId} className="min-w-0">
            <span className="block text-sm font-bold text-gray-900 font-mono">{value.rq_number}</span>
            <span className="block text-xs text-gray-600">{rqSummary(value)}</span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => { focusAfter.current = 'input'; onChange(null); }}
          disabled={disabled}
          className="shrink-0 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          <X size={14} aria-hidden="true" /> Quitar requerimiento
        </button>
      </div>
    );
  }

  let liveMessage = '';
  if (open) {
    if (status === 'loading') liveMessage = 'Buscando requerimientos…';
    else if (status === 'error') liveMessage = lookup.error;
    else if (status === 'done') {
      if (results.length === 0) {
        liveMessage = trimmed
          ? 'No hay requerimientos pendientes de entrega que coincidan con la búsqueda.'
          : 'No hay requerimientos pendientes de entrega.';
      } else {
        liveMessage = `${lookup.count} ${lookup.count === 1 ? 'requerimiento' : 'requerimientos'}.`;
      }
    }
  }

  const activeId = open && status === 'done' && results.length > 0 ? `${inputId}-opt-${activeIndex}` : undefined;
  const showList = open && status === 'done' && results.length > 0;

  return (
    <div
      className="relative"
      onBlur={(e) => {
        // La lista sigue abierta mientras el foco esté dentro (p. ej. en «Reintentar», que se alcanza con Tab).
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Search size={15} className="absolute left-3.5 top-[22px] -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={ariaInvalid}
        aria-describedby={[ariaDescribedBy, hintId].filter(Boolean).join(' ')}
        aria-required={ariaRequired}
        autoComplete="off"
        disabled={disabled}
        value={term}
        placeholder="Buscar por N° de RQ, proyecto o solicitante"
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`${inputCls(ariaInvalid === true)} pl-10 pr-9`}
      />
      {status === 'loading' && (
        <Loader2 size={15} className="absolute right-3.5 top-[22px] -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
      )}

      <p id={hintId} className="text-xs text-gray-500 mt-1">
        Opcional. Elíjalo para entregar lo pendiente de un requerimiento; si no corresponde a ninguno (EPP a un trabajador, ajuste), déjelo vacío.
      </p>
      <p aria-live="polite" className="text-xs text-gray-500 mt-1 min-h-[1rem]">{liveMessage}</p>
      {open && status === 'error' && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setLookup((prev) => ({ ...prev, term: null }));
            setRetryKey((k) => k + 1);
            inputRef.current?.focus(); // el botón desaparece al reintentar: el foco vuelve al buscador
          }}
          className="mt-1 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          <RefreshCw size={13} aria-hidden="true" /> Reintentar
        </button>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Requerimientos pendientes de entrega"
          className="absolute left-0 right-0 top-[46px] z-30 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {results.map((rq, index) => (
            <li
              key={rq.id}
              id={`${inputId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); pick(index); }}
              onMouseEnter={() => setActive(index)}
              className={`px-4 py-2.5 cursor-pointer ${index === activeIndex ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}
            >
              <span className="block text-sm font-bold text-gray-900 font-mono">{rq.rq_number}</span>
              <span className="block text-xs text-gray-600">{rqSummary(rq)}</span>
            </li>
          ))}
          {(lookup.count > results.length || lookup.truncated) && (
            <li className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100" role="presentation">
              {lookup.truncated
                ? 'Hay más requerimientos de los que se pueden listar. Escriba el N° de RQ, proyecto o solicitante para afinar la búsqueda.'
                : `Se muestran ${results.length} de ${lookup.count}. Escriba más para afinar la búsqueda.`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
