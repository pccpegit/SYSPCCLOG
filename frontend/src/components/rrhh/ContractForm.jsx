import { CONTRACT_SECTIONS, fieldDomId, isFieldApplicable, isEmpty } from './contractFormUtils';

const baseInput =
  'w-full px-3 py-2.5 text-sm rounded-xl border bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 focus:bg-white transition-colors disabled:opacity-60';
const okInput = 'border-gray-200 focus:ring-violet-500 focus:border-violet-500';
const flaggedInput = 'border-amber-400 dark:border-amber-500/60 focus:ring-amber-500 focus:border-amber-500';
const errorInput = 'border-red-400 dark:border-red-500/60 focus:ring-red-500 focus:border-red-500';

const SOURCE_CHIPS = {
  personal: 'Desde Personal',
  assistant: 'Sugerido por el asistente',
};

function Field({ field, value, onChange, error, question, source, disabled }) {
  const id = fieldDomId(field.key);
  const flagged = !error && Boolean(question) && isEmpty(value);
  const mustHave = field.required || Boolean(field.required_when);
  const describedBy = [
    field.help ? `${id}-help` : null,
    flagged ? `${id}-question` : null,
    error ? `${id}-error` : null,
  ].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error) || flagged;
  const cls = `${baseInput} ${error ? errorInput : flagged ? flaggedInput : okInput}`;

  const common = {
    id,
    name: field.key,
    value,
    disabled,
    onChange: (e) => onChange(field.key, e.target.value),
    'aria-required': mustHave || undefined,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    className: cls,
  };

  let control;
  if (field.type === 'choice') {
    control = (
      <select {...common}>
        <option value="">Seleccionar…</option>
        {field.choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    );
  } else if (field.type === 'text') {
    control = <textarea {...common} rows={3} />;
  } else if (field.type === 'date') {
    control = <input {...common} type="date" />;
  } else if (field.type === 'decimal') {
    control = <input {...common} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" />;
  } else if (field.type === 'integer') {
    control = <input {...common} type="text" inputMode="numeric" autoComplete="off" />;
  } else {
    control = <input {...common} type="text" autoComplete="off" />;
  }

  const wide = field.type === 'text' || field.key === 'worker_address' || field.key === 'worker_full_name';

  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-xs font-semibold text-gray-600">
          {field.label}
          {mustHave && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
          {mustHave && <span className="sr-only"> (obligatorio)</span>}
        </label>
        {source && SOURCE_CHIPS[source] && !isEmpty(value) && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            {SOURCE_CHIPS[source]}
          </span>
        )}
      </div>
      {flagged && (
        <p id={`${id}-question`} className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
          Falta este dato. {question}
        </p>
      )}
      {control}
      {field.help && <p id={`${id}-help`} className="text-[11px] text-gray-400 mt-1">{field.help}</p>}
      {error && (
        <p id={`${id}-error`} className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Contract form driven by `fields` (backend schema).
 * - `errors`: { key: message } (client validation + backend 400 errors).
 * - `questions`: { key: question } for missing fields (assistant / prefill);
 *   highlighted while the field is still empty.
 * - `sources`: { key: 'personal' | 'assistant' } for the origin tag.
 */
export default function ContractForm({
  fields,
  values,
  onChange,
  errors = {},
  questions = {},
  sources = {},
  disabled = false,
}) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const known = new Set(CONTRACT_SECTIONS.flatMap((s) => s.keys));
  const extra = fields.filter((f) => !known.has(f.key)).map((f) => f.key);
  const sections = extra.length
    ? [...CONTRACT_SECTIONS, { id: 'otros', title: 'Otros datos', keys: extra }]
    : CONTRACT_SECTIONS;

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const visible = section.keys
          .map((k) => byKey[k])
          .filter((f) => f && isFieldApplicable(f, values));
        if (visible.length === 0) return null;
        return (
          <fieldset
            key={section.id}
            className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6"
          >
            <legend className="px-1 text-sm font-semibold text-gray-700 font-display">
              {section.title}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              {visible.map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? ''}
                  onChange={onChange}
                  error={errors[f.key]}
                  question={questions[f.key]}
                  source={sources[f.key]}
                  disabled={disabled}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
