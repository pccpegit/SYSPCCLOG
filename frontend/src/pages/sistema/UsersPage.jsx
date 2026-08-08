import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users,
  Plus,
  Search,
  AlertTriangle,
  Pencil,
  KeyRound,
  Power,
  PowerOff,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Crown,
} from 'lucide-react';
import { getUsers, getProjects, getDepartments } from '../../api/core';
import { resetPassword, activateUser, deactivateUser } from '../../api/users';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { ROLES, ROLE_LABELS } from '../../data/constants';
import { extractErrorMessage } from '../../utils/apiErrors';
import ConfirmModal from '../../components/ui/ConfirmModal';
import TemporaryPasswordModal from '../../components/sistema/TemporaryPasswordModal';

const STATUS_OPTIONS = [
  { value: '',      label: 'Todos'      },
  { value: 'true',  label: 'Activos'    },
  { value: 'false', label: 'Inactivos'  },
];

const selectCls =
  'px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors text-gray-700';

function RoleBadges({ roles }) {
  if (!roles || roles.length === 0) {
    return <span className="text-xs text-gray-400 italic">Sin roles asignados</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {roles.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
            {r.role_display ?? ROLE_LABELS[r.role] ?? r.role}
          </span>
          {(r.project_code || r.department_code) && (
            <span className="text-[11px] text-gray-400 font-mono">
              {r.project_code ?? r.department_code}
            </span>
          )}
          {r.is_primary && (
            <span title="Rol primario">
              <Crown size={11} className="text-amber-500" aria-hidden="true" />
              <span className="sr-only">Rol primario</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  // Deep-link support: ProjectFormPage's "Ver en Usuarios" link lands here
  // pre-filtered (?project=<id>) — read once on mount, not kept in sync
  // afterwards (the filter UI below takes over from there).
  const [searchParams] = useSearchParams();

  const [state, setState] = useState({ status: 'loading', users: [], count: 0, next: null, previous: null });
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState('');
  const [projectFilter, setProjectFilter] = useState(searchParams.get('project') ?? '');
  const [deptFilter, setDeptFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]               = useState(1);

  const [projects, setProjects]     = useState([]);
  const [departments, setDepartments] = useState([]);

  const [confirmModal, setConfirmModal] = useState(null);
  const [tempPasswordModal, setTempPasswordModal] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

  // Filter option sources — best-effort, don't block the page if they fail.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [projRes, deptRes] = await Promise.all([
          getProjects({ page_size: 200 }),
          getDepartments({ page_size: 200 }),
        ]);
        if (!alive) return;
        setProjects(projRes.data?.results ?? projRes.data ?? []);
        setDepartments(deptRes.data?.results ?? deptRes.data ?? []);
      } catch {
        // Silently degrade — filters just show empty option lists.
      }
    })();
    return () => { alive = false; };
  }, []);

  const fetchUsers = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const params = { page };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (projectFilter) params.project = projectFilter;
      if (deptFilter) params.department = deptFilter;
      if (statusFilter) params.is_active = statusFilter;

      const { data } = await getUsers(params);
      const results = data?.results ?? (Array.isArray(data) ? data : []);
      setState({
        status: 'ready',
        users: results,
        count: data?.count ?? results.length,
        next: data?.next ?? null,
        previous: data?.previous ?? null,
      });
    } catch {
      setState({ status: 'error', users: [], count: 0, next: null, previous: null });
    }
  }, [page, search, roleFilter, projectFilter, deptFilter, statusFilter]);

  // Any filter change (not a page change) jumps back to page 1 — a no-op
  // via React's bail-out when already there, so it never causes a loop.
  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, projectFilter, deptFilter, statusFilter]);

  // Debounced fetch — refires whenever fetchUsers' own deps (page + every
  // filter) change. The cleanup clears the pending timer on each keystroke,
  // so only the last one in a burst actually hits the API.
  useEffect(() => {
    const timer = setTimeout(fetchUsers, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchUsers, search]);

  const doResetPassword = (user) => {
    requestConfirm({
      title: 'Restablecer contraseña',
      message: `Se generará una nueva contraseña temporal para ${user.full_name ?? user.username}. La contraseña actual dejará de funcionar de inmediato.`,
      confirmText: 'Restablecer',
      confirmColor: 'bg-amber-600 hover:bg-amber-700',
      icon: KeyRound,
      onConfirm: async () => {
        setActionBusyId(user.id);
        try {
          const { data } = await resetPassword(user.id);
          setTempPasswordModal({ username: user.username, temporaryPassword: data.temporary_password });
        } catch (err) {
          showToast({ type: 'error', message: extractErrorMessage(err, 'No se pudo restablecer la contraseña.') });
        } finally {
          setActionBusyId(null);
        }
      },
    });
  };

  const doToggleActive = (user) => {
    const activating = !user.is_active;
    requestConfirm({
      title: activating ? 'Activar usuario' : 'Desactivar usuario',
      message: activating
        ? `${user.full_name ?? user.username} podrá volver a iniciar sesión en el sistema.`
        : `${user.full_name ?? user.username} no podrá iniciar sesión hasta que se reactive su cuenta. Su historial de aprobaciones se conserva.`,
      confirmText: activating ? 'Activar' : 'Desactivar',
      confirmColor: activating ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
      icon: activating ? Power : PowerOff,
      onConfirm: async () => {
        setActionBusyId(user.id);
        try {
          await (activating ? activateUser(user.id) : deactivateUser(user.id));
          showToast({ type: 'success', message: activating ? 'Usuario activado.' : 'Usuario desactivado.' });
          fetchUsers();
        } catch (err) {
          showToast({ type: 'error', message: extractErrorMessage(err, 'No se pudo actualizar el estado del usuario.') });
        } finally {
          setActionBusyId(null);
        }
      },
    });
  };

  const { status, users, count, next, previous } = state;

  return (
    <>
      <div className="space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Usuarios</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Gestión de cuentas, roles y accesos del sistema.
            </p>
          </div>
          <button
            onClick={() => navigate('/sistema/usuarios/nuevo')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-600/20 w-full sm:w-auto"
          >
            <Plus size={16} aria-hidden="true" /> Nuevo usuario
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, usuario, email o cargo..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50 focus:bg-white transition-colors"
              aria-label="Buscar usuarios"
            />
          </div>
          <div className="flex flex-wrap gap-2.5">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={selectCls}
              aria-label="Filtrar por rol"
            >
              <option value="">Todos los roles</option>
              {Object.values(ROLES).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={selectCls}
              aria-label="Filtrar por proyecto"
            >
              <option value="">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className={selectCls}
              aria-label="Filtrar por departamento"
            >
              <option value="">Todos los departamentos</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectCls}
              aria-label="Filtrar por estado"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Error */}
        {status === 'error' && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> No se pudieron cargar los usuarios.</span>
            <button onClick={fetchUsers} className="font-semibold underline underline-offset-2 shrink-0">Reintentar</button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" aria-busy={status === 'loading'}>
          {status === 'loading' ? (
            <div className="flex items-center justify-center h-40" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-indigo-600" aria-hidden="true" />
              <span className="sr-only">Cargando usuarios…</span>
            </div>
          ) : status === 'ready' && users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Users size={28} strokeWidth={1.2} className="text-gray-300" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {search || roleFilter || projectFilter || deptFilter || statusFilter
                  ? 'Sin resultados para los filtros aplicados'
                  : 'No hay usuarios registrados'}
              </p>
            </div>
          ) : status === 'ready' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Listado de usuarios del sistema, con rol, estado y acciones disponibles por fila</caption>
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Usuario</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Email</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Roles</th>
                    <th scope="col" className="px-5 sm:px-6 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/50 transition-colors group" aria-busy={actionBusyId === u.id}>
                      <td className="px-5 sm:px-6 py-3.5">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-800">{u.full_name || u.username}</p>
                          {u.is_superuser && (
                            <span title="Superusuario">
                              <ShieldCheck size={13} className="text-indigo-500" aria-hidden="true" />
                              <span className="sr-only">Superusuario</span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">@{u.username}</p>
                        <p className="text-xs text-gray-400 sm:hidden mt-0.5">{u.email}</p>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-gray-600 hidden sm:table-cell">{u.email}</td>
                      <td className="px-5 sm:px-6 py-3.5"><RoleBadges roles={u.roles} /></td>
                      <td className="px-5 sm:px-6 py-3.5 text-center">
                        {u.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">Activo</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-500 ring-1 ring-gray-200">Inactivo</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => navigate(`/sistema/usuarios/${u.id}`)}
                            disabled={actionBusyId === u.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
                            title="Editar"
                            aria-label={`Editar usuario ${u.full_name ?? u.username}`}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => doResetPassword(u)}
                            disabled={actionBusyId === u.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
                            title="Restablecer contraseña"
                            aria-label={`Restablecer contraseña de ${u.full_name ?? u.username}`}
                          >
                            <KeyRound size={15} aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => doToggleActive(u)}
                            disabled={actionBusyId === u.id || (u.is_active && u.id === currentUser?.id)}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              u.is_active
                                ? 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={u.is_active && u.id === currentUser?.id ? 'No puede desactivarse a sí mismo' : (u.is_active ? 'Desactivar' : 'Activar')}
                            aria-label={
                              u.is_active && u.id === currentUser?.id
                                ? `No puede desactivarse a sí mismo (${u.full_name ?? u.username})`
                                : `${u.is_active ? 'Desactivar' : 'Activar'} a ${u.full_name ?? u.username}`
                            }
                          >
                            {u.is_active ? <PowerOff size={15} aria-hidden="true" /> : <Power size={15} aria-hidden="true" />}
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
          {status === 'ready' && users.length > 0 && (
            <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400" aria-live="polite" aria-atomic="true">{count} usuario{count === 1 ? '' : 's'} — página {page}</p>
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

      {tempPasswordModal && (
        <TemporaryPasswordModal
          username={tempPasswordModal.username}
          temporaryPassword={tempPasswordModal.temporaryPassword}
          onClose={() => setTempPasswordModal(null)}
        />
      )}
    </>
  );
}
