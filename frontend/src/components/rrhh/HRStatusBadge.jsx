// HR document statuses. Text + color (never color alone).
const STYLES = {
  DRAFT:  'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  ISSUED: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  VOIDED: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-500/30',
};

const STATUS_LABELS = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitido',
  VOIDED: 'Anulado',
};

export default function HRStatusBadge({ status, label }) {
  const text = label ?? STATUS_LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ring-1 ${
        STYLES[status] ?? STYLES.VOIDED
      }`}
    >
      {text}
    </span>
  );
}
