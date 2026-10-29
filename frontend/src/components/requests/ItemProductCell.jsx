import { AlertCircle } from 'lucide-react';
import CatalogCombobox from './CatalogCombobox';
import { formatQty } from '../../utils/quantity';

// ─────────────────────────────────────────────────────────────────────────────
// ItemProductCell — SYSPCC-026
//
// The "Equipos / Unidades" cell of a line in "Nuevo Requerimiento". A line is
// either a product picked from the warehouse catalog or, on purpose, an item
// "fuera de catálogo" (services, things that never go through the warehouse):
//
//   - catalog mode, nothing picked : search box + "Fuera de catálogo" checkbox
//   - catalog mode, product picked : read-only summary + "Cambiar"
//   - off-catalog mode             : free description + the checkbox (checked)
//
// The stock shown with a picked product is the CENTRAL pool, as information only.
//
// Focus: choosing a product unmounts the search box, so the focus lands on
// "Cambiar" (named with the product code); marking "Fuera de catálogo" moves the
// focus to the description that appears; unmarking returns it to the search box.
// What happened is announced by the live region of the page (RequestCreatePage).
// ─────────────────────────────────────────────────────────────────────────────

/** Id of the paragraph that explains "Fuera de catálogo" (rendered once by the page). */
export const OFF_CATALOG_HELP_ID = 'catalog-off-help';

/**
 * @param {object}   props
 * @param {object}   props.item         form line (see utils/requestCapture.js)
 * @param {number}   props.index        0-based position (labels use index + 1)
 * @param {string}   [props.error]      message when the line is touched but unresolved
 * @param {boolean}  [props.focusSearch] move the focus to the search box when it mounts
 * @param {boolean}  [props.focusDescription] move the focus to the off-catalog description when it mounts
 * @param {(product: object) => void} props.onSelect
 * @param {() => void} props.onClear              drop the picked product ("Cambiar")
 * @param {(enabled: boolean) => void} props.onToggleOffCatalog
 * @param {(text: string) => void} props.onDescription  off-catalog description
 * @param {(text: string) => void} props.onSearchText   text typed in the search box
 */
export default function ItemProductCell({
  item,
  index,
  error,
  focusSearch = false,
  focusDescription = false,
  onSelect,
  onClear,
  onToggleOffCatalog,
  onDescription,
  onSearchText,
}) {
  const n = index + 1;
  const base = `item-${item.id}`;
  const errorId = `${base}-product-error`;
  const offCatalog = item.mode === 'off_catalog';
  const product = item.mode === 'catalog' ? item.product : null;

  return (
    <div className="space-y-1.5">
      <div>
        {product ? (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-bold text-gray-800">{product.product_code}</p>
              <p className="text-xs leading-snug text-gray-700">{product.description}</p>
              <p className="text-[11px] text-gray-500">
                Unidad: {product.unit} · Disponible en almacén central: {formatQty(product.available)} {product.unit} (informativo)
              </p>
            </div>
            <button
              type="button"
              autoFocus
              onClick={onClear}
              aria-label={`Cambiar el producto del ítem ${n} (${product.product_code})`}
              className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cambiar
            </button>
          </div>
        ) : offCatalog ? (
          <input
            id={`${base}-description`}
            type="text"
            autoFocus={focusDescription}
            value={item.descripcion}
            onChange={(e) => onDescription(e.target.value)}
            aria-label={`Descripción del ítem ${n} fuera de catálogo`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="Describa el ítem o servicio…"
            maxLength={300}
            className={`w-full rounded border px-2 py-1.5 text-xs bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 ${
              error ? 'border-red-500 bg-red-50 dark:bg-red-500/10' : 'border-gray-500'
            }`}
          />
        ) : (
          <CatalogCombobox
            id={`${base}-search`}
            label={`Buscar producto del catálogo para el ítem ${n}`}
            autoFocus={focusSearch}
            invalid={Boolean(error)}
            describedBy={error ? errorId : undefined}
            onSelect={onSelect}
            onQueryChange={onSearchText}
          />
        )}
      </div>

      {!product && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={offCatalog}
            onChange={(e) => onToggleOffCatalog(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
            aria-describedby={OFF_CATALOG_HELP_ID}
            title="Servicios u otros ítems que no pasan por el almacén"
          />
          {/* The visible text is part of the accessible name (WCAG 2.5.3); the item number
              is added in front for screen readers, which meet 5 identical checkboxes. */}
          <span><span className="sr-only">Ítem {n}: </span>Fuera de catálogo</span>
        </label>
      )}

      {error && (
        <p id={errorId} className="flex items-start gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
          <AlertCircle size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
