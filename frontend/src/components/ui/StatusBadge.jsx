import { STATUS_CONFIG } from '../../data/constants';

/**
 * Colored badge displaying a request status.
 * @param {{ status: string }} props
 */
export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ${config.bg} ${config.text}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}
