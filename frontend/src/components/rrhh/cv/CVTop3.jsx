import { COPY } from '../../../utils/cvCopy';
import CVRecommendationBadge from './CVRecommendationBadge';
import { btnSecondary, card, h3Cls } from './cvStyles';

/** The 3 best candidates by score (only with requirements and once finished). */
export default function CVTop3({ items, onOpen }) {
  const top = items.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="cv-top3-title" className="space-y-3">
      <h3 id="cv-top3-title" className={h3Cls}>{COPY.results.top3}</h3>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {top.map((item, i) => (
          <li key={item.id} className={`${card} flex flex-col gap-2 !p-4`}>
            <p className="text-sm font-extrabold text-violet-700 dark:text-violet-300">{COPY.results.position(i + 1)}</p>
            <p className="truncate text-base font-bold text-gray-900" title={item.candidate_name || item.original_name}>
              {item.candidate_name || item.original_name}
            </p>
            {item.headline && <p className="line-clamp-2 text-sm text-gray-700">{item.headline}</p>}
            <p className="text-sm font-semibold text-gray-900">{COPY.results.scoreOf(Math.round(item.score))}</p>
            <div><CVRecommendationBadge value={item.recommendation} /></div>
            <button type="button" data-top3-id={item.id} onClick={() => onOpen(item.id)} className={`${btnSecondary} mt-auto`}>
              {COPY.results.seeCard}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-sm text-gray-600">{COPY.results.top3Hint}</p>
    </section>
  );
}
