import { Link } from 'react-router-dom';
import { Play, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { btnPrimary, btnSecondary } from './cvStyles';
import CVDownloadButton from './CVDownloadButton';

/**
 * One row of actions under the header with ONE primary per state:
 * failures -> Reintentar fallidos; otherwise Excel (a stalled run is resumed
 * from the progress panel, which is the only "Reanudar" while it is visible).
 * While CVs are processing the bar is reduced to "Agregar más CVs" (the focus
 * is the progress). GENERAL_MANAGER only gets downloads.
 * Busy buttons use aria-disabled (not disabled) so the focus is not lost.
 */
export default function CVActionsBar({
  analysis,
  counts,
  canWrite,
  busy = false,
  stalled = false,
  onRetryFailed,
  onResume,
  onResumeCancelled,
}) {
  const pending = counts.queued + counts.processing;
  const processing = pending > 0;
  const noneReady = counts.done === 0;
  const downloadReason = noneReady ? COPY.results.downloadsWhen : '';

  const guard = (fn) => () => {
    if (!busy) fn?.();
  };

  if (processing) {
    if (!canWrite) return null;
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start" role="group" aria-label="Acciones del análisis">
        <Link to={`/rrhh/cvs/${analysis.id}/preparar?paso=2`} className={btnSecondary}>
          <Plus size={16} aria-hidden="true" /> {COPY.results.addMore}
        </Link>
      </div>
    );
  }

  const primary =
    canWrite && stalled
      ? 'resume'
      : canWrite && counts.failed > 0
        ? 'retry'
        : 'xlsx';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start" role="group" aria-label="Acciones del análisis">
      {primary === 'resume' && (
        <button type="button" onClick={guard(onResume)} aria-disabled={busy || undefined} className={btnPrimary}>
          <Play size={18} aria-hidden="true" /> {COPY.results.resume}
        </button>
      )}
      {primary === 'retry' && (
        <button type="button" onClick={guard(onRetryFailed)} aria-disabled={busy || undefined} className={btnPrimary}>
          <RefreshCw size={18} aria-hidden="true" /> {COPY.results.retryFailed(counts.failed)}
        </button>
      )}

      <CVDownloadButton
        kind="xlsx"
        analysisId={analysis.id}
        label={COPY.results.downloadXlsx}
        variant={primary === 'xlsx' ? 'primary' : 'secondary'}
        disabledReason={downloadReason}
      />
      <CVDownloadButton
        kind="zip"
        analysisId={analysis.id}
        label={COPY.results.downloadZip}
        disabledReason={downloadReason}
      />

      {canWrite && counts.cancelled > 0 && (
        <button type="button" onClick={guard(onResumeCancelled)} aria-disabled={busy || undefined} className={btnSecondary}>
          <RotateCcw size={16} aria-hidden="true" /> {COPY.results.resumeCancelled(counts.cancelled)}
        </button>
      )}
      {canWrite && (
        <Link to={`/rrhh/cvs/${analysis.id}/preparar?paso=2`} className={btnSecondary}>
          <Plus size={16} aria-hidden="true" /> {COPY.results.addMore}
        </Link>
      )}
    </div>
  );
}
