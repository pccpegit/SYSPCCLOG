import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, AlertCircle, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes slideRight {
    from { opacity: 0; transform: translateX(-30px); }
    to   { opacity: 1; transform: translateX(0);     }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.94); }
    to   { opacity: 1; transform: scale(1);    }
  }
  .fade-up    { animation: fadeUp    0.6s ease both; }
  .slide-right{ animation: slideRight 0.5s ease both; }
  .scale-in   { animation: scaleIn  0.5s ease both; }
`;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect to system select
  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate('/', { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Por favor ingrese su usuario y contraseña.');
      return;
    }

    setIsLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/');
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 400) {
        setError('Usuario o contraseña incorrectos. Intente nuevamente.');
      } else if (status === 429) {
        setError('Demasiados intentos. Espere un momento e intente nuevamente.');
      } else {
        setError('No se pudo conectar al servidor. Verifique su conexión.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <style>{STYLES}</style>

      <div className="min-h-dvh flex bg-gradient-to-br from-slate-50 via-white to-blue-50">

        {/* ── LEFT PANEL — Branding (lg+) ───────────────────────── */}
        <div className="hidden lg:flex lg:w-[48%] xl:w-[52%] relative overflow-hidden">
          {/* Background image */}
          <img
            src="/images/sli4.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-blue-900/85 to-slate-900/90" />

          {/* Content */}
          <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 2xl:p-20 w-full">
            {/* Top — Logo */}
            <div className="slide-right flex justify-center mt-10 xl:mt-16">
              <img
                src="/images/logo-blanco.png"
                alt="PCC"
                className="w-56 xl:w-72 2xl:w-80 h-auto"
              />
            </div>

            {/* Center — Welcome text */}
            <div className="slide-right" style={{ animationDelay: '0.15s' }}>
              <p className="text-sky-400 text-xs font-semibold uppercase tracking-[0.2em] mb-4">
                Bienvenido al
              </p>
              <h1 className="text-4xl xl:text-5xl 2xl:text-[3.5rem] font-light text-white leading-[1.15] tracking-tight">
                Portal de
              </h1>
              <h1 className="text-4xl xl:text-5xl 2xl:text-[3.5rem] font-bold text-white leading-[1.15] tracking-tight">
                Colaboradores
              </h1>
              <div className="w-16 h-1 rounded-full bg-gradient-to-r from-sky-400 to-blue-500 mt-6" />
              <p className="text-white/40 text-sm mt-5 max-w-md leading-relaxed">
                Gestiona tus procesos, consulta información y
                colabora con tu equipo desde un solo lugar.
              </p>
            </div>

            {/* Bottom — Certifications + info */}
            <div className="slide-right" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-4 mb-4">
                <img src="/images/firma1.jpg" alt="ISO 9001" className="h-8 xl:h-10 rounded bg-white px-1.5 py-1 opacity-90" />
                <img src="/images/firma2.jpg" alt="ISO 14001" className="h-8 xl:h-10 rounded bg-white px-1.5 py-1 opacity-90" />
                <img src="/images/firma3.jpg" alt="ISO 45001" className="h-8 xl:h-10 rounded bg-white px-1.5 py-1 opacity-90" />
              </div>
              <p className="text-white/25 text-[11px]">
                PCC S.A.C. — Proyectos, Construcción & Comisionamiento
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL — Login Form ──────────────────────────── */}
        <div className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-12">
          <div className="w-full max-w-[420px]">

            {/* Mobile header — logo */}
            <div className="lg:hidden text-center mb-8 fade-up">
              <img src="/images/azul.jpg" alt="PCC" className="h-14 sm:h-16 w-auto mx-auto mb-3" />
              <p className="text-gray-400 text-xs font-medium">
                Sistema de Gestión de Requerimientos
              </p>
            </div>

            {/* Card */}
            <div className="scale-in" style={{ animationDelay: '0.1s' }}>
              {/* Header */}
              <div className="mb-8">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
                    <Shield size={18} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                      Iniciar Sesión
                    </h2>
                  </div>
                </div>
                <p className="text-gray-400 text-sm mt-2 pl-0.5">
                  Ingrese sus credenciales para acceder al sistema.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

                {/* Error banner */}
                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm fade-up">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
                    <span className="font-medium">{error}</span>
                  </div>
                )}

                {/* Username */}
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="username"
                    className="text-sm font-semibold text-gray-700"
                  >
                    Usuario
                  </label>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    placeholder="Ingrese su usuario"
                    className={[
                      'w-full rounded-xl px-4 py-3 text-sm text-gray-900',
                      'bg-gray-50 border border-gray-200',
                      'placeholder:text-gray-300',
                      'hover:border-gray-300',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
                      'focus:bg-white',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-all duration-150',
                    ].join(' ')}
                  />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="password"
                    className="text-sm font-semibold text-gray-700"
                  >
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      placeholder="Ingrese su contraseña"
                      className={[
                        'w-full rounded-xl px-4 py-3 pr-11 text-sm text-gray-900',
                        'bg-gray-50 border border-gray-200',
                        'placeholder:text-gray-300',
                        'hover:border-gray-300',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
                        'focus:bg-white',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        'transition-all duration-150',
                      ].join(' ')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className={[
                    'mt-1 flex items-center justify-center gap-2',
                    'w-full rounded-xl px-4 py-3.5 text-sm font-semibold text-white',
                    'bg-blue-600',
                    'hover:bg-blue-700',
                    'active:scale-[0.98]',
                    'shadow-lg shadow-blue-600/25',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2',
                    'disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100',
                    'transition-all duration-200',
                  ].join(' ')}
                >
                  {isLoading ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Verificando...
                    </>
                  ) : (
                    <>
                      <LogIn size={16} />
                      Ingresar
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 mt-8">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[10px] text-gray-300 uppercase tracking-wider font-medium">Acceso seguro</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Security note */}
              <p className="text-center text-xs text-gray-300 mt-4 leading-relaxed">
                Este sistema es de uso exclusivo para personal autorizado de PCC S.A.C.
                Todo acceso queda registrado.
              </p>
            </div>

            {/* Footer */}
            <p className="text-center text-[11px] text-gray-300 mt-6 fade-up" style={{ animationDelay: '0.4s' }}>
              PCC S.A.C. &middot; RQ System v1.0
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
