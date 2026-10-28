import { Link } from 'react-router-dom';
import { COPY } from '../../../utils/cvCopy';
import { formatDate, formatUsd } from '../../../utils/cvFormat';
import { resumeHref } from '../../../utils/cvResume';
import CVAnalysisStatus from './CVAnalysisStatus';
import { card } from './cvStyles';

/** Row of the analyses list: name (link), state (icon + text), count and summary. */
export default function CVAnalysisCard({ analysis }) {
  const counts = analysis.counts ?? {};
  const summary = counts.total ? COPY.list.summary(counts) : '';
  return (
    <li className={`${card} flex flex-col gap-2 !p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div className="min-w-0">
        <Link
          to={resumeHref(analysis)}
          className="block truncate rounded text-base font-bold text-gray-900 hover:text-violet-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          title={analysis.name}
        >
          {analysis.name}
        </Link>
        <p className="text-sm text-gray-600">
          {[formatDate(analysis.created_at), counts.total ? COPY.list.cvCount(counts.total) : null, summary || null]
            .filter(Boolean)
            .join(' · ')}
          {Number(analysis.cost_usd) > 0 && ` · US$ ${formatUsd(analysis.cost_usd)}`}
        </p>
      </div>
      <CVAnalysisStatus status={analysis.status} className="self-start sm:self-center" />
    </li>
  );
}
