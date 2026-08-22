import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Search,
  AlertTriangle,
  Pencil,
  Power,
  PowerOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getProjects } from '../../api/core';
import { activateProject, deactivateProject } from '../../api/projects';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage } from '../../utils/apiErrors';
import { formatDate } from '../../utils/format';
import ConfirmModal from '../../components/ui/ConfirmModal';

const STATUS_OPTIONS = [
  { value: '',      label: 'Todos'      },
  { value: 'true',  label: 'Activos'    },
  { value: 'false', label: 'Inactivos'  },
];

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [state, setState] = useState({ status: 'loading', projects: [], count: 0, next: null, previous: null });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [confirmModal, setConfirmModal] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

  const fetchProjects = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const params = { page };
      if (search) params.search = search;
      if (statusFilter) params.is_active = statusFilter;

      const { data } = await getProjects(params);
      const results = data?.results ?? (Array.isArray(data) ? data : []);
      setState({
        status: 'ready',
        projects: results,
        count: data?.count ?? results.length,
        next: data?.next ?? null,
        previous: data?.previous ?? null,
      });
    } catch {
      setState({ status: 'error', projects: [], count: 0, next: null, previous: null });
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchProjects, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchProjects, search]);

  const doToggleActive = (project) => {
    const activating = !project.is_active;
    requestConfirm({
      title: activating ? 'Activar proyecto' : 'Desactivar proyecto',
      message: activating
        ? `${project.code} — ${project.name} volverá a estar disponible para asignar usuarios y crear RQs.`
        : `${project.code} — ${project.name} dejará de estar disponible para nuevas asignaciones. El historial existente se conserva.`,
      confirmText: activating ? 'Activar' : 'Desactivar',
      confirmColor: activating ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
      icon: activating ? Power : PowerOff,
      onConfirm: async () => {
        setActionBusyId(project.id);
        try {
          await (activating ? activateProject(project.id) : deactivateProject(project.id));
          showToast({ type: 'success', message: activating ? 'Proyecto activado.' : 'Proyecto desactivado.' });
          fetchProjects();
        } catch (err) {
          showToast({ type: 'error', message: extractErrorMessage(err, 'No se pudo actualizar el estado del proyecto.') });
        } finally {
          setActionBusyId(null);
        }
      },
    });
  };

  const { status, projects, count, next, previous } = state;

  return (
    <>
      <div className="space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Proyectos</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Obras registradas en el sistema.
            </p>
          </div>
          <button
            onClick={() => navigate('/sistema/proyectos/nuevo')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-600/20 w-full sm:w-auto"
          >
            <Plus size={16} aria-hidden="true" /> Nuevo proyecto
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, nombre, cliente o ubicación..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50 focus:bg-white transition-colors"
              aria-label="Buscar proyectos"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors text-gray-700"
            aria-label="Filtrar por estado"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Error */}
        {status === 'error' && (
          <div role="alert" className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> No se pudieron cargar los proyectos.</span>
            <button onClick={fetchProjects} className="font-semibold underline underline-offset-2 shrink-0">Reintentar</button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" aria-busy={status === 'loading'}>
          {status === 'loading' ? (
            <div className="flex items-center justify-center h-40" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-indigo-600 dark:border-t-indigo-400" aria-hidden="true" />
              <span className="sr-only">Cargando proyectos…</span>
            </div>
          ) : status === 'ready' && projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Building2 size={28} strokeWidth={1.2} className="text-gray-300" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {search || statusFilter ? 'Sin resultados para los filtros aplicados' : 'No hay proyectos registrados'}
              </p>
              {!search && !statusFilter && (
                <button
                  onClick={() => navigate('/sistema/proyectos/nuevo')}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold"
                >
                  Registrar primer proyecto
                </button>
              )}
            </div>
          ) : status === 'ready' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Listado de proyectos registrados en el sistema, con estado y acciones disponibles por fila</caption>
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Código</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Nombre</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Cliente</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Ubicación</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Fechas</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {projects.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group" aria-busy={actionBusyId === p.id}>
                      <td className="px-5 sm:px-6 py-3.5 font-mono text-sm text-gray-700 font-semibold whitespace-nowrap">{p.code}</td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-800 font-medium">
                        {p.name}
                        <p className="text-xs text-gray-400 md:hidden">{p.client}</p>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-600 hidden md:table-cell">{p.client || '—'}</td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-600 hidden lg:table-cell">{p.location || '—'}</td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-500 text-xs hidden sm:table-cell whitespace-nowrap">
                        {p.start_date ? formatDate(p.start_date) : '—'} — {p.end_date ? formatDate(p.end_date) : '—'}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-center">
                        {p.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-100 dark:ring-emerald-500/30">Activo</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-500 ring-1 ring-gray-200">Inactivo</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => navigate(`/sistema/proyectos/${p.id}`)}
                            disabled={actionBusyId === p.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors disabled:opacity-40"
                            title="Editar"
                            aria-label={`Editar proyecto ${p.code} — ${p.name}`}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => doToggleActive(p)}
                            disabled={actionBusyId === p.id}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                              p.is_active
                                ? 'text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15'
                                : 'text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/15'
                            }`}
                            title={p.is_active ? 'Desactivar' : 'Activar'}
                            aria-label={`${p.is_active ? 'Desactivar' : 'Activar'} proyecto ${p.code} — ${p.name}`}
                          >
                            {p.is_active ? <PowerOff size={15} aria-hidden="true" /> : <Power size={15} aria-hidden="true" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Pagination footer */}
          {status === 'ready' && projects.length > 0 && (
            <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400" aria-live="polite" aria-atomic="true">{count} proyecto{count === 1 ? '' : 's'} — página {page}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!previous}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span className="text-xs text-gray-400 tabular-nums" aria-hidden="true">Página {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!next}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Página siguiente"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmModal && (
        <ConfirmModal
          isOpen
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          confirmColor={confirmModal.confirmColor}
          icon={confirmModal.icon}
          onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </>
  );
}
