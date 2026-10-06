import { useEffect, useId, useState } from 'react';
import { Search, UserCheck, X, Loader2 } from 'lucide-react';
import { searchPersonal } from '../../api/hr';
import { hrErrorMessage } from '../../utils/hrErrors';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/**
 * Worker search over Personal (name or DNI). Picking one calls
 * `onSelect(worker)`; the parent requests the prefill. It shows no salary or
 * bank data (the endpoint does not return them either).
 */
export default function WorkerPicker({ selected, onSelect, onClear, disabled = false }) {
  const inputId = useId();
  const statusId = useId();
  const [term, setTerm] = useState('');
  const [state, setState] = useState({ status: 'idle', results: [], error: '' });

  useEffect(() => {
    const query = term.trim();
    if (query.length < MIN_CHARS) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'loading', error: '' }));
      try {
        const { data } = await searchPersonal(query);
        if (!cancelled) setState({ status: 'done', results: data.results ?? [], error: '' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', results: [], error: hrErrorMessage(err) });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const tooShort = term.trim().length < MIN_CHARS;
  const { status, results, error } = state;

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <UserCheck size={18} className="text-violet-600 dark:text-violet-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{selected.apellidos_nombres}</p>
            <p className="text-xs text-gray-500 truncate">
              DNI {selected.dni}{selected.puesto ? ` · ${selected.puesto}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 rounded"
        >
          <X size={14} aria-hidden="true" /> Cambiar trabajador
        </button>
      </div>
    );
  }

  let liveMessage = '';
  if (!tooShort) {
    if (status === 'loading') liveMessage = 'Buscando…';
    else if (status === 'error') liveMessage = error;
    else if (status === 'done') {
      liveMessage = results.length === 0
        ? 'No se encontraron trabajadores.'
        : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}. Usa Tab para recorrerlos.`;
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-semibold text-gray-600 mb-1">
        Buscar trabajador en Personal (opcional)
      </label>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          placeholder="Nombre o DNI (mínimo 2 caracteres)"
          aria-describedby={statusId}
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:bg-white"
        />
        {status === 'loading' && !tooShort && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
        )}
      </div>
      <p id={statusId} role="status" aria-live="polite" className="text-[11px] text-gray-400 mt-1 min-h-[1rem]">
        {liveMessage}
      </p>
      {!tooShort && status === 'done' && results.length > 0 && (
        <ul aria-label="Resultados de la búsqueda" className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100 bg-white">
          {results.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => onSelect(w)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-500"
              >
                <span className="block text-sm font-semibold text-gray-800">{w.apellidos_nombres}</span>
                <span className="block text-xs text-gray-500">
                  DNI {w.dni}{w.puesto ? ` · ${w.puesto}` : ''}{w.estado ? ` · ${w.estado}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
