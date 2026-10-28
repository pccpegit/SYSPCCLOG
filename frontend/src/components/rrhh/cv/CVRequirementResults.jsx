import { CheckCircle2, CircleDot, CircleHelp, ShieldCheck, XCircle } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

const CONFIG = {
  met: { icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-300' },
  partial: { icon: CircleDot, cls: 'text-amber-700 dark:text-amber-300' },
  not_met: { icon: XCircle, cls: 'text-red-700 dark:text-red-300' },
  unknown: { icon: CircleHelp, cls: 'text-gray-600' },
};

/** Per-requirement result: icon + text (Cumple / Parcial / No cumple / Sin información) + evidence. */
export default function CVRequirementResults({ rows }) {
  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        const cfg = CONFIG[row.status] ?? CONFIG.unknown;
        const Icon = cfg.icon;
        return (
          <li key={row.id ?? i} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className={`flex items-center gap-1.5 text-sm font-bold ${cfg.cls}`}>
              <Icon size={16} aria-hidden="true" />
              {COPY.drawer.reqStatus[row.status] ?? COPY.drawer.reqStatus.unknown}
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-gray-900">
              {Number(row.weight) === 3 && (
                <>
                  <ShieldCheck size={16} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                  <span className="sr-only">{COPY.drawer.mandatory}: </span>
                </>
              )}
              {row.text}
            </p>
            {row.evidence && (
              <p className="mt-1 text-sm text-gray-700">
                <span className="font-semibold">{COPY.drawer.evidence}</span> {row.evidence}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
