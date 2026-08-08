import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  AlertCircle,
  Monitor,
  Code,
  Wifi,
  KeyRound,
  Mail,
  Printer,
  HelpCircle,
  CheckCircle,
  Sparkles,
  ArrowRight,
  Lightbulb,
} from 'lucide-react';
import { createTicket } from '../../api/support';
import { useToast } from '../../context/ToastContext';

const CATEGORIES = [
  { key: 'HARDWARE', label: 'Hardware',            sub: 'PC, monitor, teclado, mouse', icon: Monitor,    color: 'blue' },
  { key: 'SOFTWARE', label: 'Software',            sub: 'Programas, apps, sistema',     icon: Code,       color: 'violet' },
  { key: 'NETWORK',  label: 'Red / Internet',      sub: 'WiFi, VPN, conexion lenta',    icon: Wifi,       color: 'orange' },
  { key: 'ACCESS',   label: 'Accesos',             sub: 'Permisos, contrasenas, cuentas', icon: KeyRound, color: 'rose' },
  { key: 'EMAIL',    label: 'Correo',              sub: 'Outlook, envio, recepcion',    icon: Mail,       color: 'sky' },
  { key: 'PRINTER',  label: 'Impresora',           sub: 'Escaner, impresion, toner',    icon: Printer,    color: 'amber' },
  { key: 'OTHER',    label: 'Otro',                sub: 'Algo diferente',               icon: HelpCircle, color: 'slate' },
];

const CAT_COLORS = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   ring: 'ring-blue-400',   iconBg: 'bg-blue-500',   text: 'text-blue-700' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', ring: 'ring-violet-400', iconBg: 'bg-violet-500', text: 'text-violet-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', ring: 'ring-orange-400', iconBg: 'bg-orange-500', text: 'text-orange-700' },
  rose:   { bg: 'bg-rose-50',   border: 'border-rose-200',   ring: 'ring-rose-400',   iconBg: 'bg-rose-500',   text: 'text-rose-700' },
  sky:    { bg: 'bg-sky-50',    border: 'border-sky-200',    ring: 'ring-sky-400',    iconBg: 'bg-sky-500',    text: 'text-sky-700' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-200',  ring: 'ring-amber-400',  iconBg: 'bg-amber-500',  text: 'text-amber-700' },
  slate:  { bg: 'bg-slate-50',  border: 'border-slate-200',  ring: 'ring-slate-400',  iconBg: 'bg-slate-500',  text: 'text-slate-700' },
};

function StepNumber({ n, done }) {
  if (done) {
    return (
      <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-teal-500/30">
        <CheckCircle size={16} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shrink-0 shadow-sm shadow-teal-500/20">
      <span className="text-white text-xs font-extrabold">{n}</span>
    </div>
  );
}

export default function TicketCreatePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [form, setForm] = useState({ title: '', category: '', description: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  const step1Done = !!form.category;
  const step2Done = form.title.trim().length >= 5;
  const step3Done = form.description.trim().length >= 10;

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  }

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Ponle un titulo a tu ticket.';
    if (!form.category) errs.category = 'Selecciona que tipo de problema es.';
    if (!form.description.trim()) errs.description = 'Cuentanos que paso.';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await createTicket({
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim(),
      });
      setSuccess(data);
      showToast({ type: 'success', message: 'Ticket creado exitosamente' });
    } catch (err) {
      const msg =
        err.response?.data?.detail ??
        err.response?.data?.message ??
        'Ocurrio un error al crear el ticket.';
      showToast({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto pt-8">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden text-center">
          <div className="bg-gradient-to-br from-teal-500 to-emerald-600 px-8 pt-10 pb-8">
            <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-4 ring-4 ring-white/10">
              <CheckCircle size={40} className="text-white" strokeWidth={1.8} />
            </div>
            <h2 className="text-2xl font-extrabold text-white font-display">Ticket Creado</h2>
            <p className="text-teal-100 text-sm mt-1">Tu solicitud ha sido registrada</p>
          </div>

          <div className="px-8 py-8 space-y-5">
            <div className="bg-teal-50 rounded-2xl px-5 py-4 border border-teal-100">
              <p className="text-[10px] font-bold text-teal-500 uppercase tracking-widest mb-1">Numero de ticket</p>
              <p className="text-2xl font-extrabold text-teal-700 font-display tracking-wide">
                {success.ticket_number}
              </p>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed">
              Nuestro equipo de TI revisara tu solicitud. Puedes darle seguimiento desde <strong className="text-gray-700">Mis Tickets</strong>.
            </p>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                onClick={() => navigate(`/soporte/tickets/${success.id}`)}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white text-sm font-bold shadow-md shadow-teal-500/20 hover:from-teal-600 hover:to-teal-700 active:scale-[0.97] transition-all duration-150"
              >
                Ver mi ticket
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => {
                  setSuccess(null);
                  setForm({ title: '', category: '', description: '' });
                }}
                className="w-full px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Crear otro ticket
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="text-center sm:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 mb-3">
          <Sparkles size={13} className="text-teal-500" />
          <span className="text-[11px] font-bold text-teal-600 uppercase tracking-wider font-display">Soporte TI</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-display leading-tight">
          Necesitas ayuda?
        </h1>
        <p className="text-sm text-gray-400 mt-1.5">
          3 pasos rapidos y nuestro equipo se encarga del resto.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-6">

        {/* ── STEP 1: Category ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <StepNumber n={1} done={step1Done} />
            <div>
              <h2 className="text-sm font-extrabold text-gray-800 font-display">Que tipo de problema es?</h2>
              <p className="text-xs text-gray-400">Selecciona la categoria que mejor describa tu situacion.</p>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {CATEGORIES.map((cat) => {
                const c = CAT_COLORS[cat.color];
                const selected = form.category === cat.key;
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, category: cat.key }));
                      if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
                    }}
                    className={[
                      'relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 text-center',
                      'transition-all duration-200 cursor-pointer group',
                      'hover:shadow-md hover:-translate-y-0.5',
                      'active:scale-[0.96]',
                      selected
                        ? `${c.bg} ${c.border} ring-2 ${c.ring} shadow-sm`
                        : 'bg-white border-gray-100 hover:border-gray-200',
                    ].join(' ')}
                  >
                    <div className={[
                      'w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200',
                      selected
                        ? `${c.iconBg} shadow-sm`
                        : 'bg-gray-100 group-hover:bg-gray-200',
                    ].join(' ')}>
                      <Icon
                        size={20}
                        className={selected ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}
                        strokeWidth={selected ? 2.2 : 1.6}
                      />
                    </div>
                    <div>
                      <p className={[
                        'text-xs font-bold font-display leading-tight',
                        selected ? c.text : 'text-gray-700',
                      ].join(' ')}>
                        {cat.label}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight hidden sm:block">
                        {cat.sub}
                      </p>
                    </div>
                    {selected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle size={14} className={c.text} strokeWidth={2.5} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {errors.category && (
              <p className="flex items-center gap-1.5 mt-3 text-xs text-red-600 font-medium">
                <AlertCircle size={13} />
                {errors.category}
              </p>
            )}
          </div>
        </div>

        {/* ── STEP 2: Title ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <StepNumber n={2} done={step2Done} />
            <div>
              <h2 className="text-sm font-extrabold text-gray-800 font-display">Resumelo en una frase</h2>
              <p className="text-xs text-gray-400">Un titulo corto que describa el problema.</p>
            </div>
          </div>

          <div className="p-5">
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleChange}
              maxLength={200}
              placeholder='Ej: "No puedo conectarme al WiFi de oficina"'
              autoComplete="off"
              className={[
                'w-full px-5 py-3.5 rounded-xl border-2 bg-white',
                'text-[15px] text-gray-800 placeholder-gray-300 font-medium',
                'focus:outline-none transition-all duration-200',
                errors.title
                  ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/15'
                  : form.title.trim()
                    ? 'border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15'
                    : 'border-gray-150 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15',
              ].join(' ')}
            />
            <div className="flex items-center justify-between mt-2">
              {errors.title ? (
                <p className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                  <AlertCircle size={13} />
                  {errors.title}
                </p>
              ) : (
                <span />
              )}
              <span className={`text-[11px] font-medium ${form.title.length > 150 ? 'text-orange-500' : 'text-gray-300'}`}>
                {form.title.length}/200
              </span>
            </div>
          </div>
        </div>

        {/* ── STEP 3: Description ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <StepNumber n={3} done={step3Done} />
            <div>
              <h2 className="text-sm font-extrabold text-gray-800 font-display">Cuentanos que paso</h2>
              <p className="text-xs text-gray-400">Mientras mas detalle, mas rapido lo resolvemos.</p>
            </div>
          </div>

          <div className="p-5">
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={5}
              placeholder="Describe el problema: que estabas haciendo, que paso, que mensaje de error viste..."
              className={[
                'w-full px-5 py-3.5 rounded-xl border-2 bg-white',
                'text-sm text-gray-800 placeholder-gray-300',
                'focus:outline-none transition-all duration-200 resize-none leading-relaxed',
                errors.description
                  ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/15'
                  : form.description.trim()
                    ? 'border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15'
                    : 'border-gray-150 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15',
              ].join(' ')}
            />
            {errors.description && (
              <p className="flex items-center gap-1.5 mt-2 text-xs text-red-600 font-medium">
                <AlertCircle size={13} />
                {errors.description}
              </p>
            )}

            <div className="flex items-start gap-2 mt-3 px-1">
              <Lightbulb size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-500">Tip:</span> Incluye capturas de pantalla si puedes, o menciona el mensaje de error exacto.
              </p>
            </div>
          </div>
        </div>

        {/* ── Submit ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 hidden sm:block">
              <div className="flex items-center gap-3">
                {[step1Done, step2Done, step3Done].map((done, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`w-8 h-1.5 rounded-full transition-colors duration-300 ${done ? 'bg-teal-400' : 'bg-gray-150'}`} />
                  </div>
                ))}
                <span className="text-[11px] font-semibold text-gray-400 ml-1">
                  {[step1Done, step2Done, step3Done].filter(Boolean).length}/3 completados
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={[
                'w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl',
                'text-sm font-bold shadow-lg transition-all duration-200',
                'active:scale-[0.96]',
                step1Done && step2Done && step3Done
                  ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-teal-500/25 hover:shadow-teal-500/40 hover:from-teal-600 hover:to-emerald-600'
                  : 'bg-gradient-to-r from-gray-300 to-gray-400 text-white shadow-gray-300/20',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              {submitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send size={16} strokeWidth={2.2} />
                  Enviar Ticket
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
