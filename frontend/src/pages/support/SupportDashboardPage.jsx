import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Ticket,
  Clock,
  CheckCircle,
  Layers,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getMyStats, getTickets } from '../../api/support';
import SummaryCard from '../../components/ui/SummaryCard';
import { TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG, TICKET_CATEGORY_CONFIG } from '../../data/supportConstants';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const cfg = TICKET_STATUS_CONFIG[status] ?? { label: status, color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = TICKET_PRIORITY_CONFIG[priority] ?? { label: priority, color: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function CategoryBadge({ category }) {
  const cfg = TICKET_CATEGORY_CONFIG[category] ?? { label: category };
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
      {cfg.label}
    </span>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-500" />
    </div>
  );
}

export default function SupportDashboardPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]     = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const firstName = currentUser?.first_name
    ?? currentUser?.full_name?.split(' ')[0]
    ?? currentUser?.username
    ?? 'Usuario';

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [statsRes, ticketsRes] = await Promise.all([
          getMyStats(),
          getTickets({ page_size: 5, ordering: '-created_at' }),
        ]);
        setStats(statsRes.data);
        setTickets(ticketsRes.data?.results ?? []);
      } catch (err) {
        console.error('Error fetching support dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  return (
    <div className="space-y-7">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-teal-600 uppercase tracking-widest mb-1 font-display">
            Soporte TI
          </p>
          <h1 className="text-2xl font-extrabold text-gray-900 font-display leading-tight">
            Hola, {firstName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Aqui puedes ver el estado de tus tickets de soporte.
          </p>
        </div>
        <button
          onClick={() => navigate('/soporte')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white text-sm font-bold shadow-sm hover:from-teal-600 hover:to-teal-700 active:scale-[0.97] transition-all duration-150 w-full sm:w-auto justify-center"
        >
          <Plus size={17} strokeWidth={2.5} />
          Crear Ticket
        </button>
      </div>

      {/* ── Summary cards ── */}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              title="Abiertos"
              value={stats?.open ?? 0}
              icon={AlertCircle}
              color="blue"
              onClick={() => navigate('/soporte/tickets?status=OPEN')}
            />
            <SummaryCard
              title="En Proceso"
              value={stats?.in_progress ?? 0}
              icon={Clock}
              color="amber"
              onClick={() => navigate('/soporte/tickets?status=IN_PROGRESS')}
            />
            <SummaryCard
              title="Resueltos"
              value={stats?.resolved ?? 0}
              icon={CheckCircle}
              color="green"
              onClick={() => navigate('/soporte/tickets?status=RESOLVED')}
            />
            <SummaryCard
              title="Total"
              value={stats?.total ?? 0}
              icon={Layers}
              color="teal"
              onClick={() => navigate('/soporte/tickets')}
            />
          </div>

          {/* ── Recent tickets ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <Ticket size={18} className="text-teal-500" strokeWidth={2} />
                <h2 className="text-base font-extrabold text-gray-900 font-display">Tickets Recientes</h2>
              </div>
              <button
                onClick={() => navigate('/soporte/tickets')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors"
              >
                Ver todos
                <ChevronRight size={14} />
              </button>
            </div>

            {tickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center mb-4">
                  <Ticket size={26} className="text-teal-400" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-gray-600 font-display">No tienes tickets aun</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  Crea tu primer ticket para reportar un problema tecnico o solicitar soporte.
                </p>
                <button
                  onClick={() => navigate('/soporte')}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-50 text-teal-700 text-xs font-bold hover:bg-teal-100 transition-colors"
                >
                  <Plus size={14} />
                  Crear Ticket
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/70 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">N° Ticket</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Titulo</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden md:table-cell">Categoria</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden md:table-cell">Prioridad</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display">Estado</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider font-display hidden sm:table-cell">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tickets.map((ticket) => (
                      <tr
                        key={ticket.id}
                        onClick={() => navigate(`/soporte/tickets/${ticket.id}`)}
                        className="hover:bg-teal-50/30 cursor-pointer transition-colors duration-100 group"
                      >
                        <td className="px-5 py-3.5">
                          <span className="text-xs font-bold text-teal-600 font-display group-hover:text-teal-700">
                            #{ticket.ticket_number ?? ticket.id}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 max-w-[200px]">
                          <span className="text-sm font-semibold text-gray-800 truncate block font-display">
                            {ticket.title}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell">
                          <CategoryBadge category={ticket.category} />
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell">
                          <PriorityBadge priority={ticket.priority} />
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={ticket.status} />
                        </td>
                        <td className="px-5 py-3.5 hidden sm:table-cell">
                          <span className="text-xs text-gray-400">{formatDate(ticket.created_at)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
