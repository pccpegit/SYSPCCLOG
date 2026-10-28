import { useId } from 'react';
import { AlertTriangle, Ban, Loader2, Play, RotateCcw, WifiOff } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { NOTE, btnPrimary, btnSecondary, card, h2Cls, noteBase } from './cvStyles';

/**
 * Live progress: "12 de 40 listos" (big), a progressbar, a stable time
 * estimate and the secondary actions. The bar itself is not live; the
 * page owns the single polite live region (it must survive this panel
 * unmounting at the end of the run). While stalled, "Reanudar" is the only
 * primary action of the page and the actions bar does not repeat it.
 * Buttons use aria-disabled (not disabled) while busy so the focus is not lost.
 */
export default function CVProgressPanel({
  counts,
  percent,
  etaText,
  stalled = false,
  connectionLost = false,
  canWrite = false,
  busy = false,
  headingRef,
  onResume,
  onCancelPending,
  onResumeCancelled,
  onRetryNow,
}) {
  const titleId = useId();
  const text = COPY.results.ofReady(counts.done, counts.total);
  const secondary = COPY.results.secondary(counts);
  const waiting = counts.queued;
  const guard = (fn) => () => {
    if (!busy) fn?.();
  };

  return (
    <section aria-labelledby={titleId} className={`${card} space-y-4`}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={h2Cls}>
        <Loader2 size={20} className="mr-2 inline text-violet-700 motion-safe:animate-spin dark:text-violet-300" aria-hidden="true" />
        {COPY.results.progressTitle}
      </h2>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-extrabold text-gray-900 font-display">{text}</p>
        {secondary && <p className="text-sm text-gray-700">{secondary}</p>}
      </div>

      <div
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={text}
        className="h-4 overflow-hidden rounded-full bg-gray-200"
      >
        <div className="h-full rounded-full bg-violet-600 transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>

      <p className="text-sm font-medium text-gray-700">{etaText}</p>

      {stalled && (
        <div role="status" className={`${noteBase} ${NOTE.amber} flex-wrap items-center justify-between`}>
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
            {canWrite ? COPY.results.stalled : COPY.results.stalledRead}
          </span>
          {canWrite && (
            <button type="button" onClick={guard(onResume)} aria-disabled={busy || undefined} className={btnPrimary}>
              <Play size={16} aria-hidden="true" /> {COPY.results.resume}
            </button>
          )}
        </div>
      )}

      {connectionLost && (
        <div role="status" className={`${noteBase} ${NOTE.gray} flex-wrap items-center justify-between`}>
          <span className="flex items-center gap-2 font-semibold">
            <WifiOff size={18} className="shrink-0" aria-hidden="true" /> {COPY.results.offline}
          </span>
          <button type="button" onClick={onRetryNow} className={btnSecondary}>{COPY.results.retryNow}</button>
        </div>
      )}

      {canWrite && (waiting > 0 || counts.cancelled > 0) && (
        <div className="flex flex-wrap gap-3">
          {waiting > 0 && (
            <button type="button" onClick={guard(onCancelPending)} aria-disabled={busy || undefined} className={btnSecondary}>
              <Ban size={16} aria-hidden="true" /> {COPY.results.cancelPending(waiting)}
            </button>
          )}
          {counts.cancelled > 0 && (
            <button type="button" onClick={guard(onResumeCancelled)} aria-disabled={busy || undefined} className={btnSecondary}>
              <RotateCcw size={16} aria-hidden="true" /> {COPY.results.resumeCancelled(counts.cancelled)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
