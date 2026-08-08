import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../data/constants';
import {
  ClipboardList,
  Warehouse,
  Users,
  BarChart3,
  Settings,
  Lock,
  ArrowRight,
  LogOut,
  CircleDot,
  Headphones,
  ShieldCheck,
} from 'lucide-react';

const BG_IMAGES = ['/images/sli1.png', '/images/sli2.png', '/images/sli3.png', '/images/sli4.png'];

const WAREHOUSE_ROLES = ['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE', 'LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF'];
const ADMIN_ROLES = ['ADMIN_MANAGER', 'GENERAL_MANAGER', 'PASAJES_MANAGER'];

const SYSTEMS = [
  {
    id: 'rq',
    name: 'Requerimientos',
    subtitle: 'RQ System',
    description: 'Gestiona solicitudes de abastecimiento, aprobaciones y seguimiento de materiales para tus proyectos.',
    icon: ClipboardList,
    color: 'blue',
    path: '/rq',
    available: true,
  },
  {
    id: 'warehouse',
    name: 'Almacen',
    subtitle: 'Inventario',
    description: 'Control de inventario, registro de entradas y salidas, kardex y despacho de materiales a obra.',
    icon: Warehouse,
    color: 'emerald',
    path: '/almacen',
    available: true,
    requiredRoles: WAREHOUSE_ROLES,
  },
  {
    id: 'support',
    name: 'Soporte TI',
    subtitle: 'Mesa de Ayuda',
    description: 'Reporta incidencias tecnicas, solicita accesos y da seguimiento a tus tickets de soporte.',
    icon: Headphones,
    color: 'teal',
    path: '/soporte',
    available: true,
  },
  {
    id: 'rrhh',
    name: 'Recursos Humanos',
    subtitle: 'RRHH',
    description: 'Asistencia, vacaciones, capacitaciones y gestion de personal.',
    icon: Users,
    color: 'violet',
    path: '/rrhh',
    available: false,
  },
  {
    id: 'reports',
    name: 'Business Intelligence',
    subtitle: 'BI',
    description: 'Reportes gerenciales, indicadores de gestion y analisis de datos.',
    icon: BarChart3,
    color: 'amber',
    path: '/bi',
    available: false,
  },
  {
    id: 'admin',
    name: 'Administracion',
    subtitle: 'Admin',
    description: 'Gestion de pasajes de personal, pagos, politicas de devolucion y proveedores.',
    icon: Settings,
    color: 'slate',
    path: '/admin',
    available: true,
    requiredRoles: ADMIN_ROLES,
  },
  {
    id: 'sistema',
    name: 'Administración del Sistema',
    subtitle: 'Sistema',
    description: 'Gestión de usuarios, roles y proyectos registrados en el sistema. Acceso exclusivo de superadministrador.',
    icon: ShieldCheck,
    color: 'rose',
    path: '/sistema',
    available: true,
    requiresSuperuser: true,
  },
];

const COLOR_MAP = {
  blue: {
    card: 'from-blue-600 to-indigo-700',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-blue-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  emerald: {
    card: 'from-emerald-600 to-teal-700',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-emerald-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  teal: {
    card: 'from-teal-600 to-cyan-700',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-teal-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  violet: {
    card: 'from-violet-600 to-purple-700',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-violet-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  amber: {
    card: 'from-amber-500 to-orange-600',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-amber-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  slate: {
    card: 'from-slate-600 to-slate-800',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-slate-500/25',
    badge: 'bg-white/10 text-white/80',
  },
  rose: {
    card: 'from-rose-600 to-red-700',
    iconBg: 'bg-white/15',
    iconRing: 'ring-white/10',
    hoverGlow: 'group-hover:shadow-rose-500/25',
    badge: 'bg-white/10 text-white/80',
  },
};

export default function SystemSelectPage() {
  const { currentUser, isAuthenticated, isLoading, logout, userRoles, primaryRole, isSuperUser } = useAuth();
  const navigate = useNavigate();
  const [bgIndex, setBgIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login', { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % BG_IMAGES.length);
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const visibleSystems = useMemo(() => {
    return SYSTEMS.filter((s) => {
      // is_superuser is a Django flag, not an entry in userRoles — it needs
      // its own branch (requiredRoles.some(...) can never match it).
      if (s.requiresSuperuser) return isSuperUser;
      if (!s.requiredRoles) return true;
      return s.requiredRoles.some((r) => userRoles.includes(r));
    });
  }, [userRoles, isSuperUser]);

  if (isLoading || !currentUser) return (
    <div className="min-h-dvh flex items-center justify-center bg-[#080b12]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-blue-400" />
        <p className="text-slate-500 text-sm font-display">Cargando...</p>
      </div>
    </div>
  );

  const displayName = currentUser?.full_name
    ?? `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    ?? currentUser?.username ?? '';

  const firstName = currentUser?.first_name ?? displayName.split(' ')[0] ?? '';
  const initials = displayName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  const roleLabel = ROLE_LABELS[primaryRole] ?? primaryRole ?? '';

  const handleSelect = (system) => {
    if (!system.available) return;
    navigate(system.path);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos dias' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="min-h-dvh relative overflow-hidden flex flex-col bg-[#080b12]">

      {/* Background slideshow */}
      {BG_IMAGES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[2500ms] select-none"
          style={{ opacity: i === bgIndex ? 1 : 0, zIndex: 0 }}
          draggable={false}
        />
      ))}

      {/* Overlays */}
      <div className="absolute inset-0 bg-[#080b12]/75 z-[1]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#080b12] via-[#080b12]/30 to-[#080b12]/50 z-[1]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(56,139,253,0.04),transparent_60%)] z-[1]" />

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-dvh">

        {/* Header */}
        <header
          className="flex items-center justify-between px-4 sm:px-8 lg:px-12 py-4 sm:py-5 shrink-0"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.6s ease 0.1s',
          }}
        >
          <img
            src="/images/logo-blanco.png"
            alt="PCC"
            className="h-8 sm:h-10 lg:h-11 w-auto object-contain"
          />

          <div className="flex items-center gap-2 sm:gap-3">
            {roleLabel && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[11px] font-medium text-white/45 font-display">
                <CircleDot size={10} className="text-blue-400/80" />
                {roleLabel}
              </span>
            )}

            <div className="flex items-center gap-2.5 pl-2 sm:pl-3 sm:border-l border-white/[0.07]">
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 -mx-1 hover:bg-white/[0.06] cursor-pointer"
                title="Configuracion"
              >
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[13px] font-semibold text-white/85 leading-tight font-display">{displayName}</span>
                  <span className="text-[10px] text-white/25 leading-tight">{currentUser?.position ?? ''}</span>
                </div>
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold shadow-lg shadow-blue-500/15">
                  {initials}
                </div>
              </button>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-white/25 hover:text-white hover:bg-white/10"
                title="Cerrar sesion"
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </header>

        {/* Main */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 lg:px-12 pb-6 sm:pb-8">

          {/* Welcome */}
          <div
            className="text-center mb-8 sm:mb-12 lg:mb-14 max-w-2xl mx-auto"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.15s',
            }}
          >
            <p className="text-blue-400/60 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.25em] mb-3 sm:mb-4 font-display">
              {greeting}, {firstName}
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-extrabold text-white tracking-tight leading-tight font-display">
              Selecciona un modulo
            </h1>
            <p className="text-white/25 text-xs sm:text-sm mt-2 sm:mt-3 max-w-md mx-auto leading-relaxed">
              Accede a las herramientas disponibles para tu rol.
            </p>
          </div>

          {/* System cards */}
          <div className={`
            grid gap-3 sm:gap-4 lg:gap-5 w-full
            ${visibleSystems.length <= 2
              ? 'grid-cols-1 sm:grid-cols-2 max-w-2xl'
              : visibleSystems.length <= 3
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl'
            }
            mx-auto
          `}>
            {visibleSystems.map((system, idx) => {
              const Icon = system.icon;
              const isAvailable = system.available;
              const colors = COLOR_MAP[system.color];

              return (
                <button
                  key={system.id}
                  onClick={() => handleSelect(system)}
                  disabled={!isAvailable}
                  className="group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080b12] rounded-2xl"
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
                    transition: `all 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${0.2 + idx * 0.08}s`,
                  }}
                >
                  <div
                    className={[
                      'relative rounded-2xl overflow-hidden transition-all duration-300 h-full',
                      'border border-white/[0.06]',
                      isAvailable
                        ? `hover:-translate-y-1.5 hover:shadow-2xl ${colors.hoverGlow} hover:border-white/[0.12] cursor-pointer`
                        : 'opacity-30 cursor-not-allowed',
                    ].join(' ')}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${colors.card} ${isAvailable ? 'opacity-90 group-hover:opacity-100' : 'opacity-40'} transition-opacity duration-500`} />
                    <div className="absolute inset-0 bg-white/[0.02]" />
                    <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/[0.04] group-hover:bg-white/[0.07] transition-colors duration-500" />

                    <div className="relative p-5 sm:p-6 lg:p-7 flex flex-col h-full min-h-[170px] sm:min-h-[190px]">
                      <div className="flex items-start justify-between mb-4 sm:mb-5">
                        <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl ${colors.iconBg} ring-1 ${colors.iconRing} flex items-center justify-center`}>
                          {isAvailable
                            ? <Icon size={22} className="text-white" strokeWidth={1.7} />
                            : <Lock size={18} className="text-white/40" />
                          }
                        </div>
                        {isAvailable && (
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.badge} px-2.5 py-1 rounded-full font-display`}>
                            {system.subtitle}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base sm:text-lg font-extrabold text-white mb-1.5 leading-snug font-display">
                        {system.name}
                      </h3>

                      <p className="text-white/45 text-[11px] sm:text-xs leading-relaxed flex-1 line-clamp-3">
                        {isAvailable ? system.description : 'Proximamente disponible'}
                      </p>

                      <div className="mt-4 sm:mt-5">
                        {isAvailable ? (
                          <span className="inline-flex items-center gap-2 text-xs font-bold text-white/60 group-hover:text-white transition-colors duration-200 font-display">
                            Acceder
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/10 group-hover:bg-white/20 transition-all duration-200">
                              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform duration-200" />
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/20 uppercase tracking-wider font-display">
                            <Lock size={10} />
                            Proximamente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 px-4 sm:px-8 lg:px-12 py-4 sm:py-5">
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/[0.04] pt-4 sm:pt-5"
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity 0.6s ease 0.5s',
            }}
          >
            <div className="flex items-center gap-3">
              <img src="/images/firma1.jpg" alt="ISO 9001"  className="h-6 sm:h-7 rounded-md bg-white/90 px-1 py-0.5" />
              <img src="/images/firma2.jpg" alt="ISO 14001" className="h-6 sm:h-7 rounded-md bg-white/90 px-1 py-0.5" />
              <img src="/images/firma3.jpg" alt="ISO 45001" className="h-6 sm:h-7 rounded-md bg-white/90 px-1 py-0.5" />
            </div>
            <p className="text-[10px] sm:text-[11px] text-white/15">
              PCC S.A.C. &middot; Proyectos, Construccion & Comisionamiento &middot; v1.0
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
