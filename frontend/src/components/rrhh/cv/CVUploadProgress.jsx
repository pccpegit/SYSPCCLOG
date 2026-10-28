import { Loader2 } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { btnSecondary } from './cvStyles';

/** Replaces the primary button while uploading: "Subiendo 40 de 120 CVs…" + stop. */
export default function CVUploadProgress({ sent, total, onStop, stopping = false, headingRef }) {
  const percent = total ? Math.round((sent / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
      <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-extrabold text-gray-900 focus:outline-none font-display">
        <Loader2 size={18} className="text-violet-700 motion-safe:animate-spin dark:text-violet-300" aria-hidden="true" />
        {COPY.step2.uploading(sent, total)}
      </h3>
      <div
        role="progressbar"
        aria-label={COPY.step2.uploading(sent, total)}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={sent}
        aria-valuetext={`${sent} de ${total}`}
        className="mt-3 h-3 overflow-hidden rounded-full bg-white ring-1 ring-violet-200"
      >
        <div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">{COPY.step2.savedNote}</p>
        <button type="button" onClick={() => !stopping && onStop()} aria-disabled={stopping || undefined} className={btnSecondary}>
          {stopping ? COPY.step2.stopping : COPY.step2.stop}
        </button>
      </div>
    </div>
  );
}
