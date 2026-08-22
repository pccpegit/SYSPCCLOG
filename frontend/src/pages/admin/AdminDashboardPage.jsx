import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plane,
  Clock,
  DollarSign,
  Building2,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { getPasajes, getProveedores } from '../../api/administracion';
import { fmtNum } from '../../utils/format';

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color, loading, prefix }) {
  const colorMap = {
    indigo: { bg: 'bg-indigo-50 dark:bg-indigo-500/10', icon: 'text-indigo-600 dark:text-indigo-400', ring: 'ring-indigo-100 dark:ring-indigo-500/30' },
    amber:  { bg: 'bg-amber-50 dark:bg-amber-500/10',  icon: 'text-amber-600 dark:text-amber-400',  ring: 'ring-amber-100 dark:ring-amber-500/30'  },
    blue:   { bg: 'bg-blue-50 dark:bg-blue-500/10',   icon: 'text-blue-600 dark:text-blue-400',   ring: 'ring-blue-100 dark:ring-blue-500/30'   },
    slate:  { bg: 'bg-slate-50',  icon: 'text-slate-600',  ring: 'ring-slate-100'  },
  };
  const c = colorMap[color] ?? colorMap.indigo;

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-100 hover:border-gray-200 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${c.bg} ring-1 ${c.ring} flex items-center justify-center`}>
          <Icon size={20} className={c.icon} strokeWidth={1.8} />
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-20 bg-gray-100 animate-pulse rounded-lg" />
          <div className="h-4 w-28 bg-gray-50 animate-pulse rounded" />
        </div>
      ) : (
        <>
          <p className="text-3xl font-bold text-gray-900 tracking-tight">
            {prefix && <span className="text-xl text-gray-400 mr-1">{prefix}</span>}
            {fmtNum(value ?? 0)}
          </p>
          <p className="text-[13px] text-gray-500 mt-1">{label}</p>
        </>
      )}
    </div>
  );
}

// ── Quick Action ──────────────────────────────────────────────────────────────

function QuickAction({ label, description, icon: Icon, color, onClick }) {
  const colorMap = {
    indigo: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20',
    blue:   'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20',
    gray:   'bg-white hover:bg-gray-50 shadow-none border border-gray-200 !text-gray-700 !shadow-sm',
  };

  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-4 px-5 py-4 rounded-2xl text-white text-left transition-all duration-200 shadow-lg ${colorMap[color]}`}
    >
      <div className={`w-10 h-10 rounded-xl ${color === 'gray' ? 'bg-gray-100' : 'bg-white/15'} flex items-center justify-center shrink-0`}>
        <Icon size={20} className={color === 'gray' ? 'text-gray-500' : 'text-white'} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${color === 'gray' ? 'text-gray-800' : ''}`}>{label}</p>
        <p className={`text-xs mt-0.5 ${color === 'gray' ? 'text-gray-400' : 'text-white/60'}`}>{description}</p>
      </div>
      <ChevronRight size={16} className={`ml-auto shrink-0 opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all ${color === 'gray' ? 'text-gray-400' : ''}`} />
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const navigate = useNavigate();

  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const now = new Date();
        // El backend filtra `mes` por el nombre del mes en español (ej. "Julio"),
        // que es como el modelo Pasaje lo almacena a partir de la fecha.
        const MESES = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ];
        const mes = MESES[now.getMonth()];

        const [pasajesRes, provRes] = await Promise.all([
          getPasajes({ mes, page_size: 1000 }),
          getProveedores(),
        ]);

        if (cancelled) return;

        const pasajesData = pasajesRes.data?.results ?? pasajesRes.data ?? [];
        const provData    = provRes.data?.results    ?? provRes.data    ?? [];

        const total        = Array.isArray(pasajesData) ? pasajesData.length : 0;
        const pendientes   = Array.isArray(pasajesData) ? pasajesData.filter((p) => p.estado === 'PENDIENTE').length : 0;
        const totalPagado  = Array.isArray(pasajesData)
          ? pasajesData.filter((p) => p.estado === 'PAGADO').reduce((acc, p) => acc + Number(p.total_soles ?? 0), 0)
          : 0;
        const provActivos  = Array.isArray(provData) ? provData.length : 0;

        setStats({ total, pendientes, totalPagado, provActivos });
      } catch {
        if (!cancelled) setError('No se pudieron cargar los datos del dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">

      {/* ── Page header ──────────────────────────────────────── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          Resumen de pasajes y pagos del mes en curso.
        </p>
      </div>

      {/* ── Error banner ────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Total pasajes (mes)"
          value={stats?.total}
          icon={Plane}
          color="indigo"
          loading={loading}
        />
        <KpiCard
          label="Pendientes de pago"
          value={stats?.pendientes}
          icon={Clock}
          color="amber"
          loading={loading}
        />
        <KpiCard
          label="Total pagado (S/)"
          value={stats?.totalPagado}
          icon={DollarSign}
          color="blue"
          loading={loading}
          prefix="S/"
        />
        <KpiCard
          label="Proveedores activos"
          value={stats?.provActivos}
          icon={Building2}
          color="slate"
          loading={loading}
        />
      </div>

      {/* ── Quick actions ───────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
          Acciones rapidas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickAction
            label="Registrar Pasaje"
            description="Nuevo pasaje de personal"
            icon={Plane}
            color="indigo"
            onClick={() => navigate('/admin/pasajes')}
          />
          <QuickAction
            label="Gestionar Pagos"
            description="Marcar pasajes como pagados"
            icon={DollarSign}
            color="blue"
            onClick={() => navigate('/admin/pagos')}
          />
          <QuickAction
            label="Ver Proveedores"
            description="Administrar proveedores"
            icon={Building2}
            color="gray"
            onClick={() => navigate('/admin/proveedores')}
          />
        </div>
      </div>
    </div>
  );
}
