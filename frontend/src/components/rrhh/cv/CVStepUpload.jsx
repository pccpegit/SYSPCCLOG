import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Info, ShieldCheck } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { HR_ERROR_MESSAGES } from '../../../utils/hrErrors';
import { classifyFiles, fileKey } from '../../../utils/cvFiles';
import { formatUsd } from '../../../utils/cvFormat';
import { toCards } from '../../../utils/cvRequirements';
import { useToast } from '../../../context/useToast';
import useCVUpload from '../../../hooks/useCVUpload';
import CVDisclaimer from './CVDisclaimer';
import CVDropzone from './CVDropzone';
import CVFileList from './CVFileList';
import CVUploadProgress from './CVUploadProgress';
import { NOTE, btnLink, btnPrimary, btnSecondary, card, h2Cls, noteBase } from './cvStyles';

const C = COPY.step2;
const needsUpload = (e) => e.state === 'pending' || e.state === 'failed';

/**
 * Step 2 — CVs. Order: analysis summary, big dropzone, file list (problems
 * visible, the rest collapsed), cost estimate and ONE primary button. The
 * client already trims the selection to what fits so the server never has to
 * reject a whole request.
 */
export default function CVStepUpload({ analysis, config, reloadConfig, headingRef }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const limits = config?.limits ?? {};
  const uploader = useCVUpload(analysis.id);

  const [entries, setEntries] = useState([]);
  const [ignored, setIgnored] = useState(0);
  const [live, setLive] = useState('');
  const [needFirst, setNeedFirst] = useState(false);
  const [outcome, setOutcome] = useState(null); // { kind: 'partial'|'fatal'|'none', ... }
  const groupRef = useRef(null);
  const progressRef = useRef(null);
  const outcomeRef = useRef(null);

  const disabledByKey = config?.enabled === false;
  const alreadyUploaded = analysis.counts?.total ?? 0;
  const todo = entries.filter(needsUpload);
  const pendingCount = todo.length;
  const requirements = useMemo(() => toCards(analysis.requirements ?? []), [analysis.requirements]);

  const fitDaily = limits.daily_remaining ?? Infinity;
  const fitAnalysis = limits.max_items_per_analysis != null ? limits.max_items_per_analysis - alreadyUploaded : Infinity;
  const fit = Math.max(0, Math.min(fitDaily, fitAnalysis));
  const overflow = pendingCount > fit;

  // Warn before leaving ONLY while uploading.
  useEffect(() => {
    if (!uploader.uploading) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploader.uploading]);

  useEffect(() => {
    if (uploader.uploading) progressRef.current?.focus();
  }, [uploader.uploading]);

  // The progress heading (which had the focus) is gone once the upload ends
  // with a problem: bring the keyboard user to the alert instead of <body>.
  useEffect(() => {
    if (outcome) outcomeRef.current?.focus();
  }, [outcome]);

  function addFiles(files) {
    const existing = new Set(entries.map((e) => fileKey(e.file)));
    const { ok, problems, ignored: skipped } = classifyFiles(files, {
      extensions: limits.extensions,
      maxBytes: limits.max_file_bytes,
      existingKeys: existing,
    });
    setEntries((prev) => [
      ...prev,
      ...ok.map((o) => ({ ...o, state: 'pending', detail: '' })),
      ...problems.map((p) => ({ id: p.id, file: p.file, state: 'rejected', detail: p.detail, code: p.code })),
    ]);
    setIgnored((n) => n + skipped);
    setLive(C.added(ok.length, problems.length));
    setNeedFirst(false);
    setOutcome(null);
  }

  const removeEntry = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const clearEntries = () => {
    setEntries([]);
    setIgnored(0);
    setOutcome(null);
  };
  const keepFirst = () => {
    let kept = 0;
    setEntries((prev) =>
      prev.filter((e) => {
        if (!needsUpload(e)) return true;
        kept += 1;
        return kept <= fit;
      }),
    );
  };

  async function analyze() {
    if (disabledByKey || uploader.uploading) return;
    if (pendingCount === 0) {
      setNeedFirst(true);
      groupRef.current?.focus();
      return;
    }
    if (overflow) return;
    setOutcome(null);
    setNeedFirst(false);
    // Files already discarded on the client (wrong type, too big) must not vanish silently either.
    const discarded = entries.filter((e) => e.state === 'rejected').length;
    const result = await uploader.upload(todo, {
      batchSize: limits.batch_size ?? 25,
      onEntry: (id, patch) => setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    });
    reloadConfig?.();
    const reached = result.uploaded + result.duplicates;
    if (result.fatal) {
      setOutcome({ kind: 'fatal', message: result.fatal.message, code: result.fatal.code });
      return;
    }
    if (result.aborted || result.failed > 0) {
      setOutcome({ kind: 'partial', sent: reached, total: todo.length - result.rejected });
      return;
    }
    if (reached === 0) {
      setOutcome({ kind: 'none' });
      return;
    }
    if (result.uploaded > 0) showToast({ type: 'success', message: COPY.toasts.queued(result.uploaded) });
    const rejectedTotal = discarded + result.rejected;
    if (rejectedTotal > 0) {
      // Some files did not make it: stay here so RR. HH. sees which ones and why.
      setOutcome({ kind: 'rejected', rejected: rejectedTotal });
      return;
    }
    navigate(`/rrhh/cvs/${analysis.id}`);
  }

  const estMin = config?.estimate_usd?.min ?? 0;
  const estMax = config?.estimate_usd?.max ?? 0;
  const free = config?.provider === 'fake' || config?.simulated;
  const keyHintId = 'cv-key-hint';

  return (
    <section aria-labelledby="step2-title" className={`${card} space-y-5`}>
      <h2 id="step2-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{COPY.wizard.step2Title}</h2>
      <p role="status" className="sr-only">{live}</p>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-900">{C.summaryLine(analysis.name)}</p>
        {requirements.length > 0 ? (
          <details className="rounded-xl border border-gray-200 bg-gray-50 px-3">
            <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-gray-800">
              {C.seeRequirements(requirements.length)}
            </summary>
            <ul className="space-y-1 pb-3 text-sm text-gray-800">
              {requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-2">
                  {r.mandatory && <ShieldCheck size={16} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />}
                  <span>
                    {r.mandatory && <span className="sr-only">{COPY.wizard.mandatoryPrefix}</span>}
                    {r.text}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-sm text-gray-700">{C.noRequirements}</p>
        )}
      </div>

      {alreadyUploaded > 0 && (
        <div className={`${noteBase} ${NOTE.info} flex-wrap items-center justify-between`}>
          <span className="flex items-center gap-2">
            <Info size={18} className="shrink-0" aria-hidden="true" /> {C.alreadyHave(alreadyUploaded)}
          </span>
          <Link to={`/rrhh/cvs/${analysis.id}`} className={btnLink}>{C.seeResults}</Link>
        </div>
      )}

      <CVDropzone
        groupRef={groupRef}
        onFiles={addFiles}
        disabled={disabledByKey || uploader.uploading}
        disabledReason={disabledByKey ? `${COPY.banners.noKey} ${COPY.banners.noKeyHint}` : ''}
        maxMb={limits.max_file_mb ?? 10}
        extensions={limits.extensions}
      />
      {needFirst && (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{C.addFirst}</p>
      )}
      {ignored > 0 && <p className="text-sm text-gray-600">{C.ignored(ignored)}</p>}

      <CVFileList
        entries={entries}
        onRemove={removeEntry}
        onClear={clearEntries}
        onRetryUpload={analyze}
        disabled={uploader.uploading}
      />

      {overflow && (
        <div role="alert" className={`${noteBase} ${NOTE.amber} flex-col`}>
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
            {fit > 0
              ? C.tooMany(pendingCount, fit)
              : fitDaily <= 0
                ? HR_ERROR_MESSAGES.daily_limit_reached
                : HR_ERROR_MESSAGES.analysis_limit_reached}
          </span>
          <span className="flex flex-wrap gap-3">
            {fit > 0 && (
              <button type="button" onClick={keepFirst} className={btnSecondary}>{C.takeFirst(fit)}</button>
            )}
            <button type="button" onClick={clearEntries} className={btnSecondary}>{C.removeFiles}</button>
          </span>
        </div>
      )}

      {outcome && (
        <div ref={outcomeRef} tabIndex={-1} className="focus:outline-none">
          {outcome?.kind === 'partial' && (
            <div role="alert" className={`${noteBase} ${NOTE.amber}`}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                {C.partial(outcome.sent, outcome.total)} {C.savedNote}
              </p>
            </div>
          )}
          {outcome?.kind === 'fatal' && (
            <div role="alert" className={`${noteBase} ${NOTE.red}`}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                {outcome.message}{' '}
                {outcome.code === 'analysis_limit_reached' && (
                  <Link to="/rrhh/cvs/nuevo" className="font-semibold underline">{COPY.list.newAnalysis}</Link>
                )}
              </p>
            </div>
          )}
          {outcome?.kind === 'rejected' && (
            <div role="alert" className={`${noteBase} ${NOTE.amber}`}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                {C.someRejected(outcome.rejected)} {C.someRejectedHint}
              </p>
            </div>
          )}
          {outcome?.kind === 'none' && (
            <div role="alert" className={`${noteBase} ${NOTE.red}`}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{C.noneUsable}</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5 text-sm text-gray-700">
        {free && <p>{C.estimateFree}</p>}
        {!free && estMax > 0 && pendingCount > 0 && (
          <p>{C.estimate(formatUsd(estMin * pendingCount), formatUsd(estMax * pendingCount))}</p>
        )}
        <CVDisclaimer compact />
      </div>

      {uploader.uploading ? (
        <CVUploadProgress
          sent={uploader.sent}
          total={uploader.total}
          onStop={uploader.stop}
          stopping={uploader.stopping}
          headingRef={progressRef}
        />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Link to={`/rrhh/cvs/${analysis.id}/preparar?paso=1`} className={btnSecondary}>{COPY.back}</Link>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {outcome?.kind === 'rejected' && pendingCount === 0 ? (
              <Link to={`/rrhh/cvs/${analysis.id}`} className={btnPrimary}>
                {C.continueToResults} <ArrowRight size={18} aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={analyze}
                aria-disabled={disabledByKey || overflow || undefined}
                aria-describedby={disabledByKey ? keyHintId : undefined}
                className={btnPrimary}
              >
                {outcome?.kind === 'partial' && pendingCount > 0 ? C.retryUpload(pendingCount) : C.analyze(pendingCount)}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            )}
            {disabledByKey && (
              <p id={keyHintId} className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {`${COPY.banners.noKey} ${COPY.banners.noKeyHint}`}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
