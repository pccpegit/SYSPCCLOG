import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';
import {
  cancelCVAnalysis,
  deleteCVAnalysis,
  getCVItems,
  resumeCVAnalysis,
  retryCVItem,
  retryFailedCVItems,
} from '../../api/hr';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { COPY } from '../../utils/cvCopy';
import { hrErrorMessage } from '../../utils/hrErrors';
import { formatUsd, normalizeText } from '../../utils/cvFormat';
import useCVAnalysis from '../../hooks/useCVAnalysis';
import useCVConfig from '../../hooks/useCVConfig';
import useCVProgress from '../../hooks/useCVProgress';
import useEta from '../../hooks/useEta';
import useFilterAnnouncer from '../../hooks/useFilterAnnouncer';
import useMediaQuery from '../../hooks/useMediaQuery';
import usePageFocus from '../../hooks/usePageFocus';
import useProgressAnnouncer from '../../hooks/useProgressAnnouncer';
import HRDialog from '../../components/rrhh/HRDialog';
import CVActionsBar from '../../components/rrhh/cv/CVActionsBar';
import CVAnalysisStatus from '../../components/rrhh/cv/CVAnalysisStatus';
import CVCandidateDrawer from '../../components/rrhh/cv/CVCandidateDrawer';
import CVCandidateList from '../../components/rrhh/cv/CVCandidateList';
import CVCandidatesTable from '../../components/rrhh/cv/CVCandidatesTable';
import CVCompletionBanner from '../../components/rrhh/cv/CVCompletionBanner';
import CVDisclaimer from '../../components/rrhh/cv/CVDisclaimer';
import CVModeBanner from '../../components/rrhh/cv/CVModeBanner';
import CVProgressPanel from '../../components/rrhh/cv/CVProgressPanel';
import CVQuickFilters from '../../components/rrhh/cv/CVQuickFilters';
import CVStepper from '../../components/rrhh/cv/CVStepper';
import CVTop3 from '../../components/rrhh/cv/CVTop3';
import {
  NOTE,
  btnDanger,
  btnLink,
  btnLinkDanger,
  btnPrimary,
  btnSecondary,
  card,
  h1Cls,
  h2Cls,
  inputCls,
  noteBase,
} from '../../components/rrhh/cv/cvStyles';
import { candidateLabel } from '../../components/rrhh/cv/cvCandidate';

const R = COPY.results;
const EMPTY_COUNTS = { total: 0, queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0 };
const LIVE_KEYS = ['status', 'error_code', 'error_message', 'candidate_name', 'score', 'recommendation'];
const SEARCH_URL_DEBOUNCE_MS = 250;
const SORTABLE = new Set(['rank', 'candidate_name', 'score', 'status']);
const STATUS_ORDER = { QUEUED: 0, PROCESSING: 1, DONE: 2, FAILED: 3, CANCELLED: 4 };

function normalizeCounts(raw = {}) {
  const queued = raw.queued ?? 0;
  const processing = raw.processing ?? 0;
  return { ...EMPTY_COUNTS, ...raw, queued, processing };
}

function compareRows(key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    let va = a[key];
    let vb = b[key];
    if (key === 'candidate_name') {
      va = candidateLabel(a);
      vb = candidateLabel(b);
    }
    if (key === 'status') {
      va = STATUS_ORDER[a.status] ?? 9;
      vb = STATUS_ORDER[b.status] ?? 9;
    }
    const aNull = va == null || va === '';
    const bNull = vb == null || vb === '';
    if (aNull && bNull) return a.id - b.id;
    if (aNull) return 1; // nulls always last
    if (bNull) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return cmp !== 0 ? cmp * sign : a.id - b.id;
  };
}

function matchesChip(row, chip) {
  switch (chip) {
    case 'ADVANCE':
    case 'REVIEW':
    case 'NO_ADVANCE':
      return row.status === 'DONE' && row.recommendation === chip;
    case 'FAILED':
      return row.status === 'FAILED';
    case 'CANCELLED':
      return row.status === 'CANCELLED';
    case 'active':
      return row.status === 'QUEUED' || row.status === 'PROCESSING';
    default:
      return true;
  }
}

/** Step 3 — progress, ranking and downloads of one analysis. */
export default function HRCVAnalysisPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { userRoles } = useAuth();
  const canWrite = userRoles.includes('HR_MANAGER');
  const { showToast } = useToast();
  const { config } = useCVConfig();
  const { analysis, status, error, reload } = useCVAnalysis(id);
  const ready = status === 'ready';
  const progress = useCVProgress(id, { enabled: ready });
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const h1Ref = useRef(null);
  const resultsRef = useRef(null);
  const progressRef = useRef(null);
  const lastOpenedRef = useRef(null);
  const deletedFocusRef = useRef(null);
  const originRef = useRef(null); // element that opened the card (Top 3 button, name button, ...)
  usePageFocus(h1Ref, analysis?.name, { ready });

  // ── counts ──
  const counts = progress.loaded ? normalizeCounts(progress.counts) : normalizeCounts(analysis?.counts);
  const pending = counts.queued + counts.processing;
  const processing = pending > 0;
  const hasRequirements = Boolean(analysis?.has_requirements ?? (analysis?.requirements?.length ?? 0) > 0);

  // ── candidates (paginated list + live patches from the progress poll) ──
  const [list, setList] = useState({ status: 'loading', rows: [], error: '' });
  const loadItems = useCallback(async () => {
    try {
      const { data } = await getCVItems(id, { page_size: 500 });
      setList({ status: 'ready', rows: data.results ?? data ?? [], error: '' });
    } catch (err) {
      setList((prev) => ({ status: prev.rows.length ? 'ready' : 'error', rows: prev.rows, error: hrErrorMessage(err, R.listError) }));
    }
  }, [id]);

  const reloadTimer = useRef(null);
  const scheduleReload = useCallback(
    (ms) => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(loadItems, ms);
    },
    [loadItems],
  );
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  // On mount and whenever the number of CVs changes.
  useEffect(() => {
    if (ready) loadItems();
  }, [ready, loadItems, counts.total]);

  // Debounced reload after CVs finish; immediate when the whole run ends.
  const doneKey = counts.done + counts.failed + counts.cancelled;
  const lastDoneKey = useRef(null);
  useEffect(() => {
    if (lastDoneKey.current === null) {
      lastDoneKey.current = doneKey;
      return;
    }
    if (lastDoneKey.current !== doneKey) {
      lastDoneKey.current = doneKey;
      scheduleReload(3000);
    }
  }, [doneKey, scheduleReload]);
  useEffect(() => {
    if (progress.finishedEvent) scheduleReload(0);
  }, [progress.finishedEvent, scheduleReload]);

  const rows = useMemo(
    () =>
      list.rows.map((row) => {
        const live = progress.itemsById[row.id];
        if (!live) return row;
        const merged = { ...row };
        LIVE_KEYS.forEach((key) => {
          if (key in live) merged[key] = live[key];
        });
        return merged;
      }),
    [list.rows, progress.itemsById],
  );

  // ── view state in the URL ──
  const estado = params.get('estado') ?? '';
  const sugerencia = params.get('sugerencia') ?? '';
  const q = params.get('q') ?? '';
  const orden = params.get('orden') ?? '';
  const candidatoId = Number(params.get('candidato')) || null;
  const chip = sugerencia || estado || 'all';

  // The box filters instantly from local state; the URL (replace) follows after a
  // short pause so typing does not rewrite the history on every keystroke.
  const [qInput, setQInput] = useState(q);
  const searchTimer = useRef(null);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const updateParams = useCallback(
    (patch, { replace = true } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([key, value]) => {
            if (value) next.set(key, value);
            else next.delete(key);
          });
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const onSearchChange = (value) => {
    setQInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: value }), SEARCH_URL_DEBOUNCE_MS);
  };

  const chipCounts = {
    all: rows.length,
    ADVANCE: rows.filter((r) => matchesChip(r, 'ADVANCE')).length,
    REVIEW: rows.filter((r) => matchesChip(r, 'REVIEW')).length,
    NO_ADVANCE: rows.filter((r) => matchesChip(r, 'NO_ADVANCE')).length,
    FAILED: rows.filter((r) => matchesChip(r, 'FAILED')).length,
    active: rows.filter((r) => matchesChip(r, 'active')).length,
    CANCELLED: rows.filter((r) => matchesChip(r, 'CANCELLED')).length,
  };

  const userSort = useMemo(() => {
    const raw = orden.replace(/^-/, '');
    if (!SORTABLE.has(raw)) return null;
    return { key: raw, dir: orden.startsWith('-') ? 'desc' : 'asc' };
  }, [orden]);
  // While running the table keeps the upload order (rows do not jump); the
  // ranking order is applied once, when everything is finished.
  const defaultSort = !processing && hasRequirements ? { key: 'rank', dir: 'asc' } : null;
  const sort = userSort ?? defaultSort;

  const visibleRows = useMemo(() => {
    const needle = normalizeText(qInput);
    const filtered = rows.filter(
      (r) =>
        matchesChip(r, chip) &&
        (!needle || normalizeText(`${r.candidate_name ?? ''} ${r.original_name ?? ''} ${r.headline ?? ''}`).includes(needle)),
    );
    const ordered = [...filtered];
    ordered.sort(sort ? compareRows(sort.key, sort.dir) : (a, b) => a.id - b.id);
    return ordered;
  }, [rows, chip, qInput, sort]);

  const top3 = useMemo(
    () =>
      !processing && hasRequirements
        ? rows.filter((r) => r.status === 'DONE' && r.score != null).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 3)
        : [],
    [rows, processing, hasRequirements],
  );

  const onChipChange = (value) => {
    if (value === 'all') updateParams({ estado: '', sugerencia: '' });
    else if (['ADVANCE', 'REVIEW', 'NO_ADVANCE'].includes(value)) updateParams({ sugerencia: value, estado: '' });
    else updateParams({ estado: value, sugerencia: '' });
  };
  const onSort = (key) => {
    const asc = key === 'score' ? 'desc' : 'asc';
    if (sort?.key === key) updateParams({ orden: sort.dir === 'asc' ? `-${key}` : key });
    else updateParams({ orden: asc === 'desc' ? `-${key}` : key });
  };
  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setQInput('');
    updateParams({ estado: '', sugerencia: '', q: '' });
  };
  const filtersActive = Boolean(estado || sugerencia || qInput);

  // ── candidate drawer (state in the URL: Esc and the Back button close it) ──
  // Opening pushes a history entry (Back closes the panel); moving between
  // candidates replaces it. Closing undoes the push when we made it.
  const openedByPush = useRef(false);
  const openCandidate = useCallback(
    (itemId) => {
      const first = !params.get('candidato');
      if (first) {
        const active = document.activeElement;
        originRef.current = active && active !== document.body ? active : null;
      }
      openedByPush.current = openedByPush.current || first;
      updateParams({ candidato: String(itemId) }, { replace: !first });
    },
    [params, updateParams],
  );
  const closeCandidate = useCallback(() => {
    if (openedByPush.current) {
      openedByPush.current = false;
      navigate(-1);
    } else {
      updateParams({ candidato: '' });
    }
  }, [navigate, updateParams]);
  useEffect(() => {
    if (candidatoId) {
      lastOpenedRef.current = candidatoId;
      return;
    }
    const last = deletedFocusRef.current ?? lastOpenedRef.current;
    if (last) {
      const origin = originRef.current;
      const neighbor = deletedFocusRef.current;
      lastOpenedRef.current = null;
      deletedFocusRef.current = null;
      originRef.current = null;
      // Back to where the user was (e.g. the Top 3 button), not to another zone of the
      // page; the table row is only the fallback (deep link, deleted CV, row gone).
      const target =
        (neighbor && document.querySelector(`[data-item-id="${neighbor}"]`)) ||
        (!neighbor && origin?.isConnected ? origin : null) ||
        document.querySelector(`[data-item-id="${last}"]`) ||
        resultsRef.current;
      target?.focus();
    }
  }, [candidatoId]);

  // ── actions ──
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelRef = useRef(null);

  const afterChange = () => {
    progress.refresh();
    loadItems();
  };

  async function runAction(fn) {
    setBusy(true);
    setActionError('');
    try {
      await fn();
    } catch (err) {
      setActionError(hrErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const retryFailed = () =>
    runAction(async () => {
      const { data } = await retryFailedCVItems(id);
      showToast({ type: 'success', message: COPY.toasts.retrying(data?.requeued ?? counts.failed) });
      afterChange();
    });
  const retryOne = (itemId) =>
    runAction(async () => {
      await retryCVItem(id, itemId);
      showToast({ type: 'success', message: COPY.toasts.retrying(1) });
      afterChange();
    });
  const resume = () =>
    runAction(async () => {
      await resumeCVAnalysis(id);
      showToast({ type: 'success', message: COPY.toasts.resumed });
      afterChange();
    });
  const cancelPending = () =>
    runAction(async () => {
      await cancelCVAnalysis(id);
      afterChange();
    });
  const resumeCancelled = () =>
    runAction(async () => {
      const ids = rows.filter((r) => r.status === 'CANCELLED').map((r) => r.id);
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map((itemId) => retryCVItem(id, itemId)));
      }
      showToast({ type: 'success', message: COPY.toasts.retrying(ids.length) });
      afterChange();
    });
  const removeAnalysis = () =>
    runAction(async () => {
      await deleteCVAnalysis(id);
      showToast({ type: 'success', message: COPY.toasts.analysisDeleted });
      navigate('/rrhh/cvs');
    }).finally(() => setConfirmDelete(false));

  // A stalled run is resumed once automatically (only HR_MANAGER).
  const autoResumed = useRef(false);
  useEffect(() => {
    if (progress.stalled && canWrite && !autoResumed.current) {
      autoResumed.current = true;
      resumeCVAnalysis(id)
        .then(() => progress.refresh())
        .catch(() => {});
    }
    // progress.refresh is stable; the effect must only react to `stalled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.stalled, canWrite, id]);

  // End of a run seen in this session: move the focus only if it was lost.
  useEffect(() => {
    if (!progress.finishedEvent) return;
    const active = document.activeElement;
    if (!active || active === document.body) resultsRef.current?.focus();
  }, [progress.finishedEvent]);

  // ── derived UI ──
  const eta = useEta(counts);
  const announcement = useProgressAnnouncer(counts, progress.finishedEvent);
  const filterMessage = visibleRows.length === 0 ? R.noMatches : R.showing(visibleRows.length, rows.length);
  const filterAnnouncement = useFilterAnnouncer(`${chip}|${qInput}`, filterMessage);

  const onDeleted = (itemId) => {
    const index = visibleRows.findIndex((r) => r.id === itemId);
    const neighbor = visibleRows[index + 1] ?? visibleRows[index - 1];
    deletedFocusRef.current = neighbor?.id ?? null;
    closeCandidate();
    showToast({ type: 'success', message: COPY.drawer.deleted });
    setList((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== itemId) }));
    afterChange();
    reload();
  };

  // ── loading / error states ──
  if (status === 'loading' || status === 'idle') {
    return (
      <div role="status" className="flex h-48 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-violet-600 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm text-gray-600">{R.loading}</p>
      </div>
    );
  }
  if (status === 'notfound' || progress.fatal === 'notfound') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 text-center">
        <h1 ref={h1Ref} tabIndex={-1} className={h1Cls}>{COPY.wizard.notFound}</h1>
        <Link to="/rrhh/cvs" className={btnSecondary}>{COPY.wizard.backToList}</Link>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className={`${noteBase} ${NOTE.red} mx-auto max-w-3xl flex-wrap items-center justify-between`}>
        <span className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> {error}</span>
        <button type="button" onClick={reload} className={btnSecondary}>
          <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
        </button>
      </div>
    );
  }

  const analysisStatus = progress.loaded ? progress.status : analysis.status;
  const cost = progress.loaded ? progress.cost : analysis.cost_usd;
  const simulated = Boolean(config?.simulated || config?.provider === 'fake');
  const requirementsList = analysis.requirements ?? [];
  const noCvs = counts.total === 0;
  const showTable = list.status === 'ready' && rows.length > 0;
  const Candidates = isDesktop ? CVCandidatesTable : CVCandidateList;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Persistent live regions (never inside a conditional): progress milestones and the
          final summary, and what a filter/search left on screen. */}
      <p aria-live="polite" className="sr-only">{announcement}</p>
      <p role="status" className="sr-only">{filterAnnouncement}</p>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 ref={h1Ref} tabIndex={-1} className={h1Cls}>{analysis.name}</h1>
          <CVAnalysisStatus status={analysisStatus} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-700">
          <span>{simulated ? R.costFree : R.cost(formatUsd(cost))}</span>
          {requirementsList.length > 0 && (
            <details className="min-w-[14rem]">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-800">{R.requirementsCount(requirementsList.length)}</summary>
              <ul className="list-disc space-y-1 pb-2 pl-5">
                {requirementsList.map((r, i) => (
                  <li key={r.id ?? i}>
                    {r.text}
                    {Number(r.weight) === 3 && ` (${COPY.wizard.mandatory.toLowerCase()})`}
                  </li>
                ))}
              </ul>
              {canWrite && !analysis.requirements_locked && (
                <Link to={`/rrhh/cvs/${analysis.id}/preparar?paso=1`} className={btnLink}>{R.editRequirements}</Link>
              )}
            </details>
          )}
        </div>
        <CVDisclaimer />
      </header>

      <CVStepper current={3} analysisId={analysis.id} completed={{ 1: true, 2: counts.total > 0 }} readOnly={!canWrite} />
      <CVModeBanner config={config} />

      {actionError && (
        <div role="alert" className={`${noteBase} ${NOTE.red}`}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {actionError}
        </div>
      )}

      {processing && (
        <CVProgressPanel
          counts={counts}
          percent={progress.percent}
          etaText={eta.text}
          stalled={progress.stalled}
          connectionLost={progress.connection === 'lost'}
          canWrite={canWrite}
          busy={busy}
          headingRef={progressRef}
          onResume={resume}
          onCancelPending={cancelPending}
          onResumeCancelled={resumeCancelled}
          onRetryNow={progress.refresh}
        />
      )}

      {!processing && progress.finishedEvent && <CVCompletionBanner counts={counts} />}

      {!noCvs && (
        <CVActionsBar
          analysis={analysis}
          counts={counts}
          canWrite={canWrite}
          busy={busy}
          stalled={progress.stalled}
          onRetryFailed={retryFailed}
          onResume={resume}
          onResumeCancelled={resumeCancelled}
        />
      )}

      {noCvs && (
        <div className={`${card} py-10 text-center`}>
          <p className="text-base font-bold text-gray-900">{canWrite ? R.empty : R.emptyRead}</p>
          {canWrite && (
            <Link to={`/rrhh/cvs/${analysis.id}/preparar?paso=2`} className={`${btnPrimary} mt-4`}>{R.emptyCta}</Link>
          )}
        </div>
      )}

      {!noCvs && (
        <section aria-labelledby="cv-results-title" className="space-y-4">
          <h2 id="cv-results-title" ref={resultsRef} tabIndex={-1} className={h2Cls}>{R.resultsTitle}</h2>

          {top3.length > 0 && <CVTop3 items={top3} onOpen={openCandidate} />}

          {list.status === 'loading' && (
            <p role="status" className="text-sm text-gray-600">{R.loadingList}</p>
          )}
          {list.status === 'error' && (
            <div role="alert" className={`${noteBase} ${NOTE.red} flex-wrap items-center justify-between`}>
              <span className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> {list.error}</span>
              <button type="button" onClick={loadItems} className={btnSecondary}>
                <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
              </button>
            </div>
          )}

          {showTable && (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CVQuickFilters counts={chipCounts} value={chip} onChange={onChipChange} hasRequirements={hasRequirements} />
                <div className="relative md:w-72">
                  <label htmlFor="cv-candidate-search" className="sr-only">{R.search}</label>
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                  <input
                    id="cv-candidate-search"
                    type="search"
                    value={qInput}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={R.search}
                    className={`${inputCls} pl-9`}
                  />
                </div>
              </div>

              {processing && hasRequirements && <p className="text-sm text-gray-700">{R.rankingLater}</p>}

              {visibleRows.length === 0 ? (
                <div className={`${card} text-center`}>
                  <p className="text-sm font-semibold text-gray-800">{R.noMatches}</p>
                  {filtersActive && (
                    <button type="button" onClick={clearFilters} className={btnLink}>{R.clearFilters}</button>
                  )}
                </div>
              ) : (
                <Candidates
                  items={visibleRows}
                  sort={sort}
                  onSort={onSort}
                  onOpen={openCandidate}
                  onRetry={retryOne}
                  canWrite={canWrite}
                  ranking={processing ? 'live' : 'final'}
                  hasRequirements={hasRequirements}
                  caption={R.tableCaption(analysis.name)}
                  activeId={candidatoId}
                />
              )}
              {filtersActive && visibleRows.length > 0 && (
                <button type="button" onClick={clearFilters} className={btnLink}>{R.clearFilters}</button>
              )}
            </>
          )}
        </section>
      )}

      {canWrite && (
        <details className="rounded-xl border border-gray-200 bg-white px-4">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-gray-800">{R.moreOptions}</summary>
          <div className="pb-3">
            <button type="button" onClick={() => setConfirmDelete(true)} className={btnLinkDanger}>{R.deleteAnalysis}</button>
          </div>
        </details>
      )}

      {candidatoId && (
        <CVCandidateDrawer
          analysisId={analysis.id}
          itemId={candidatoId}
          rows={visibleRows}
          liveStatus={progress.itemsById[candidatoId]?.status}
          hasRequirements={hasRequirements}
          canWrite={canWrite}
          onClose={closeCandidate}
          onNavigate={openCandidate}
          onDeleted={onDeleted}
          onChanged={afterChange}
        />
      )}

      <HRDialog
        open={confirmDelete}
        title={COPY.dialogs.deleteAnalysisTitle}
        description={COPY.dialogs.deleteAnalysisBody}
        onClose={() => setConfirmDelete(false)}
        initialFocusRef={cancelRef}
        busy={busy}
        footer={
          <>
            <button ref={cancelRef} type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className={btnSecondary}>
              {COPY.cancel}
            </button>
            <button type="button" onClick={removeAnalysis} disabled={busy} className={btnDanger}>
              {COPY.dialogs.deleteAnalysisConfirm}
            </button>
          </>
        }
      />
    </div>
  );
}
