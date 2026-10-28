import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, FileText, Plus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLES, STATUS_CONFIG, PRIORITY_CONFIG } from '../../data/constants';
import { getRequests } from '../../api/requests';
import { getProjects } from '../../api/core';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';

function formatCurrency(val) {
  if (!val && val !== 0) return '—';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600 dark:border-t-blue-400" />
    </div>
  );
}

export default function RequestListPage() {
  const { primaryRole, currentUser } = useAuth();
  const navigate = useNavigate();

  const role = primaryRole ?? ROLES.REQUESTER;

  const [requests,  setRequests]  = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);

  const [filters, setFilters] = useState({
    status:   '',
    project:  '',
    priority: '',
    search:   '',
  });

  const fetchRequests = useCallback(async (currentFilters) => {
    setLoading(true);
    try {
      const params = {
        page_size: 100,
        ordering: '-created_at',
        requested_by: currentUser?.id,
      };
      if (currentFilters.status)   params.status   = currentFilters.status;
      if (currentFilters.project)  params.project   = currentFilters.project;
      if (currentFilters.priority) params.priority  = currentFilters.priority;
      if (currentFilters.search)   params.search    = currentFilters.search;

      const { data } = await getRequests(params);
      setRequests(data.results ?? []);
      setTotal(data.count ?? 0);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data } = await getProjects({ page_size: 50 });
        setProjects(data.results ?? []);
      } catch (err) {
        console.error('Error fetching projects:', err);
      }
    };
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchRequests(filters);
  }, [filters, fetchRequests]);

  function handleFilter(e) {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function clearFilters() {
    setFilters({ status: '', project: '', priority: '', search: '' });
  }

  const hasFilters  = filters.status || filters.project || filters.priority || filters.search;
  const totalEstimated = requests.reduce((sum, r) => sum + (r.estimated_cost ?? r.estimatedCost ?? 0), 0);
  const selectedProject = projects.find((p) => String(p.id) === filters.project);

  const selectCls =
    'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 hover:border-gray-300';

  return (
    <div className="max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 flex items-center gap-2.5 tracking-tight font-display">
            <FileText size={26} className="text-blue-600 dark:text-blue-400" strokeWidth={2} />
            Requerimientos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-bold text-gray-700">{requests.length}</span> resultado{requests.length !== 1 ? 's' : ''} encontrado{requests.length !== 1 ? 's' : ''}{' '}
            de <span className="font-bold text-gray-700">{total}</span> total{total !== 1 ? 'es' : ''}
          </p>
        </div>
        {role === ROLES.REQUESTER && (
          <button
            onClick={() => navigate('/rq/requests/new')}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-bold rounded-xl hover:from-blue-700 hover:to-blue-800 hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.97] shadow-md shadow-blue-600/15 font-display"
          >
            <Plus size={18} strokeWidth={2.5} />
            Nuevo Requerimiento
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={15} className="text-blue-500" />
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider font-display">Filtros</span>
          {hasFilters && (
            <span className="ml-auto">
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-lg font-display"
              >
                <X size={13} />
                Limpiar
              </button>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilter}
              placeholder="Buscar RQ, descripcion..."
              className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 hover:border-gray-300"
            />
          </div>

          <select name="status" value={filters.status} onChange={handleFilter} className={selectCls}>
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>

          <select name="project" value={filters.project} onChange={handleFilter} className={selectCls}>
            <option value="">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </select>

          <select name="priority" value={filters.priority} onChange={handleFilter} className={selectCls}>
            <option value="">Todas las prioridades</option>
            {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-display">Activos:</span>
            {filters.search && (
              <span className="text-[11px] font-bold bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30">
                "{filters.search}"
              </span>
            )}
            {filters.status && (
              <span className="text-[11px] font-bold bg-gray-50 text-gray-700 px-2.5 py-0.5 rounded-full border border-gray-200/60">
                {STATUS_CONFIG[filters.status]?.label ?? filters.status}
              </span>
            )}
            {filters.project && selectedProject && (
              <span className="text-[11px] font-bold bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full border border-teal-200/60 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30">
                {selectedProject.code}
              </span>
            )}
            {filters.priority && (
              <span className="text-[11px] font-bold bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-full border border-orange-200/60 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30">
                {PRIORITY_CONFIG[filters.priority]?.label ?? filters.priority}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <LoadingSpinner />
        ) : requests.length === 0 ? (
          <div className="py-20 text-center px-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
              <FileText size={28} className="text-gray-300" />
            </div>
            <p className="text-lg font-extrabold text-gray-500 font-display">No se encontraron requerimientos</p>
            <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
              {hasFilters
                ? 'Ninguno coincide con los filtros aplicados. Pruebe cambiando o limpiando los filtros.'
                : 'Aun no hay requerimientos registrados para su rol.'}
            </p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 shadow-sm font-display"
              >
                <X size={15} />
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">RQ #</th>
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Descripcion</th>
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider hidden md:table-cell font-display">Proyecto</th>
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider hidden sm:table-cell font-display">Prioridad</th>
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Estado</th>
                  <th className="py-3 px-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider hidden lg:table-cell font-display">Fecha Req.</th>
                  <th className="py-3 px-5 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wider hidden xl:table-cell font-display">Costo Est.</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    onClick={() => navigate(`/rq/requests/${req.rq_number ?? req.rqNumber}`)}
                    className="border-b border-gray-50 cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-500/10 hover:shadow-[inset_3px_0_0_0_#3b82f6] transition-all duration-100"
                  >
                    <td className="py-3.5 px-5 font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap text-xs">
                      {req.rq_number ?? req.rqNumber}
                    </td>
                    <td className="py-3.5 px-5 text-gray-700 max-w-xs">
                      <span className="line-clamp-2 leading-snug">{req.description}</span>
                    </td>
                    <td className="py-3.5 px-5 hidden md:table-cell">
                      <span className="text-xs font-bold text-gray-700">
                        {req.project_code ?? req.projectCode}
                      </span>
                      <br />
                      <span className="text-[11px] text-gray-400 line-clamp-1">
                        {req.project_name ?? req.projectName}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 hidden sm:table-cell">
                      <PriorityBadge priority={req.priority} />
                    </td>
                    <td className="py-3.5 px-5">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="py-3.5 px-5 text-xs text-gray-500 hidden lg:table-cell whitespace-nowrap">
                      {formatDate(req.required_date ?? req.requiredDate)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-semibold text-gray-700 hidden xl:table-cell whitespace-nowrap">
                      {formatCurrency(req.estimated_cost ?? req.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && requests.length > 0 && (
          <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <span className="text-xs text-gray-500">
              <span className="font-bold text-gray-700">{requests.length}</span> de{' '}
              <span className="font-bold text-gray-700">{total}</span>{' '}
              requerimiento{total !== 1 ? 's' : ''}
            </span>
            <span className="text-xs font-bold text-gray-700 font-display">
              Total estimado: <span className="text-blue-600 dark:text-blue-400">{formatCurrency(totalEstimated)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
