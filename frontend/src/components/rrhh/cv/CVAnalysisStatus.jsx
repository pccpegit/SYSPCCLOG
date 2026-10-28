import { AlertTriangle, CheckCircle2, FilePen, Loader2 } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

const STATUS = {
  EMPTY: { icon: FilePen, cls: 'bg-gray-100 text-gray-700 ring-gray-300 dark:bg-gray-500/15 dark:text-gray-200 dark:ring-gray-500/30' },
  PROCESSING: { icon: Loader2, spin: true, cls: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/30' },
  COMPLETED: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30' },
  COMPLETED_WITH_ERRORS: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30' },
};

/** Analysis state: icon + text + color. */
export default function CVAnalysisStatus({ status, className = '' }) {
  const cfg = STATUS[status] ?? STATUS.EMPTY;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${cfg.cls} ${className}`}>
      <Icon size={14} className={cfg.spin ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
      {COPY.list.status[status] ?? status}
    </span>
  );
}
