import { useNavigate } from 'react-router-dom';
import { User, LogOut, Menu, Bell, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../data/constants';
import ThemeToggleButton from '../ui/ThemeToggleButton';

// Saturated/semantic colors — deliberately outside the index.css compat
// layer (SYSPCC-020, Decisión 1), so each variant carries its own `dark:`
// override here instead.
const ROLE_BADGE_COLORS = {
  REQUESTER:            'bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:ring-sky-500/30',
  PROJECT_RESIDENT:     'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30',
  PROJECT_CONTROL:      'bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30',
  GENERAL_MANAGER:      'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30',
  LOGISTICS:            'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 dark:bg-orange-500/15 dark:text-orange-400 dark:ring-orange-500/30',
  LOGISTICS_COORDINATOR:'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 dark:bg-orange-500/15 dark:text-orange-400 dark:ring-orange-500/30',
  CENTRAL_WAREHOUSE:    'bg-teal-500/10 text-teal-600 ring-1 ring-teal-500/20 dark:bg-teal-500/15 dark:text-teal-400 dark:ring-teal-500/30',
  SITE_WAREHOUSE:       'bg-cyan-500/10 text-cyan-600 ring-1 ring-cyan-500/20 dark:bg-cyan-500/15 dark:text-cyan-400 dark:ring-cyan-500/30',
  DIRECT_SUPERVISOR:    'bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-400 dark:ring-indigo-500/30',
  ADMIN_MANAGER:        'bg-purple-500/10 text-purple-600 ring-1 ring-purple-500/20 dark:bg-purple-500/15 dark:text-purple-400 dark:ring-purple-500/30',
  LOGISTICS_SUPERVISOR: 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 dark:bg-orange-500/15 dark:text-orange-400 dark:ring-orange-500/30',
  LOGISTICS_CHIEF:      'bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400 dark:ring-rose-500/30',
};

const AVATAR_COLORS = [
  'from-blue-500 to-blue-700',
  'from-emerald-500 to-emerald-700',
  'from-violet-500 to-violet-700',
  'from-amber-500 to-amber-700',
  'from-rose-500 to-rose-700',
  'from-teal-500 to-teal-700',
  'from-indigo-500 to-indigo-700',
  'from-cyan-500 to-cyan-700',
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name?.length ?? 0); i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function Header({ onMenuClick }) {
  const { currentUser, logout, primaryRole } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!currentUser) return null;

  const badgeColor = ROLE_BADGE_COLORS[primaryRole] ?? 'bg-gray-100 text-gray-600';
  const roleLabel  = ROLE_LABELS[primaryRole] ?? primaryRole;

  const displayName = currentUser.full_name
    ?? `${currentUser.first_name ?? ''} ${currentUser.last_name ?? ''}`.trim()
    ?? currentUser.username
    ?? '';

  const avatarInitials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || <User size={16} />;

  const avatarColor = getAvatarColor(displayName);

  return (
    <header className="h-16 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-700/60 flex items-center px-4 sm:px-6 gap-3 shrink-0 sticky top-0 z-10">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-1 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:scale-90 active:bg-gray-200 transition-all duration-150 shrink-0"
        aria-label="Abrir menú"
      >
        <Menu size={22} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Notification bell */}
      <button
        className="relative p-2.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:scale-90 active:bg-gray-200 transition-all duration-150"
        title="Notificaciones"
      >
        <Bell size={19} strokeWidth={1.8} />
        <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white dark:ring-gray-900" />
      </button>

      {/* Theme toggle */}
      <ThemeToggleButton />

      {/* Divider */}
      <div className="h-8 w-px bg-gray-200/80 dark:bg-gray-700/80 shrink-0 hidden sm:block" />

      {/* User info */}
      <button
        onClick={() => navigate('/settings')}
        className="group flex items-center gap-2.5 min-w-0 rounded-xl px-2.5 py-2 -mx-2 hover:bg-gray-50 active:scale-[0.96] active:bg-gray-100 transition-all duration-150 cursor-pointer"
        title="Configuracion"
      >
        <div className={`w-9 h-9 shrink-0 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-[11px] font-bold select-none shadow-sm`}>
          {currentUser.avatar ?? avatarInitials}
        </div>
        <div className="hidden sm:flex flex-col items-start leading-tight min-w-0">
          <span className="text-[13px] font-semibold text-gray-800 truncate max-w-[160px] font-display">
            {displayName}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColor} truncate max-w-[160px]`}>
            {roleLabel}
          </span>
        </div>
      </button>

      {/* Logout button */}
      <button
        onClick={handleLogout}
        className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 active:scale-90 active:bg-red-100 transition-all duration-150 shrink-0"
        title="Cerrar sesión"
      >
        <LogOut size={18} strokeWidth={1.8} />
      </button>
    </header>
  );
}
