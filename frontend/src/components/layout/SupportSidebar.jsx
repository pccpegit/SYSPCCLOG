import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Plus,
  Ticket,
  Settings,
  ChevronLeft,
  X,
  Headphones,
} from 'lucide-react';

const NAV_ITEMS = [
  {
    label: 'Nuevo Ticket',
    to:    '/soporte',
    icon:  Plus,
    end:   true,
  },
  { section: 'Seguimiento' },
  {
    label: 'Mis Tickets',
    to:    '/soporte/tickets',
    icon:  Ticket,
    end:   true,
  },
  {
    label: 'Dashboard',
    to:    '/soporte/dashboard',
    icon:  LayoutDashboard,
    end:   true,
  },
];

const ACCENT = {
  activeBg:      'bg-teal-500/12',
  activeText:    'text-teal-400',
  activeIcon:    'text-teal-400',
  activeBar:     'bg-teal-400',
  activeIconBg:  'bg-teal-500/20',
  dot:           'bg-teal-400',
  dotGlow:       'shadow-[0_0_8px_2px_rgba(20,184,166,0.35)]',
  brandGradient: 'from-teal-500 to-teal-700',
};

export default function SupportSidebar({ isOpen, onClose }) {
  const navigate = useNavigate();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-[6px] z-20 lg:hidden transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed left-0 top-0 h-screen w-[260px] flex flex-col z-30',
          'bg-gradient-to-b from-[#0c1220] via-[#0a0f1a] to-[#080c14]',
          'border-r border-white/[0.05]',
          'transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        ].join(' ')}
      >
        {/* ── Logo / Brand ── */}
        <div className="shrink-0 border-b border-white/[0.05]">
          {/* Close button — mobile only */}
          <div className="flex justify-end px-3 pt-3 lg:hidden">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Cerrar menu"
            >
              <X size={18} />
            </button>
          </div>

          {/* Logo — full width clickable, centered */}
          <button
            onClick={() => { onClose(); navigate('/'); }}
            className="group w-full flex justify-center px-5 py-4 lg:pt-5 hover:bg-white/[0.03] active:scale-[0.95] active:brightness-75 transition-all duration-150"
            title="Ir al menu principal"
          >
            <img
              src="/images/logo-blanco.png"
              alt="PCC"
              className="h-11 w-auto object-contain group-hover:brightness-125 transition-all duration-200"
            />
          </button>

          {/* Module badge */}
          <div className="px-5 pb-4 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${ACCENT.brandGradient} flex items-center justify-center shadow-md`}>
              <Headphones size={15} className="text-white" strokeWidth={2} />
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-bold text-white/90 tracking-tight font-display">Soporte TI</p>
              <p className="text-[10px] text-white/25 font-medium">Mesa de Ayuda</p>
            </div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-4 scrollbar-thin">
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item, idx) => {
              if (item.section) {
                return (
                  <li key={`section-${idx}`} className="pt-5 pb-1.5 px-3">
                    <p className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] font-display">
                      {item.section}
                    </p>
                  </li>
                );
              }

              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      [
                        'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium',
                        'transition-all duration-150 active:scale-[0.97] active:brightness-90',
                        isActive
                          ? `${ACCENT.activeBg} ${ACCENT.activeText}`
                          : 'text-white/40 hover:bg-white/[0.04] hover:text-white/75',
                      ].join(' ')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full ${ACCENT.activeBar}`} />
                        )}

                        <div className={[
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200',
                          isActive
                            ? ACCENT.activeIconBg
                            : 'bg-white/[0.03] group-hover:bg-white/[0.06]',
                        ].join(' ')}>
                          <Icon
                            size={16}
                            className={isActive ? ACCENT.activeIcon : 'text-white/30 group-hover:text-white/55'}
                            strokeWidth={isActive ? 2.2 : 1.6}
                          />
                        </div>

                        <span className="font-display truncate">{item.label}</span>

                        {isActive && (
                          <div className={`ml-auto w-1.5 h-1.5 rounded-full ${ACCENT.dot} ${ACCENT.dotGlow}`} />
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── Footer ── */}
        <div className="shrink-0 px-3 pb-3 space-y-1">
          <div className="mx-2 mb-1">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          </div>

          <button
            onClick={() => { onClose(); navigate('/settings'); }}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-white/30 hover:bg-white/[0.04] hover:text-white/65 active:scale-[0.97] active:brightness-90 transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-lg bg-white/[0.03] group-hover:bg-white/[0.06] flex items-center justify-center transition-all duration-200">
              <Settings size={16} className="text-white/25 group-hover:text-white/50" strokeWidth={1.6} />
            </div>
            <span className="font-display">Configuracion</span>
          </button>

          <button
            onClick={() => { onClose(); navigate('/'); }}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-white/30 hover:bg-white/[0.04] hover:text-white/65 active:scale-[0.97] active:brightness-90 transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-lg bg-white/[0.03] group-hover:bg-white/[0.06] flex items-center justify-center transition-all duration-200">
              <ChevronLeft size={16} className="text-white/25 group-hover:text-white/50" strokeWidth={1.6} />
            </div>
            <span className="font-display">Menu principal</span>
          </button>

          <div className="mx-2 mt-1">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          </div>
          <div className="px-3 py-2.5 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${ACCENT.dot} ${ACCENT.dotGlow}`} />
            <p className="text-[10px] text-white/15 font-medium font-display">
              Soporte TI &middot; v1.0
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
