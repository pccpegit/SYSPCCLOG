import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search, UserCheck, UserPen, X } from 'lucide-react';
import { lookupPersonal } from '../../api/almacen';
import { extractErrorMessage } from '../../utils/apiErrors';
import { Banner } from './ui';
import { inputCls } from './uiStyles';

export const WORKER_MIN_CHARS = 3;
export const WORKER_MAX_RESULTS = 10;
const DEBOUNCE_MS = 350;

/**
 * Búsqueda de trabajador para entregas de EPP (SYSPCC-025).
 *
 * `value`: `null` | `{ kind: 'personal', id, name }` | `{ kind: 'manual', name }`.
 * El endpoint solo devuelve id, nombre y puesto (sin DNI ni sueldo). Lo que se
 * escribe y los resultados viven únicamente en el estado del componente:
 * nunca se guardan en almacenamiento, URL ni consola.
 *
 * Foco (teclado y lectores de pantalla): al elegir un trabajador el foco pasa al
 * recuadro del valor elegido (se anuncia «Trabajador <nombre>») y al pulsar
 * «Cambiar trabajador» vuelve al campo de búsqueda. `autoFocus` enfoca la
 * búsqueda al montarse (p. ej. al abrirla desde un botón «Vincular»).
 */
export default function WorkerCombobox({
  id,
  value,
  onChange,
  disabled = false,
  allowManual = true,
  autoFocus = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-label': ariaLabel,
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const valueId = `${inputId}-value`;
  const hintId = `${inputId}-hint`;
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [lookup, setLookup] = useState({ term: '', status: 'idle', results: [], error: '' });
  const inputRef = useRef(null);
  const valueRef = useRef(null);
  // A dónde debe ir el foco tras el próximo cambio de `value` ('value' | 'input').
  const focusAfter = useRef(null);

  const trimmed = term.trim();
  const tooShort = trimmed.length < WORKER_MIN_CHARS;

  useEffect(() => {
    if (value || trimmed.length < WORKER_MIN_CHARS) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookup((prev) => ({ ...prev, term: trimmed, status: 'loading', error: '' }));
      try {
        const { data } = await lookupPersonal(trimmed);
        const list = Array.isArray(data) ? data : (data?.results ?? []);
        if (!cancelled) {
          setLookup({ term: trimmed, status: 'done', results: list.slice(0, WORKER_MAX_RESULTS), error: '' });
        }
      } catch (err) {
        if (!cancelled) {
          setLookup({
            term: trimmed,
            status: 'error',
            results: [],
            error: err?.response?.status === 429
              ? 'Demasiadas búsquedas seguidas. Espere unos segundos.'
              : extractErrorMessage(err, 'No se pudo buscar trabajadores. Intente nuevamente.'),
          });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, value]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (focusAfter.current === 'value' && value) valueRef.current?.focus();
    else if (focusAfter.current === 'input' && !value) inputRef.current?.focus();
    focusAfter.current = null;
  }, [value]);

  // Los resultados solo valen para el texto con el que se pidieron.
  const fresh = !tooShort && lookup.term === trimmed;
  const status = fresh ? lookup.status : (tooShort ? 'idle' : 'loading');
  const results = fresh && lookup.status === 'done' ? lookup.results : [];
  const manualOption = allowManual && !tooShort && status !== 'loading';
  const optionCount = results.length + (manualOption ? 1 : 0);
  const activeIndex = Math.min(active, Math.max(optionCount - 1, 0));

  const pick = (index) => {
    if (index < results.length) {
      const person = results[index];
      onChange({ kind: 'personal', id: person.id, name: person.full_name });
    } else if (manualOption) {
      onChange({ kind: 'manual', name: trimmed });
    } else {
      return;
    }
    focusAfter.current = 'value';
    setTerm('');
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (optionCount === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((cur) => (Math.min(cur, optionCount - 1) + (event.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount);
    } else if (event.key === 'Enter' && open && optionCount > 0) {
      event.preventDefault();
      pick(activeIndex);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (value) {
    const manual = value.kind === 'manual';
    const Icon = manual ? UserPen : UserCheck;
    return (
      <div>
        <div
          id={inputId}
          ref={valueRef}
          role="group"
          tabIndex={-1}
          aria-labelledby={`${inputId}-label ${valueId}`}
          aria-describedby={ariaDescribedBy}
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 min-h-11 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Icon size={17} className={manual ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} aria-hidden="true" />
            <span id={valueId} className="text-sm font-semibold text-gray-800 truncate">{value.name}</span>
          </span>
          <button
            type="button"
            onClick={() => { focusAfter.current = 'input'; onChange(null); }}
            disabled={disabled}
            className="shrink-0 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            <X size={14} aria-hidden="true" /> Cambiar trabajador
          </button>
        </div>
        {manual && (
          <Banner tone="amber" live className="mt-2">
            Este trabajador no figura en Personal; la entrega se registrará como texto.
          </Banner>
        )}
      </div>
    );
  }

  let liveMessage = '';
  if (tooShort) {
    if (trimmed.length > 0) liveMessage = `Escriba al menos ${WORKER_MIN_CHARS} letras para buscar.`;
  } else {
    if (status === 'loading') liveMessage = 'Buscando…';
    else if (status === 'error') liveMessage = lookup.error;
    else if (status === 'done') {
      liveMessage = results.length === 0
        ? 'No se encontraron trabajadores. Pruebe con otro apellido o escríbalo manualmente.'
        : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}.`;
    }
  }

  const activeId = open && optionCount > 0 ? `${inputId}-opt-${activeIndex}` : undefined;

  return (
    <div className="relative">
      <Search size={15} className="absolute left-3.5 top-[22px] -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && !tooShort}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={ariaInvalid}
        aria-describedby={[ariaDescribedBy, hintId].filter(Boolean).join(' ')}
        aria-required={ariaRequired}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        value={term}
        placeholder="Apellidos y nombres"
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={`${inputCls(ariaInvalid === true)} pl-10 pr-9`}
      />
      {status === 'loading' && !tooShort && (
        <Loader2 size={15} className="absolute right-3.5 top-[22px] -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
      )}

      <p id={hintId} className="text-xs text-gray-500 mt-1">
        Escriba al menos {WORKER_MIN_CHARS} letras del apellido o del nombre.
      </p>
      <p role="status" aria-live="polite" className="text-xs text-gray-500 mt-1 min-h-[1rem]">
        {liveMessage}
      </p>

      {open && !tooShort && status !== 'loading' && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Trabajadores"
          className="absolute left-0 right-0 top-[46px] z-30 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {results.map((person, index) => (
            <li
              key={person.id}
              id={`${inputId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); pick(index); }}
              onMouseEnter={() => setActive(index)}
              className={`px-4 py-2.5 cursor-pointer ${index === activeIndex ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}
            >
              <span className="block text-sm font-semibold text-gray-800">{person.full_name}</span>
              {person.position && <span className="block text-xs text-gray-500">{person.position}</span>}
            </li>
          ))}
          {status === 'done' && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500" role="presentation">
              No se encontraron trabajadores. Pruebe con otro apellido o escríbalo manualmente.
            </li>
          )}
          {status === 'error' && (
            <li className="px-4 py-3 text-sm text-red-600 dark:text-red-400" role="presentation">{lookup.error}</li>
          )}
          {manualOption && (
            <li
              id={`${inputId}-opt-${results.length}`}
              role="option"
              aria-selected={results.length === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); pick(results.length); }}
              onMouseEnter={() => setActive(results.length)}
              className={`px-4 py-2.5 cursor-pointer border-t border-gray-100 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2 ${
                results.length === activeIndex ? 'bg-amber-50 dark:bg-amber-500/10' : ''
              }`}
            >
              <UserPen size={14} aria-hidden="true" /> Escribir manualmente «{trimmed}»
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
