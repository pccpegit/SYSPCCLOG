import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, RefreshCw, ScanSearch, Search } from 'lucide-react';
import { getCVAnalyses } from '../../api/hr';
import { useAuth } from '../../context/AuthContext';
import { COPY } from '../../utils/cvCopy';
import { hrErrorMessage } from '../../utils/hrErrors';
import { normalizeText } from '../../utils/cvFormat';
import { resumeHref, resumeStep } from '../../utils/cvResume';
import useCVConfig from '../../hooks/useCVConfig';
import useFilterAnnouncer from '../../hooks/useFilterAnnouncer';
import usePageFocus from '../../hooks/usePageFocus';
import CVAnalysisCard from '../../components/rrhh/cv/CVAnalysisCard';
import CVModeBanner from '../../components/rrhh/cv/CVModeBanner';
import { NOTE, btnLink, btnPrimary, btnSecondary, card, h1Cls, h2Cls, inputCls, noteBase } from '../../components/rrhh/cv/cvStyles';

const L = COPY.list;
const PAGE_SIZE = 50;
const SEARCH_FROM = 6; // search/filter only appear with more than 6 analyses

/** "Análisis de CVs" — list of processes with a single "continue where you left off" card. */
export default function HRCVAnalysesListPage() {
  const { userRoles } = useAuth();
  const canWrite = userRoles.includes('HR_MANAGER');
  const { config, isError: configError, reload: reloadConfig } = useCVConfig();
  const h1Ref = useRef(null);

  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState({ pages: {}, count: 0, error: '', loadedTick: -1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    getCVAnalyses({ page, page_size: PAGE_SIZE, ordering: '-created_at' })
      .then(({ data: body }) => {
        if (cancelled) return;
        setData((prev) => ({
          pages: { ...(page === 1 ? {} : prev.pages), [page]: body.results ?? [] },
          count: body.count ?? (body.results ?? []).length,
          error: '',
          loadedTick: tick,
        }));
      })
      .catch((err) => {
        if (!cancelled) setData((prev) => ({ ...prev, error: hrErrorMessage(err, L.error), loadedTick: tick }));
      });
    return () => {
      cancelled = true;
    };
  }, [page, tick]);

  const rows = useMemo(
    () => Object.keys(data.pages).sort((a, b) => a - b).flatMap((k) => data.pages[k]),
    [data.pages],
  );
  const status = data.error ? 'error' : data.loadedTick !== tick ? 'loading' : 'ready';
  usePageFocus(h1Ref, L.title, { ready: true });

  const resumeCandidate = canWrite
    ? rows.find((a) => a.status === 'EMPTY' || a.status === 'PROCESSING')
    : null;
  const filtersActive = Boolean(search.trim() || statusFilter);
  const visible = rows.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (search.trim() && !normalizeText(a.name).includes(normalizeText(search))) return false;
    return a.id !== resumeCandidate?.id || filtersActive;
  });
  const filterMessage = visible.length === 0 ? L.noMatches : L.showing(visible.length, rows.length);
  const filterAnnouncement = useFilterAnnouncer(`${statusFilter}|${search}`, filterMessage);
  const running = visible.filter((a) => a.status === 'EMPTY' || a.status === 'PROCESSING');
  const done = visible.filter((a) => a.status === 'COMPLETED' || a.status === 'COMPLETED_WITH_ERRORS');
  const isEmpty = status === 'ready' && rows.length === 0;
  const canLoadMore = status === 'ready' && rows.length < data.count;

  const retry = () => {
    setData((prev) => ({ ...prev, error: '' }));
    setPage(1);
    setTick((t) => t + 1);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 ref={h1Ref} tabIndex={-1} className={h1Cls}>{L.title}</h1>
          <p className="mt-0.5 text-sm text-gray-600">{canWrite ? L.subtitleWrite : L.subtitleRead}</p>
        </div>
        {canWrite && !isEmpty && (
          <Link to="/rrhh/cvs/nuevo" className={btnPrimary}>
            <Plus size={18} aria-hidden="true" /> {L.newAnalysis}
          </Link>
        )}
      </div>

      <p role="status" className="sr-only">{filterAnnouncement}</p>

      <CVModeBanner config={config} isError={configError} onRetry={reloadConfig} />

      {status === 'loading' && (
        <div role="status" className="flex h-40 flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-violet-600 motion-safe:animate-spin" aria-hidden="true" />
          <p className="text-sm text-gray-600">{L.loading}</p>
        </div>
      )}

      {status === 'error' && (
        <div role="alert" className={`${noteBase} ${NOTE.red} flex-wrap items-center justify-between`}>
          <span className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> {data.error}</span>
          <button type="button" onClick={retry} className={btnSecondary}>
            <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
          </button>
        </div>
      )}

      {isEmpty && (
        <div className={`${card} py-12 text-center`}>
          <ScanSearch size={36} className="mx-auto mb-3 text-violet-700 dark:text-violet-300" aria-hidden="true" />
          <p className="text-base font-bold text-gray-900">{canWrite ? L.emptyTitle : L.emptyRead}</p>
          {canWrite && (
            <>
              <p className="mt-1 text-sm text-gray-600">{L.emptyHint}</p>
              <Link to="/rrhh/cvs/nuevo" className={`${btnPrimary} mt-5`}>{L.emptyCta}</Link>
            </>
          )}
        </div>
      )}

      {status === 'ready' && resumeCandidate && !filtersActive && (
        <section aria-labelledby="cv-resume-title" className={`${card} border-violet-200 bg-violet-50 dark:bg-violet-500/10`}>
          <h2 id="cv-resume-title" className={h2Cls}>{L.resumeTitle}</h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-gray-900">{resumeCandidate.name}</p>
              <p className="text-sm text-gray-700">
                {resumeCandidate.status === 'PROCESSING'
                  ? L.resumeRunning
                  : resumeStep(resumeCandidate) === 2
                    ? L.resumeDraft
                    : L.resumeDraftPosting}
              </p>
            </div>
            <Link to={resumeHref(resumeCandidate)} className={btnSecondary}>
              {resumeCandidate.status === 'PROCESSING' ? L.resumeRunningButton : L.resumeDraftButton}
            </Link>
          </div>
        </section>
      )}

      {status === 'ready' && rows.length > SEARCH_FROM && (
        <form role="search" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="cv-list-search" className="sr-only">{L.search}</label>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              id="cv-list-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={L.search}
              className={`${inputCls} pl-9`}
            />
          </div>
          <div>
            <label htmlFor="cv-list-status" className="sr-only">{L.statusFilter}</label>
            <select id="cv-list-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
              <option value="">{L.allStatuses}</option>
              {Object.entries(L.status).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </form>
      )}

      {status === 'ready' && rows.length > 0 && visible.length === 0 && (
        <div className={`${card} text-center`}>
          <p className="text-sm font-semibold text-gray-800">{L.noMatches}</p>
          <button type="button" onClick={() => { setSearch(''); setStatusFilter(''); }} className={btnLink}>{L.clearFilters}</button>
        </div>
      )}

      {running.length > 0 && (
        <section aria-labelledby="cv-running-title" className="space-y-3">
          <h2 id="cv-running-title" className={h2Cls}>{L.sectionRunning}</h2>
          <ul className="space-y-3">{running.map((a) => <CVAnalysisCard key={a.id} analysis={a} />)}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="cv-done-title" className="space-y-3">
          <h2 id="cv-done-title" className={h2Cls}>{L.sectionDone}</h2>
          <ul className="space-y-3">{done.map((a) => <CVAnalysisCard key={a.id} analysis={a} />)}</ul>
        </section>
      )}

      {canLoadMore && (
        <div className="text-center">
          <button type="button" onClick={() => setPage((p) => p + 1)} className={btnSecondary}>{L.more}</button>
        </div>
      )}
    </div>
  );
}
