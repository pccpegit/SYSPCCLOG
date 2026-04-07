import { useNavigate } from 'react-router-dom';
import { User, LogOut, Menu, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../data/constants';

const ROLE_BADGE_COLORS = {
  REQUESTER:            'bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20',
  PROJECT_RESIDENT:     'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20',
  PROJECT_CONTROL:      'bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20',
  GENERAL_MANAGER:      'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20',
  LOGISTICS:            'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20',
  LOGISTICS_COORDINATOR:'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20',
  CENTRAL_WAREHOUSE:    'bg-teal-500/10 text-teal-600 ring-1 ring-teal-500/20',
  SITE_WAREHOUSE:       'bg-cyan-500/10 text-cyan-600 ring-1 ring-cyan-500/20',
  DIRECT_SUPERVISOR:    'bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/20',
  ADMIN_MANAGER:        'bg-purple-500/10 text-purple-600 ring-1 ring-purple-500/20',
  LOGISTICS_SUPERVISOR: 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20',
  LOGISTICS_CHIEF:      'bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/20',
};

const AVATAR_COLORS = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-cyan-600',
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
    <header className="h-16 bg-white border-b border-gray-200/80 flex items-center px-4 sm:px-6 gap-3 shrink-0 sticky top-0 z-10">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
        aria-label="Abrir menú"
      >
        <Menu size={22} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Notification bell */}
      <button
        className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        title="Notificaciones"
      >
        <Bell size={20} />
        {/* Unread dot */}
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
      </button>

      {/* Divider */}
      <div className="h-8 w-px bg-gray-200 shrink-0 hidden sm:block" />

      {/* User info */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-9 h-9 shrink-0 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold select-none shadow-sm`}>
          {currentUser.avatar ?? avatarInitials}
        </div>
        <div className="hidden sm:flex flex-col items-start leading-tight min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[160px]">
            {displayName}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColor} truncate max-w-[160px]`}>
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Logout button */}
      <button
        onClick={handleLogout}
        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
        title="Cerrar sesión"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
