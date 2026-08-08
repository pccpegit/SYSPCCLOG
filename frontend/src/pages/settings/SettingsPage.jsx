import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Lock, Shield, ArrowLeft, Cloud, CloudOff, Loader2, Copy, ExternalLink,
  Mail, Briefcase, Building2, Eye, EyeOff, Check, AlertCircle, CheckCircle2,
  PenTool, Camera, Trash2, Upload,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { changePassword, uploadSignatureFile, uploadSignatureDrawing, deleteSignature } from '../../api/auth';
import { getOneDriveStatus, oneDriveConnect, oneDrivePoll, oneDriveDisconnect } from '../../api/almacen';
import { BACKEND_URL } from '../../api/config';
import { ROLE_LABELS } from '../../data/constants';

// ── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-cyan-600',
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name?.length ?? 0); i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const ROLE_COLORS = {
  REQUESTER:             'bg-sky-50 text-sky-700 ring-sky-200',
  PROJECT_RESIDENT:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PROJECT_CONTROL:       'bg-violet-50 text-violet-700 ring-violet-200',
  GENERAL_MANAGER:       'bg-amber-50 text-amber-700 ring-amber-200',
  LOGISTICS_COORDINATOR: 'bg-orange-50 text-orange-700 ring-orange-200',
  LOGISTICS_SUPERVISOR:  'bg-orange-50 text-orange-700 ring-orange-200',
  LOGISTICS_CHIEF:       'bg-rose-50 text-rose-700 ring-rose-200',
  CENTRAL_WAREHOUSE:     'bg-teal-50 text-teal-700 ring-teal-200',
  SITE_WAREHOUSE:        'bg-cyan-50 text-cyan-700 ring-cyan-200',
  DIRECT_SUPERVISOR:     'bg-indigo-50 text-indigo-700 ring-indigo-200',
  ADMIN_MANAGER:         'bg-purple-50 text-purple-700 ring-purple-200',
};

// ── Section wrapper ─────────────────────────────────────────────────────────

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center shrink-0">
          <Icon size={17} className="text-gray-500" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

const BASE_TABS = [
  { id: 'profile',      label: 'Perfil',        icon: User },
  { id: 'signature',    label: 'Firma',          icon: PenTool },
  { id: 'security',     label: 'Seguridad',     icon: Lock },
  { id: 'roles',        label: 'Roles',         icon: Shield },
];
const TABS = [
  ...BASE_TABS,
  { id: 'integrations', label: 'OneDrive', icon: Cloud, adminOnly: true },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { currentUser, primaryRole, isAuthenticated, isLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login', { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading || !currentUser) return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600" />
    </div>
  );

  const displayName = currentUser.full_name
    ?? `${currentUser.first_name ?? ''} ${currentUser.last_name ?? ''}`.trim()
    ?? currentUser.username ?? '';

  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  const avatarColor = getAvatarColor(displayName);

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-lg border-b border-gray-200/80">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 sm:px-6 h-14">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Volver"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <h1 className="text-sm font-bold text-gray-900">Configuracion</h1>
          <div className="flex-1" />
          <img src="/images/logo-blanco.png" alt="PCC" className="h-7 w-auto object-contain opacity-60 invert" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* ── User card ── */}
        <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-emerald-500/8 blur-2xl" />

          <div className="relative flex flex-col sm:flex-row items-center gap-5">
            <div className={`w-20 h-20 rounded-2xl ${avatarColor} flex items-center justify-center text-white text-2xl font-bold shadow-lg ring-4 ring-white/10 shrink-0`}>
              {initials}
            </div>
            <div className="text-center sm:text-left">
              <h2 className="text-xl sm:text-2xl font-bold text-white">{displayName}</h2>
              <p className="text-sm text-gray-400 mt-0.5">@{currentUser.username}</p>
              <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
                {(currentUser.roles ?? []).map((r, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold ring-1 ${ROLE_COLORS[r.role] ?? 'bg-gray-50 text-gray-600 ring-gray-200'}`}
                  >
                    {r.is_primary && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
                    {ROLE_LABELS[r.role] ?? r.role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
        {TABS.map((tab) => {
          if (tab.adminOnly && !currentUser.is_staff) return null;
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-blue-600' : 'text-gray-400'} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
        </div>

        {/* ── Tab content ── */}
        {activeTab === 'profile'  && <ProfileTab user={currentUser} displayName={displayName} />}
        {activeTab === 'signature' && <SignatureTab user={currentUser} showToast={showToast} />}
        {activeTab === 'security' && <SecurityTab showToast={showToast} />}
        {activeTab === 'roles'    && <RolesTab user={currentUser} primaryRole={primaryRole} />}
        {activeTab === 'integrations' && <OneDriveTab showToast={showToast} />}
      </div>
    </div>
  );
}

// ── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ user, displayName }) {
  const fields = [
    { icon: User,       label: 'Nombre completo', value: displayName },
    { icon: Mail,       label: 'Email',           value: user.email },
    { icon: User,       label: 'Usuario',         value: user.username },
    { icon: Briefcase,  label: 'Cargo',           value: user.position },
    { icon: Building2,  label: 'Departamento',    value: user.department },
  ];

  return (
    <Section icon={User} title="Informacion personal" subtitle="Datos de tu perfil en el sistema">
      <div className="space-y-1">
        {fields.filter(f => f.value).map((f) => (
          <div key={f.label} className="flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-gray-50/80 transition-colors group">
            <div className="w-9 h-9 rounded-lg bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center shrink-0 group-hover:ring-gray-200 transition-colors">
              <f.icon size={15} className="text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-400 font-medium">{f.label}</p>
              <p className="text-sm text-gray-900 font-medium mt-0.5 truncate">{f.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-gray-100">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50/60 ring-1 ring-blue-100">
          <AlertCircle size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 leading-relaxed">
            Para modificar tus datos personales, contacta al administrador del sistema.
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── Signature Tab ────────────────────────────────────────────────────────────

function SignatureTab({ user, showToast }) {
  // Build full media URL pointing to the backend
  const mediaUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `${BACKEND_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  };
  const [sigUrl, setSigUrl] = useState(mediaUrl(user.signature));
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(null); // null | 'draw' | 'upload'
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const fileRef = useRef(null);

  // ── Canvas drawing ──
  const startDraw = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDraw = () => { isDrawing.current = false; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const initCanvas = useCallback((node) => {
    canvasRef.current = node;
    if (!node) return;
    const ctx = node.getContext('2d');
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  // ── Save drawn signature ──
  const saveDrawn = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const res = await uploadSignatureDrawing(dataUrl);
      setSigUrl(mediaUrl(res.data.signature));
      setMode(null);
      showToast({ type: 'success', message: 'Firma guardada correctamente.' });
    } catch {
      showToast({ type: 'error', message: 'No se pudo guardar la firma.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Upload photo ──
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const res = await uploadSignatureFile(file);
      setSigUrl(mediaUrl(res.data.signature));
      setMode(null);
      showToast({ type: 'success', message: 'Firma guardada correctamente.' });
    } catch {
      showToast({ type: 'error', message: 'No se pudo procesar la imagen.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──
  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteSignature();
      setSigUrl('');
      showToast({ type: 'success', message: 'Firma eliminada.' });
    } catch {
      showToast({ type: 'error', message: 'Error al eliminar la firma.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section icon={PenTool} title="Mi firma" subtitle="Se estampa automaticamente en los vales de entrada y salida">
      {/* Current signature preview */}
      {sigUrl && !mode && (
        <div className="space-y-4">
          <div className="p-6 rounded-xl bg-gray-50 ring-1 ring-gray-100 flex flex-col items-center gap-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Firma actual</p>
            <div className="bg-white rounded-xl p-4 ring-1 ring-gray-200 shadow-sm">
              <img src={sigUrl} alt="Firma" className="h-20 w-auto object-contain" />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('draw')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <PenTool size={16} /> Dibujar nueva
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Camera size={16} /> Subir foto
            </button>
            <button
              onClick={handleDelete}
              disabled={saving}
              className="px-4 py-3 rounded-xl border border-red-200 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* No signature yet */}
      {!sigUrl && !mode && (
        <div className="space-y-4">
          <div className="p-8 rounded-xl bg-gray-50 ring-1 ring-gray-100 text-center">
            <PenTool size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">No tienes firma registrada</p>
            <p className="text-xs text-gray-400 mt-1">Agrega tu firma para que aparezca en los documentos.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setMode('draw')}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-600/20"
            >
              <PenTool size={16} /> Dibujar firma
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Camera size={16} /> Tomar foto
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* Draw mode */}
      {mode === 'draw' && (
        <div className="space-y-4">
          <div className="rounded-xl ring-1 ring-gray-200 overflow-hidden bg-white">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500">Dibuja tu firma aqui</p>
              <button onClick={clearCanvas} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Limpiar</button>
            </div>
            <canvas
              ref={initCanvas}
              width={500}
              height={180}
              className="w-full cursor-crosshair touch-none"
              style={{ height: '180px' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setMode(null)}
              className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={saveDrawn}
              disabled={saving}
              className="flex-1 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
            >
              {saving ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Check size={16} /> Guardar firma</>}
            </button>
          </div>
        </div>
      )}

      {/* Upload loading */}
      {saving && mode !== 'draw' && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Loader2 size={20} className="animate-spin text-blue-500" />
          <span className="text-sm text-gray-500">Procesando imagen...</span>
        </div>
      )}

      <div className="mt-5 pt-5 border-t border-gray-100">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50/60 ring-1 ring-blue-100">
          <AlertCircle size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 leading-relaxed">
            Tu firma se estampa automaticamente en los vales PDF que generas. Si subes una foto, el sistema elimina el fondo y limpia la imagen. Puedes usar el celular para tomar una foto de tu firma en papel o dibujarla directamente.
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── Security Tab ─────────────────────────────────────────────────────────────

function SecurityTab({ showToast }) {
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm: '' });
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [errors, setErrors]   = useState({});

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const validate = () => {
    const errs = {};
    if (!form.old_password) errs.old_password = 'Ingresa tu contrasena actual.';
    if (!form.new_password) errs.new_password = 'Ingresa la nueva contrasena.';
    else if (form.new_password.length < 8) errs.new_password = 'Minimo 8 caracteres.';
    if (form.new_password !== form.confirm) errs.confirm = 'Las contrasenas no coinciden.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      await changePassword(form.old_password, form.new_password, form.confirm);
      showToast({ type: 'success', message: 'Contrasena actualizada correctamente.' });
      setForm({ old_password: '', new_password: '', confirm: '' });
    } catch (err) {
      const detail = err.response?.data;
      if (detail?.old_password) {
        setErrors({ old_password: 'Contrasena actual incorrecta.' });
      } else if (detail?.new_password) {
        setErrors({ new_password: Array.isArray(detail.new_password) ? detail.new_password[0] : detail.new_password });
      } else {
        showToast({ type: 'error', message: 'No se pudo cambiar la contrasena.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (field) =>
    `w-full pl-4 pr-12 py-3 text-sm rounded-xl border bg-gray-50/50 ${
      errors[field] ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-blue-500 focus:border-blue-500'
    } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

  return (
    <Section icon={Lock} title="Cambiar contrasena" subtitle="Actualiza tu contrasena de acceso al sistema">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        {/* Old password */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Contrasena actual</label>
          <div className="relative">
            <input
              type={showOld ? 'text' : 'password'}
              value={form.old_password}
              onChange={(e) => set('old_password', e.target.value)}
              className={inputCls('old_password')}
              placeholder="Ingresa tu contrasena actual"
            />
            <button type="button" onClick={() => setShowOld(!showOld)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors">
              {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.old_password && <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.old_password}</p>}
        </div>

        {/* New password */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nueva contrasena</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={form.new_password}
              onChange={(e) => set('new_password', e.target.value)}
              className={inputCls('new_password')}
              placeholder="Minimo 8 caracteres"
            />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors">
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.new_password && <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.new_password}</p>}

          {/* Strength hints */}
          {form.new_password && (
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { ok: form.new_password.length >= 8, text: '8+ caracteres' },
                { ok: /[A-Z]/.test(form.new_password), text: 'Mayuscula' },
                { ok: /[0-9]/.test(form.new_password), text: 'Numero' },
                { ok: /[^A-Za-z0-9]/.test(form.new_password), text: 'Simbolo' },
              ].map((h) => (
                <span key={h.text} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${
                  h.ok ? 'bg-emerald-50 text-emerald-600 ring-emerald-200' : 'bg-gray-50 text-gray-400 ring-gray-200'
                }`}>
                  {h.ok ? <Check size={10} /> : <span className="w-2.5 h-2.5 rounded-full border border-current opacity-40" />}
                  {h.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Confirm */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirmar nueva contrasena</label>
          <input
            type="password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            className={inputCls('confirm')}
            placeholder="Repite la nueva contrasena"
          />
          {errors.confirm && <p className="text-[11px] text-red-500 mt-1 font-medium">{errors.confirm}</p>}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
          >
            {saving ? (
              <><span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" /> Guardando...</>
            ) : (
              <><Lock size={15} /> Cambiar contrasena</>
            )}
          </button>
        </div>
      </form>
    </Section>
  );
}

// ── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab({ user, primaryRole }) {
  const roles = user.roles ?? [];

  return (
    <Section icon={Shield} title="Roles y permisos" subtitle="Roles asignados y alcance de cada uno">
      <div className="space-y-3">
        {roles.map((r, i) => {
          const isPrimary = r.is_primary || r.role === primaryRole;
          const color = ROLE_COLORS[r.role] ?? 'bg-gray-50 text-gray-600 ring-gray-200';

          return (
            <div
              key={i}
              className={`relative rounded-xl p-4 ring-1 transition-colors ${
                isPrimary ? 'bg-blue-50/50 ring-blue-200' : 'bg-gray-50/50 ring-gray-100 hover:ring-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${color}`}>
                    <Shield size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{ROLE_LABELS[r.role] ?? r.role}</p>
                      {isPrimary && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wide">Principal</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                      {r.project_name && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 size={12} className="text-gray-400" />
                          {r.project_name}
                        </span>
                      )}
                      {r.department_name && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 size={12} className="text-gray-400" />
                          {r.department_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {roles.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Shield size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No tienes roles asignados</p>
        </div>
      )}

      <div className="mt-5 pt-5 border-t border-gray-100">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50/60 ring-1 ring-amber-100">
          <AlertCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 leading-relaxed">
            Los roles son asignados por el administrador del sistema. Si necesitas un cambio de rol o permisos adicionales, contacta al area de TI.
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── OneDrive Tab ─────────────────────────────────────────────────────────────

function OneDriveTab({ showToast }) {
  const [status, setStatus] = useState(null);   // { connected, account_name, ... }
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null); // { user_code, verification_uri, device_code }
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  // Fetch connection status
  useEffect(() => {
    getOneDriveStatus()
      .then((res) => setStatus(res.data))
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await oneDriveConnect();
      setDeviceInfo(res.data);
      setPolling(true);

      // Start polling every 5 seconds
      const interval = (res.data.interval || 5) * 1000;
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await oneDrivePoll(res.data.device_code);
          if (pollRes.data.status === 'connected') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPolling(false);
            setDeviceInfo(null);
            setConnecting(false);
            setStatus({ connected: true, account_name: pollRes.data.account_name });
            showToast({ type: 'success', message: 'OneDrive conectado correctamente.' });
          }
          // 'pending' → keep polling
          if (pollRes.data.status === 'failed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPolling(false);
            setDeviceInfo(null);
            setConnecting(false);
            showToast({ type: 'error', message: 'Autorizacion rechazada o expirada.' });
          }
        } catch {
          // ignore transient errors
        }
      }, interval);

      // Auto-stop after 5 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setPolling(false);
          setDeviceInfo(null);
          setConnecting(false);
        }
      }, 300000);

    } catch (err) {
      showToast({ type: 'error', message: 'No se pudo iniciar la conexion.' });
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await oneDriveDisconnect();
      setStatus({ connected: false });
      showToast({ type: 'success', message: 'OneDrive desconectado.' });
    } catch {
      showToast({ type: 'error', message: 'Error al desconectar.' });
    }
  };

  const copyCode = () => {
    if (deviceInfo?.user_code) {
      navigator.clipboard.writeText(deviceInfo.user_code);
      showToast({ type: 'success', message: 'Codigo copiado al portapapeles.' });
    }
  };

  if (loading) {
    return (
      <Section icon={Cloud} title="OneDrive" subtitle="Almacenamiento de documentos en la nube">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-blue-600" />
        </div>
      </Section>
    );
  }

  return (
    <Section icon={Cloud} title="OneDrive" subtitle="Los vales de entrada y salida se guardan automaticamente en OneDrive">
      {status?.connected ? (
        /* ── Connected state ── */
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-5 rounded-xl bg-emerald-50 ring-1 ring-emerald-200">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={24} className="text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-emerald-900">Conectado a OneDrive</p>
              <p className="text-xs text-emerald-700 mt-0.5 truncate">{status.account_name}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 ring-1 ring-gray-100">
            <p className="text-xs text-gray-500 leading-relaxed">
              Los documentos de entrada y salida se guardan automaticamente en la carpeta
              <span className="font-mono font-semibold text-gray-700"> Documentos/SYSPCC-Almacen/</span>
              organizados por mes (ej: 2026-04 Abril).
            </p>
          </div>

          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 ring-1 ring-red-200 transition-colors"
          >
            <CloudOff size={16} /> Desconectar OneDrive
          </button>
        </div>
      ) : deviceInfo ? (
        /* ── Device code entry state ── */
        <div className="space-y-5">
          <div className="text-center p-6 rounded-2xl bg-blue-50 ring-1 ring-blue-200">
            <p className="text-sm text-blue-800 font-medium mb-4">
              Ingresa este codigo en la pagina de Microsoft:
            </p>
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="text-3xl font-mono font-extrabold text-blue-900 tracking-[0.15em] select-all">
                {deviceInfo.user_code}
              </span>
              <button
                onClick={copyCode}
                className="p-2 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors"
                title="Copiar codigo"
              >
                <Copy size={18} />
              </button>
            </div>
            <a
              href={deviceInfo.verification_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-600/20"
            >
              <ExternalLink size={16} /> Abrir microsoft.com/devicelogin
            </a>
          </div>

          {polling && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              Esperando que completes el inicio de sesion...
            </div>
          )}
        </div>
      ) : (
        /* ── Disconnected state ── */
        <div className="space-y-4">
          <div className="flex items-start gap-4 p-5 rounded-xl bg-gray-50 ring-1 ring-gray-100">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              <CloudOff size={24} className="text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">OneDrive no conectado</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Conecta tu cuenta de OneDrive para guardar automaticamente los vales de entrada y salida como PDF organizados por mes.
              </p>
            </div>
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-blue-600/20"
          >
            {connecting ? (
              <><Loader2 size={16} className="animate-spin" /> Conectando...</>
            ) : (
              <><Cloud size={16} /> Conectar OneDrive</>
            )}
          </button>
        </div>
      )}
    </Section>
  );
}
