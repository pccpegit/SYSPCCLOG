import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  User,
  MessageSquare,
  RefreshCw,
  Calendar,
  Tag,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { getTicket, addComment } from '../../api/support';
import { useToast } from '../../context/ToastContext';
import {
  TICKET_STATUS_CONFIG,
  TICKET_PRIORITY_CONFIG,
  TICKET_CATEGORY_CONFIG,
} from '../../data/supportConstants';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const cfg = TICKET_STATUS_CONFIG[status] ?? { label: status, color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${cfg.color}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = TICKET_PRIORITY_CONFIG[priority] ?? { label: priority, color: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${cfg.color}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function CategoryBadge({ category }) {
  const cfg = TICKET_CATEGORY_CONFIG[category] ?? { label: category };
  return (
    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
      {cfg.label}
    </span>
  );
}

function AvatarInitials({ name, size = 'sm' }) {
  const initials = (name ?? 'U')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || 'U';

  const sizeMap = {
    sm: 'w-8 h-8 text-[11px]',
    md: 'w-10 h-10 text-sm',
  };

  return (
    <div className={`${sizeMap[size]} rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white font-bold shrink-0`}>
      {initials}
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
        <Icon size={14} className="text-gray-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        <div className="mt-0.5 text-sm font-semibold text-gray-800">{children}</div>
      </div>
    </div>
  );
}

function CommentBubble({ comment }) {
  const authorName = comment.author?.full_name ?? comment.author?.username ?? 'Usuario';

  if (comment.is_status_change) {
    const fromCfg = TICKET_STATUS_CONFIG[comment.old_status] ?? { label: comment.old_status_display ?? comment.old_status ?? '—', dot: 'bg-gray-400' };
    const toCfg   = TICKET_STATUS_CONFIG[comment.new_status] ?? { label: comment.new_status_display ?? comment.new_status ?? '—', dot: 'bg-teal-400' };

    return (
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
          <RefreshCw size={14} className="text-gray-400" />
        </div>
        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-none px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="font-semibold">{authorName}</span>
            <span>cambio el estado de</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
              <span className={`w-1.5 h-1.5 rounded-full ${fromCfg.dot}`} />
              {fromCfg.label}
            </span>
            <span>a</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700">
              <span className={`w-1.5 h-1.5 rounded-full ${toCfg.dot}`} />
              {toCfg.label}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">{formatDateTime(comment.created_at)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <AvatarInitials name={authorName} />
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-tl-none px-4 py-3">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xs font-bold text-gray-800">{authorName}</span>
            <span className="text-[10px] text-gray-400">{formatDateTime(comment.created_at)}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{comment.content}</p>
        </div>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-500" />
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const commentsEndRef = useRef(null);

  const [ticket,    setTicket]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [comment,   setComment]   = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canAddComment = ticket && (ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS');

  async function fetchTicket() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getTicket(id);
      setTicket(data);
    } catch (err) {
      const msg = err.response?.data?.detail ?? 'No se pudo cargar el ticket.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTicket();
  }, [id]);

  async function handleAddComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;

    setSubmitting(true);
    try {
      await addComment(id, { content: comment.trim() });
      showToast({ type: 'success', message: 'Comentario agregado' });
      setComment('');
      await fetchTicket();
      setTimeout(() => {
        commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 200);
    } catch (err) {
      const msg = err.response?.data?.detail ?? 'No se pudo agregar el comentario.';
      showToast({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <p className="text-sm font-semibold text-gray-700 font-display">{error ?? 'Ticket no encontrado'}</p>
          <button
            onClick={() => navigate('/soporte/tickets')}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft size={15} />
            Volver a mis tickets
          </button>
        </div>
      </div>
    );
  }

  const comments = [...(ticket.comments ?? [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at),
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* ── Page header ── */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/soporte/tickets')}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors mt-0.5"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-bold text-teal-600 font-display">
              #{ticket.ticket_number ?? ticket.id}
            </span>
            <StatusBadge status={ticket.status} />
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 font-display leading-snug">
            {ticket.title}
          </h1>
        </div>
      </div>

      {/* ── Info card ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
          <Info size={15} className="text-teal-500" />
          <h2 className="text-sm font-bold text-gray-700 font-display">Informacion del ticket</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Description */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Descripcion</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow icon={Tag} label="Categoria">
              <CategoryBadge category={ticket.category} />
            </InfoRow>
            <InfoRow icon={AlertTriangle} label="Prioridad">
              <PriorityBadge priority={ticket.priority} />
            </InfoRow>
            <InfoRow icon={User} label="Creado por">
              <span className="text-sm text-gray-800">
                {ticket.created_by?.full_name ?? ticket.created_by?.username ?? '—'}
              </span>
            </InfoRow>
            <InfoRow icon={Calendar} label="Fecha de creacion">
              <span className="text-sm text-gray-800">{formatDate(ticket.created_at)}</span>
            </InfoRow>
            {ticket.assigned_to ? (
              <InfoRow icon={User} label="Asignado a">
                <span className="text-sm text-gray-800">
                  {ticket.assigned_to?.full_name ?? ticket.assigned_to?.username}
                </span>
              </InfoRow>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Timeline / Comments ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
          <MessageSquare size={15} className="text-teal-500" />
          <h2 className="text-sm font-bold text-gray-700 font-display">
            Actividad
            {comments.length > 0 && (
              <span className="ml-1.5 text-xs font-bold text-gray-400">({comments.length})</span>
            )}
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {comments.length === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={18} className="text-gray-300" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-gray-400">No hay comentarios aun.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((c) => (
                <CommentBubble key={c.id} comment={c} />
              ))}
              <div ref={commentsEndRef} />
            </div>
          )}

          {/* ── Comment form ── */}
          {canAddComment && (
            <>
              <div className="h-px bg-gray-100 mt-2" />
              <form onSubmit={handleAddComment} className="flex items-start gap-3 pt-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-[11px] font-bold shrink-0 mt-0.5">
                  <User size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Agrega un comentario o informacion adicional..."
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 transition-colors resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      type="submit"
                      disabled={submitting || !comment.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white text-sm font-bold shadow-sm hover:from-teal-600 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] transition-all duration-150"
                    >
                      {submitting ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                      ) : (
                        <Send size={14} />
                      )}
                      Comentar
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}

          {!canAddComment && ticket && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 mt-2">
              <Info size={13} className="text-gray-400 shrink-0" />
              Este ticket esta {TICKET_STATUS_CONFIG[ticket.status]?.label?.toLowerCase() ?? 'cerrado'} y ya no acepta nuevos comentarios.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
