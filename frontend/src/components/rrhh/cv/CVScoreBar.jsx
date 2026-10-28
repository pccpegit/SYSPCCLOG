import { COPY } from '../../../utils/cvCopy';

/** Score as number + neutral violet bar (the color never encodes the suggestion). */
export default function CVScoreBar({ score }) {
  if (score == null) {
    return (
      <span className="text-gray-500">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{COPY.results.noScore}</span>
      </span>
    );
  }
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2 w-16 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <span className="block h-full rounded-full bg-violet-600" style={{ width: `${value}%` }} />
      </span>
      <span className="text-sm font-bold tabular-nums text-gray-900">
        {value}
        <span className="sr-only"> de 100</span>
      </span>
    </span>
  );
}
