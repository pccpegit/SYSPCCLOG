import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FilePlus,
  FileText,
  CheckSquare,
  Truck,
  Warehouse,
  BarChart3,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../data/constants';

const ALL_ROLES = Object.values(ROLES);

const NAV_ITEMS = [
  {
    label: 'Dashboard',
    to: '/rq',
    icon: LayoutDashboard,
    roles: ALL_ROLES,
    end: true,
  },
  {
    label: 'Nuevo RQ',
    to: '/rq/requests/new',
    icon: FilePlus,
    roles: ALL_ROLES,
    end: false,
  },
  {
    label: 'Mis Requerimientos',
    to: '/rq/requests',
    icon: FileText,
    roles: ALL_ROLES,
    end: true,
  },
  {
    label: 'Aprobaciones',
    to: '/rq/approvals',
    icon: CheckSquare,
    roles: [ROLES.PROJECT_RESIDENT, ROLES.PROJECT_CONTROL, ROLES.GENERAL_MANAGER, ROLES.DIRECT_SUPERVISOR, ROLES.ADMIN_MANAGER],
    end: false,
  },
  {
    label: 'Informes',
    to: '/rq/reports',
    icon: BarChart3,
    roles: [ROLES.GENERAL_MANAGER],
    end: false,
  },
  {
    label: 'Logística',
    to: '/rq/logistics',
    icon: Truck,
    roles: [ROLES.LOGISTICS_COORDINATOR, ROLES.LOGISTICS_SUPERVISOR, ROLES.LOGISTICS_CHIEF],
    end: false,
  },
  {
    label: 'Almacén',
    to: '/rq/warehouse',
    icon: Warehouse,
    roles: [ROLES.CENTRAL_WAREHOUSE, ROLES.SITE_WAREHOUSE],
    end: false,
  },
];

export default function Sidebar({ isOpen, onClose }) {
  const { primaryRole } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => primaryRole && item.roles.includes(primaryRole)
  );

  return (
    <>
      {/* Backdrop — mobile only */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel — dark theme */}
      <aside
        className={[
          'fixed left-0 top-0 h-screen w-64 flex flex-col z-30',
          'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo / Brand */}
        <div className="h-16 sm:h-20 flex items-center justify-center px-5 border-b border-white/10 shrink-0 gap-3">
          <img
            src="/images/logo-blanco.png"
            alt="PCC Logo"
            className="h-11 sm:h-14 w-auto object-contain"
          />
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>

        {/* Section label */}
        <div className="px-5 pt-5 pb-2">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.15em]">Menú principal</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="flex flex-col gap-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                          : 'text-white/50 hover:bg-white/[0.07] hover:text-white/90'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={20}
                          className={isActive ? 'text-white' : 'text-white/40'}
                          strokeWidth={isActive ? 2.5 : 1.8}
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.06] flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] text-white/20 font-medium">Sistema activo &middot; v1.0</p>
        </div>
      </aside>
    </>
  );
}
