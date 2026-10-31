import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { formatQty } from '../../../utils/almacen';
import { sumCounts } from '../../../utils/almacenImport';
import { Banner, Card, FocusHeading } from '../ui';
import { btnPrimary, btnSecondary } from '../uiStyles';

/**
 * Resultado de una importación confirmada. El servidor entrega `groups` y
 * `movements` como objetos (`{ initial, entries, exits }`) y `skipped` como
 * `{ rows_with_errors, already_imported }`: se suman para mostrar totales.
 * El título recibe el foco y describe el resumen, así que se lee al aparecer.
 */
export default function ImportResult({ result, replay, onAnother }) {
  const items = (result?.catalog?.created ?? 0) + (result?.catalog?.updated ?? 0);
  const groups = sumCounts(result?.groups);
  const movements = sumCounts(result?.movements);
  const skipped = result?.skipped;
  const omitted = sumCounts(typeof skipped === 'object' && skipped !== null ? skipped.rows_with_errors : skipped);
  const alreadyImported = typeof skipped === 'object' && skipped !== null ? sumCounts(skipped.already_imported) : 0;

  return (
    <Card className="p-8 sm:p-10 text-center max-w-2xl mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
        <CheckCircle size={32} className="text-emerald-500" aria-hidden="true" />
      </div>
      <FocusHeading aria-describedby="import-result-summary">
        {replay ? 'Esta importación ya estaba confirmada' : 'Importación completada'}
      </FocusHeading>
      <div role="status" aria-live="polite">
        <p id="import-result-summary" className="text-sm text-gray-700">
          Importación completada: {formatQty(items)} {items === 1 ? 'ítem' : 'ítems'}, {formatQty(groups)} {groups === 1 ? 'vale' : 'vales'},
          {' '}{formatQty(movements)} {movements === 1 ? 'movimiento' : 'movimientos'}. {formatQty(omitted)} {omitted === 1 ? 'fila omitida' : 'filas omitidas'}.
          {alreadyImported > 0 && (
            <> {formatQty(alreadyImported)} {alreadyImported === 1 ? 'fila ya estaba importada' : 'filas ya estaban importadas'} y no se duplicó.</>
          )}
        </p>
      </div>

      {result?.reconciled === true && (
        <Banner tone="emerald" className="mt-4 text-left">El stock resultante coincide con el del libro.</Banner>
      )}
      {result?.reconciled === false && (
        <Banner tone="amber" className="mt-4 text-left">
          El stock resultante difiere del del libro en algunos ítems. Revíselos en el Resumen de movimiento.
        </Banner>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mt-6">
        <Link to="/almacen/resumen" className={`${btnPrimary} flex-1`}>Ver resumen de movimiento</Link>
        <Link to="/almacen/inventario?pendientes=1" className={`${btnSecondary} flex-1`}>Ítems pendientes de ubicar</Link>
      </div>
      <button type="button" onClick={onAnother} className="mt-4 text-sm font-semibold text-gray-600 hover:underline">
        Importar otro libro
      </button>
    </Card>
  );
}
