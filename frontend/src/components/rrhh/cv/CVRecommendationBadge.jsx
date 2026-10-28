import { CheckCircle2, Eye, MinusCircle } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

// "No avanzar" is slate (not red): red is for errors and this must not read as an automatic rejection.
const CONFIG = {
  ADVANCE: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30' },
  REVIEW: { icon: Eye, cls: 'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30' },
  NO_ADVANCE: { icon: MinusCircle, cls: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-500/15 dark:text-slate-200 dark:ring-slate-500/30' },
};

export default function CVRecommendationBadge({ value }) {
  const cfg = CONFIG[value];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${cfg.cls}`}>
      <Icon size={14} aria-hidden="true" />
      {COPY.results.recommendations[value]}
    </span>
  );
}
