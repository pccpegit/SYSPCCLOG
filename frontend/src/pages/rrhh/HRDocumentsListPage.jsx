import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { getDocuments } from '../../api/hr';
import { useAuth } from '../../context/AuthContext';
import { hrErrorMessage } from '../../utils/hrErrors';
import HRStatusBadge from '../../components/rrhh/HRStatusBadge';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'ISSUED', label: 'Emitido' },
  { value: 'VOIDED', label: 'Anulado' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'CONTRACT', label: 'Contrato de trabajo' },
];

const selectCls =
  'px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:bg-white transition-colors text-gray-700';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function HRDocumentsListPage() {
  const { userRoles } = useAuth();
  const canWrite = userRoles.includes('HR_MANAGER');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the name/reference search.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // `result.key` identifies the query a result belongs to; if it does not
  // match the current query the screen shows "loading".
  const [result, setResult] = useState({ key: null, rows: [], count: 0, error: '' });
  const [reloadTick, setReloadTick] = useState(0);
  const queryKey = JSON.stringify([page, search, statusFilter, typeFilter, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    const params = { page };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (typeFilter) params.document_type = typeFilter;
    getDocuments(params)
      .then(({ data }) => {
        if (!cancelled) setResult({ key: queryKey, rows: data.results ?? [], count: data.count ?? 0, error: '' });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({ key: queryKey, rows: [], count: 0, error: hrErrorMessage(err, 'No se pudo cargar la lista de documentos.') });
        }
      });
    return () => { cancelled = true; };
  }, [queryKey, page, search, statusFilter, typeFilter]);

  const fetchRows = () => setReloadTick((t) => t + 1);
  const state = {
    status: result.key !== queryKey ? 'loading' : result.error ? 'error' : 'ready',
    rows: result.rows,
    count: result.count,
    error: result.error,
  };

  const totalPages = Math.max(1, Math.ceil(state.count / PAGE_SIZE));
  const hasFilters = Boolean(search || statusFilter || typeFilter);

  function resetFilters() {
    setSearchInput('');
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setPage(1);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 font-display">Documentos de RR. HH.</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {canWrite
              ? 'Contratos generados desde plantillas aprobadas.'
              : 'Consulta de documentos generados (solo lectura).'}
          </p>
        </div>
        {canWrite && (
          <Link
            to="/rrhh/documentos/nuevo"
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            <FilePlus2 size={16} aria-hidden="true" /> Nuevo contrato
          </Link>
        )}
      </div>

      <form
        role="search"
        aria-label="Filtrar documentos"
        onSubmit={(e) => e.preventDefault()}
        className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto] gap-3"
      >
        <div className="relative">
          <label htmlFor="hr-doc-search" className="sr-only">Buscar por trabajador o número de referencia</label>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            id="hr-doc-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por trabajador o número (CT-2026-0001)"
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:bg-white"
          />
        </div>
        <div>
          <label htmlFor="hr-doc-status" className="sr-only">Estado</label>
          <select id="hr-doc-status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={`${selectCls} w-full`}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hr-doc-type" className="sr-only">Tipo de documento</label>
          <select id="hr-doc-type" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className={`${selectCls} w-full`}>
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </form>

      {state.status === 'loading' && (
        <div className="flex items-center justify-center h-48" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-violet-600" />
            <p className="text-sm text-gray-400">Cargando documentos…</p>
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{state.error}</span>
          <button type="button" onClick={fetchRows} className="inline-flex items-center gap-1.5 font-semibold underline">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {state.status === 'ready' && state.rows.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 py-14 px-6 text-center">
          <FileText size={32} className="mx-auto text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-gray-700">
            {hasFilters ? 'Ningún documento coincide con los filtros.' : 'Aún no hay documentos generados.'}
          </p>
          {hasFilters ? (
            <button type="button" onClick={resetFilters} className="mt-3 text-sm font-semibold text-violet-600 dark:text-violet-300 underline">
              Quitar filtros
            </button>
          ) : (
            canWrite && (
              <Link to="/rrhh/documentos/nuevo" className="mt-3 inline-block text-sm font-semibold text-violet-600 dark:text-violet-300 underline">
                Generar el primer contrato
              </Link>
            )
          )}
        </div>
      )}

      {state.status === 'ready' && state.rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Documentos de RR. HH.</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th scope="col" className="px-4 py-3 font-semibold">Referencia</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Trabajador</th>
                  <th scope="col" className="px-4 py-3 font-semibold hidden md:table-cell">Tipo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                  <th scope="col" className="px-4 py-3 font-semibold hidden lg:table-cell">Creado por</th>
                  <th scope="col" className="px-4 py-3 font-semibold hidden sm:table-cell">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                      {row.reference_number || <span className="text-gray-400">Sin número</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/rrhh/documentos/${row.id}`}
                        className="font-semibold text-gray-800 hover:text-violet-700 dark:hover:text-violet-300 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
                      >
                        {row.subject_name}
                        <span className="sr-only">: ver detalle</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{row.document_type_label}</td>
                    <td className="px-4 py-3"><HRStatusBadge status={row.status} label={row.status_label} /></td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{row.created_by_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell whitespace-nowrap">{formatDate(row.issued_at ?? row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Paginación" className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500" aria-live="polite">
              {state.count} {state.count === 1 ? 'documento' : 'documentos'} · Página {page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} aria-hidden="true" /> Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
