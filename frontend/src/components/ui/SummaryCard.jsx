/**
 * Dashboard KPI card.
 *
 * @param {{
 *   title: string,
 *   value: string | number,
 *   icon: React.ComponentType<{ size?: number, className?: string }>,
 *   color: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'orange' | 'teal' | 'cyan',
 *   onClick?: () => void
 * }} props
 */

const COLOR_MAP = {
  blue: {
    border: 'border-blue-500',
    iconBg: 'bg-blue-100',
    iconText: 'text-blue-600',
  },
  green: {
    border: 'border-green-500',
    iconBg: 'bg-green-100',
    iconText: 'text-green-600',
  },
  amber: {
    border: 'border-amber-500',
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-600',
  },
  red: {
    border: 'border-red-500',
    iconBg: 'bg-red-100',
    iconText: 'text-red-600',
  },
  purple: {
    border: 'border-purple-500',
    iconBg: 'bg-purple-100',
    iconText: 'text-purple-600',
  },
  orange: {
    border: 'border-orange-500',
    iconBg: 'bg-orange-100',
    iconText: 'text-orange-600',
  },
  teal: {
    border: 'border-teal-500',
    iconBg: 'bg-teal-100',
    iconText: 'text-teal-600',
  },
  cyan: {
    border: 'border-cyan-500',
    iconBg: 'bg-cyan-100',
    iconText: 'text-cyan-600',
  },
};

export default function SummaryCard({ title, value, icon: Icon, color = 'blue', onClick }) {
  const colors = COLOR_MAP[color] ?? COLOR_MAP.blue;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={`bg-white rounded-xl border border-gray-200 border-l-4 ${colors.border} p-5 flex items-center gap-4 shadow-sm transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-1' : 'hover:shadow-md'
      }`}
    >
      {/* Icon circle */}
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${colors.iconBg}`}
      >
        <Icon size={26} className={colors.iconText} />
      </div>

      {/* Text */}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide truncate">
          {title}
        </span>
        <span className="text-3xl font-bold text-gray-800 leading-tight mt-0.5">{value}</span>
      </div>
    </div>
  );
}
