import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { searchRequestCatalog } from '../../api/requests';
import { formatQty } from '../../utils/quantity';

// ─────────────────────────────────────────────────────────────────────────────
// CatalogCombobox — SYSPCC-026
//
// Accessible type-ahead over the warehouse catalog (GET /request-catalog/).
// WAI-ARIA 1.2 "combobox with listbox popup" (list autocomplete): focus stays in
// the input, the options are announced through aria-activedescendant, and the
// result/empty/error states are spoken through a persistent live region.
//
//   Arrow Down / Up  move through the results (opens the list)
//   Enter            picks the highlighted product (retries after an error)
//   Escape           closes the list; again, clears the text
//   Tab              closes the list and moves on without picking
//
// `onSelect` may return a promise. If it settles with `false` / `{ ok: false }` (or rejects) the
// pick could not be applied: the text the person had typed comes back and the focus stays in
// the input, so a failed save does not throw a keyboard user to the top of the page.
// While the parent saves a pick it passes `busy`: the input becomes read-only (NOT disabled: a
// disabled control loses the focus) and further picks are ignored.
//
// The stock number shown with each product is the CENTRAL pool and is purely
// informative — nothing here blocks or changes a request.
//
// The list renders in a portal with fixed positioning so the horizontally
// scrollable item tables cannot clip it.
// ─────────────────────────────────────────────────────────────────────────────

export const CATALOG_MIN_CHARS = 2;
export const CATALOG_DEBOUNCE_MS = 300;

const POPUP_MAX_HEIGHT = 320;
const POPUP_MIN_WIDTH = 340;
const VIEWPORT_MARGIN = 8;

const ERROR_TEXT = {
  throttled: 'Demasiadas búsquedas seguidas. Espere unos segundos y vuelva a intentar.',
  failed: 'No se pudo buscar en el catálogo. Presione Enter para reintentar.',
};

/**
 * @param {object}   props
 * @param {string}   [props.id]            id of the input (so an external label can point at it)
 * @param {string}   props.label           accessible name (rendered as a visually hidden <label>)
 * @param {(product: object) => (void | Promise<boolean | {ok: boolean} | void>)} props.onSelect
 *        called with the picked catalog row; a promise that settles with `false` / `{ok: false}`
 *        restores the typed text
 * @param {(text: string) => void}    [props.onQueryChange] text typed so far (to flag "typed but not picked")
 * @param {boolean}  [props.disabled]
 * @param {boolean}  [props.busy]          the parent is saving a pick: read-only, keeps the focus
 * @param {boolean}  [props.autoFocus]
 * @param {boolean}  [props.invalid]
 * @param {string}   [props.describedBy]   id(s) of an error/help element
 * @param {string}   [props.placeholder]
 * @param {string}   [props.inputClassName]
 */
export default function CatalogCombobox({
  id,
  label,
  onSelect,
  onQueryChange,
  disabled = false,
  busy = false,
  autoFocus = false,
  invalid = false,
  describedBy,
  placeholder = 'Buscar por código o descripción…',
  inputClassName = '',
}) {
  const autoId = useId();
  const inputId = id ?? `catalog-${autoId}`;
  const listboxId = `${inputId}-listbox`;
  const helpId = `${inputId}-help`;
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  // Last answer, tagged with the term/attempt it belongs to so a stale one is never shown.
  const [result, setResult] = useState(null);
  const [anchor, setAnchor] = useState(null);
  // Latest text, readable from the async continuation of `choose` without a stale closure.
  const queryRef = useRef('');
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const term = query.trim();
  const searchable = term.length >= CATALOG_MIN_CHARS;
  const current = result && result.term === term && result.attempt === attempt ? result : null;
  const status = !searchable ? 'idle' : current ? current.status : 'loading';
  const rows = status === 'ready' ? current.rows : [];
  const total = status === 'ready' ? current.total : 0;
  const showPopup = open && query.trim().length > 0;
  const listboxVisible = showPopup && status === 'ready' && rows.length > 0;

  // ── Debounced search ────────────────────────────────────────────────────
  useEffect(() => {
    if (term.length < CATALOG_MIN_CHARS) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await searchRequestCatalog(term, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const list = Array.isArray(data?.results) ? data.results : [];
        setActiveIndex(-1);
        setResult({
          term, attempt, status: 'ready', rows: list, total: data?.count ?? list.length,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setActiveIndex(-1);
        setResult({
          term, attempt, status: 'error', kind: err?.response?.status === 429 ? 'throttled' : 'failed',
        });
      }
    }, CATALOG_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, attempt]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // ── Popup placement (fixed, follows the input while open) ───────────────
  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  function openPopup() {
    measure();
    setOpen(true);
  }

  function closePopup() {
    setOpen(false);
    setActiveIndex(-1);
  }

  // The pick could not be applied: give the typed text back (unless the person already typed
  // something else) and keep the keyboard where it was, without stealing it from another control.
  function restoreAfterFailure(typed) {
    if (queryRef.current === '') {
      setQuery(typed);
      onQueryChange?.(typed);
    }
    const input = inputRef.current;
    const holder = document.activeElement;
    if (input && (!holder || holder === document.body || holder === input)) input.focus();
  }

  function choose(product) {
    if (busy) return;
    const typed = query;
    setQuery('');
    onQueryChange?.('');
    closePopup();
    const outcome = onSelect(product);
    if (outcome && typeof outcome.then === 'function') {
      outcome.then(
        (result) => {
          if (result === false || result?.ok === false) restoreAfterFailure(typed);
        },
        () => restoreAfterFailure(typed),
      );
    }
  }

  // Keep the highlighted option visible while moving with the arrows.
  useEffect(() => {
    if (activeIndex < 0 || !listboxVisible) return;
    document.getElementById(`${inputId}-opt-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listboxVisible, inputId]);

  function handleChange(e) {
    if (busy) return;
    const value = e.target.value;
    setQuery(value);
    onQueryChange?.(value);
    setActiveIndex(-1);
    openPopup();
  }

  function handleKeyDown(e) {
    if (busy && e.key !== 'Tab') {
      // Saving a pick: nothing to do, but Enter must not reach a surrounding form either.
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openPopup();
        if (rows.length > 0) setActiveIndex((i) => (open ? (i + 1) % rows.length : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openPopup();
        if (rows.length > 0) setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1));
        break;
      case 'Enter':
        if (showPopup && listboxVisible && activeIndex >= 0 && rows[activeIndex]) {
          e.preventDefault();
          choose(rows[activeIndex]);
        } else if (showPopup && status === 'error') {
          e.preventDefault();
          setAttempt((n) => n + 1);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          closePopup();
        } else if (query) {
          e.preventDefault();
          setQuery('');
          onQueryChange?.('');
        }
        break;
      case 'Tab':
        closePopup();
        break;
      default:
        break;
    }
  }

  // ── Text for the live region (results / empty / error; not every keystroke) ──
  let announcement = '';
  if (showPopup) {
    if (status === 'ready') {
      announcement = rows.length === 0
        ? `Sin resultados para «${term}».`
        : `${rows.length} ${rows.length === 1 ? 'resultado disponible' : 'resultados disponibles'}. Use las flechas para recorrerlos.`;
    } else if (status === 'error') {
      announcement = ERROR_TEXT[current.kind];
    }
  }

  // ── Popup geometry ──────────────────────────────────────────────────────
  let popupStyle = null;
  if (showPopup && anchor) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(anchor.width, POPUP_MIN_WIDTH), vw - VIEWPORT_MARGIN * 2);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), vw - width - VIEWPORT_MARGIN);
    const below = vh - anchor.bottom;
    const above = anchor.top;
    const placeBelow = below >= 220 || below >= above;
    popupStyle = placeBelow
      ? { left, width, top: anchor.bottom + 4, maxHeight: Math.max(120, Math.min(POPUP_MAX_HEIGHT, below - 12)) }
      : { left, width, bottom: vh - anchor.top + 4, maxHeight: Math.max(120, Math.min(POPUP_MAX_HEIGHT, above - 12)) };
  }

  const describedByIds = [describedBy, helpId].filter(Boolean).join(' ');

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">{label}</label>
      <div className="relative">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={listboxVisible}
          aria-controls={listboxVisible ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={listboxVisible && activeIndex >= 0 ? `${inputId}-opt-${activeIndex}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByIds}
          aria-busy={busy || (showPopup && status === 'loading')}
          value={query}
          disabled={disabled}
          readOnly={busy}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim()) openPopup(); }}
          onBlur={closePopup}
          // WCAG 1.4.11: the border and the focus ring of the main control need 3:1
          // (gray-200 / blue-400 gave 1.2:1 / 2.6:1); gray-500 and blue-600 give 4.8:1.
          className={`w-full border rounded pl-7 pr-7 py-1.5 text-xs bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed ${
            invalid ? 'border-red-500 bg-red-50 dark:bg-red-500/10' : 'border-gray-500'
          } ${busy ? 'opacity-60 cursor-progress' : ''} ${inputClassName}`}
        />
        {showPopup && status === 'loading' && (
          <Loader2
            size={13}
            aria-hidden="true"
            className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-gray-400"
          />
        )}
      </div>

      <p id={helpId} className="sr-only">
        Escriba al menos {CATALOG_MIN_CHARS} caracteres. Use las flechas para recorrer los resultados y Enter para elegir.
      </p>
      {/* Always mounted: a live region that appears already filled is not announced reliably. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {showPopup && popupStyle && createPortal(
        <div
          // Keep the focus in the input while the pointer works on the list (incl. its scrollbar).
          onMouseDown={(e) => e.preventDefault()}
          style={popupStyle}
          className="fixed z-[60] overflow-auto rounded-lg border border-gray-200 bg-white text-left shadow-xl"
        >
          {listboxVisible && (
            <ul id={listboxId} role="listbox" aria-label="Productos del catálogo" className="divide-y divide-gray-100">
              {rows.map((product, index) => (
                <li
                  key={product.id}
                  id={`${inputId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => choose(product)}
                  className={`cursor-pointer px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 ${
                    index === activeIndex ? 'bg-blue-50 ring-2 ring-inset ring-blue-600 dark:bg-blue-500/15 dark:ring-blue-400' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-mono text-xs font-bold text-gray-800">{product.product_code}</span>
                    <span className="text-[11px] text-gray-500">
                      Disponible en almacén central: {formatQty(product.available)} {product.unit}
                    </span>
                  </div>
                  <div className="text-xs leading-snug text-gray-700">{product.description}</div>
                  <div className="text-[11px] text-gray-500">
                    Unidad: {product.unit}{product.category ? ` · ${product.category}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {status === 'idle' && (
            <p className="px-3 py-3 text-xs text-gray-500">
              Escriba al menos {CATALOG_MIN_CHARS} caracteres para buscar.
            </p>
          )}
          {status === 'loading' && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
              <Loader2 size={13} aria-hidden="true" className="animate-spin" />
              Buscando en el catálogo…
            </p>
          )}
          {status === 'ready' && rows.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-600">
              Sin resultados para «{term}». Pruebe con otro código o descripción; si no es un producto de almacén,
              márquelo como fuera de catálogo.
            </p>
          )}
          {status === 'error' && (
            <p className="flex items-start gap-2 px-3 py-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
              {ERROR_TEXT[current.kind]}
            </p>
          )}
          {status === 'ready' && total > rows.length && (
            <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              Mostrando {rows.length} de {total} resultados. Escriba más para afinar la búsqueda.
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
