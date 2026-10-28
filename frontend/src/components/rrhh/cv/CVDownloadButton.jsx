import { useEffect, useId, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  downloadCVOriginal,
  downloadCVPosting,
  downloadCVReport,
  downloadCVXlsx,
  downloadCVZip,
  saveBlob,
} from '../../../api/hr';
import { COPY } from '../../../utils/cvCopy';
import { hrErrorMessage } from '../../../utils/hrErrors';
import { useToast } from '../../../context/ToastContext';
import { btnPrimary, btnSecondary } from './cvStyles';

const NOUNS = COPY.results.nouns;
const KINDS = {
  xlsx: { run: (a) => downloadCVXlsx(a.analysisId), toast: COPY.toasts.xlsx, noun: NOUNS.xlsx },
  zip: { run: (a) => downloadCVZip(a.analysisId), toast: COPY.toasts.zip, slow: true, noun: NOUNS.zip },
  report: { run: (a) => downloadCVReport(a.analysisId, a.itemId), toast: COPY.toasts.report, noun: NOUNS.report },
  original: { run: (a) => downloadCVOriginal(a.analysisId, a.itemId), toast: COPY.toasts.original, noun: NOUNS.original },
  posting: { run: (a) => downloadCVPosting(a.analysisId), toast: COPY.toasts.posting, noun: NOUNS.posting },
};

/**
 * One download (blob; there is no public file URL). States: idle ->
 * "Preparando…" (aria-disabled + aria-busy, guarded against double click; it
 * is NOT `disabled` so the focus stays on the button) -> success toast, or a
 * persistent inline alert + retry whose accessible name keeps the file kind
 * ("Reintentar descarga de Excel"). `disabledReason` keeps the button focusable
 * (aria-disabled) and explains why in visible text.
 */
export default function CVDownloadButton({
  kind,
  analysisId,
  itemId,
  label,
  variant = 'secondary',
  disabledReason = '',
  icon = true,
}) {
  const { showToast } = useToast();
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [slow, setSlow] = useState(false);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);
  const reasonId = useId();
  const cfg = KINDS[kind];

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  async function run() {
    if (disabledReason || state === 'busy') return;
    setState('busy');
    setError('');
    if (cfg.slow) timerRef.current = setTimeout(() => aliveRef.current && setSlow(true), 3000);
    try {
      const { blob, filename } = await cfg.run({ analysisId, itemId });
      saveBlob(blob, filename);
      showToast({ type: 'success', message: cfg.toast });
      if (aliveRef.current) setState('idle');
    } catch (err) {
      if (aliveRef.current) {
        setError(hrErrorMessage(err, 'No pudimos descargar el archivo.'));
        setState('error');
      }
    } finally {
      clearTimeout(timerRef.current);
      if (aliveRef.current) setSlow(false);
    }
  }

  const busy = state === 'busy';
  const cls = variant === 'primary' ? btnPrimary : btnSecondary;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        aria-busy={busy || undefined}
        aria-disabled={busy || disabledReason ? 'true' : undefined}
        aria-label={state === 'error' && !busy ? COPY.results.retryDownload(cfg.noun) : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={cls}
      >
        {busy ? (
          <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          icon && <Download size={16} aria-hidden="true" />
        )}
        {busy ? COPY.results.preparing : state === 'error' ? COPY.retry : label}
      </button>
      {busy && slow && <p className="text-xs text-gray-600">{COPY.results.takesAWhile}</p>}
      {disabledReason && (
        <p id={reasonId} className="text-xs text-gray-600">{disabledReason}</p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
      )}
    </div>
  );
}
