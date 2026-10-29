import { useId, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { foldText, formatQty, locationInfo } from '../../utils/almacen';
import { inputCls } from './uiStyles';

const MAX_VISIBLE = 40;

/**
 * Combobox accesible para elegir un ítem del catálogo (búsqueda por código o
 * descripción). Patrón ARIA 1.2: input `role="combobox"` + listbox, flechas,
 * Enter para elegir y Escape para cerrar. Con `requireStock` los ítems sin
 * stock quedan deshabilitados (`getStock` define cuánto hay disponible).
 */
export default function ItemCombobox({
  id,
  items,
  value,
  onChange,
  loading = false,
  disabled = false,
  requireStock = false,
  getStock = (item) => Number(item.total_stock ?? 0),
  placeholder = 'Buscar ítem por código o descripción…',
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-label': ariaLabel,
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = useMemo(
    () => items.find((i) => String(i.id) === String(value)),
    [items, value],
  );

  const matches = useMemo(() => {
    const needle = foldText(query).trim();
    if (!needle) return items;
    return items.filter((i) =>
      foldText(i.product_code).includes(needle) || foldText(i.description).includes(needle));
  }, [items, query]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const isDisabledOption = (item) => requireStock && getStock(item) <= 0;
  const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (item) => {
    if (!item || isDisabledOption(item)) return;
    onChange(String(item.id));
    close();
  };

  const move = (delta) => {
    if (visible.length === 0) return;
    setOpen(true);
    setActive((current) => {
      const base = Math.min(current, visible.length - 1);
      return (base + delta + visible.length) % visible.length;
    });
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault(); // no enviar el formulario al elegir
      choose(visible[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  const shownValue = open || !selected ? query : `${selected.product_code} — ${selected.description}`;
  const activeId = open && visible[activeIndex] ? `${inputId}-opt-${visible[activeIndex].id}` : undefined;

  return (
    <div className="relative">
      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        value={shownValue}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onClick={() => { if (!open) { setOpen(true); setQuery(''); setActive(0); } }}
        onBlur={close}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        className={`${inputCls(ariaInvalid === true)} pl-10 pr-9`}
      />
      <ChevronDown size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />

      <div role="status" aria-live="polite" className="sr-only">
        {open && !loading ? `${matches.length} ${matches.length === 1 ? 'resultado' : 'resultados'}` : ''}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Ítems del inventario"
          className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {loading && <li className="px-4 py-3 text-sm text-gray-500 text-center">Cargando ítems…</li>}
          {!loading && visible.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500 text-center">No se encontraron ítems.</li>
          )}
          {!loading && visible.map((item, index) => {
            const stock = getStock(item);
            const blocked = isDisabledOption(item);
            const loc = locationInfo(item);
            return (
              <li
                key={item.id}
                id={`${inputId}-opt-${item.id}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={blocked || undefined}
                // mousedown evita que el input pierda el foco antes del clic
                onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                onMouseEnter={() => setActive(index)}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm cursor-pointer ${
                  index === activeIndex ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''
                } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="min-w-0">
                  <span className="font-mono text-xs text-gray-500 mr-2">{item.product_code}</span>
                  <span className="text-gray-800">{item.description}</span>
                  <span className="block text-xs text-gray-500">
                    {loc.exact ? `Ubicación ${loc.code}` : 'Pendiente de ubicar'}
                  </span>
                </span>
                <span className={`shrink-0 text-xs font-medium tabular-nums ${stock > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {stock > 0 ? `${formatQty(stock)} ${item.unit ?? ''}` : 'Sin stock'}
                </span>
              </li>
            );
          })}
          {!loading && matches.length > visible.length && (
            <li className="px-4 py-2 text-xs text-gray-500 text-center" aria-hidden="true">
              Mostrando {visible.length} de {matches.length}. Siga escribiendo para acotar.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
