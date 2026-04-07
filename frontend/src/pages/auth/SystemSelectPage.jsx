import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ClipboardList,
  Warehouse,
  Users,
  BarChart3,
  Settings,
  Lock,
  ArrowRight,
  LogOut,
  ChevronRight,
} from 'lucide-react';

// Background slider images
const BG_IMAGES = ['/images/sli1.png', '/images/sli2.png', '/images/sli3.png', '/images/sli4.png'];

const SYSTEMS = [
  {
    id: 'rq',
    name: 'Requerimientos',
    description: 'Gestión de requerimientos de abastecimiento, aprobaciones y seguimiento de materiales.',
    icon: ClipboardList,
    gradient: 'from-blue-600 to-indigo-700',
    iconBg: 'bg-white/20',
    path: '/rq',
    available: true,
  },
  {
    id: 'warehouse',
    name: 'Almacén',
    description: 'Control de inventario, recepción de materiales y despacho a obra.',
    icon: Warehouse,
    gradient: 'from-emerald-600 to-teal-700',
    iconBg: 'bg-white/20',
    path: '/warehouse-system',
    available: false,
  },
  {
    id: 'rrhh',
    name: 'Recursos Humanos',
    description: 'Gestión de personal, asistencia, vacaciones y capacitaciones.',
    icon: Users,
    gradient: 'from-violet-600 to-purple-700',
    iconBg: 'bg-white/20',
    path: '/rrhh',
    available: false,
  },
  {
    id: 'reports',
    name: 'Business Intelligence',
    description: 'Reportes gerenciales, indicadores de gestión y análisis de datos.',
    icon: BarChart3,
    gradient: 'from-amber-500 to-orange-600',
    iconBg: 'bg-white/20',
    path: '/bi',
    available: false,
  },
  {
    id: 'admin',
    name: 'Administración',
    description: 'Configuración del sistema, usuarios, roles y permisos.',
    icon: Settings,
    gradient: 'from-slate-600 to-slate-800',
    iconBg: 'bg-white/20',
    path: '/admin',
    available: false,
  },
];

const STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(30px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1);       }
  }
  .anim-fade-up  { animation: fadeUp  0.6s ease both; }
  .anim-fade-in   { animation: fadeIn  0.8s ease both; }
  .anim-slide-up { animation: slideUp 0.5s ease both; }
  .anim-bg-crossfade {
    animation: fadeIn 1.2s ease both;
  }
`;

export default function SystemSelectPage() {
  const { currentUser, isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [bgIndex, setBgIndex] = useState(0);

  // Redirect to login only AFTER session restore completes
  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login', { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  // Background image slideshow
  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % BG_IMAGES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Show nothing while checking session
  if (isLoading || !currentUser) return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-900">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-400" />
    </div>
  );

  const displayName = currentUser?.full_name
    ?? `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    ?? currentUser?.username ?? '';

  const handleSelect = (system) => {
    if (!system.available) return;
    navigate(system.path);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      <style>{STYLES}</style>

      <div className="min-h-dvh relative overflow-hidden flex flex-col">

        {/* ── Background slideshow ── */}
        {BG_IMAGES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[2000ms]"
            style={{ opacity: i === bgIndex ? 1 : 0, zIndex: 0 }}
          />
        ))}

        {/* ── Overlay ── */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/70 to-slate-900/90 z-[1]" />
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/30 to-transparent z-[1]" />

        {/* ── Content ── */}
        <div className="relative z-10 flex flex-col min-h-dvh">

          {/* ── Header ── */}
          <header className="flex items-center justify-between px-6 sm:px-10 lg:px-16 py-5 sm:py-6 shrink-0">
            <div className="anim-fade-in">
              <img
                src="/images/logo-blanco.png"
                alt="PCC"
                className="h-10 sm:h-12 lg:h-14 w-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-3 sm:gap-4 anim-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-semibold text-white">{displayName}</span>
                <span className="text-[11px] text-white/40">{currentUser?.position ?? ''}</span>
              </div>
              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white text-xs font-bold">
                {displayName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()}
              </div>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>

          {/* ── Main ── */}
          <div className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 lg:px-16 pb-8">

            {/* Welcome text */}
            <div className="text-center mb-10 sm:mb-14 anim-fade-up">
              <p className="text-sky-400 text-xs sm:text-sm font-semibold uppercase tracking-[0.2em] mb-3">
                Portal de Colaboradores
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight">
                ¿A dónde quieres ir?
              </h1>
              <p className="text-white/35 text-sm sm:text-base mt-3 max-w-lg mx-auto leading-relaxed">
                Selecciona el módulo al que deseas acceder.
              </p>
            </div>

            {/* System cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 w-full max-w-5xl">
              {SYSTEMS.map((system, idx) => {
                const Icon = system.icon;
                const isAvailable = system.available;

                return (
                  <button
                    key={system.id}
                    onClick={() => handleSelect(system)}
                    disabled={!isAvailable}
                    className="anim-slide-up group text-left"
                    style={{ animationDelay: `${0.1 + idx * 0.08}s` }}
                  >
                    <div
                      className={`
                        relative rounded-2xl overflow-hidden transition-all duration-300 h-full
                        ${isAvailable
                          ? 'hover:-translate-y-2 hover:shadow-2xl hover:shadow-black/40 cursor-pointer'
                          : 'opacity-40 cursor-not-allowed'
                        }
                      `}
                    >
                      {/* Card background */}
                      <div className={`
                        absolute inset-0 bg-gradient-to-br ${system.gradient}
                        ${isAvailable ? 'opacity-90 group-hover:opacity-100' : 'opacity-50'}
                        transition-opacity duration-300
                      `} />

                      {/* Glass overlay */}
                      <div className="absolute inset-0 bg-white/[0.05] backdrop-blur-[1px]" />

                      {/* Content */}
                      <div className="relative p-6 sm:p-7 flex flex-col h-full min-h-[180px]">
                        {/* Icon */}
                        <div className={`w-12 h-12 rounded-xl ${system.iconBg} flex items-center justify-center mb-4 backdrop-blur-sm`}>
                          {isAvailable
                            ? <Icon size={24} className="text-white" strokeWidth={1.8} />
                            : <Lock size={20} className="text-white/50" />
                          }
                        </div>

                        {/* Title */}
                        <h3 className="text-lg font-bold text-white mb-1.5">
                          {system.name}
                        </h3>

                        {/* Description */}
                        <p className="text-white/60 text-xs leading-relaxed flex-1">
                          {isAvailable ? system.description : 'Próximamente disponible'}
                        </p>

                        {/* Footer */}
                        <div className="mt-4 flex items-center justify-between">
                          {isAvailable ? (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-white/80 group-hover:text-white transition-colors">
                              Acceder
                              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider bg-white/10 px-3 py-1 rounded-full">
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

          {/* ── Footer ── */}
          <footer className="shrink-0 px-6 sm:px-10 lg:px-16 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 anim-fade-in" style={{ animationDelay: '0.6s' }}>
              <img src="/images/firma1.jpg" alt="ISO 9001" className="h-7 sm:h-8 rounded bg-white px-1 py-0.5 opacity-80" />
              <img src="/images/firma2.jpg" alt="ISO 14001" className="h-7 sm:h-8 rounded bg-white px-1 py-0.5 opacity-80" />
              <img src="/images/firma3.jpg" alt="ISO 45001" className="h-7 sm:h-8 rounded bg-white px-1 py-0.5 opacity-80" />
            </div>
            <p className="text-[11px] text-white/20 anim-fade-in" style={{ animationDelay: '0.7s' }}>
              PCC S.A.C. &middot; Proyectos, Construcción & Comisionamiento &middot; v1.0
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
