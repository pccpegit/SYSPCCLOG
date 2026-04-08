import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, Send, AlertCircle, Download } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getProjects, getDepartments } from '../../api/core';
import { createRequest } from '../../api/requests';
import { exportRQToExcel } from '../../utils/exportRQ';
import { useToast } from '../../context/ToastContext';

const UNITS = [
  'UND', 'KG', 'M', 'M2', 'M3', 'GLB', 'SACO', 'L',
  'bolsa', 'galón', 'varilla', 'pln', 'litro', 'par', 'kit', 'juego', 'rollo', 'caja',
];

const AREAS = ['Producción', 'Acabados', 'Instalaciones', 'Administración', 'Seguridad'];

// Tipo de pedido (COMPRA_LOCAL, IMPORTACION, etc.) lo determina Logística,
// no el solicitante. Se asigna por defecto COMPRA_LOCAL al crear.

function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function newItem() {
  return {
    id:                      Date.now() + Math.random(),
    descripcion:             '',
    unidad:                  'UND',
    cantidad:                '',
    stockAlmacenObra:        0,
    stockAlmacenPrincipal:   0,
    xAtender:                '',
    xAtenderManual:          false,
    presupuestadoAdicional:  'P',
    rfiFwo:                  '',
    estatusGuia:             '',
    comentarios:             '',
  };
}

function calcXAtender(item) {
  if (item.xAtenderManual) return item.xAtender;
  const qty  = parseFloat(item.cantidad)              || 0;
  const obra = parseFloat(item.stockAlmacenObra)      || 0;
  const ppal = parseFloat(item.stockAlmacenPrincipal) || 0;
  const val  = qty - obra - ppal;
  return val < 0 ? 0 : val;
}

// ── Step heading with number badge + colored accent ──────────
function StepHeading({ number, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 pl-4 border-l-4 border-blue-500 mb-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-extrabold flex items-center justify-center shadow-sm">
        {number}
      </div>
      <div>
        <p className="text-base font-bold text-gray-900 leading-tight">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Required field label ─────────────────────────────────────
function RequiredLabel({ children }) {
  return (
    <span>
      {children}
      <span className="text-red-500 ml-0.5 font-bold">*</span>
    </span>
  );
}

export default function RequestCreatePage() {
  const { currentUser } = useAuth();
  const navigate        = useNavigate();
  const { showToast }   = useToast();

  // Determine user's primary role info
  const primaryRoleObj = currentUser?.roles?.find((r) => r.is_primary) ?? currentUser?.roles?.[0];
  const userProjectId = primaryRoleObj?.project ?? null;
  const userProjectName = primaryRoleObj?.project_name ?? '';
  const userProjectFrente = primaryRoleObj?.project_frente ?? '';
  const userDepartmentId = primaryRoleObj?.department_obj ?? null;
  const userDepartmentName = primaryRoleObj?.department_name ?? '';
  const userDepartmentFrente = primaryRoleObj?.department_frente ?? '';

  // If user has a project assigned → OPS user (locked to that project)
  // If user has department only → ADM user (can choose any frente/project)
  // If neither → global access
  const isOps = !!userProjectId;
  const hasGlobalAccess = !userProjectId && !userDepartmentId;
  const autoFrente = isOps ? userProjectFrente : userDepartmentFrente;
  const userProjectCode = primaryRoleObj?.project_code ?? '';
  const autoServicio = isOps
    ? (userProjectCode && userProjectName ? `${userProjectCode} — ${userProjectName}` : userProjectName)
    : userDepartmentName;

  const [projects,    setProjects]    = useState([]);
  const [departments, setDepartments] = useState([]);
  const [frentes,     setFrentes]     = useState([]);
  const [form, setForm] = useState({
    rqNumber:           '',
    // destinationKey format: "proj-{id}" or "dept-{id}"
    destinationKey:     userProjectId ? `proj-${userProjectId}` : (userDepartmentId ? `dept-${userDepartmentId}` : ''),
    area:               currentUser?.department || '',
    frente:             autoFrente,
    servicio:           autoServicio,
    usoEspecifico:      '',
    fechaRequerimiento: today(),
    fechaEntrega:       '',
  });

  const [items, setItems]           = useState(() => Array.from({ length: 5 }, newItem));
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Parse destination key
  const destType = form.destinationKey?.startsWith('proj-') ? 'project'
    : form.destinationKey?.startsWith('dept-') ? 'department' : null;
  const destId = form.destinationKey ? Number(form.destinationKey.split('-')[1]) : null;

  // Load projects and departments
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projRes, deptRes] = await Promise.all([
          getProjects({ page_size: 50 }),
          getDepartments({ page_size: 50 }),
        ]);
        const projList = projRes.data.results ?? [];
        const deptList = deptRes.data.results ?? [];
        setProjects(projList);
        setDepartments(deptList);

        // Build unique frentes from projects and departments
        const frenteSet = new Set();
        projList.forEach((p) => { if (p.frente) frenteSet.add(p.frente); });
        deptList.forEach((d) => { if (d.frente) frenteSet.add(d.frente); });
        setFrentes([...frenteSet].sort());

        // If user has a project assigned (OPS), auto-fill and lock
        if (userProjectId) {
          const proj = projList.find((p) => p.id === userProjectId);
          if (proj) {
            setForm((f) => ({
              ...f,
              destinationKey: `proj-${proj.id}`,
              frente: proj.frente || autoFrente,
              servicio: `${proj.code} — ${proj.name}`,
            }));
          }
        } else if (userDepartmentId) {
          const dept = deptList.find((d) => d.id === userDepartmentId);
          if (dept) {
            setForm((f) => ({
              ...f,
              destinationKey: `dept-${dept.id}`,
              frente: dept.frente || '',
              servicio: dept.name || '',
            }));
          }
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    };
    fetchData();
  }, []);

  const selectedProject = destType === 'project' ? projects.find((p) => p.id === destId) : null;
  const selectedDepartment = destType === 'department' ? departments.find((d) => d.id === destId) : null;

  // Services available for the selected frente
  const serviciosForFrente = form.frente
    ? [
        ...projects.filter((p) => p.frente === form.frente).map((p) => ({
          key: `proj-${p.id}`, label: `${p.code} — ${p.name}`, type: 'project',
        })),
        ...departments.filter((d) => d.frente === form.frente).map((d) => ({
          key: `dept-${d.id}`, label: d.name, type: 'department',
        })),
      ]
    : [];
  const rqNumber = `REQ-${form.rqNumber}`;

  const currentDate = formatDateDisplay(today());
  const hasErrors   = Object.keys(errors).length > 0;

  // ── Helpers ─────────────────────────────────────────────────

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // When frente changes, reset servicio and proyecto
      if (name === 'frente') {
        const hasProjects = projects.some((p) => p.frente === value);
        if (!hasProjects && userDepartmentId) {
          // No projects for this frente → auto-fill with user's department
          next.servicio = currentUser?.department || '';
          next.destinationKey = `dept-${userDepartmentId}`;
        } else {
          next.servicio = '';
          next.destinationKey = '';
        }
      }
      // When servicio changes, auto-fill proyecto
      if (name === 'servicio') {
        next.destinationKey = value; // value is "proj-{id}" or "dept-{id}"
        if (value.startsWith('proj-')) {
          const proj = projects.find((p) => p.id === Number(value.split('-')[1]));
          if (proj) next.servicio = `${proj.code} — ${proj.name}`;
        } else if (value.startsWith('dept-')) {
          const dept = departments.find((d) => d.id === Number(value.split('-')[1]));
          if (dept) next.servicio = dept.name;
        }
      }
      // Legacy: direct destinationKey changes
      if (name === 'destinationKey') {
        if (value.startsWith('proj-')) {
          const proj = projects.find((p) => p.id === Number(value.split('-')[1]));
          next.frente = proj?.frente ?? '';
          next.servicio = proj ? `${proj.code} — ${proj.name}` : '';
        } else if (value.startsWith('dept-')) {
          const dept = departments.find((d) => d.id === Number(value.split('-')[1]));
          next.frente = dept?.frente ?? '';
          next.servicio = dept?.name ?? '';
        }
      }
      return next;
    });
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  }

  function handleItemChange(id, field, value) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'xAtender') updated.xAtenderManual = true;
        if (['cantidad', 'stockAlmacenObra', 'stockAlmacenPrincipal'].includes(field)) {
          updated.xAtenderManual = false;
        }
        return updated;
      })
    );
  }

  function addItem() {
    setItems((prev) => [...prev, newItem()]);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  // ── Validation ───────────────────────────────────────────────

  function validate() {
    const errs = {};
    if (!form.rqNumber.trim()) errs.rqNumber = 'Ingrese el N° de Requerimiento.';
    if (!form.frente)          errs.frente        = 'Seleccione el frente.';
    if (!form.destinationKey)  errs.destinationKey = 'Seleccione un servicio.';
    if (!form.area)            errs.area         = 'Seleccione el área.';
    if (!form.fechaEntrega)    errs.fechaEntrega = 'Ingrese la fecha de entrega.';
    const filledItems = items.filter((i) => i.descripcion.trim());
    if (filledItems.length === 0) errs.items = 'Agregue al menos un ítem con descripción.';
    return errs;
  }

  // ── Submit ───────────────────────────────────────────────────

  async function handleSubmit(asDraft = false) {
    if (!asDraft) {
      const errs = validate();
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    setSubmitting(true);

    try {
      const filledItems = items
        .filter((i) => i.descripcion.trim())
        .map((i, idx) => ({
          line_number:              idx + 1,
          description:              i.descripcion,
          unit:                     i.unidad,
          quantity:                 parseFloat(i.cantidad) || 0,
          stock_almacen_obra:       parseFloat(i.stockAlmacenObra) || 0,
          stock_almacen_principal:  parseFloat(i.stockAlmacenPrincipal) || 0,
          x_atender:                parseFloat(calcXAtender(i)) || 0,
          presupuestado_adicional:  i.presupuestadoAdicional,
          rfi_fwo:                  i.rfiFwo,
          comentarios:              i.comentarios,
        }));

      const isProject = form.destinationKey?.startsWith('proj-');
      const isOficina = form.destinationKey === 'dept-oficina';
      const parsedDestId = isOficina ? null : destId;
      // For Oficina Central, find the ADM department
      const adminDept = departments.find((d) => d.code === 'ADM');
      const deptIdToSend = isOficina ? (adminDept?.id ?? null) : (isProject ? null : parsedDestId);
      const payload = {
        rq_number:           `REQ-${form.rqNumber.trim()}`,
        flow:                isProject ? 'OPERATIONS' : 'ADMINISTRATIVE',
        project:             isProject ? destId : null,
        department:          deptIdToSend,
        front_area:          form.frente,
        service:             form.servicio,
        specific_use:        form.usoEspecifico,
        acquisition_type:    form.tipoPedido || 'COMPRA_LOCAL',
        priority:            'NORMAL',
        fecha_necesidad:     form.fechaEntrega || today(),
        estimated_cost:      0,
        items:               filledItems,
      };

      const { data: createdReq } = await createRequest(payload);

      // Download Excel for submitted requests
      if (!asDraft) {
        try {
          await exportRQToExcel({ form, items, currentUser, rqNumber: createdReq.rq_number ?? rqNumber });
        } catch (excelErr) {
          console.error('Error al exportar Excel:', excelErr);
        }
      }

      showToast({
        type:    'success',
        message: asDraft
          ? 'Borrador guardado exitosamente.'
          : 'Requerimiento enviado exitosamente. El Excel se ha descargado.',
      });
      setTimeout(() => navigate('/rq/requests'), 250);
    } catch (err) {
      console.error('Error al crear requerimiento:', err);
      const detail = err?.response?.data?.detail ?? err?.response?.data ?? 'Error al guardar el requerimiento.';
      showToast({ type: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
      setSubmitting(false);
    }
  }

  async function handleDownloadExcel() {
    try {
      await exportRQToExcel({ form, items, currentUser, rqNumber });
    } catch (err) {
      console.error('Error al exportar Excel:', err);
      showToast({ type: 'error', message: 'Error al generar el Excel.' });
    }
  }

  // ── Cell input/select styles — slightly bigger for readability
  const cellInput =
    'w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1 focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 rounded transition-colors';

  const cellSelect =
    'w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1 focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 rounded transition-colors cursor-pointer';

  // ── Error input class helpers
  function fieldCls(hasError) {
    return `text-xs border rounded px-2 py-1.5 w-full focus:outline-none focus:ring-2 transition-colors ${
      hasError
        ? 'border-red-400 bg-red-50 focus:ring-red-400'
        : 'border-gray-200 focus:ring-blue-400'
    }`;
  }

  return (
    <div className="max-w-[1400px] mx-auto">

      {/* Back navigation — bigger, clearer breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 font-medium text-sm transition-colors"
          aria-label="Volver"
        >
          <ArrowLeft size={18} />
          Volver
        </button>
        <span className="text-gray-300 text-lg font-light">/</span>
        <span className="text-base font-bold text-gray-800">Nuevo Requerimiento</span>
      </div>

      {/* ── Global error banner ──────────────────────────────────── */}
      {hasErrors && (
        <div className="mb-5 flex items-start gap-3 p-4 bg-red-50 border-2 border-red-300 rounded-xl">
          <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Por favor corrija los siguientes campos antes de enviar:</p>
            <ul className="mt-1.5 space-y-0.5">
              {Object.values(errors).filter(Boolean).map((msg, i) => (
                <li key={i} className="text-sm text-red-600 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── STEP 1 HEADING — identification ─────────────────────── */}
      <div className="mb-3">
        <StepHeading
          number="1"
          title="Identificacion del Requerimiento"
          subtitle="Complete los datos generales del requerimiento. Los campos marcados con * son obligatorios."
        />
      </div>

      {/* ── DOCUMENT (official form layout preserved) ────────────── */}
      <div className="bg-white shadow-md border border-gray-400 font-sans overflow-x-auto">

        {/* ── DOCUMENT HEADER ──────────────────────────────────────── */}
        <div className="border-b border-gray-400 flex">
          {/* Logo area */}
          <div className="border-r border-gray-400 flex items-center justify-center p-2 min-w-[120px]">
            <img
              src="/images/azul.jpg"
              alt="PCC - Proyectos, Construcción & Comisionamiento"
              className="h-14 w-auto object-contain"
            />
          </div>

          {/* Title */}
          <div className="flex-1 flex items-center justify-center p-3 border-r border-gray-400">
            <div className="text-center">
              <div className="text-base font-black text-gray-800 uppercase tracking-wide leading-tight">
                Requerimiento de Materiales y/o Equipos
              </div>
            </div>
          </div>

          {/* Document metadata table */}
          <div className="min-w-[200px]">
            <table className="w-full text-[10px] border-collapse h-full">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="border-r border-gray-300 bg-gray-100 px-2 py-1 font-semibold uppercase text-gray-600 whitespace-nowrap">
                    Código:
                  </td>
                  <td className="px-2 py-1 font-mono text-gray-800">PCC-ADM-FOR-01</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="border-r border-gray-300 bg-gray-100 px-2 py-1 font-semibold uppercase text-gray-600">
                    Revisión:
                  </td>
                  <td className="px-2 py-1 text-gray-800">02</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="border-r border-gray-300 bg-gray-100 px-2 py-1 font-semibold uppercase text-gray-600">
                    Fecha:
                  </td>
                  <td className="px-2 py-1 text-gray-800">{currentDate}</td>
                </tr>
                <tr>
                  <td className="border-r border-gray-300 bg-gray-100 px-2 py-1 font-semibold uppercase text-gray-600">
                    Página:
                  </td>
                  <td className="px-2 py-1 text-gray-800">1 de 1</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── FORM FIELDS SECTION ──────────────────────────────────── */}
        <div className="border-b border-gray-400">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {/* Row 1: Requerido por / N° Requerimiento */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap w-40">
                  Requerido por:
                </td>
                <td className="border-r border-gray-300 px-3 py-2.5 w-64 text-gray-800 bg-gray-50 font-medium">
                  {currentUser?.full_name ?? (`${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || '—')}
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap w-44">
                  <RequiredLabel>N° Requerimiento:</RequiredLabel>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-0">
                    <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 border border-r-0 border-gray-200 rounded-l px-2 py-1.5 select-none">REQ-</span>
                    <input
                      type="text"
                      name="rqNumber"
                      value={form.rqNumber}
                      onChange={handleChange}
                      placeholder="001"
                      className={fieldCls(errors.rqNumber) + ' font-mono font-bold rounded-l-none'}
                    />
                  </div>
                  {errors.rqNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.rqNumber}</p>}
                </td>
              </tr>

              {/* Row 2: Uso específico / Fecha de requerimiento */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 align-top pt-3">
                  Uso específico:
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  <textarea
                    name="usoEspecifico"
                    value={form.usoEspecifico}
                    onChange={handleChange}
                    rows={2}
                    placeholder="Describe el uso específico del material..."
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                  />
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap">
                  Fecha de requerimiento:
                </td>
                <td className="px-2 py-2">
                  <input
                    type="date"
                    name="fechaRequerimiento"
                    value={form.fechaRequerimiento}
                    onChange={handleChange}
                    className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
              </tr>

              {/* Row 3: Área (required) / Frente */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <RequiredLabel>Área:</RequiredLabel>
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  {currentUser?.department ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.area}
                    </span>
                  ) : (
                    <select
                      name="area"
                      value={form.area}
                      onChange={handleChange}
                      className={fieldCls(errors.area)}
                    >
                      <option value="">-- Seleccione --</option>
                      {AREAS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  )}
                  {errors.area && (
                    <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                      <AlertCircle size={11} />
                      {errors.area}
                    </p>
                  )}
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <RequiredLabel>Frente:</RequiredLabel>
                </td>
                <td className="px-2 py-2">
                  {userProjectId && !hasGlobalAccess ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.frente || '—'}
                    </span>
                  ) : (
                    <select
                      name="frente"
                      value={form.frente}
                      onChange={handleChange}
                      className={fieldCls(errors.frente)}
                    >
                      <option value="">-- Seleccione --</option>
                      {frentes.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  )}
                  {errors.frente && (
                    <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                      <AlertCircle size={11} />
                      {errors.frente}
                    </p>
                  )}
                </td>
              </tr>

              {/* Row 4: Fecha entrega (required) / Servicio */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap">
                  <RequiredLabel>Fecha entrega:</RequiredLabel>
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  <input
                    type="date"
                    name="fechaEntrega"
                    value={form.fechaEntrega}
                    onChange={handleChange}
                    className={fieldCls(errors.fechaEntrega)}
                  />
                  {errors.fechaEntrega && (
                    <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                      <AlertCircle size={11} />
                      {errors.fechaEntrega}
                    </p>
                  )}
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <RequiredLabel>Servicio:</RequiredLabel>
                </td>
                <td className="px-2 py-2">
                  {userProjectId && !hasGlobalAccess ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.servicio || '—'}
                    </span>
                  ) : form.frente && !projects.some((p) => p.frente === form.frente) ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.servicio || '—'}
                    </span>
                  ) : (
                    <>
                      <select
                        name="servicio"
                        value={form.destinationKey}
                        onChange={handleChange}
                        className={fieldCls(errors.servicio)}
                        disabled={!form.frente}
                      >
                        <option value="">{form.frente ? '-- Seleccione servicio --' : '-- Seleccione frente primero --'}</option>
                        {serviciosForFrente.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                      {errors.servicio && (
                        <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                          <AlertCircle size={11} />
                          {errors.servicio}
                        </p>
                      )}
                    </>
                  )}
                </td>
              </tr>

              {/* Row 5: Proyecto/Destino (required, full width) */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <RequiredLabel>Proyecto:</RequiredLabel>
                </td>
                <td colSpan={3} className="px-2 py-2">
                  <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block max-w-xl">
                    {selectedProject
                      ? `${selectedProject.code} — ${selectedProject.name}`
                      : selectedDepartment
                      ? `${selectedDepartment.name}`
                      : form.destinationKey ? form.servicio : '— Seleccione frente y servicio —'}
                  </span>
                  {errors.destinationKey && (
                    <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                      <AlertCircle size={11} />
                      {errors.destinationKey}
                    </p>
                  )}
                </td>
              </tr>

              {/* Tipo de pedido: lo determina Logística, no el solicitante */}
            </tbody>
          </table>
        </div>

        {/* ── STEP 2 HEADING inside document — Items ───────────────── */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-200 bg-gray-50/50">
          <StepHeading
            number="2"
            title="Lista de Materiales y/o Equipos"
            subtitle="Complete al menos un ítem con descripción. La columna X Atender se calcula automaticamente."
          />
          {errors.items && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-red-50 border border-red-300 rounded-lg">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700 font-semibold">{errors.items}</p>
            </div>
          )}
        </div>

        {/* ── ITEMS TABLE ───────────────────────────────────────────── */}
        <div className="border-b border-gray-400">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="bg-blue-50 border-b border-gray-300">
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-8">
                    #
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-48">
                    Equipos / Unidades
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Unidad
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-16">
                    Cantidad
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-20">
                    Stock Obra
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Stock Principal
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-blue-700 uppercase text-[10px] w-16 bg-yellow-50">
                    X Atender
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Pres. / Adic.
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-20">
                    RFI / FWO
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Estatus / Guía
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px]">
                    Comentarios
                  </th>
                  <th className="px-2 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const xAtenderVal = calcXAtender(item);
                  const isEven = idx % 2 === 0;
                  return (
                    <tr
                      key={item.id}
                      className={[
                        'border-b border-gray-200 hover:bg-blue-50/40 transition-colors',
                        isEven ? 'bg-white' : 'bg-gray-50/50',
                      ].join(' ')}
                    >
                      {/* Item number */}
                      <td className="border-r border-gray-200 px-2 py-2 text-center text-gray-600 font-mono font-bold">
                        {idx + 1}
                      </td>

                      {/* Equipos/Unidades */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="text"
                          value={item.descripcion}
                          onChange={(e) => handleItemChange(item.id, 'descripcion', e.target.value)}
                          placeholder="Descripción del material..."
                          className={cellInput}
                        />
                      </td>

                      {/* Unidad de Medida */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <select
                          value={item.unidad}
                          onChange={(e) => handleItemChange(item.id, 'unidad', e.target.value)}
                          className={cellSelect}
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>

                      {/* Cantidad */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.cantidad}
                          onChange={(e) => handleItemChange(item.id, 'cantidad', e.target.value)}
                          placeholder="0"
                          className={`${cellInput} text-right`}
                        />
                      </td>

                      {/* Stock Almacén Obra */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.stockAlmacenObra}
                          onChange={(e) => handleItemChange(item.id, 'stockAlmacenObra', e.target.value)}
                          className={`${cellInput} text-right`}
                        />
                      </td>

                      {/* Stock Almacén Principal */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.stockAlmacenPrincipal}
                          onChange={(e) => handleItemChange(item.id, 'stockAlmacenPrincipal', e.target.value)}
                          className={`${cellInput} text-right`}
                        />
                      </td>

                      {/* X Atender (auto-calculated, editable) */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5 bg-yellow-50/60">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.xAtenderManual ? item.xAtender : xAtenderVal}
                          onChange={(e) => handleItemChange(item.id, 'xAtender', e.target.value)}
                          className={`${cellInput} text-right font-bold text-blue-700`}
                          title="Auto-calculado: Cantidad - Stock Obra - Stock Principal. Editable."
                        />
                      </td>

                      {/* Presupuestado/Adicional */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <select
                          value={item.presupuestadoAdicional}
                          onChange={(e) => handleItemChange(item.id, 'presupuestadoAdicional', e.target.value)}
                          className={cellSelect}
                        >
                          <option value="P">P - Presupuestado</option>
                          <option value="A">A - Adicional</option>
                        </select>
                      </td>

                      {/* RFI/FWO */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="text"
                          value={item.rfiFwo}
                          onChange={(e) => handleItemChange(item.id, 'rfiFwo', e.target.value)}
                          placeholder="RFI-000"
                          className={cellInput}
                        />
                      </td>

                      {/* Estatus/Guía (read-only in create) */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5 bg-gray-100/60">
                        <input
                          type="text"
                          value={item.estatusGuia}
                          readOnly
                          placeholder="—"
                          className={`${cellInput} text-gray-400 cursor-not-allowed`}
                          title="Se completa por Logística/Almacén"
                        />
                      </td>

                      {/* Comentarios */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="text"
                          value={item.comentarios}
                          onChange={(e) => handleItemChange(item.id, 'comentarios', e.target.value)}
                          placeholder="Observaciones..."
                          className={cellInput}
                        />
                      </td>

                      {/* Delete row — bigger hit target */}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          disabled={items.length === 1}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-20 disabled:cursor-not-allowed transition-all rounded-md"
                          title="Eliminar fila"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add item button — more prominent */}
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-4">
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-700 bg-white border-2 border-blue-300 rounded-lg hover:bg-blue-50 hover:border-blue-400 active:scale-95 transition-all duration-200 shadow-sm"
            >
              <Plus size={16} />
              Agregar Item
            </button>
            <span className="text-xs text-gray-400">
              {items.length} fila{items.length !== 1 ? 's' : ''} · "X Atender" se calcula automaticamente
            </span>
          </div>
        </div>

        {/* ── SIGNATURE SECTION ─────────────────────────────────────── */}
        <div>
          <div className="grid grid-cols-4 border-b border-gray-400">
            {/* Realizado por */}
            <div className="border-r border-gray-300 p-3">
              <div className="text-[9px] font-semibold uppercase text-gray-600 tracking-wide mb-2 pb-1 border-b border-gray-200">
                Realizado por:
              </div>
              <div className="min-h-[48px] flex flex-col justify-end">
                <div className="text-[10px] text-gray-700 font-medium mt-4">
                  {currentUser?.full_name ?? (`${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || '—')}
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{currentDate}</div>
              </div>
            </div>

            {/* Validado por */}
            <div className="border-r border-gray-300 p-3">
              <div className="text-[9px] font-semibold uppercase text-gray-600 tracking-wide mb-2 pb-1 border-b border-gray-200">
                Validado por:
              </div>
              <div className="min-h-[48px] flex flex-col justify-end">
                <div className="text-[9px] text-gray-300 mt-4">Residente de Proyecto</div>
                <div className="text-[9px] text-gray-300">Firma / Fecha</div>
              </div>
            </div>

            {/* Revisado y aprobado por */}
            <div className="border-r border-gray-300 p-3">
              <div className="text-[9px] font-semibold uppercase text-gray-600 tracking-wide mb-2 pb-1 border-b border-gray-200">
                Revisado y aprobado por:
              </div>
              <div className="min-h-[48px] flex flex-col justify-end">
                <div className="text-[9px] text-gray-300 mt-4">Control / Gerencia</div>
                <div className="text-[9px] text-gray-300">Firma / Fecha</div>
              </div>
            </div>

            {/* Verificado por Logística */}
            <div className="p-3">
              <div className="text-[9px] font-semibold uppercase text-gray-600 tracking-wide mb-2 pb-1 border-b border-gray-200">
                Verificado por: Logística
              </div>
              <div className="min-h-[48px] flex flex-col justify-end">
                <div className="text-[9px] text-gray-300 mt-4">Coord. Logístico</div>
                <div className="text-[9px] text-gray-300">Firma / Fecha</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── END DOCUMENT ──────────────────────────────────────────── */}

      {/* ── ACTION BUTTONS ── clear visual hierarchy ─────────────── */}
      <div className="mt-8 pb-10">
        {/* Separator */}
        <div className="border-t border-gray-200 mb-6" />
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-end">
          {/* Tertiary — cancel */}
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-full sm:w-auto px-5 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>

          {/* Download Excel only */}
          <button
            type="button"
            onClick={handleDownloadExcel}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border-2 border-green-400 text-green-700 rounded-xl text-sm font-semibold hover:bg-green-50 hover:border-green-500 transition-all duration-200"
          >
            <Download size={18} />
            Descargar Excel
          </button>

          {/* Secondary — save draft */}
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 border-2 border-gray-400 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:border-gray-500 transition-all duration-200 disabled:opacity-50"
          >
            <Save size={18} />
            Guardar Borrador
          </button>

          {/* Primary — submit: BIG and obvious */}
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-10 py-4 bg-blue-600 text-white rounded-xl text-base font-extrabold hover:bg-blue-700 hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all duration-200 disabled:opacity-50 shadow-lg"
          >
            <Send size={20} />
            {submitting ? 'Enviando...' : 'Enviar Requerimiento'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-right mt-3">
          Los campos marcados con <span className="text-red-500 font-bold">*</span> son obligatorios para enviar.
        </p>
      </div>
    </div>
  );
}
