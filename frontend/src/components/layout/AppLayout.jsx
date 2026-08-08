import { useState } from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Plus,
  ClipboardList,
  LogOut,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS, ROLES } from '../../data/constants';

const NAV_LINKS = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard',      exact: true },
  { to: '/requests',     icon: FileText,        label: 'Requerimientos'              },
  { to: '/requests/new', icon: Plus,            label: 'Nuevo RQ',       roles: [ROLES.REQUESTER] },
  { to: '/approvals',    icon: ClipboardList,   label: 'Aprobaciones',
    roles: [ROLES.PROJECT_RESIDENT, ROLES.PROJECT_CONTROL, ROLES.GENERAL_MANAGER] },
];

function Initials({ name }) {
  const parts   = (name ?? '').trim().split(/\s+/);
  const letters = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.[0] ?? 'U').toUpperCase();
  return (
    <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
      {letters}
    </span>
  );
}

export default function AppLayout() {
  const { currentUser, logout, primaryRole } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [userMenuOpen,setUserMenuOpen] = useState(false);

  const role = primaryRole;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const displayName = currentUser?.full_name
    ?? `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    ?? currentUser?.username
    ?? '';

  const visibleLinks = NAV_LINKS.filter(
    (link) => !link.roles || (role && link.roles.includes(role))
  );

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 text-blue-700'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top navigation */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-6">
            {/* Brand */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <FileText size={14} className="text-white" />
              </div>
              <span className="font-bold text-gray-900 text-sm hidden sm:block">RQ System</span>
              <span className="text-xs text-gray-400 hidden lg:block">· SYSPCC</span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {visibleLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.exact}
                  className={linkClass}
                >
                  <link.icon size={15} />
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right: user menu + mobile hamburger */}
          <div className="flex items-center gap-2">
            {/* User menu (desktop) */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Initials name={displayName} />
                <div className="text-left hidden lg:block">
                  <p className="text-xs font-semibold text-gray-800 leading-tight">{displayName}</p>
                  <p className="text-xs text-gray-400 leading-tight">{ROLE_LABELS[role] ?? role}</p>
                </div>
                <ChevronDown size={14} className="text-gray-400 hidden lg:block" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-20">
                    <div className="px-4 py-2.5 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-800">{displayName}</p>
                      <p className="text-xs text-gray-500">{currentUser?.email}</p>
                      <p className="text-xs text-blue-600 mt-0.5">{ROLE_LABELS[role] ?? role}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={14} />
                      Cambiar usuario / Salir
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Menu"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1">
            {visibleLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.exact}
                className={linkClass}
                onClick={() => setMobileOpen(false)}
              >
                <link.icon size={16} />
                {link.label}
              </NavLink>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center gap-2 px-3 py-2">
                <Initials name={displayName} />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{displayName}</p>
                  <p className="text-xs text-gray-500">{ROLE_LABELS[role] ?? role}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut size={15} />
                Cambiar usuario / Salir
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-3 px-6 text-center">
        <p className="text-xs text-gray-400">
          SYSPCC · RQ System — v1.0 · 2026
        </p>
      </footer>
    </div>
  );
}
