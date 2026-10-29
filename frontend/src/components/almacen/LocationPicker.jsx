import { useId, useState } from 'react';
import { MapPin } from 'lucide-react';
import { FLOOR_LABELS, splitLocation } from '../../utils/almacen';
import { inputCls } from './uiStyles';

/**
 * Selectores Pabellón / Sección / Nivel para la ubicación exacta
 * `{Pabellón}{Sección}-{Nivel}` (fase 3, almacenamiento). El layout viene del
 * backend (única fuente de verdad); el formato no se puede escribir a mano.
 * Llama a `onChange(code)` con `F3-2` cuando los tres están elegidos y con ''
 * mientras falte alguno. Para reiniciarlo desde fuera, cambie su `key`.
 */
export default function LocationPicker({
  layout, floor = null, value = '', onChange, idPrefix, disabled = false, invalid = false, describedBy, firstSelectRef,
}) {
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const [parts, setParts] = useState(() => splitLocation(value));

  const floors = layout?.floors ?? [];
  const levels = layout?.levels ?? [1, 2, 3, 4, 5];
  const floorNumber = floor ? Number(floor) : null;
  const visibleFloors = floorNumber ? floors.filter((f) => f.floor === floorNumber) : floors;
  const allPavilions = floors.flatMap((f) => f.pavilions);
  const selectedPavilion = allPavilions.find((p) => p.code === parts.pavilion);
  const sectionCount = selectedPavilion?.sections ?? 0;

  const update = (patch) => {
    const next = { ...parts, ...patch };
    if (patch.pavilion !== undefined && patch.pavilion !== parts.pavilion) {
      const pav = allPavilions.find((p) => p.code === patch.pavilion);
      if (!pav || Number(next.section) > pav.sections) next.section = '';
    }
    setParts(next);
    onChange(next.pavilion && next.section && next.level ? `${next.pavilion}${next.section}-${next.level}` : '');
  };

  const code = parts.pavilion && parts.section && parts.level
    ? `${parts.pavilion}${parts.section}-${parts.level}`
    : '';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${prefix}-pav`} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Pabellón</label>
          <select
            id={`${prefix}-pav`}
            ref={firstSelectRef}
            value={parts.pavilion}
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => update({ pavilion: e.target.value })}
            className={inputCls(invalid)}
          >
            <option value="">—</option>
            {visibleFloors.map((f) => (
              <optgroup key={f.floor} label={FLOOR_LABELS[f.floor] ?? `Piso ${f.floor}`}>
                {f.pavilions.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${prefix}-sec`} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Sección</label>
          <select
            id={`${prefix}-sec`}
            value={parts.section}
            disabled={disabled || !parts.pavilion}
            aria-describedby={describedBy}
            onChange={(e) => update({ section: e.target.value })}
            className={inputCls(false)}
          >
            <option value="">—</option>
            {Array.from({ length: sectionCount }, (_, i) => String(i + 1)).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${prefix}-lvl`} className="block text-xs font-semibold text-gray-600 mb-1.5 font-display">Nivel</label>
          <select
            id={`${prefix}-lvl`}
            value={parts.level}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(e) => update({ level: e.target.value })}
            className={inputCls(false)}
          >
            <option value="">—</option>
            {levels.map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-gray-600" aria-live="polite">
        <MapPin size={13} className="text-gray-400" aria-hidden="true" />
        {code
          ? <>Ubicación: <strong className="font-mono text-gray-900">{code}</strong></>
          : 'Formato: Pabellón + Sección – Nivel (ej. B3-2).'}
      </p>
    </div>
  );
}
