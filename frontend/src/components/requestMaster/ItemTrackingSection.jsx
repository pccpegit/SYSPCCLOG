import { useState } from 'react';
import { Rows3 } from 'lucide-react';
import { getRequestMaster } from '../../api/requestMaster';
import useMasterQuery from '../../hooks/useMasterQuery';
import { useToast } from '../../context/useToast';
import MasterItemsTable from './MasterItemsTable';
import OverrideDialog from './OverrideDialog';
import Pagination from './Pagination';
import { EmptyState, ErrorState, LoadingState } from './QueryStates';
import { describeLoadError, nextOrdering } from '../../utils/requestMaster';
import { DEFAULT_PAGE_SIZE } from '../../data/requestMaster';

/**
 * SYSPCC-030 — «Seguimiento por ítem» del detalle de un RQ: las líneas de ESE requerimiento con
 * lo que el almacén lleva atendido. Usa `request-master/?request=<id>` sin filtros de proyecto.
 */
export default function ItemTrackingSection({ requestId }) {
  const { showToast } = useToast();
  const [ordering, setOrdering] = useState('line_number');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [overrideTarget, setOverrideTarget] = useState(null);

  const query = useMasterQuery(getRequestMaster, {
    request: requestId, ordering, page, page_size: pageSize,
  });
  const rows = query.data?.results ?? [];
  const count = query.data?.count ?? 0;

  function handleSaved(result) {
    const item = result?.item;
    if (item) query.patchRows((row) => (row.id === item.id ? { ...row, ...item } : row));
    setOverrideTarget(null);
    showToast({
      type: result?.changed === false ? 'info' : 'success',
      message: result?.detail || 'Seguimiento actualizado.',
    });
  }

  function changeOrder(field) {
    setOrdering(nextOrdering(ordering, field) || 'line_number');
    setPage(1);
  }

  return (
    <section
      aria-labelledby="item-tracking-title"
      aria-busy={query.loading}
      className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden"
    >
      <div className="px-6 pt-5 pb-3">
        <h2 id="item-tracking-title" className="text-sm font-extrabold text-gray-800 flex items-center gap-2 font-display">
          <Rows3 size={15} className="text-gray-400" aria-hidden="true" />
          Seguimiento por ítem
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Cantidad atendida por el almacén, faltante, entregas y alertas de cada línea.
        </p>
      </div>

      <p aria-live="polite" className="sr-only">
        {query.loading ? 'Cargando el seguimiento por ítem…' : query.data ? `${count} ítems en seguimiento.` : ''}
      </p>

      {query.loading && !query.data ? (
        <LoadingState label="Cargando el seguimiento por ítem…" />
      ) : query.error ? (
        <ErrorState message={describeLoadError(query.error)} onRetry={query.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Este RQ aún no tiene ítems en seguimiento"
          hint="Cuando el requerimiento tenga líneas, aquí verá lo que el almacén va atendiendo."
        />
      ) : (
        <>
          <MasterItemsTable
            compact
            rows={rows}
            ordering={ordering}
            onOrder={changeOrder}
            busy={query.loading}
            onOverride={(row, kind) => setOverrideTarget({ row, kind })}
          />
          {(count > DEFAULT_PAGE_SIZE || pageSize !== DEFAULT_PAGE_SIZE) && (
            <Pagination
              count={count}
              page={page}
              pageSize={pageSize}
              hasNext={Boolean(query.data?.next)}
              hasPrevious={page > 1}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </>
      )}

      <OverrideDialog target={overrideTarget} onClose={() => setOverrideTarget(null)} onSaved={handleSaved} />
    </section>
  );
}
