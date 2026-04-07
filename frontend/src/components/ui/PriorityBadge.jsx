import { PRIORITY_CONFIG } from '../../data/constants';

/**
 * Colored badge displaying a request priority.
 * @param {{ priority: string }} props
 */
export default function PriorityBadge({ priority }) {
  const config = PRIORITY_CONFIG[priority] ?? {
    label: priority,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
  };

  const isUrgent = priority === 'URGENT' || priority === 'CRITICAL';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ${config.bg} ${config.text}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot} ${isUrgent ? 'pulse-attention' : ''}`} />
      {config.label}
    </span>
  );
}
