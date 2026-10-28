import { COPY } from '../../../utils/cvCopy';
import CVRecommendationBadge from './CVRecommendationBadge';
import CVScoreBar from './CVScoreBar';
import CVStatusChip from './CVStatusChip';
import { candidateLabel, candidateSubtitle, failureOf } from './cvCandidate';
import { btnLink } from './cvStyles';

/** Card list for narrow screens (< md): no horizontal scroll at 320 px. */
export default function CVCandidateList({ items, onOpen, onRetry, canWrite, ranking = 'final', hasRequirements, activeId = null }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const failure = failureOf(item);
        const subtitle = candidateSubtitle(item);
        return (
          <li
            key={item.id}
            className={`rounded-2xl border border-gray-100 bg-white p-4 ${activeId === item.id ? 'ring-2 ring-violet-500' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {hasRequirements && ranking === 'final' && item.rank != null && (
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300">
                    {COPY.results.columns.rank} {item.rank}
                  </p>
                )}
                <button
                  type="button"
                  data-item-id={item.id}
                  onClick={() => onOpen(item.id)}
                  className="block min-h-11 max-w-full break-words rounded text-left text-base font-semibold text-gray-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  {candidateLabel(item)}
                </button>
                {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
              </div>
              <CVStatusChip status={item.status} />
            </div>
            {hasRequirements && (item.score != null || item.recommendation) && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <CVScoreBar score={item.score} />
                <CVRecommendationBadge value={item.recommendation} />
              </div>
            )}
            {failure && (
              <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                {failure.message}
                {canWrite && failure.retryable && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.id)}
                    aria-label={COPY.results.retryFor(candidateLabel(item))}
                    className={`${btnLink} ml-2`}
                  >
                    {COPY.retry}
                  </button>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
