import { describeCoverage } from '../../utils/stockCheck';

// Stock coverage of a request line against the CENTRAL pool (SYSPCC-026).
// Text + dot, never color alone. Advisory only.

const TONES = {
  green:  { box: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300', dot: 'bg-green-500' },
  yellow: { box: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/10 dark:text-yellow-300', dot: 'bg-yellow-500' },
  red:    { box: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300', dot: 'bg-red-500' },
  amber:  { box: 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dot: 'bg-amber-500' },
  gray:   { box: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
};

export default function CoverageBadge({ coverage = null, linkStatus, loading = false, className = '' }) {
  const { tone, text } = describeCoverage(coverage, linkStatus, loading);
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${t.box} ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {text}
    </span>
  );
}
