import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

const CONFIG = {
  QUEUED: { icon: Clock, cls: 'bg-gray-100 text-gray-700 ring-gray-300 dark:bg-gray-500/15 dark:text-gray-200 dark:ring-gray-500/30' },
  PROCESSING: { icon: Loader2, spin: true, cls: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/30' },
  DONE: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30' },
  FAILED: { icon: AlertTriangle, cls: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30' },
  CANCELLED: { icon: Ban, cls: 'bg-gray-100 text-gray-700 ring-gray-300 dark:bg-gray-500/15 dark:text-gray-200 dark:ring-gray-500/30' },
};

/** CV state: icon + text + color. */
export default function CVStatusChip({ status }) {
  const cfg = CONFIG[status] ?? CONFIG.QUEUED;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${cfg.cls}`}>
      <Icon size={14} className={cfg.spin ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
      {COPY.results.statuses[status] ?? status}
    </span>
  );
}
