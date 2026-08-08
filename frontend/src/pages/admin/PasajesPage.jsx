import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plane,
  Search,
  ChevronDown,
  ChevronUp,
  Download,
  AlertTriangle,
  X,
  Plus,
  User,
  Calendar,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  getPasajes,
  createPasaje,
  getPasajesPorDni,
  buscarRuc,
  getPoliticas,
  getPuestos,
  calcularDevolucion,
  exportPasajesUrl,
  buscarPersonalPorDni,
  getTipoCambio,
} from '../../api/administracion';
import client from '../../api/client';
import { useToast } from '../../context/ToastContext';
import NumberInput from '../../components/ui/NumberInput';
import { fmtNum } from '../../utils/format';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPO_PASAJE_OPTIONS = [
  { value: 'B',   label: 'Bajada'        },
  { value: 'S',   label: 'Subida'        },
  { value: 'S/B', label: 'Subida/Bajada' },
];

const TIPO_TRABAJADOR_OPTIONS = [
  { value: 'WORKER', label: 'Trabajador' },
  { value: 'STAFF',  label: 'Staff'      },
];

const MONEDA_OPTIONS = [
  { value: 'SOLES',   label: 'Soles (S/)' },
  { value: 'DOLARES', label: 'Dólares ($)' },
];

const TIPO_PASAJE_FILTER = [
  { value: '',    label: 'Todos'          },
  { value: 'B',   label: 'Bajada'        },
  { value: 'S',   label: 'Subida'        },
  { value: 'S/B', label: 'Subida/Bajada' },
];

const ESTADO_OPTIONS = [
  { value: '',          label: 'Todos'     },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'PAGADO',    label: 'Pagado'    },
];

const MESES = [
  { value: '', label: 'Todos los meses' },
  { value: 'Enero', label: 'Enero' },
  { value: 'Febrero', label: 'Febrero' },
  { value: 'Marzo', label: 'Marzo' },
  { value: 'Abril', label: 'Abril' },
  { value: 'Mayo', label: 'Mayo' },
  { value: 'Junio', label: 'Junio' },
  { value: 'Julio', label: 'Julio' },
  { value: 'Agosto', label: 'Agosto' },
  { value: 'Septiembre', label: 'Setiembre' },
  { value: 'Octubre', label: 'Octubre' },
  { value: 'Noviembre', label: 'Noviembre' },
  { value: 'Diciembre', label: 'Diciembre' },
];

const EMPTY_FORM = {
  dni: '',
  nombres: '',
  cargo: '',
  tipo: 'B',
  fecha_bajada: '',
  embarque_bajada: '',
  destino_bajada: '',
  fecha_subida: '',
  embarque_subida: '',
  destino_subida: '',
  centro_costo: '',
  tipo_trabajador: 'WORKER',
  ruc: '',
  razon_social: '',
  factura_ticket: '',
  fecha: '',
  moneda: 'SOLES',
  monto_con_igv_soles: '',
  monto_con_igv_dolares: '',
  tipo_cambio: '',
  politica_id: '',
  detalle: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = (hasError, disabled) =>
  `w-full px-3.5 py-2.5 text-sm rounded-xl border ${
    disabled ? 'bg-gray-100 text-gray-600' : 'bg-gray-50/50'
  } ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors`;

function Field({ label, required, id, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-red-500 mt-1 font-medium">{error}</p>}
    </div>
  );
}

function RadioGroup({ options, value, onChange, name }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all select-none ${
            value === opt.value
              ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200'
              : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function EstadoBadge({ estado }) {
  if (estado === 'PAGADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-green-50 text-green-700 ring-1 ring-green-100">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Pagado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-100">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Pendiente
    </span>
  );
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PasajesPage() {
  const { showToast } = useToast();

  // Form state
  const [form, setForm]         = useState(EMPTY_FORM);
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [formOpen, setFormOpen] = useState(true);

  // DNI validation state
  const [dniSearching, setDniSearching]     = useState(false);
  const [dniValidated, setDniValidated]     = useState(false);
  const [dniHistory, setDniHistory]         = useState([]);

  // RUC validation state
  const [rucSearching, setRucSearching]     = useState(false);
  const [rucValidated, setRucValidated]     = useState(false);

  // Tipo de cambio state
  const [tipoCambioSunat, setTipoCambioSunat] = useState(null);
  const [tcLoading, setTcLoading]             = useState(false);

  // Lookups
  const [politicas, setPoliticas] = useState([]);
  const [projects, setProjects]   = useState([]);
  const [puestos, setPuestos]     = useState([]);

  // Table state
  const [pasajes, setPasajes]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tableError, setTableError] = useState('');
  const [page, setPage]             = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [search,       setSearch]       = useState('');
  const [filterTipo,   setFilterTipo]   = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [filterMes,    setFilterMes]    = useState('');

  // Refs for auto-trigger
  const dniTimerRef = useRef(null);
  const rucTimerRef = useRef(null);

  // Load lookups on mount
  useEffect(() => {
    getPoliticas({ page_size: 500 })
      .then((res) => {
        const data = res.data?.results ?? res.data ?? [];
        setPoliticas(Array.isArray(data) ? data : []);
      })
      .catch(() => {});

    client.get('/projects/', { params: { is_active: true, page_size: 200 } })
      .then((res) => {
        const data = res.data?.results ?? res.data ?? [];
        setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => {});

    getPuestos()
      .then((res) => {
        const data = res.data?.results ?? res.data ?? [];
        setPuestos(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  // Computed: tramos filtered by tipo_trabajador
  const tramosDisponibles = useMemo(
    () => politicas.filter(
      (p) => p.habilitado && (!form.tipo_trabajador || p.tipo_trabajador === form.tipo_trabajador)
    ),
    [politicas, form.tipo_trabajador],
  );

  const selectedPolitica = useMemo(
    () => politicas.find((p) => String(p.id) === String(form.politica_id)),
    [politicas, form.politica_id],
  );

  const devolucion = useMemo(() => {
    if (!selectedPolitica) return 0;
    if (selectedPolitica.no_devolucion) return 0;
    if (form.moneda === 'DOLARES') {
      return Number(selectedPolitica.monto_dolares ?? 0);
    }
    return Number(selectedPolitica.monto_soles ?? 0);
  }, [selectedPolitica, form.moneda]);

  const montoBase = useMemo(() => {
    if (form.moneda === 'DOLARES') {
      const usd = Number(form.monto_con_igv_dolares) || 0;
      const tc  = Number(form.tipo_cambio) || 1;
      return usd * tc;
    }
    return Number(form.monto_con_igv_soles) || 0;
  }, [form.moneda, form.monto_con_igv_soles, form.monto_con_igv_dolares, form.tipo_cambio]);

  const total = useMemo(() => Math.max(0, montoBase - devolucion), [montoBase, devolucion]);

  // Fetch table
  const fetchPasajes = useCallback(async () => {
    setLoading(true);
    setTableError('');
    try {
      const params = { page, page_size: 25 };
      if (search)       params.search = search;
      if (filterTipo)   params.tipo   = filterTipo;
      if (filterEstado) params.estado = filterEstado;
      if (filterMes)    params.mes    = filterMes;
      const res = await getPasajes(params);
      const data  = res.data?.results ?? res.data ?? [];
      const count = res.data?.count   ?? (Array.isArray(data) ? data.length : 0);
      setPasajes(Array.isArray(data) ? data : []);
      setTotalCount(count);
    } catch {
      setTableError('No se pudieron cargar los pasajes.');
    } finally {
      setLoading(false);
    }
  }, [page, search, filterTipo, filterEstado, filterMes]);

  useEffect(() => { setPage(1); }, [search, filterTipo, filterEstado, filterMes]);

  useEffect(() => {
    const timer = setTimeout(() => fetchPasajes(), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchPasajes, search]);

  // Helpers
  const setF = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // ── DNI auto-validation ──────────────────────────────────────────────────
  const handleDniChange = (value) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 8);
    setF('dni', cleaned);

    // Reset validation when DNI changes
    if (dniValidated) {
      setDniValidated(false);
      setDniHistory([]);
    }

    // Auto-trigger when 8 digits
    if (dniTimerRef.current) clearTimeout(dniTimerRef.current);
    if (cleaned.length === 8) {
      dniTimerRef.current = setTimeout(() => validateDni(cleaned), 300);
    }
  };

  const validateDni = async (dni) => {
    if (!dni || dni.length < 8) return;
    setDniSearching(true);
    setDniValidated(false);
    try {
      // 1) Query Personal table
      try {
        const personalRes = await buscarPersonalPorDni(dni);
        const persona = personalRes.data;
        if (persona) {
          setForm((prev) => ({
            ...prev,
            nombres: persona.apellidos_nombres ?? '',
            cargo: persona.puesto ?? '',
            centro_costo: persona.proyecto ? String(persona.proyecto) : prev.centro_costo,
          }));
          setDniValidated(true);
          showToast({ type: 'success', message: 'Personal encontrado.' });
        }
      } catch {
        showToast({ type: 'warning', message: 'DNI no encontrado en base de datos.' });
      }

      // 2) Load pasaje history
      const res = await getPasajesPorDni(dni);
      const data = res.data?.results ?? res.data ?? [];
      setDniHistory(Array.isArray(data) ? data : []);

      // If Personal didn't fill, try from last pasaje
      setForm((prev) => {
        if (!prev.nombres && Array.isArray(data) && data.length > 0) {
          const last = data[0];
          return {
            ...prev,
            nombres: last.nombres ?? '',
            cargo: last.cargo ?? '',
          };
        }
        return prev;
      });
    } catch {
      showToast({ type: 'error', message: 'Error al buscar DNI.' });
    } finally {
      setDniSearching(false);
    }
  };

  // ── RUC auto-validation ──────────────────────────────────────────────────
  const handleRucChange = (value) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 11);
    setF('ruc', cleaned);

    // Reset validation when RUC changes
    if (rucValidated) {
      setRucValidated(false);
      setF('razon_social', '');
    }

    // Auto-trigger when 11 digits
    if (rucTimerRef.current) clearTimeout(rucTimerRef.current);
    if (cleaned.length === 11) {
      rucTimerRef.current = setTimeout(() => validateRuc(cleaned), 300);
    }
  };

  const validateRuc = async (ruc) => {
    if (!ruc || ruc.length < 11) return;
    setRucSearching(true);
    setRucValidated(false);
    try {
      const res = await buscarRuc(ruc);
      const data = res.data;
      if (data?.found && data?.razon_social) {
        setF('razon_social', data.razon_social);
        setRucValidated(true);
        const source = data.source === 'sunat' ? 'SUNAT' : 'base de datos';
        showToast({
          type: data.source === 'sunat' ? 'info' : 'success',
          message: `Proveedor encontrado (${source}).`,
        });
      } else {
        showToast({ type: 'warning', message: 'RUC no encontrado.' });
      }
    } catch {
      showToast({ type: 'error', message: 'Error al consultar RUC.' });
    } finally {
      setRucSearching(false);
    }
  };

  // ── Moneda change → fetch tipo de cambio ─────────────────────────────────
  const fetchTipoCambio = async () => {
    setTcLoading(true);
    try {
      const res = await getTipoCambio();
      const data = res.data;
      if (data?.venta) {
        setTipoCambioSunat(data);
        setF('tipo_cambio', String(data.venta));
      }
    } catch {
      showToast({ type: 'warning', message: 'No se pudo obtener el tipo de cambio.' });
    } finally {
      setTcLoading(false);
    }
  };

  const handleMonedaChange = (v) => {
    setF('moneda', v);
    if (v === 'DOLARES') {
      fetchTipoCambio();
    } else {
      setF('tipo_cambio', '');
      setTipoCambioSunat(null);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!form.dni || form.dni.length < 8) errs.dni = 'Ingrese un DNI válido (8 dígitos).';
    if (!form.nombres)  errs.nombres  = 'El nombre es obligatorio.';
    if (!form.cargo)    errs.cargo    = 'Seleccione un puesto.';
    if (!form.tipo)     errs.tipo     = 'Seleccione el tipo de pasaje.';
    if (['B', 'S/B'].includes(form.tipo)) {
      if (!form.fecha_bajada)    errs.fecha_bajada    = 'Fecha de bajada requerida.';
      if (!form.embarque_bajada) errs.embarque_bajada = 'Embarque de bajada requerido.';
      if (!form.destino_bajada)  errs.destino_bajada  = 'Destino de bajada requerido.';
    }
    if (['S', 'S/B'].includes(form.tipo)) {
      if (!form.fecha_subida)    errs.fecha_subida    = 'Fecha de subida requerida.';
      if (!form.embarque_subida) errs.embarque_subida = 'Embarque de subida requerido.';
      if (!form.destino_subida)  errs.destino_subida  = 'Destino de subida requerido.';
    }
    if (!form.ruc || form.ruc.length < 11) errs.ruc = 'Ingrese un RUC válido (11 dígitos).';
    if (!form.razon_social)   errs.razon_social   = 'La razón social es obligatoria.';
    if (!form.factura_ticket) errs.factura_ticket  = 'El N. factura es obligatorio.';
    if (!form.fecha)          errs.fecha           = 'La fecha de factura es obligatoria.';
    if (form.moneda === 'SOLES' && !form.monto_con_igv_soles) {
      errs.monto_con_igv_soles = 'Ingrese el monto en soles.';
    }
    if (form.moneda === 'DOLARES') {
      if (!form.monto_con_igv_dolares) errs.monto_con_igv_dolares = 'Ingrese el monto en dólares.';
      if (!form.tipo_cambio)           errs.tipo_cambio = 'Ingrese el tipo de cambio.';
    }
    if (!form.politica_id) errs.politica_id = 'Seleccione un tramo.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      // Calculate devolucion via API
      let devolucionCalc = 0;
      if (form.politica_id) {
        try {
          const devRes = await calcularDevolucion({
            monto: form.moneda === 'DOLARES'
              ? Number(form.monto_con_igv_dolares)
              : Number(form.monto_con_igv_soles),
            moneda: form.moneda,
            tipo_cambio: form.moneda === 'DOLARES' ? Number(form.tipo_cambio) : 0,
            politica_id: Number(form.politica_id),
          });
          devolucionCalc = Number(devRes.data?.devolucion ?? 0);
        } catch {
          devolucionCalc = devolucion;
        }
      }

      const payload = {
        tipo:            form.tipo,
        dni:             form.dni,
        nombres:         form.nombres.toUpperCase(),
        cargo:           form.cargo.toUpperCase(),
        tipo_trabajador: form.tipo_trabajador,
        centro_costo:    form.centro_costo || null,
        ruc:             form.ruc,
        razon_social:    form.razon_social.toUpperCase(),
        factura_ticket:  form.factura_ticket,
        fecha:           form.fecha,
        detalle:         form.detalle || '',
        moneda:          form.moneda,
        monto_con_igv_soles:   form.moneda === 'SOLES'   ? Number(form.monto_con_igv_soles)   : 0,
        monto_con_igv_dolares: form.moneda === 'DOLARES'  ? Number(form.monto_con_igv_dolares) : 0,
        tipo_cambio:     form.moneda === 'DOLARES' ? Number(form.tipo_cambio) : 0,
        devolucion:      devolucionCalc,
        estado:          'PENDIENTE',
      };

      if (['B', 'S/B'].includes(form.tipo)) {
        payload.fecha_bajada    = form.fecha_bajada;
        payload.embarque_bajada = form.embarque_bajada.toUpperCase();
        payload.destino_bajada  = form.destino_bajada.toUpperCase();
      }
      if (['S', 'S/B'].includes(form.tipo)) {
        payload.fecha_subida    = form.fecha_subida;
        payload.embarque_subida = form.embarque_subida.toUpperCase();
        payload.destino_subida  = form.destino_subida.toUpperCase();
      }

      await createPasaje(payload);
      showToast({ type: 'success', message: 'Pasaje registrado correctamente.' });
      setForm(EMPTY_FORM);
      setDniHistory([]);
      setDniValidated(false);
      setRucValidated(false);
      fetchPasajes();
    } catch (err) {
      const detail = err.response?.data;
      const msg = typeof detail === 'string'
        ? detail
        : detail?.detail ?? Object.values(detail || {}).flat().join(', ') ?? 'No se pudo registrar el pasaje.';
      showToast({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setDniHistory([]);
    setDniValidated(false);
    setRucValidated(false);
  };

  const showBajada = ['B', 'S/B'].includes(form.tipo);
  const showSubida = ['S', 'S/B'].includes(form.tipo);

  const exportFilters = {};
  if (search)       exportFilters.search = search;
  if (filterTipo)   exportFilters.tipo   = filterTipo;
  if (filterEstado) exportFilters.estado = filterEstado;
  if (filterMes)    exportFilters.mes    = filterMes;

  const totalPages = Math.ceil(totalCount / 25);

  // Validation indicator component
  const ValidationIcon = ({ searching, validated }) => {
    if (searching) return <Loader2 size={16} className="animate-spin text-indigo-500" />;
    if (validated) return <CheckCircle2 size={16} className="text-green-500" />;
    return null;
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Pasajes</h1>
          <p className="text-sm text-gray-400 mt-0.5">Registro y gestión de pasajes de personal.</p>
        </div>
      </div>

      {/* ── Section A: Registration form ─────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 sm:px-7 py-4 sm:py-5 hover:bg-gray-50/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center">
              <Plus size={17} className="text-indigo-600" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">Registrar nuevo pasaje</p>
              <p className="text-xs text-gray-400">Complete el formulario para registrar un pasaje</p>
            </div>
          </div>
          {formOpen
            ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
            : <ChevronDown size={18} className="text-gray-400 shrink-0" />
          }
        </button>

        {formOpen && (
          <form onSubmit={handleSubmit} className="border-t border-gray-100">
            <div className="px-5 sm:px-7 py-5 sm:py-6 space-y-6">

              {/* ── Sección: Trabajador ── */}
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Datos del trabajador
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  {/* DNI with auto-validation */}
                  <div className="sm:col-span-1">
                    <Field label="DNI" required id="dni" error={errors.dni}>
                      <div className="relative">
                        <input
                          id="dni"
                          value={form.dni}
                          onChange={(e) => handleDniChange(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), validateDni(form.dni))}
                          disabled={dniValidated}
                          maxLength={8}
                          placeholder="12345678"
                          className={inputCls(!!errors.dni, dniValidated)}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <ValidationIcon searching={dniSearching} validated={dniValidated} />
                          {dniValidated && (
                            <button
                              type="button"
                              onClick={() => { setDniValidated(false); setDniHistory([]); setF('nombres', ''); setF('cargo', ''); }}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Cambiar DNI"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      {dniValidated && (
                        <p className="text-[11px] text-green-600 mt-1 font-medium flex items-center gap-1">
                          <CheckCircle2 size={11} /> Personal validado
                        </p>
                      )}
                    </Field>
                  </div>

                  {/* Nombres — always read-only, filled by DNI lookup */}
                  <div className="sm:col-span-2">
                    <Field label="Nombres completos" required id="nombres" error={errors.nombres}>
                      <input
                        id="nombres"
                        value={form.nombres}
                        readOnly
                        tabIndex={-1}
                        placeholder="Se completa al validar DNI"
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-100 text-gray-600 cursor-not-allowed focus:outline-none"
                      />
                    </Field>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Cargo — dropdown from Puestos */}
                  <Field label="Puesto" required id="cargo" error={errors.cargo}>
                    <select
                      id="cargo"
                      value={form.cargo}
                      onChange={(e) => setF('cargo', e.target.value)}
                      className={inputCls(!!errors.cargo)}
                    >
                      <option value="">-- Seleccione puesto --</option>
                      {puestos.map((p) => (
                        <option key={p.id} value={p.cargo}>
                          {p.cargo}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* Centro de costo — dropdown from Projects */}
                  <Field label="Centro de costo" id="centro_costo">
                    <select
                      id="centro_costo"
                      value={form.centro_costo}
                      onChange={(e) => setF('centro_costo', e.target.value)}
                      className={inputCls(false)}
                    >
                      <option value="">-- Sin asignar --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Tipo de trabajador" required id="tipo_trabajador" error={errors.tipo_trabajador}>
                    <RadioGroup
                      name="tipo_trabajador"
                      options={TIPO_TRABAJADOR_OPTIONS}
                      value={form.tipo_trabajador}
                      onChange={(v) => { setF('tipo_trabajador', v); setF('politica_id', ''); }}
                    />
                  </Field>
                </div>
              </div>

              {/* ── DNI history ── */}
              {dniHistory.length > 0 && (
                <div className="bg-indigo-50/60 rounded-xl border border-indigo-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
                      <User size={13} /> Historial de pasajes ({dniHistory.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => setDniHistory([])}
                      className="text-indigo-400 hover:text-indigo-600 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left pb-2 text-indigo-500 font-semibold pr-4">Fecha</th>
                          <th className="text-left pb-2 text-indigo-500 font-semibold pr-4">Tipo</th>
                          <th className="text-left pb-2 text-indigo-500 font-semibold pr-4">Ruta</th>
                          <th className="text-right pb-2 text-indigo-500 font-semibold pr-4">Monto S/</th>
                          <th className="text-right pb-2 text-indigo-500 font-semibold">Total S/</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-indigo-100">
                        {dniHistory.slice(0, 10).map((h) => (
                          <tr key={h.id}>
                            <td className="py-1.5 text-indigo-700 pr-4">{formatDate(h.fecha)}</td>
                            <td className="py-1.5 text-indigo-700 pr-4">{h.tipo_display ?? h.tipo}</td>
                            <td className="py-1.5 text-indigo-700 pr-4">
                              {h.embarque_bajada || h.embarque_subida || ''} - {h.destino_bajada || h.destino_subida || ''}
                            </td>
                            <td className="py-1.5 text-right text-indigo-700 pr-4">
                              S/ {fmtNum(h.monto_con_igv_soles ?? 0)}
                            </td>
                            <td className="py-1.5 text-right font-bold text-indigo-800">
                              S/ {fmtNum(h.total ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Sección: Tipo de pasaje ── */}
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Tipo de pasaje
                </p>

                <div className="mb-4">
                  <Field label="Tipo" required id="tipo" error={errors.tipo}>
                    <RadioGroup
                      name="tipo"
                      options={TIPO_PASAJE_OPTIONS}
                      value={form.tipo}
                      onChange={(v) => setF('tipo', v)}
                    />
                  </Field>
                </div>

                {showBajada && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 p-4 rounded-xl bg-gray-50/70 border border-gray-100">
                    <p className="sm:col-span-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar size={12} /> Bajada
                    </p>
                    <Field label="Fecha bajada" required id="fecha_bajada" error={errors.fecha_bajada}>
                      <input id="fecha_bajada" type="date" value={form.fecha_bajada} onChange={(e) => setF('fecha_bajada', e.target.value)} className={inputCls(!!errors.fecha_bajada)} />
                    </Field>
                    <Field label="Embarque bajada" required id="embarque_bajada" error={errors.embarque_bajada}>
                      <input id="embarque_bajada" value={form.embarque_bajada} onChange={(e) => setF('embarque_bajada', e.target.value)} placeholder="Ej: Lima" className={inputCls(!!errors.embarque_bajada)} />
                    </Field>
                    <Field label="Destino bajada" required id="destino_bajada" error={errors.destino_bajada}>
                      <input id="destino_bajada" value={form.destino_bajada} onChange={(e) => setF('destino_bajada', e.target.value)} placeholder="Ej: Arequipa" className={inputCls(!!errors.destino_bajada)} />
                    </Field>
                  </div>
                )}

                {showSubida && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-gray-50/70 border border-gray-100">
                    <p className="sm:col-span-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar size={12} /> Subida
                    </p>
                    <Field label="Fecha subida" required id="fecha_subida" error={errors.fecha_subida}>
                      <input id="fecha_subida" type="date" value={form.fecha_subida} onChange={(e) => setF('fecha_subida', e.target.value)} className={inputCls(!!errors.fecha_subida)} />
                    </Field>
                    <Field label="Embarque subida" required id="embarque_subida" error={errors.embarque_subida}>
                      <input id="embarque_subida" value={form.embarque_subida} onChange={(e) => setF('embarque_subida', e.target.value)} placeholder="Ej: Arequipa" className={inputCls(!!errors.embarque_subida)} />
                    </Field>
                    <Field label="Destino subida" required id="destino_subida" error={errors.destino_subida}>
                      <input id="destino_subida" value={form.destino_subida} onChange={(e) => setF('destino_subida', e.target.value)} placeholder="Ej: Lima" className={inputCls(!!errors.destino_subida)} />
                    </Field>
                  </div>
                )}
              </div>

              {/* ── Sección: Proveedor y factura ── */}
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Proveedor y factura
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  {/* RUC with auto-validation */}
                  <Field label="RUC" required id="ruc" error={errors.ruc}>
                    <div className="relative">
                      <input
                        id="ruc"
                        value={form.ruc}
                        onChange={(e) => handleRucChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), validateRuc(form.ruc))}
                        disabled={rucValidated}
                        maxLength={11}
                        placeholder="20XXXXXXXXX"
                        className={inputCls(!!errors.ruc, rucValidated)}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <ValidationIcon searching={rucSearching} validated={rucValidated} />
                        {rucValidated && (
                          <button
                            type="button"
                            onClick={() => { setRucValidated(false); setF('razon_social', ''); }}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            title="Cambiar RUC"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {rucValidated && (
                      <p className="text-[11px] text-green-600 mt-1 font-medium flex items-center gap-1">
                        <CheckCircle2 size={11} /> Proveedor validado
                      </p>
                    )}
                  </Field>

                  {/* Razón social — always read-only, filled by RUC lookup */}
                  <Field label="Razón social" required id="razon_social" error={errors.razon_social}>
                    <input
                      id="razon_social"
                      value={form.razon_social}
                      readOnly
                      tabIndex={-1}
                      placeholder="Se completa al validar RUC"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-100 text-gray-600 cursor-not-allowed focus:outline-none"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <Field label="N. Factura / Ticket" required id="factura_ticket" error={errors.factura_ticket}>
                    <input
                      id="factura_ticket"
                      value={form.factura_ticket}
                      onChange={(e) => setF('factura_ticket', e.target.value)}
                      placeholder="F001-000123"
                      className={inputCls(!!errors.factura_ticket)}
                    />
                  </Field>

                  <Field label="Fecha de factura" required id="fecha" error={errors.fecha}>
                    <input id="fecha" type="date" value={form.fecha} onChange={(e) => setF('fecha', e.target.value)} className={inputCls(!!errors.fecha)} />
                  </Field>

                  <Field label="Moneda" required id="moneda">
                    <RadioGroup name="moneda" options={MONEDA_OPTIONS} value={form.moneda} onChange={handleMonedaChange} />
                  </Field>
                </div>

                {form.moneda === 'DOLARES' && (tipoCambioSunat || tcLoading) && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 mb-4">
                    {tcLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-blue-500" />
                        <p className="text-xs text-blue-600 font-medium">Consultando tipo de cambio SUNAT...</p>
                      </>
                    ) : tipoCambioSunat && (
                      <>
                        <CheckCircle2 size={16} className="text-blue-500 shrink-0" />
                        <div className="text-xs text-blue-700">
                          <span className="font-semibold">Tipo de cambio SUNAT ({tipoCambioSunat.fecha}):</span>{' '}
                          Compra <span className="font-bold">S/ {tipoCambioSunat.compra?.toFixed(3)}</span> — Venta <span className="font-bold">S/ {tipoCambioSunat.venta?.toFixed(3)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {form.moneda === 'SOLES' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <Field label="Monto con IGV (S/)" required id="monto_con_igv_soles" error={errors.monto_con_igv_soles}>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold select-none">S/</span>
                        <NumberInput value={form.monto_con_igv_soles} onChange={(v) => setF('monto_con_igv_soles', v)} className={`${inputCls(!!errors.monto_con_igv_soles)} pl-8`} placeholder="0.00" />
                      </div>
                    </Field>
                  </div>
                )}

                {form.moneda === 'DOLARES' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <Field label="Monto con IGV ($)" required id="monto_con_igv_dolares" error={errors.monto_con_igv_dolares}>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold select-none">$</span>
                        <NumberInput value={form.monto_con_igv_dolares} onChange={(v) => setF('monto_con_igv_dolares', v)} className={`${inputCls(!!errors.monto_con_igv_dolares)} pl-7`} placeholder="0.00" />
                      </div>
                    </Field>
                    <Field label="Tipo de cambio" required id="tipo_cambio" error={errors.tipo_cambio}>
                      <NumberInput value={form.tipo_cambio} onChange={(v) => setF('tipo_cambio', v)} className={inputCls(!!errors.tipo_cambio)} placeholder="3.75" />
                    </Field>
                    <div className="flex items-end pb-0.5">
                      <div className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 border border-gray-200">
                        <p className="text-[10px] text-gray-400 mb-0.5">Equivalente S/</p>
                        <p className="text-sm font-bold text-gray-700">S/ {fmtNum(montoBase)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sección: Tramo y devolución ── */}
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Tramo y devolución
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="sm:col-span-1">
                    <Field label="Tramo (Política)" required id="politica_id" error={errors.politica_id}>
                      <select id="politica_id" value={form.politica_id} onChange={(e) => setF('politica_id', e.target.value)} className={inputCls(!!errors.politica_id)}>
                        <option value="">-- Seleccione tramo --</option>
                        {tramosDisponibles.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.tramo}
                            {t.no_devolucion
                              ? ' (Sin devolución)'
                              : t.monto_soles > 0
                                ? ` — S/ ${fmtNum(t.monto_soles)}`
                                : t.monto_dolares > 0
                                  ? ` — $ ${fmtNum(t.monto_dolares)}`
                                  : ''
                            }
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="flex items-end">
                    <div className="w-full px-3.5 py-2.5 rounded-xl bg-green-50 border border-green-100">
                      <p className="text-[10px] text-green-600 mb-0.5 font-semibold">Devolución</p>
                      <p className="text-sm font-bold text-green-700">
                        {selectedPolitica?.monto_dolares > 0 && selectedPolitica?.monto_soles == 0
                          ? `$ ${fmtNum(devolucion)}`
                          : `S/ ${fmtNum(devolucion)}`
                        }
                      </p>
                    </div>
                  </div>

                  <div className="flex items-end">
                    <div className="w-full px-3.5 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
                      <p className="text-[10px] text-indigo-600 mb-0.5 font-semibold">Total a pagar</p>
                      <p className="text-lg font-bold text-indigo-700">S/ {fmtNum(total)}</p>
                    </div>
                  </div>
                </div>

                <Field label="Detalle / Notas" id="detalle">
                  <textarea id="detalle" value={form.detalle} onChange={(e) => setF('detalle', e.target.value)} rows={2} className={`${inputCls(false)} resize-none`} placeholder="Observaciones adicionales (opcional)" />
                </Field>
              </div>
            </div>

            {/* Form footer */}
            <div className="px-5 sm:px-7 py-4 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row gap-3 justify-end">
              <button type="button" onClick={handleReset} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Limpiar
              </button>
              <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-60">
                {saving
                  ? <><span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> Registrando...</>
                  : <><Plane size={16} /> Registrar pasaje</>
                }
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Section B: Table ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por DNI, nombre, RUC o factura..." className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50 focus:bg-white transition-colors" />
              </div>
              <a href={exportPasajesUrl(exportFilters)} download className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors whitespace-nowrap">
                <Download size={16} /> Exportar Excel
              </a>
            </div>

            <div className="flex flex-wrap gap-2">
              {TIPO_PASAJE_FILTER.map((t) => (
                <button key={t.value} onClick={() => setFilterTipo(filterTipo === t.value ? '' : t.value)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${filterTipo === t.value ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
                  {t.label}
                </button>
              ))}
              <div className="w-px bg-gray-200 mx-1" />
              {ESTADO_OPTIONS.map((e) => (
                <button key={e.value} onClick={() => setFilterEstado(filterEstado === e.value ? '' : e.value)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${filterEstado === e.value ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-200' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
                  {e.label}
                </button>
              ))}
              <select value={filterMes} onChange={(e) => setFilterMes(e.target.value)} className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {tableError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {tableError}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-indigo-600" />
            </div>
          ) : pasajes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Plane size={28} strokeWidth={1.2} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">No hay pasajes registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Embarque</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Destino</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">C. Costo</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">T. Trab.</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">DNI</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Cargo</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Nombres</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Razón Social</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">RUC</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Factura</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Mes</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Monto S/</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Monto $</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">T.C.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Dev.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">F. Pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pasajes.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs font-medium">{p.tipo_display ?? p.tipo}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{formatDate(p.fecha_bajada ?? p.fecha_subida)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{p.embarque_bajada || p.embarque_subida || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{p.destino_bajada || p.destino_subida || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden xl:table-cell">{p.centro_costo_codigo ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{p.tipo_trabajador_display ?? p.tipo_trabajador}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{p.dni}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell max-w-[120px] truncate">{p.cargo}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium text-xs max-w-[160px] truncate">{p.nombres}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden xl:table-cell max-w-[160px] truncate">{p.razon_social || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 hidden xl:table-cell">{p.ruc}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 hidden lg:table-cell">{p.factura_ticket || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{p.mes || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium tabular-nums whitespace-nowrap text-xs">{fmtNum(p.monto_con_igv_soles)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums whitespace-nowrap text-xs hidden md:table-cell">{Number(p.monto_con_igv_dolares) > 0 ? fmtNum(p.monto_con_igv_dolares) : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-400 tabular-nums text-xs hidden md:table-cell">{Number(p.tipo_cambio) > 0 ? fmtNum(p.tipo_cambio) : '—'}</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium tabular-nums hidden md:table-cell text-xs whitespace-nowrap">{fmtNum(p.devolucion)}</td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-700 tabular-nums whitespace-nowrap text-xs">S/ {fmtNum(p.total)}</td>
                      <td className="px-4 py-3 text-center"><EstadoBadge estado={p.estado} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell whitespace-nowrap">{p.fecha_pago ? formatDate(p.fecha_pago) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && totalCount > 0 && (
            <div className="flex items-center justify-between px-5 sm:px-6 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                {totalCount} pasaje{totalCount !== 1 ? 's' : ''}
                {totalPages > 1 && ` — Pág. ${page} de ${totalPages}`}
              </p>
              <div className="flex gap-2 items-center">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Anterior
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
