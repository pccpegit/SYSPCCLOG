import { useEffect, useRef, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import {
  AREA_FILTER_OPTIONS, SOURCE_FILTER_OPTIONS, ITEM_STATUS_OPTIONS, STAGE_OPTIONS, MAX_SEARCH_LENGTH, SEARCH_DEBOUNCE_MS,
} from '../../data/requestMaster';

const CONTROL =
  'w-full min-h-11 px-3 border border-gray-200 rounded-xl text-sm bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const LABEL = 'block text-[11px] font-bold text-gray-500 uppercase tracking-wider font-display mb-1';

function Field({ id, label, children }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children}
    </div>
  );
}

function Select({ id, label, value, onChange, options, allLabel }) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/**
 * Búsqueda con espera: el texto se ve al instante y se envía a la URL (y a la API) recién cuando
 * se deja de teclear. Si la URL cambia desde fuera (Limpiar, Atrás), el texto se resincroniza.
 */
function SearchBox({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef(null);

  if (value !== seen) {
    setSeen(value);
    // El valor de la URL va sin espacios en los extremos: no pisar lo que se está tecleando.
    if (value !== draft.trim()) setDraft(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(e) {
    const next = e.target.value.slice(0, MAX_SEARCH_LENGTH);
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next.trim()), SEARCH_DEBOUNCE_MS);
  }

  return (
    <Field id="master-search" label="Buscar">
      <div className="relative">
        <Search size={15} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id="master-search"
          type="search"
          value={draft}
          onChange={handleChange}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="RQ, descripción, código, guía…"
          className={`${CONTROL} pl-10`}
        />
      </div>
    </Field>
  );
}

function Check({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
        className="size-4 rounded border-gray-300 accent-blue-600"
      />
      {label}
    </label>
  );
}

/** Filtros del Master. `filters` viene de la URL; cada cambio llama `onChange({ clave: valor })`. */
export default function MasterFilters({ filters, projects, onChange, onClear, activeCount }) {
  const projectOptions = projects.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }));
  return (
    <section aria-labelledby="master-filters-title" className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Filter size={15} className="text-blue-500" aria-hidden="true" />
        <h2 id="master-filters-title" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider font-display">
          Filtros{activeCount ? ` (${activeCount})` : ''}
        </h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 px-3 rounded-lg font-display"
          >
            <X size={13} aria-hidden="true" />
            Limpiar filtros
          </button>
        )}
      </div>

      <div role="search" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SearchBox value={filters.search} onCommit={(search) => onChange({ search })} />
        <Select id="master-project" label="Proyecto" allLabel="Todos los proyectos" value={filters.project} options={projectOptions} onChange={(project) => onChange({ project })} />
        <Select id="master-area" label="Área" allLabel="Todas las áreas" value={filters.area} options={AREA_FILTER_OPTIONS} onChange={(area) => onChange({ area })} />
        <Select id="master-source" label="Fuente" allLabel="Todas las fuentes" value={filters.source} options={SOURCE_FILTER_OPTIONS} onChange={(source) => onChange({ source })} />
        <Select id="master-item-status" label="Estado del ítem" allLabel="Todos los estados" value={filters.item_status} options={ITEM_STATUS_OPTIONS} onChange={(item_status) => onChange({ item_status })} />
        <Select id="master-stage" label="Etapa" allLabel="Todas las etapas" value={filters.stage} options={STAGE_OPTIONS} onChange={(stage) => onChange({ stage })} />

        <Field id="master-approved-from" label="Aprobado desde">
          <input id="master-approved-from" type="date" value={filters.approved_from} max={filters.approved_to || undefined} onChange={(e) => onChange({ approved_from: e.target.value })} className={CONTROL} />
        </Field>
        <Field id="master-approved-to" label="Aprobado hasta">
          <input id="master-approved-to" type="date" value={filters.approved_to} min={filters.approved_from || undefined} onChange={(e) => onChange({ approved_to: e.target.value })} className={CONTROL} />
        </Field>
        <Field id="master-attended-from" label="Atendido desde">
          <input id="master-attended-from" type="date" value={filters.attended_from} max={filters.attended_to || undefined} onChange={(e) => onChange({ attended_from: e.target.value })} className={CONTROL} />
        </Field>
        <Field id="master-attended-to" label="Atendido hasta">
          <input id="master-attended-to" type="date" value={filters.attended_to} min={filters.attended_from || undefined} onChange={(e) => onChange({ attended_to: e.target.value })} className={CONTROL} />
        </Field>

        <div className="sm:col-span-2 flex flex-wrap items-end gap-x-6">
          <Check id="master-with-shortage" label="Solo con faltante" checked={filters.with_shortage === '1'} onChange={(with_shortage) => onChange({ with_shortage })} />
          <Check id="master-with-alerts" label="Solo con alertas" checked={filters.with_alerts === '1'} onChange={(with_alerts) => onChange({ with_alerts })} />
        </div>
      </div>
    </section>
  );
}
