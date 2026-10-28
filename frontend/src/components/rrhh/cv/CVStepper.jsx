import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';

const hrefFor = (analysisId, n) => {
  if (!analysisId) return null;
  return n === 3 ? `/rrhh/cvs/${analysisId}` : `/rrhh/cvs/${analysisId}/preparar?paso=${n}`;
};

/**
 * Always-visible 3-step indicator. State = icon + text + border (not only
 * color). Done steps are links (going back never loses anything); future steps
 * are plain text. `readOnly` (GENERAL_MANAGER) renders no links.
 * On phones the label of non-current steps is hidden only VISUALLY (sr-only):
 * a link must always keep its accessible name ("Convocatoria", not just "completado").
 */
export default function CVStepper({ current, analysisId, completed = {}, readOnly = false }) {
  const labels = COPY.wizard.steps;
  return (
    <nav aria-label={COPY.wizard.stepperLabel} className="mb-5">
      <p className="sm:hidden text-sm font-semibold text-gray-700 mb-2">
        {COPY.wizard.stepOf(current, labels[current - 1])}
      </p>
      <ol className="flex items-center gap-2 sm:gap-3">
        {labels.map((label, i) => {
          const n = i + 1;
          const state = n === current ? 'current' : completed[n] ? 'done' : 'pending';
          const href = state === 'done' && !readOnly ? hrefFor(analysisId, n) : null;
          const circle =
            state === 'current'
              ? 'bg-violet-600 text-white border-violet-600'
              : state === 'done'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'bg-white text-gray-600 border-[#8a8f98]';
          const inner = (
            <>
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${circle}`}
                aria-hidden="true"
              >
                {state === 'done' ? <Check size={16} strokeWidth={3} /> : n}
              </span>
              <span className={`text-sm font-semibold ${state === 'pending' ? 'text-gray-600' : 'text-gray-900'} ${state === 'current' ? '' : 'sr-only sm:not-sr-only'}`}>
                {label}
              </span>
              {state === 'done' && <span className="sr-only">{`, ${COPY.wizard.stepDone}`}</span>}
              {state === 'pending' && <span className="sr-only">{`, ${COPY.wizard.stepPending}`}</span>}
            </>
          );
          return (
            <li key={label} className={`flex items-center gap-2 sm:gap-3 ${n < 3 ? 'flex-1' : ''}`}>
              {href ? (
                <Link to={href} className="flex items-center gap-2 rounded-lg min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500">
                  {inner}
                </Link>
              ) : (
                <span className="flex items-center gap-2 min-h-11" aria-current={state === 'current' ? 'step' : undefined}>
                  {inner}
                </span>
              )}
              {n < 3 && <span className="h-0.5 flex-1 rounded bg-gray-300" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
