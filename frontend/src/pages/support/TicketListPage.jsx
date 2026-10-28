import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, X, Ticket } from 'lucide-react';
import { getTickets } from '../../api/support';
import {
  TICKET_STATUS_CONFIG,
  TICKET_PRIORITY_CONFIG,
  TICKET_CATEGORY_CONFIG,
} from '../../data/supportConstants';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const cfg = TICKET_STATUS_CONFIG[status] ?? { label: status, color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0`} />
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = TICKET_PRIORITY_CONFIG[priority] ?? { label: priority, color: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0`} />
      {cfg.label}
    </span>
  );
}

function CategoryBadge({ category }) {
  const cfg = TICKET_CATEGORY_CONFIG[category] ?? { label: category };
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30">
      {cfg.label}
    </span>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-500" />
    </div>
  );
}

const selectCls = [
  'px-3 py-2 rounded-xl border border-gray-200 bg-white',
  'text-sm text-gray-700',
  'focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400',
  'transition-colors duration-150 appearance-none cursor-pointer',
].join(' ');

export default function TicketListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tickets,  setTickets]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);

  const [filters, setFilters] = useState({
    search:   '',
    status:   searchParams.get('status') ?? '',
    priority: '',
    category: '',
  });

  const fetchTickets = useCallback(async (currentFilters) => {
    setLoading(true);
    try {
      const params = { page_size: 100, ordering: '-created_at' };
      if (currentFilters.search)   params.search   = currentFilters.search;
      if (currentFilters.status)   params.status   = currentFilters.status;
      if (currentFilters.priority) params.priority = currentFilters.priority;
      if (currentFilters.category) params.category = currentFilters.category;

      const { data } = await getTickets(params);
      setTickets(data.results ?? []);
      setTotal(data.count ?? 0);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets(filters);
  }, [filters, fetchTickets]);

  function handleFilter(e) {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function clearFilters() {
    setFilters({ search: '', status: '', priority: '', category: '' });
  }

  const hasFilters = filters.search || filters.status || filters.priority || filters.category;

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-teal-600 uppercase tracking-widest mb-1 font-display">Soporte TI</p>
          <h1 className="text-2xl font-extrabold text-gray-900 font-display leading-tight">
            Mis Tickets
            {!loading && (
              <span className="ml-2 text-base font-bold text-gray-400">({total})</span>
            )}
          </h1>
        </div>
        <button
          onClick={() => navigate('/soporte/tickets/new')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white text-sm font-bold shadow-sm hover:from-teal-600 hover:to-teal-700 active:scale-[0.97] transition-all duration-150 w-full sm:w-auto justify-center"
        >
          <Plus size={17} strokeWidth={2.5} />
          Nuevo Ticket
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilter}
              placeholder="Buscar tickets..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 transition-colors"
            />
          </div>

          {/* Status filter */}
          <div className="relative">
            <select name="status" value={filters.status} onChange={handleFilter} className={selectCls}>
              <option value="">Todos los estados</option>
              {Object.entries(TICKET_STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          {/* Priority filter */}
          <div className="relative">
            <select name="priority" value={filters.priority} onChange={handleFilter} className={selectCls}>
              <option value="">Toda prioridad</option>
              {Object.entries(TICKET_PRIORITY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          {/* Category filter */}
          <div className="relative">
            <select name="category" value={filters.category} onChange={handleFilter} className={selectCls}>
              <option value="">Toda categoria</option>
              {Object.entries(TICKET_CATEGORY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <X size={14} />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* ── Results table ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <LoadingSpinner />
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 dark:bg-teal-500/10 flex items-center justify-center mb-4">
              <Ticket size={26} className="text-teal-400" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-semibold text-gray-600 font-display">
              {hasFilters ? 'No se encontraron tickets' : 'No tienes tickets aun'}
            </p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
              {hasFilters
                ? 'Intenta con otros filtros o limpia la busqueda.'
                : 'Crea tu primer ticket para reportar un problema tecnico.'}
            </p>
            {!hasFilters && (
              <button
                onClick={() => navigate('/soporte/tickets/new')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-50 text-teal-700 text-xs font-bold hover:bg-teal-100 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/15 transition-colors"
              >
                <Plus size={14} />
                Crear Ticket
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/70 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">N° Ticket</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Titulo</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden md:table-cell">Categoria</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden sm:table-cell">Prioridad</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Estado</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden sm:table-cell">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => navigate(`/soporte/tickets/${ticket.id}`)}
                    className="hover:bg-teal-50/30 dark:hover:bg-teal-500/10 cursor-pointer transition-colors duration-100 group"
                  >
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-bold text-teal-600 font-display group-hover:text-teal-700">
                        #{ticket.ticket_number ?? ticket.id}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 max-w-[200px] lg:max-w-xs">
                      <span className="text-sm font-semibold text-gray-800 truncate block font-display">
                        {ticket.title}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <CategoryBadge category={ticket.category} />
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className="text-xs text-gray-400">{formatDate(ticket.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
