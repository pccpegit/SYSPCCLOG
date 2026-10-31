import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES } from '../../data/requestMaster';

const btn =
  'inline-flex min-h-11 items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';

/** Paginación del Master: «Mostrando a–b de N», anterior/siguiente y filas por página. */
export default function Pagination({ count, page, pageSize, onPage, onPageSize, hasNext, hasPrevious }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);

  return (
    <nav
      aria-label="Paginación"
      className="px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-xs text-gray-500">
        Mostrando <span className="font-bold text-gray-700">{from}–{to}</span> de{' '}
        <span className="font-bold text-gray-700">{count}</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Filas por página
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="min-h-11 px-2 border border-gray-200 rounded-xl text-sm bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={btn}
          aria-disabled={!hasPrevious}
          onClick={() => hasPrevious && onPage(page - 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" /> Anterior
        </button>
        <span className="text-xs text-gray-500">Página {page} de {pages}</span>
        <button
          type="button"
          className={btn}
          aria-disabled={!hasNext}
          onClick={() => hasNext && onPage(page + 1)}
        >
          Siguiente <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
