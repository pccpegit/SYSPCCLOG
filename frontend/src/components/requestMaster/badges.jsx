import {
  CircleCheck, CircleDot, Clock, CirclePause, CircleX, Ban, Link2Off, TriangleAlert,
} from 'lucide-react';
import { TONES } from '../almacen/uiStyles';
import { ITEM_STATUS_LABELS, STAGE_LABELS } from '../../data/requestMaster';
import { clampPercent, formatPercent } from '../../utils/requestMaster';

const ORANGE = 'bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30';

// Estado del ítem: color + icono + texto (el color nunca es el único canal).
const STATUS_STYLE = {
  ATENDIDO:     { icon: CircleCheck, tone: TONES.emerald },
  PARCIAL:      { icon: CircleDot,   tone: TONES.amber },
  PENDIENTE:    { icon: Clock,       tone: TONES.blue },
  STAND_BY:     { icon: CirclePause, tone: TONES.violet },
  DESESTIMADO:  { icon: CircleX,     tone: TONES.gray },
  ANULADO:      { icon: Ban,         tone: TONES.red },
  SIN_VINCULAR: { icon: Link2Off,    tone: ORANGE },
};

export function ItemStatusBadge({ status, label }) {
  const style = STATUS_STYLE[status] ?? { icon: Clock, tone: TONES.gray };
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset whitespace-nowrap ${style.tone}`}>
      <Icon size={12} aria-hidden="true" className="shrink-0" />
      {label || ITEM_STATUS_LABELS[status] || status}
    </span>
  );
}

export function StageChip({ stage, label, phase }) {
  const text = label || STAGE_LABELS[stage] || stage;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${TONES.blue}`}>
      {phase ? <span className="font-mono text-[10px] opacity-80" title={`Fase ${phase} del flujo`}>F{phase}</span> : null}
      {text}
    </span>
  );
}

/** Alertas de seguimiento de la fila (`[{code, label}]`). */
export function AlertChips({ alerts = [] }) {
  if (!alerts.length) return <span className="text-gray-400">—</span>;
  return (
    <ul className="flex flex-col gap-1 items-start">
      {alerts.map((alert) => (
        <li
          key={alert.code}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES.amber}`}
        >
          <TriangleAlert size={11} aria-hidden="true" className="shrink-0" />
          {alert.label}
        </li>
      ))}
    </ul>
  );
}

/** Barra de avance de un RQ; `percent` null = sin ítems contables. */
export function PercentBar({ percent, label }) {
  const known = percent !== null && percent !== undefined;
  const value = clampPercent(percent);
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(value) : undefined}
        aria-valuetext={known ? formatPercent(percent) : 'Sin ítems contables'}
        className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden"
      >
        <div
          className={`h-full rounded-full ${value >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${known ? value : 0}%` }}
        />
      </div>
      <span className="w-12 text-right text-xs font-bold tabular-nums text-gray-700">{formatPercent(percent)}</span>
    </div>
  );
}
