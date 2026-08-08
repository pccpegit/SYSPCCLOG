import { PRIORITY_CONFIG } from '../../data/constants';

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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${config.bg} ${config.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot} ${isUrgent ? 'pulse-attention' : ''}`} />
      {config.label}
    </span>
  );
}
