const COLOR_MAP = {
  blue: {
    bg: 'bg-blue-50/80',
    border: 'border-blue-200/50',
    iconBg: 'bg-gradient-to-br from-blue-500 to-blue-700',
    text: 'text-blue-700',
    glow: 'shadow-blue-500/10',
  },
  green: {
    bg: 'bg-emerald-50/80',
    border: 'border-emerald-200/50',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    text: 'text-emerald-700',
    glow: 'shadow-emerald-500/10',
  },
  amber: {
    bg: 'bg-amber-50/80',
    border: 'border-amber-200/50',
    iconBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
    text: 'text-amber-700',
    glow: 'shadow-amber-500/10',
  },
  red: {
    bg: 'bg-red-50/80',
    border: 'border-red-200/50',
    iconBg: 'bg-gradient-to-br from-red-500 to-red-700',
    text: 'text-red-700',
    glow: 'shadow-red-500/10',
  },
  purple: {
    bg: 'bg-purple-50/80',
    border: 'border-purple-200/50',
    iconBg: 'bg-gradient-to-br from-purple-500 to-purple-700',
    text: 'text-purple-700',
    glow: 'shadow-purple-500/10',
  },
  orange: {
    bg: 'bg-orange-50/80',
    border: 'border-orange-200/50',
    iconBg: 'bg-gradient-to-br from-orange-500 to-orange-600',
    text: 'text-orange-700',
    glow: 'shadow-orange-500/10',
  },
  teal: {
    bg: 'bg-teal-50/80',
    border: 'border-teal-200/50',
    iconBg: 'bg-gradient-to-br from-teal-500 to-teal-700',
    text: 'text-teal-700',
    glow: 'shadow-teal-500/10',
  },
  cyan: {
    bg: 'bg-cyan-50/80',
    border: 'border-cyan-200/50',
    iconBg: 'bg-gradient-to-br from-cyan-500 to-cyan-700',
    text: 'text-cyan-700',
    glow: 'shadow-cyan-500/10',
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
      className={[
        'relative overflow-hidden rounded-2xl border p-5',
        'bg-white',
        colors.border,
        'shadow-sm',
        'transition-all duration-200',
        onClick
          ? `cursor-pointer hover:shadow-lg hover:-translate-y-1 hover:${colors.glow}`
          : 'hover:shadow-md',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate font-display">
            {title}
          </span>
          <span className="text-3xl font-extrabold text-gray-900 leading-tight mt-1.5 font-display">
            {value}
          </span>
        </div>

        <div className={`w-11 h-11 rounded-xl ${colors.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
          <Icon size={20} className="text-white" strokeWidth={2} />
        </div>
      </div>

      {/* Decorative accent line at bottom */}
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${colors.iconBg}`} />
    </div>
  );
}
