import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Plane,
  Lock,
  ArrowRight,
  ChevronLeft,
  LogOut,
  Users,
  Building2,
} from 'lucide-react';

// ── Módulos administrativos ───────────────────────────────────────────────────
// "Pasajes" está siempre disponible. Los dos módulos restantes son
// "Próximamente" para la mayoría, pero SYSPCC-018 los reemplaza por
// Usuarios/Proyectos para el superadmin (is_superuser) — no hay rol de
// negocio SUPERADMIN, así que ese es el único gate posible aquí.

const PASAJES_MODULE = {
  id: 'pasajes',
  name: 'Pasajes',
  subtitle: 'Personal',
  description: 'Gestión de pasajes de personal: registro, pagos, políticas de devolución, proveedores y dashboard.',
  icon: Plane,
  color: 'indigo',
  path: '/admin/pasajes',
  available: true,
};

const PLACEHOLDER_MODULES = [
  {
    id: 'futuro-1',
    name: 'Próximamente',
    subtitle: 'Nuevo módulo',
    description: 'Nuevo módulo administrativo en desarrollo.',
    icon: Lock,
    color: 'slate',
    path: null,
    available: false,
  },
  {
    id: 'futuro-2',
    name: 'Próximamente',
    subtitle: 'Nuevo módulo',
    description: 'Nuevo módulo administrativo en desarrollo.',
    icon: Lock,
    color: 'slate',
    path: null,
    available: false,
  },
];

const SUPERUSER_MODULES = [
  {
    id: 'usuarios',
    name: 'Usuarios',
    subtitle: 'Sistema',
    description: 'Cuentas, roles y accesos: crear, editar, restablecer contraseñas y activar/desactivar usuarios.',
    icon: Users,
    color: 'emerald',
    path: '/admin/usuarios',
    available: true,
  },
  {
    id: 'proyectos',
    name: 'Proyectos',
    subtitle: 'Sistema',
    description: 'Obras registradas en el sistema: crear, editar y activar/desactivar proyectos.',
    icon: Building2,
    color: 'amber',
    path: '/admin/proyectos',
    available: true,
  },
];

const COLOR_MAP = {
  indigo: {
    card: 'from-indigo-600 to-blue-700',
    hoverGlow: 'group-hover:shadow-indigo-500/25',
  },
  slate: {
    card: 'from-slate-600 to-slate-800',
    hoverGlow: 'group-hover:shadow-slate-500/25',
  },
  emerald: {
    card: 'from-emerald-600 to-teal-700',
    hoverGlow: 'group-hover:shadow-emerald-500/25',
  },
  amber: {
    card: 'from-amber-600 to-orange-700',
    hoverGlow: 'group-hover:shadow-amber-500/25',
  },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminMenuPage() {
  const { currentUser, isAuthenticated, isLoading, logout, isSuperUser } = useAuth();
  const navigate = useNavigate();

  const MODULES = [
    PASAJES_MODULE,
    ...(isSuperUser ? SUPERUSER_MODULES : PLACEHOLDER_MODULES),
  ];

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login', { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading || !currentUser) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#080b12]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-indigo-400" />
      </div>
    );
  }

  const handleSelect = (mod) => {
    if (!mod.available || !mod.path) return;
    navigate(mod.path);
  };

  return (
    <div className="min-h-dvh relative overflow-hidden flex flex-col bg-[#080b12]">

      {/* Overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c1220] via-[#080b12] to-[#050810] z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_25%,rgba(99,102,241,0.08),transparent_60%)] z-0" />

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-dvh">

        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-8 lg:px-12 py-4 sm:py-5 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Volver al menú principal"
            >
              <ChevronLeft size={18} />
            </button>
            <img
              src="/images/logo-blanco.png"
              alt="PCC"
              className="h-8 sm:h-10 lg:h-11 w-auto object-contain"
            />
          </div>

          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="p-2 rounded-lg text-white/25 hover:text-white hover:bg-white/10 transition-colors"
            title="Cerrar sesión"
          >
            <LogOut size={17} />
          </button>
        </header>

        {/* Main */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 lg:px-12 pb-6 sm:pb-8">

          {/* Title */}
          <div className="text-center mb-8 sm:mb-12 max-w-2xl mx-auto">
            <p className="text-indigo-400/60 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.25em] mb-3 font-display">
              Administración
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight font-display">
              Selecciona un módulo
            </h1>
            <p className="text-white/25 text-xs sm:text-sm mt-2 sm:mt-3 max-w-md mx-auto leading-relaxed">
              Accede a las herramientas administrativas disponibles.
            </p>
          </div>

          {/* Module cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5 w-full max-w-5xl mx-auto">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              const colors = COLOR_MAP[mod.color];
              const isAvailable = mod.available;

              return (
                <button
                  key={mod.id}
                  onClick={() => handleSelect(mod)}
                  disabled={!isAvailable}
                  className="group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080b12] rounded-2xl"
                >
                  <div
                    className={[
                      'relative rounded-2xl overflow-hidden transition-all duration-300 h-full border border-white/[0.06]',
                      isAvailable
                        ? `hover:-translate-y-1.5 hover:shadow-2xl ${colors.hoverGlow} hover:border-white/[0.12] cursor-pointer`
                        : 'opacity-30 cursor-not-allowed',
                    ].join(' ')}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${colors.card} ${isAvailable ? 'opacity-90 group-hover:opacity-100' : 'opacity-40'} transition-opacity duration-500`} />
                    <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/[0.04] group-hover:bg-white/[0.07] transition-colors duration-500" />

                    <div className="relative p-5 sm:p-6 lg:p-7 flex flex-col h-full min-h-[170px] sm:min-h-[190px]">
                      <div className="flex items-start justify-between mb-4 sm:mb-5">
                        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/15 ring-1 ring-white/10 flex items-center justify-center">
                          <Icon size={22} className={isAvailable ? 'text-white' : 'text-white/40'} strokeWidth={1.7} />
                        </div>
                        {isAvailable && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/80 px-2.5 py-1 rounded-full font-display">
                            {mod.subtitle}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base sm:text-lg font-extrabold text-white mb-1.5 leading-snug font-display">
                        {mod.name}
                      </h3>

                      <p className="text-white/45 text-[11px] sm:text-xs leading-relaxed flex-1 line-clamp-3">
                        {isAvailable ? mod.description : 'Próximamente disponible'}
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
                            Próximamente
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
      </div>
    </div>
  );
}
