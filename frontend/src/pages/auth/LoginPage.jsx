import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, AlertCircle, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate('/', { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('Demo2026Pcc!');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

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
    <div className="min-h-dvh flex bg-[#f0f2f5]">

      {/* ── LEFT PANEL — Branding ── */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-[52%] relative overflow-hidden">
        <img
          src="/images/sli4.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0f1a]/92 via-[#0c1929]/88 to-[#0a0f1a]/92" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(56,139,253,0.08),transparent_60%)]" />

        <div
          className="relative z-10 flex flex-col justify-between p-10 xl:p-14 2xl:p-20 w-full"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateX(0)' : 'translateX(-20px)',
            transition: 'all 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Top — Logo */}
          <div className="flex justify-center mt-10 xl:mt-16">
            <img
              src="/images/logo-blanco.png"
              alt="PCC"
              className="w-56 xl:w-72 2xl:w-80 h-auto"
            />
          </div>

          {/* Center — Welcome text */}
          <div>
            <p className="text-blue-400/70 text-[11px] font-semibold uppercase tracking-[0.25em] mb-4 font-display">
              Bienvenido al
            </p>
            <h1 className="text-4xl xl:text-5xl 2xl:text-[3.5rem] font-light text-white/90 leading-[1.15] tracking-tight font-display">
              Portal de
            </h1>
            <h1 className="text-4xl xl:text-5xl 2xl:text-[3.5rem] font-extrabold text-white leading-[1.15] tracking-tight font-display">
              Colaboradores
            </h1>
            <div className="w-14 h-0.5 bg-gradient-to-r from-blue-400 to-blue-600 mt-6 rounded-full" />
            <p className="text-white/30 text-sm mt-5 max-w-md leading-relaxed">
              Gestiona tus procesos, consulta información y
              colabora con tu equipo desde un solo lugar.
            </p>
          </div>

          {/* Bottom — Certifications */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <img src="/images/firma1.jpg" alt="ISO 9001" className="h-8 xl:h-10 rounded-md bg-white/95 px-1.5 py-1" />
              <img src="/images/firma2.jpg" alt="ISO 14001" className="h-8 xl:h-10 rounded-md bg-white/95 px-1.5 py-1" />
              <img src="/images/firma3.jpg" alt="ISO 45001" className="h-8 xl:h-10 rounded-md bg-white/95 px-1.5 py-1" />
            </div>
            <p className="text-white/20 text-[11px]">
              PCC S.A.C. — Proyectos, Construcción & Comisionamiento
            </p>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Login Form ── */}
      <div className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <div
          className="w-full max-w-[420px]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(8px)',
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.1s',
          }}
        >

          {/* Mobile header */}
          <div className="lg:hidden text-center mb-8">
            <img src="/images/azul.jpg" alt="PCC" className="h-14 sm:h-16 w-auto mx-auto mb-3" />
            <p className="text-gray-400 text-xs font-medium">
              Sistema de Gestión de Requerimientos
            </p>
          </div>

          {/* Form header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Shield size={18} className="text-white" />
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight font-display">
                Iniciar Sesión
              </h2>
            </div>
            <p className="text-gray-400 text-sm mt-3 pl-0.5">
              Ingrese sus credenciales para acceder al sistema.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200/80 rounded-xl px-4 py-3 text-red-700 text-sm animate-[fadeIn_0.2s_ease-out]">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            {/* Username */}
            <div className="flex flex-col gap-2">
              <label htmlFor="username" className="text-sm font-semibold text-gray-700 font-display">
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
                className="w-full rounded-xl px-4 py-3 text-sm text-gray-900 bg-white border border-gray-200 placeholder:text-gray-300 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-semibold text-gray-700 font-display">
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
                  className="w-full rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 bg-white border border-gray-200 placeholder:text-gray-300 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
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
              className="mt-1 flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:scale-[0.98] shadow-lg shadow-blue-600/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 font-display"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
            <div className="flex-1 h-px bg-gray-200/80" />
            <span className="text-[10px] text-gray-300 uppercase tracking-wider font-medium">Acceso seguro</span>
            <div className="flex-1 h-px bg-gray-200/80" />
          </div>

          {/* Security note */}
          <p className="text-center text-xs text-gray-300 mt-4 leading-relaxed">
            Este sistema es de uso exclusivo para personal autorizado de PCC S.A.C.
            Todo acceso queda registrado.
          </p>

          {/* Footer */}
          <p className="text-center text-[11px] text-gray-300 mt-6">
            PCC S.A.C. &middot; RQ System v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
