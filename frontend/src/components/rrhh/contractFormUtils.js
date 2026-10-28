// SYSPCC-022 — helpers for the form driven by the GET /hr/document-types/
// schema. The backend is the source of truth for the rules; this only
// validates enough to give immediate feedback.

const DNI_RE = /^\d{8}$/;
const FOREIGN_ID_RE = /^[A-Za-z0-9]{9,12}$/;
const DECIMAL_RE = /^\d{1,8}(\.\d{1,2})?$/;

/** DOM id of a form field control (for focus and aria). */
export function fieldDomId(key) {
  return `hr-field-${key}`;
}

export const REQUIRED_MSG = 'Este campo es obligatorio.';

/** Visual grouping of contract fields (key -> section). */
export const CONTRACT_SECTIONS = [
  { id: 'trabajador', title: 'Datos del trabajador', keys: ['worker_full_name', 'worker_dni', 'worker_nationality', 'worker_marital_status', 'worker_birth_date', 'worker_address'] },
  { id: 'cargo', title: 'Cargo y lugar de trabajo', keys: ['position', 'job_description', 'work_location'] },
  { id: 'plazo', title: 'Plazo del contrato', keys: ['contract_type', 'fixed_term_modality', 'fixed_term_cause', 'start_date', 'end_date', 'probation_months'] },
  { id: 'remuneracion', title: 'Remuneración y jornada', keys: ['gross_salary', 'currency', 'payment_frequency', 'work_schedule'] },
  { id: 'suscripcion', title: 'Suscripción', keys: ['issue_date'] },
];

export function todayISO() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "1130.00" / "2500.5" -> integer cents (no floats). null if not a valid decimal. */
export function toCents(value) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}

/** Formats a decimal string amount as "S/ 1,130.00". */
export function formatPen(value) {
  const cents = toCents(value);
  if (cents === null) return String(value);
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `S/ ${whole}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Initial values: the schema `default` ("today" -> today's date).
 * `constraints.default_probation_months` (backend) overrides the default of
 * the `probation_months` field when that field exists.
 */
export function initialValues(fields, constraints = {}) {
  const out = {};
  (fields ?? []).forEach((f) => {
    if (f.default === null || f.default === undefined) {
      out[f.key] = '';
    } else if (f.default === 'today') {
      out[f.key] = todayISO();
    } else {
      out[f.key] = String(f.default);
    }
  });
  if ('probation_months' in out && constraints?.default_probation_months != null) {
    out.probation_months = String(constraints.default_probation_months);
  }
  return out;
}

/** Parses `required_when` ("field=VALUE"). Empty = always applies. */
export function isFieldApplicable(field, values) {
  if (!field.required_when) return true;
  const [key, expected] = field.required_when.split('=');
  return (values[key] ?? '') === expected;
}

export function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Merges `incoming` (prefill/assistant) without overwriting what the user typed. */
export function mergeWithoutOverwrite(current, incoming) {
  const next = { ...current };
  Object.entries(incoming ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (isEmpty(next[key])) next[key] = String(value);
  });
  return next;
}

/** Returns { key: message } with the client-side validation errors. */
export function validateContract(fields, values, constraints = {}) {
  const errors = {};
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  fields.forEach((f) => {
    if (!isFieldApplicable(f, values)) return;
    // A conditional field (required_when) is mandatory whenever it applies.
    const mustHave = f.required || Boolean(f.required_when);
    if (mustHave && isEmpty(values[f.key])) errors[f.key] = REQUIRED_MSG;
  });

  const dni = (values.worker_dni ?? '').trim();
  if (!errors.worker_dni && dni && !(DNI_RE.test(dni) || FOREIGN_ID_RE.test(dni))) {
    errors.worker_dni = 'Usa 8 dígitos (DNI) o 9 a 12 caracteres alfanuméricos (CE o pasaporte).';
  }

  const salary = (values.gross_salary ?? '').trim();
  if (!errors.gross_salary && byKey.gross_salary && salary) {
    if (!DECIMAL_RE.test(salary)) {
      errors.gross_salary = 'Ingresa un monto válido, con hasta 2 decimales (ej. 2500.00).';
    } else if (Number(salary) <= 0) {
      errors.gross_salary = 'El sueldo debe ser mayor a 0.';
    } else if (
      constraints?.min_wage
      && (values.currency || 'PEN') === 'PEN'
      && toCents(salary) < toCents(constraints.min_wage)
    ) {
      errors.gross_salary = `El sueldo no puede ser menor a la remuneración mínima vital vigente (${formatPen(constraints.min_wage)}).`;
    }
  }

  if (values.contract_type === 'FIXED_TERM' && values.start_date && values.end_date && !errors.end_date) {
    if (values.end_date <= values.start_date) {
      errors.end_date = 'La fecha de fin debe ser posterior a la fecha de inicio.';
    }
  }

  const probation = (values.probation_months ?? '').trim();
  if (!errors.probation_months && probation) {
    if (!/^\d+$/.test(probation) || Number(probation) > 12) {
      errors.probation_months = 'Ingresa un número entero entre 0 y 12.';
    }
  }

  return errors;
}

/** Builds the POST/PATCH `data`: only applicable, non-empty fields. */
export function buildPayload(fields, values) {
  const data = {};
  fields.forEach((f) => {
    if (!isFieldApplicable(f, values)) return;
    const raw = values[f.key];
    if (isEmpty(raw)) return;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    data[f.key] = f.type === 'integer' ? Number(value) : value;
  });
  return data;
}

/** Form values from the document `data` (everything as strings). */
export function valuesFromData(fields, data, constraints = {}) {
  const base = initialValues(fields, constraints);
  Object.entries(data ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) base[key] = String(value);
  });
  return base;
}
