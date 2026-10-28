import { Info } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

/** Fixed notice: the AI helps to sort; the final decision is HR's. */
export default function CVDisclaimer({ compact = false }) {
  return (
    <p
      className={`flex items-start gap-2 text-gray-600 ${compact ? 'text-xs' : 'text-sm'}`}
    >
      <Info size={compact ? 14 : 16} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
      <span>{COPY.disclaimer}</span>
    </p>
  );
}
