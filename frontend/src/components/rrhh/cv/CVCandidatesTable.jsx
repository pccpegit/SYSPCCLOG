import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import CVRecommendationBadge from './CVRecommendationBadge';
import CVScoreBar from './CVScoreBar';
import CVStatusChip from './CVStatusChip';
import { candidateLabel, candidateSubtitle, failureOf } from './cvCandidate';
import { btnLink } from './cvStyles';

const COLS = COPY.results.columns;

function SortHeader({ label, sortKey, sort, onSort, className = '' }) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-4 py-3 text-left ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={COPY.results.sortBy(label)}
        className="inline-flex min-h-8 items-center gap-1 rounded text-xs font-bold uppercase tracking-wide text-gray-700 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      >
        {label}
        <Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * Candidates table (>= md). The candidate NAME is a real <button> that opens
 * the drawer (the clickable row is only an extra for the mouse). While the
 * analysis runs the ranking column shows "—" (`ranking="live"`): rows do not jump.
 */
export default function CVCandidatesTable({
  items,
  sort,
  onSort,
  onOpen,
  onRetry,
  canWrite,
  ranking = 'final',
  hasRequirements,
  caption,
  activeId = null,
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            {hasRequirements && <SortHeader label={COLS.rank} sortKey="rank" sort={sort} onSort={onSort} />}
            <SortHeader label={COLS.candidate} sortKey="candidate_name" sort={sort} onSort={onSort} />
            {hasRequirements && <SortHeader label={COLS.score} sortKey="score" sort={sort} onSort={onSort} />}
            {hasRequirements && (
              <th scope="col" className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-700">
                {COLS.recommendation}
              </th>
            )}
            <SortHeader label={COLS.status} sortKey="status" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const failure = failureOf(item);
            const subtitle = candidateSubtitle(item);
            return (
              <tr
                key={item.id}
                onClick={() => onOpen(item.id)}
                className={`cursor-pointer align-top hover:bg-gray-50 ${activeId === item.id ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}
              >
                {hasRequirements && (
                  <td className="px-4 py-3 font-bold tabular-nums text-gray-900">
                    {ranking === 'final' && item.rank != null ? (
                      item.rank
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{COPY.results.noRank}</span>
                      </>
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <button
                    type="button"
                    data-item-id={item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(item.id);
                    }}
                    className="max-w-[28ch] truncate rounded text-left text-base font-semibold text-gray-900 underline-offset-2 hover:text-violet-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    title={candidateLabel(item)}
                  >
                    {candidateLabel(item)}
                  </button>
                  {subtitle && <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p>}
                  {failure && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      {failure.message}
                      {canWrite && failure.retryable && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetry(item.id);
                          }}
                          aria-label={COPY.results.retryFor(candidateLabel(item))}
                          className={`${btnLink} ml-2`}
                        >
                          {COPY.retry}
                        </button>
                      )}
                    </p>
                  )}
                </td>
                {hasRequirements && (
                  <td className="px-4 py-3"><CVScoreBar score={item.score} /></td>
                )}
                {hasRequirements && (
                  <td className="px-4 py-3">
                    <CVRecommendationBadge value={item.recommendation} />
                  </td>
                )}
                <td className="px-4 py-3"><CVStatusChip status={item.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
