import { COPY } from '../../../utils/cvCopy';

/** Quick filter chips (aria-pressed): the active one is also marked with a check mark. */
export default function CVQuickFilters({ counts, value, onChange, hasRequirements }) {
  const chips = [{ key: 'all', count: counts.all }];
  if (hasRequirements) {
    chips.push(
      { key: 'ADVANCE', count: counts.ADVANCE },
      { key: 'REVIEW', count: counts.REVIEW },
      { key: 'NO_ADVANCE', count: counts.NO_ADVANCE },
    );
  }
  chips.push({ key: 'FAILED', count: counts.FAILED });
  if (counts.active > 0) chips.push({ key: 'active', count: counts.active });
  if (counts.CANCELLED > 0) chips.push({ key: 'CANCELLED', count: counts.CANCELLED });

  return (
    <div role="group" aria-label={COPY.results.filtersLabel} className="flex flex-wrap gap-2">
      {chips.map(({ key, count }) => {
        const pressed = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(key)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
              pressed
                ? 'border-violet-600 bg-violet-50 text-violet-900 dark:bg-violet-500/10 dark:text-violet-100'
                : 'border-[#8a8f98] bg-white text-gray-800 hover:bg-gray-50'
            }`}
          >
            {pressed && <span aria-hidden="true">✓</span>}
            {COPY.results.chips[key]} ({count})
          </button>
        );
      })}
    </div>
  );
}
