import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, Send, AlertCircle, Download } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getProjects, getDepartments } from '../../api/core';
import { createRequest } from '../../api/requests';
import { exportRQToExcel } from '../../utils/exportRQ';
import { useToast } from '../../context/ToastContext';
import { isOficinaCentral } from '../../data/constants';
import { ITEM_SOURCES, MAX_REQUEST_ITEMS, REQUESTING_AREAS, RFI_FWO_MAX_LENGTH, itemSourceLabel } from '../../data/requestCapture';
import { extractFieldErrors } from '../../utils/apiErrors';
import {
  applyProduct,
  buildItemsPayload,
  clearProduct,
  extractCreateErrorMessage,
  payloadRowNumbers,
  newCaptureItem,
  setItemSource,
  setOffCatalog,
  validateCaptureItems,
} from '../../utils/requestCapture';
import ItemProductCell, { OFF_CATALOG_HELP_ID } from '../../components/requests/ItemProductCell';

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

function calcXAtender(item) {
  if (item.xAtenderManual) return item.xAtender;
  const qty  = parseFloat(item.cantidad)              || 0;
  const obra = parseFloat(item.stockAlmacenObra)      || 0;
  const ppal = parseFloat(item.stockAlmacenPrincipal) || 0;
  const val  = qty - obra - ppal;
  return val < 0 ? 0 : val;
}

// ── Step heading with number badge + colored accent ──────────
function StepHeading({ number, title, subtitle, help, helpId }) {
  return (
    <div className="flex items-start gap-3 pl-4 border-l-4 border-blue-500 mb-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-extrabold flex items-center justify-center shadow-sm">
        {number}
      </div>
      <div>
        <p className="text-base font-bold text-gray-900 leading-tight">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        {help && <p id={helpId} className="text-xs text-gray-700 mt-1">{help}</p>}
      </div>
    </div>
  );
}

// ── Required field label ─────────────────────────────────────
function RequiredLabel({ children }) {
  return (
    <span>
      {children}
      <span className="text-red-500 ml-0.5 font-bold" aria-hidden="true">*</span>
    </span>
  );
}

// Label of a field of the official form: a real <label> when the control exists
// (the cell next to it is a layout table, so without this the control has no name).
function FieldLabel({ htmlFor, required = false, children }) {
  const text = required ? <RequiredLabel>{children}</RequiredLabel> : children;
  return htmlFor ? <label htmlFor={htmlFor}>{text}</label> : text;
}

// Error under a field; `id` is what the control's aria-describedby points to.
function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium flex items-center gap-1">
      <AlertCircle size={11} aria-hidden="true" />
      {children}
    </p>
  );
}

// Props every control with an inline error shares.
function invalidProps(errors, name, required = false) {
  return {
    ...(required ? { 'aria-required': 'true' } : {}),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  };
}

// Error summary: order of the header fields and the controls each message links to.
const FORM_ERROR_ORDER = ['rqNumber', 'area', 'frente', 'requestingArea', 'fechaEntrega', 'destinationKey'];
const FORM_ERROR_TARGETS = {
  rqNumber:       ['rqNumber'],
  area:           ['area'],
  frente:         ['frente'],
  requestingArea: ['requestingArea'],
  fechaEntrega:   ['fechaEntrega'],
  destinationKey: ['servicio', 'frente'],
};

// Controls that fix a line problem (the first one that exists in the page takes the focus).
function itemIssueTargets(issue, items) {
  if (issue.itemId == null) return items.map((it) => `item-${it.id}-search`);
  const item = items.find((it) => it.id === issue.itemId);
  if (!item) return [];
  if (issue.field === 'quantity') return [`item-${item.id}-quantity`];
  if (issue.field === 'source') return [`item-${item.id}-source`];
  return [item.mode === 'off_catalog' ? `item-${item.id}-description` : `item-${item.id}-search`];
}

function focusField(targets) {
  for (const id of targets) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      return;
    }
  }
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
    : (isOficinaCentral(userDepartmentFrente) ? 'Oficina Central' : userDepartmentName);

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
    // SYSPCC-026: functional area of the RQ (OP / QC / HSE / ADM). Not the same
    // thing as `area` above, which is the user's department / legacy form field.
    requestingArea:     '',
  });

  const [items, setItems]           = useState(() => Array.from({ length: 5 }, newCaptureItem));
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);
  // After the first failed submit the lines are validated live, so each message
  // disappears as soon as the line is fixed.
  const [submitAttempt, setSubmitAttempt] = useState(0);
  // Line + control that must take the focus when it mounts: the search box after
  // "Cambiar" / unmarking "Fuera de catálogo", the description after marking it.
  const [focusTarget, setFocusTarget] = useState(null);
  // Always-mounted live region: what happened to a line when its control unmounted.
  const [announcement, setAnnouncement] = useState('');
  // A 400 from the server that is not tied to one field; shown in the summary so the
  // message does not depend on a toast that disappears.
  const [serverError, setServerError] = useState(null);
  const submitLock  = useRef(false);
  const summaryRef  = useRef(null);

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
              servicio: isOficinaCentral(dept.frente) ? 'Oficina Central' : (dept.name || ''),
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

  const liveCapture = submitAttempt > 0 ? validateCaptureItems(items) : null;
  const itemProblems = liveCapture?.byItem ?? {};
  const summaryEntries = [
    ...[...FORM_ERROR_ORDER, ...Object.keys(errors).filter((k) => !FORM_ERROR_ORDER.includes(k))]
      .filter((key) => errors[key])
      .map((key) => ({ key: `field-${key}`, text: errors[key], targets: FORM_ERROR_TARGETS[key] ?? [] })),
    ...(liveCapture?.issues ?? []).map((issue) => ({
      key: `item-${issue.itemId ?? 'none'}-${issue.field ?? 'none'}`,
      text: issue.message,
      targets: itemIssueTargets(issue, items),
    })),
    ...(serverError ? [{ key: 'server', text: serverError, targets: [] }] : []),
  ];
  const hasErrors = summaryEntries.length > 0;

  // Layout of the header fields: which are real controls (and so get a <label>).
  const isLockedToProject = Boolean(userProjectId) && !hasGlobalAccess;
  const servicioIsSelect = !isLockedToProject
    && !isOficinaCentral(form.frente)
    && !(form.frente && !projects.some((p) => p.frente === form.frente));

  // Move the focus to the error summary after each failed submit (keyboard and
  // screen-reader users land on the list of what to fix).
  useEffect(() => {
    if (submitAttempt > 0) summaryRef.current?.focus();
  }, [submitAttempt]);

  // ── Helpers ─────────────────────────────────────────────────

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // When frente changes, reset servicio and proyecto
      if (name === 'frente') {
        if (isOficinaCentral(value)) {
          // SYSPCC-019: frente Oficina Central → Servicio/Proyecto fijos,
          // para todo usuario tenga o no departamento propio asignado.
          next.servicio = 'Oficina Central';
          next.destinationKey = userDepartmentId ? `dept-${userDepartmentId}` : 'dept-oficina';
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

  function updateItem(id, transform) {
    setItems((prev) => prev.map((item) => (item.id === id ? transform(item) : item)));
  }

  const lineNumber = (id) => items.findIndex((item) => item.id === id) + 1;

  function handleSelectProduct(id, product) {
    const current = items.find((item) => item.id === id);
    const next = current ? applyProduct(current, product) : null;
    updateItem(id, (item) => applyProduct(item, product));
    setAnnouncement(
      `Ítem ${lineNumber(id)}: ${product.product_code} – ${product.description} elegido.`
      + (next?.itemSourceProposed ? ` Fuente propuesta: ${itemSourceLabel(next.itemSource)}.` : ''),
    );
  }

  function handleClearProduct(id) {
    updateItem(id, clearProduct);
    setFocusTarget({ id, field: 'search' });
    setAnnouncement(`Ítem ${lineNumber(id)}: producto quitado. Busque otro producto del catálogo.`);
  }

  function handleToggleOffCatalog(id, enabled) {
    updateItem(id, (item) => setOffCatalog(item, enabled));
    setFocusTarget({ id, field: enabled ? 'description' : 'search' });
    setAnnouncement(
      enabled
        ? `Ítem ${lineNumber(id)}: fuera de catálogo. Describa el ítem.`
        : `Ítem ${lineNumber(id)}: vuelve al catálogo. Busque el producto.`,
    );
  }

  const atItemLimit = items.length >= MAX_REQUEST_ITEMS;

  function addItem() {
    if (atItemLimit) return;
    setItems((prev) => (prev.length >= MAX_REQUEST_ITEMS ? prev : [...prev, newCaptureItem()]));
    if (items.length + 1 >= MAX_REQUEST_ITEMS) {
      setAnnouncement(`Ítem ${items.length + 1} agregado. Alcanzó el máximo de ${MAX_REQUEST_ITEMS} ítems por requerimiento.`);
    }
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  // ── Validation ───────────────────────────────────────────────

  // The area is required also for "Guardar borrador": the backend creates the RQ
  // straight from this payload and answers 400 without it. The lines are checked
  // separately (validateCaptureItems), for both buttons.
  function validate(asDraft) {
    const errs = {};
    if (!form.requestingArea) errs.requestingArea = 'Seleccione el área del RQ (OP, QC, HSE o ADM).';
    if (asDraft) return errs;
    if (!form.rqNumber.trim()) errs.rqNumber = 'Ingrese el N° de Requerimiento.';
    if (!form.frente)          errs.frente        = 'Seleccione el frente.';
    if (!form.destinationKey)  errs.destinationKey = 'Seleccione un servicio.';
    if (!form.area)            errs.area         = 'Seleccione el área.';
    if (!form.fechaEntrega)    errs.fechaEntrega = 'Ingrese la fecha de entrega.';
    return errs;
  }

  // ── Submit ───────────────────────────────────────────────────

  async function handleSubmit(asDraft = false) {
    // Double click / Enter twice: the state below is not updated yet, the ref is.
    if (submitLock.current) return;

    setServerError(null);
    const errs = validate(asDraft);
    const capture = validateCaptureItems(items);
    if (Object.keys(errs).length > 0 || !capture.valid) {
      setErrors(errs);
      setSubmitAttempt((n) => n + 1);
      return;
    }
    setErrors({});
    submitLock.current = true;
    setSubmitting(true);
    // The server points at a line by its position among the lines SENT (blank rows are skipped);
    // keep the map to the form's row numbers from this very submit.
    const rowNumbers = payloadRowNumbers(items);

    try {
      // Only resolved lines go out (catalog product or explicit off-catalog);
      // `supply_source` is logistics' call and is never sent from here.
      const filledItems = buildItemsPayload(items, calcXAtender);

      const isProject = form.destinationKey?.startsWith('proj-');
      const isOficina = form.destinationKey === 'dept-oficina';
      const parsedDestId = isOficina ? null : destId;
      // For Oficina Central, find the ADM department
      const adminDept = departments.find((d) => d.code === 'ADM');
      const deptIdToSend = isOficina ? (adminDept?.id ?? null) : (isProject ? null : parsedDestId);
      const payload = {
        rq_number:           `REQ-${form.rqNumber.trim()}`,
        flow:                isProject ? 'OPERATIONS' : 'ADMINISTRATIVE',
        requesting_area:     form.requestingArea,
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

      // The backend creates the RQ already SUBMITTED (there is no editable draft):
      // both buttons end up in validation, so neither message may say "borrador".
      showToast({
        type:    'success',
        message: asDraft
          ? 'Requerimiento registrado y enviado a validación.'
          : 'Requerimiento enviado exitosamente. El Excel se ha descargado.',
      });
      setTimeout(() => navigate('/rq/requests'), 250);
    } catch (err) {
      console.error('Error al crear requerimiento:', err);
      // Cubre también el 400 { flow: [...] } del backend (SYSPCC-019) si la
      // combinación front_area/flow llegara a ser inconsistente — no debería
      // ocurrir desde esta UI, pero es la red de seguridad.
      const fieldErrors = extractFieldErrors(err);
      const message = extractCreateErrorMessage(err, 'Error al guardar el requerimiento.', rowNumbers);
      const areaFromServer = typeof fieldErrors.requesting_area === 'string';
      if (areaFromServer) {
        setErrors((prev) => ({ ...prev, requestingArea: fieldErrors.requesting_area }));
      }
      if (err?.response?.status === 400) {
        // Something to fix: put it in the summary and move the focus there (the toast alone
        // disappears in seconds and the user is looking at the buttons at the bottom).
        if (!areaFromServer) setServerError(message);
        setSubmitAttempt((n) => n + 1);
      }
      showToast({ type: 'error', message });
      submitLock.current = false;
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
    'w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1 focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 dark:focus:bg-blue-500/10 rounded transition-colors';

  const cellSelect =
    'w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1 focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 dark:focus:bg-blue-500/10 rounded transition-colors cursor-pointer';

  // ── Error input class helpers
  function fieldCls(hasError) {
    return `text-xs border rounded px-2 py-1.5 w-full focus:outline-none focus:ring-2 transition-colors ${
      hasError
        ? 'border-red-400 bg-red-50 focus:ring-red-400 dark:bg-red-500/10'
        : 'border-gray-200 focus:ring-blue-400'
    }`;
  }

  return (
    <div className="max-w-[1400px] mx-auto">

      {/* Always mounted: announces what happened to a line when the control that had the focus unmounts. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

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
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="form-errors-title"
          aria-describedby="form-errors-list"
          className="mb-5 flex items-start gap-3 p-4 bg-red-50 border-2 border-red-300 dark:bg-red-500/10 dark:border-red-500/30 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
        >
          <AlertCircle size={20} aria-hidden="true" className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p id="form-errors-title" className="text-sm font-bold text-red-700 dark:text-red-300">
              {summaryEntries.length === 1
                ? 'Corrija 1 error antes de enviar'
                : `Corrija ${summaryEntries.length} errores antes de enviar`}
            </p>
            {/* red-700 on red-50 = 6.5:1 (red-600 was 4.4:1). Each message takes you to its control. */}
            <ul id="form-errors-list" className="mt-1.5 space-y-0.5">
              {summaryEntries.map((entry) => (
                <li key={entry.key} className="text-sm text-red-700 dark:text-red-300 flex items-start gap-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" aria-hidden="true" />
                  {entry.targets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => focusField(entry.targets)}
                      className="text-left underline underline-offset-2 rounded hover:text-red-900 dark:hover:text-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                    >
                      {entry.text}
                    </button>
                  ) : (
                    <span>{entry.text}</span>
                  )}
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
                  <FieldLabel htmlFor="rqNumber" required>N° Requerimiento:</FieldLabel>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-0">
                    <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 border border-r-0 border-gray-200 rounded-l px-2 py-1.5 select-none">REQ-</span>
                    <input
                      id="rqNumber"
                      type="text"
                      name="rqNumber"
                      value={form.rqNumber}
                      onChange={handleChange}
                      placeholder="001"
                      {...invalidProps(errors, 'rqNumber', true)}
                      className={fieldCls(errors.rqNumber) + ' font-mono font-bold rounded-l-none'}
                    />
                  </div>
                  <FieldError id="rqNumber-error">{errors.rqNumber}</FieldError>
                </td>
              </tr>

              {/* Row 2: Uso específico / Fecha de requerimiento */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 align-top pt-3">
                  <FieldLabel htmlFor="usoEspecifico">Uso específico:</FieldLabel>
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  <textarea
                    id="usoEspecifico"
                    name="usoEspecifico"
                    value={form.usoEspecifico}
                    onChange={handleChange}
                    rows={2}
                    placeholder="Describe el uso específico del material..."
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                  />
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap">
                  <FieldLabel htmlFor="fechaRequerimiento">Fecha de requerimiento:</FieldLabel>
                </td>
                <td className="px-2 py-2">
                  <input
                    id="fechaRequerimiento"
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
                  {/* On screen only: the exported Excel keeps the official "Área" text. */}
                  <FieldLabel htmlFor={currentUser?.department ? undefined : 'area'} required>Área (departamento):</FieldLabel>
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  {currentUser?.department ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.area}
                    </span>
                  ) : (
                    <select
                      id="area"
                      name="area"
                      value={form.area}
                      onChange={handleChange}
                      {...invalidProps(errors, 'area', true)}
                      className={fieldCls(errors.area)}
                    >
                      <option value="">-- Seleccione --</option>
                      {AREAS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  )}
                  <FieldError id="area-error">{errors.area}</FieldError>
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <FieldLabel htmlFor={isLockedToProject ? undefined : 'frente'} required>Frente:</FieldLabel>
                </td>
                <td className="px-2 py-2">
                  {userProjectId && !hasGlobalAccess ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.frente || '—'}
                    </span>
                  ) : (
                    <select
                      id="frente"
                      name="frente"
                      value={form.frente}
                      onChange={handleChange}
                      {...invalidProps(errors, 'frente', true)}
                      className={fieldCls(errors.frente)}
                    >
                      <option value="">-- Seleccione --</option>
                      {frentes.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  )}
                  <FieldError id="frente-error">{errors.frente}</FieldError>
                </td>
              </tr>

              {/* Row 3b: Área del RQ — OP / QC / HSE / ADM (SYSPCC-026) */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <FieldLabel htmlFor="requestingArea" required>Área del RQ (OP / QC / HSE / ADM):</FieldLabel>
                </td>
                <td colSpan={3} className="px-2 py-2">
                  <select
                    id="requestingArea"
                    name="requestingArea"
                    value={form.requestingArea}
                    onChange={handleChange}
                    aria-required="true"
                    aria-invalid={errors.requestingArea ? true : undefined}
                    aria-describedby={errors.requestingArea ? 'requestingArea-help requestingArea-error' : 'requestingArea-help'}
                    className={fieldCls(errors.requestingArea) + ' max-w-sm'}
                  >
                    <option value="">-- Seleccione --</option>
                    {REQUESTING_AREAS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                  {/* Right under the select (it used to sit in another column) and kept in aria-describedby. */}
                  <p id="requestingArea-help" className="mt-1 text-[11px] text-gray-600 normal-case">
                    Área funcional que solicita (Operaciones, Calidad, Seguridad o Administración). No es el departamento.
                  </p>
                  <FieldError id="requestingArea-error">{errors.requestingArea}</FieldError>
                </td>
              </tr>

              {/* Row 4: Fecha entrega (required) / Servicio */}
              <tr className="border-b border-gray-300">
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600 whitespace-nowrap">
                  <FieldLabel htmlFor="fechaEntrega" required>Fecha entrega:</FieldLabel>
                </td>
                <td className="border-r border-gray-300 px-2 py-2">
                  <input
                    id="fechaEntrega"
                    type="date"
                    name="fechaEntrega"
                    value={form.fechaEntrega}
                    onChange={handleChange}
                    {...invalidProps(errors, 'fechaEntrega', true)}
                    className={fieldCls(errors.fechaEntrega)}
                  />
                  <FieldError id="fechaEntrega-error">{errors.fechaEntrega}</FieldError>
                </td>
                <td className="border-r border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase text-gray-600">
                  <FieldLabel htmlFor={servicioIsSelect ? 'servicio' : undefined} required>Servicio:</FieldLabel>
                </td>
                <td className="px-2 py-2">
                  {userProjectId && !hasGlobalAccess ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.servicio || '—'}
                    </span>
                  ) : isOficinaCentral(form.frente) ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      Oficina Central
                    </span>
                  ) : form.frente && !projects.some((p) => p.frente === form.frente) ? (
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 block">
                      {form.servicio || '—'}
                    </span>
                  ) : (
                    <>
                      <select
                        id="servicio"
                        name="servicio"
                        value={form.destinationKey}
                        onChange={handleChange}
                        aria-required="true"
                        aria-invalid={errors.destinationKey ? true : undefined}
                        aria-describedby={errors.destinationKey ? 'destinationKey-error' : undefined}
                        className={fieldCls(errors.destinationKey)}
                        disabled={!form.frente}
                      >
                        <option value="">{form.frente ? '-- Seleccione servicio --' : '-- Seleccione frente primero --'}</option>
                        {serviciosForFrente.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
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
                    {isOficinaCentral(form.frente)
                      ? 'Oficina Central'
                      : selectedProject
                      ? `${selectedProject.code} — ${selectedProject.name}`
                      : selectedDepartment
                      ? `${selectedDepartment.name}`
                      : form.destinationKey ? form.servicio : '— Seleccione frente y servicio —'}
                  </span>
                  <FieldError id="destinationKey-error">{errors.destinationKey}</FieldError>
                </td>
              </tr>

              {/* Tipo de pedido: lo determina Logística, no el solicitante */}
            </tbody>
          </table>
        </div>

        {/* ── STEP 2 HEADING inside document — Items ───────────────── */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-200 bg-gray-50/50 dark:bg-transparent">
          <StepHeading
            number="2"
            title="Lista de Materiales y/o Equipos"
            subtitle="Cada ítem lleva su fuente y su cantidad. La columna X Atender se calcula automáticamente."
            helpId={OFF_CATALOG_HELP_ID}
            help={'Elija el producto en el buscador. Marque "Fuera de catálogo" solo para servicios u otros ítems que no pasan por el almacén (p. ej. alquiler o transporte).'}
          />
        </div>

        {/* ── ITEMS TABLE ───────────────────────────────────────────── */}
        <div className="border-b border-gray-400">
          {/* `relative`: the table's sr-only elements are absolutely positioned; without a
              positioned scroller they escape the clipping and widen the whole page. */}
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse text-xs" style={{ minWidth: '1380px' }}>
              <caption className="sr-only">
                Lista de materiales y equipos del requerimiento. Cada ítem se elige del catálogo de almacén
                o se marca como fuera de catálogo, y lleva su fuente.
              </caption>
              <thead>
                <tr className="bg-blue-50 dark:bg-blue-500/10 border-b border-gray-300">
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-8">
                    #
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-72">
                    Equipos / Unidades
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Unidad
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Cantidad <span className="text-red-500 font-bold" aria-hidden="true">*</span>
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-32">
                    Fuente <span className="text-red-500 font-bold" aria-hidden="true">*</span>
                  </th>
                  <th
                    scope="col"
                    title="Stock que usted declara en el almacén de obra"
                    className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-20"
                  >
                    Stock Obra
                  </th>
                  <th
                    scope="col"
                    title="Stock que usted declara en el almacén principal (el almacén central del sistema)"
                    className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24"
                  >
                    Stock Principal
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-blue-700 uppercase text-[10px] w-16 bg-yellow-50 dark:text-blue-300 dark:bg-yellow-500/10">
                    X Atender
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Pres. / Adic.
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-20">
                    RFI / FWO
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px] w-24">
                    Estatus / Guía
                  </th>
                  <th scope="col" className="border-r border-gray-200 px-2 py-2.5 text-center font-bold text-gray-700 uppercase text-[10px]">
                    Comentarios
                  </th>
                  <th scope="col" className="px-2 py-2.5 w-10">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const n = idx + 1;
                  const xAtenderVal = calcXAtender(item);
                  const isEven = idx % 2 === 0;
                  const problems = itemProblems[item.id] ?? {};
                  const sourceErrorId = `item-${item.id}-source-error`;
                  const quantityErrorId = `item-${item.id}-quantity-error`;
                  const linked = item.mode === 'catalog' && item.product;
                  return (
                    <tr
                      key={item.id}
                      className={[
                        'border-b border-gray-200 hover:bg-blue-50/40 dark:hover:bg-blue-500/10 transition-colors align-top',
                        isEven ? 'bg-white' : 'bg-gray-50/50 dark:bg-white/5',
                      ].join(' ')}
                    >
                      {/* Item number */}
                      <td className="border-r border-gray-200 px-2 py-2 text-center text-gray-600 font-mono font-bold">
                        {n}
                      </td>

                      {/* Equipos/Unidades — catalog product or explicit off-catalog */}
                      <td className="border-r border-gray-200 px-2 py-1.5">
                        <ItemProductCell
                          item={item}
                          index={idx}
                          error={problems.product}
                          focusSearch={focusTarget?.id === item.id && focusTarget.field === 'search'}
                          focusDescription={focusTarget?.id === item.id && focusTarget.field === 'description'}
                          onSelect={(product) => handleSelectProduct(item.id, product)}
                          onClear={() => handleClearProduct(item.id)}
                          onToggleOffCatalog={(enabled) => handleToggleOffCatalog(item.id, enabled)}
                          onDescription={(text) => handleItemChange(item.id, 'descripcion', text)}
                          onSearchText={(text) => handleItemChange(item.id, 'searchText', text)}
                        />
                      </td>

                      {/* Unidad de Medida — fixed by the catalog product when linked */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        {linked ? (
                          <span className="block px-1.5 py-1 font-mono text-xs text-gray-700">{item.product.unit}</span>
                        ) : (
                          <select
                            value={item.unidad}
                            onChange={(e) => handleItemChange(item.id, 'unidad', e.target.value)}
                            aria-label={`Unidad del ítem ${n}`}
                            className={cellSelect}
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Cantidad */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          id={`item-${item.id}-quantity`}
                          type="number"
                          min="0"
                          step="any"
                          value={item.cantidad}
                          onChange={(e) => handleItemChange(item.id, 'cantidad', e.target.value)}
                          aria-label={`Cantidad del ítem ${n}`}
                          aria-required="true"
                          aria-invalid={problems.quantity ? true : undefined}
                          aria-describedby={problems.quantity ? quantityErrorId : undefined}
                          placeholder="0"
                          className={`${cellInput} text-right ${problems.quantity ? 'ring-1 ring-red-500 bg-red-50 dark:bg-red-500/10' : ''}`}
                        />
                        {problems.quantity && (
                          <p id={quantityErrorId} className="mt-0.5 px-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {problems.quantity}
                          </p>
                        )}
                      </td>

                      {/* Fuente (required) — proposed from the product category, correctable */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <select
                          id={`item-${item.id}-source`}
                          value={item.itemSource}
                          onChange={(e) => updateItem(item.id, (it) => setItemSource(it, e.target.value))}
                          aria-label={`Fuente del ítem ${n}`}
                          aria-required="true"
                          aria-invalid={problems.source ? true : undefined}
                          aria-describedby={problems.source ? sourceErrorId : undefined}
                          className={`${cellSelect} ${problems.source ? 'ring-1 ring-red-400 bg-red-50 dark:bg-red-500/10' : ''}`}
                        >
                          <option value="">-- Fuente --</option>
                          {ITEM_SOURCES.map((src) => (
                            <option key={src.value} value={src.value}>{src.label}</option>
                          ))}
                        </select>
                        {item.itemSourceProposed && !problems.source && (
                          <p className="mt-0.5 px-1 text-[10px] text-gray-500">Propuesta según el producto</p>
                        )}
                        {problems.source && (
                          <p id={sourceErrorId} className="mt-0.5 px-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {problems.source}
                          </p>
                        )}
                      </td>

                      {/* Stock Almacén Obra */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.stockAlmacenObra}
                          onChange={(e) => handleItemChange(item.id, 'stockAlmacenObra', e.target.value)}
                          aria-label={`Stock declarado en el almacén de obra del ítem ${n}`}
                          className={`${cellInput} text-right`}
                        />
                      </td>

                      {/* Stock Almacén Principal = the system's central warehouse. What the person types is
                          DECLARED (labelled so); the live figure is "Disponible en almacén central" of the
                          catalog search. The column keeps the official Excel header. */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.stockAlmacenPrincipal}
                          onChange={(e) => handleItemChange(item.id, 'stockAlmacenPrincipal', e.target.value)}
                          aria-label={`Stock declarado en el almacén principal (central) del ítem ${n}`}
                          className={`${cellInput} text-right`}
                        />
                      </td>

                      {/* X Atender (auto-calculated, editable) */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5 bg-yellow-50/60 dark:bg-yellow-500/10">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.xAtenderManual ? item.xAtender : xAtenderVal}
                          onChange={(e) => handleItemChange(item.id, 'xAtender', e.target.value)}
                          aria-label={`Cantidad por atender del ítem ${n}`}
                          className={`${cellInput} text-right font-bold text-blue-700 dark:text-blue-300`}
                          title="Auto-calculado: Cantidad - Stock Obra - Stock Principal. Editable."
                        />
                      </td>

                      {/* Presupuestado/Adicional */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <select
                          value={item.presupuestadoAdicional}
                          onChange={(e) => handleItemChange(item.id, 'presupuestadoAdicional', e.target.value)}
                          aria-label={`Presupuestado o adicional del ítem ${n}`}
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
                          maxLength={RFI_FWO_MAX_LENGTH}
                          onChange={(e) => handleItemChange(item.id, 'rfiFwo', e.target.value)}
                          aria-label={`RFI o FWO del ítem ${n}`}
                          placeholder="RFI-000"
                          className={cellInput}
                        />
                      </td>

                      {/* Estatus/Guía (read-only in create) */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5 bg-gray-100/60 dark:bg-white/5">
                        <input
                          type="text"
                          value={item.estatusGuia}
                          readOnly
                          aria-label={`Estatus o guía del ítem ${n} (lo completa Logística o Almacén)`}
                          placeholder="—"
                          className={`${cellInput} text-gray-500 cursor-not-allowed`}
                          title="Se completa por Logística/Almacén"
                        />
                      </td>

                      {/* Comentarios */}
                      <td className="border-r border-gray-200 px-1.5 py-1.5">
                        <input
                          type="text"
                          value={item.comentarios}
                          onChange={(e) => handleItemChange(item.id, 'comentarios', e.target.value)}
                          aria-label={`Comentarios del ítem ${n}`}
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
                          aria-label={`Eliminar el ítem ${n}`}
                          className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-md"
                          title="Eliminar fila"
                        >
                          <Trash2 size={14} aria-hidden="true" />
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
              aria-disabled={atItemLimit || undefined}
              aria-describedby={atItemLimit ? 'items-limit-note' : undefined}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-700 bg-white border-2 border-blue-300 rounded-lg hover:bg-blue-50 hover:border-blue-400 active:scale-95 transition-all duration-200 shadow-sm dark:text-blue-300 dark:border-blue-500/30 dark:hover:bg-blue-500/10 ${
                atItemLimit ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Plus size={16} aria-hidden="true" />
              Agregar ítem
            </button>
            <span className="text-xs text-gray-500">
              {items.length} fila{items.length !== 1 ? 's' : ''} · "X Atender" se calcula automáticamente
            </span>
            {atItemLimit && (
              <span id="items-limit-note" className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Alcanzó el máximo de {MAX_REQUEST_ITEMS} ítems por requerimiento. Para pedir más, cree otro requerimiento.
              </span>
            )}
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
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border-2 border-green-400 text-green-700 rounded-xl text-sm font-semibold hover:bg-green-50 hover:border-green-500 transition-all duration-200 dark:text-green-300 dark:hover:bg-green-500/10"
          >
            <Download size={18} />
            Descargar Excel
          </button>

          {/* Secondary — register without downloading the Excel. NOT a draft: the backend creates
              the RQ already SUBMITTED, so it goes straight to validation (product decision pending). */}
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 border-2 border-gray-400 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:border-gray-500 transition-all duration-200 disabled:opacity-50"
          >
            <Save size={18} aria-hidden="true" />
            Enviar sin Excel
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
