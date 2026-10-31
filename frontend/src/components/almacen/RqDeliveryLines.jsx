import { Ban, MapPin, MapPinOff } from 'lucide-react';
import { inputCls, thCls } from './uiStyles';
import { BLOCK_REASON_LABELS, pickingLocation, qtyWithUnit } from '../../utils/rqPicking';

/**
 * Líneas de la Salida vinculada a un RQ (SYSPCC-041). Son fijas: no se agregan ni se quitan, solo se
 * incluyen o no y se ajusta la cantidad (sugerida = lo máximo entregable ahora). El servidor revalida todo.
 *
 * `selection`: `{ [itemId]: { include, quantity } }` · `errors`: `{ [itemId]: mensaje }`.
 */
export default function RqDeliveryLines({ items, selection, errors, disabled = false, onToggle, onQuantity }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Líneas del requerimiento a entregar">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">
          Líneas del requerimiento con lo pendiente, el stock del Almacén Central y la cantidad a entregar.
        </caption>
        <thead className="bg-gray-50 text-left">
          <tr>
            <th scope="col" className={thCls}>Incluir</th>
            <th scope="col" className={thCls}>Línea</th>
            <th scope="col" className={thCls}>Producto</th>
            <th scope="col" className={`${thCls} text-right`}>Pendiente</th>
            <th scope="col" className={`${thCls} text-right`}>Stock central</th>
            <th scope="col" className={thCls}>Cantidad a entregar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const state = selection[item.id];
            const error = errors[item.id];
            const included = Boolean(state?.include);
            const reason = !item.can_deliver
              ? BLOCK_REASON_LABELS[item.blocked_reason] ?? 'No se puede entregar ahora.'
              : '';
            const loc = pickingLocation(item);
            const errId = `rq-qty-err-${item.id}`;
            const hintId = `rq-qty-hint-${item.id}`;
            return (
              <tr
                key={item.id}
                data-testid={`rq-line-${item.id}`}
                className={`align-top ${error ? 'bg-red-50 dark:bg-red-500/10' : ''} ${item.can_deliver ? '' : 'opacity-70'}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={included}
                    disabled={!item.can_deliver || disabled}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                    aria-label={`Incluir la línea ${item.line_number}`}
                    className="h-5 w-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600 tabular-nums">{item.line_number}</td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="font-medium text-gray-900">{item.description}</p>
                  <p className="text-xs text-gray-500">
                    {item.product ? <span className="font-mono">{item.product.product_code}</span> : null}
                    {item.product && item.unit ? ' · ' : ''}
                    {item.unit}
                  </p>
                  {item.product && (
                    <p className={`mt-1 flex items-start gap-1 text-xs ${loc.exact ? 'font-mono font-semibold text-gray-700' : 'text-amber-800 dark:text-amber-300'}`}>
                      {loc.exact
                        ? <MapPin size={12} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                        : <MapPinOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
                      {loc.text}
                    </p>
                  )}
                  {reason && (
                    <p className="flex items-start gap-1 text-xs text-gray-600 mt-1.5">
                      <Ban size={12} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                      <span>{reason}</span>
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{qtyWithUnit(item.remaining, item.unit)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.available_central == null ? '—' : qtyWithUnit(item.available_central, item.unit)}
                </td>
                <td className="px-4 py-3">
                  {item.can_deliver ? (
                    <div className="w-36">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={state?.quantity ?? ''}
                        disabled={!included || disabled}
                        onChange={(e) => onQuantity(item.id, e.target.value)}
                        aria-label={`Cantidad a entregar de la línea ${item.line_number}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={[error ? errId : null, hintId].filter(Boolean).join(' ')}
                        className={`${inputCls(!!error)} text-right tabular-nums`}
                      />
                      <p id={hintId} className="text-xs text-gray-500 mt-1">Máximo {qtyWithUnit(item.max_deliverable, item.unit)}</p>
                      {error && <p id={errId} className="text-xs text-red-700 dark:text-red-300 font-medium mt-1">{error}</p>}
                    </div>
                  ) : (
                    <span className="text-gray-500" aria-label="No se puede entregar">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
