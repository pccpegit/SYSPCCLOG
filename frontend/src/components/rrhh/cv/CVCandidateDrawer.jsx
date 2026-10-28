import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { deleteCVItem, getCVItem, retryCVItem } from '../../../api/hr';
import { COPY } from '../../../utils/cvCopy';
import { hrErrorMessage } from '../../../utils/hrErrors';
import { formatUsd, formatNumber } from '../../../utils/cvFormat';
import HRDialog from '../HRDialog';
import CVDisclaimer from './CVDisclaimer';
import CVDownloadButton from './CVDownloadButton';
import CVRecommendationBadge from './CVRecommendationBadge';
import CVRequirementResults from './CVRequirementResults';
import CVStatusChip from './CVStatusChip';
import { candidateLabel, failureOf } from './cvCandidate';
import { NOTE, btnDanger, btnLinkDanger, btnSecondary, noteBase } from './cvStyles';

const D = COPY.drawer;
const isHttpUrl = (value) => /^https?:\/\//i.test(String(value ?? ''));

function Section({ title, open = false, children }) {
  return (
    <details open={open} className="rounded-xl border border-gray-200 bg-white px-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-gray-900">{title}</summary>
      <div className="pb-4 text-sm leading-relaxed text-gray-800">{children}</div>
    </details>
  );
}

function BulletList({ items }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
}

function ReportBody({ item, hasRequirements }) {
  const report = item.report ?? {};
  const computed = item.computed ?? {};
  const evaluation = report.evaluation ?? {};
  const candidate = report.candidate ?? {};
  const notes = [];
  if (item.injection_suspected || report.injection_suspected) notes.push(D.notes.injection);
  if (report.readability === 'poor') notes.push(D.notes.poor);
  else if (report.readability === 'partial') notes.push(D.notes.partial);
  if (computed.experience_source === 'ai_estimate') notes.push(D.notes.aiYears);
  const reqRows = computed.requirements ?? [];
  const strengths = evaluation.strengths ?? [];
  const gaps = evaluation.gaps ?? [];
  const contactLines = [candidate.email, candidate.phone, candidate.location].filter(Boolean);
  const links = (candidate.links ?? []).filter(Boolean);

  return (
    <div className="space-y-3">
      {notes.map((text) => (
        <p key={text} role="note" className={`${noteBase} ${NOTE.amber}`}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {text}
        </p>
      ))}

      {report.summary && (
        <Section title={D.summary} open>
          <p>{report.summary}</p>
        </Section>
      )}

      {hasRequirements && reqRows.length > 0 && (
        <Section title={D.requirements} open>
          <CVRequirementResults rows={reqRows} />
        </Section>
      )}
      {strengths.length > 0 && (
        <Section title={D.strengths} open>
          <BulletList items={strengths} />
        </Section>
      )}
      {gaps.length > 0 && (
        <Section title={D.gaps} open>
          <BulletList items={gaps} />
        </Section>
      )}

      {(report.experience ?? []).length > 0 && (
        <Section title={D.experience}>
          <ul className="space-y-3">
            {report.experience.map((e, i) => (
              <li key={i}>
                <p className="font-semibold text-gray-900">{[e.role, e.company].filter(Boolean).join(' — ')}</p>
                <p className="text-gray-600">
                  {[e.start, e.is_current ? D.present : e.end].filter(Boolean).join(' – ')}
                </p>
                {e.description && <p>{e.description}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(report.education ?? []).length > 0 && (
        <Section title={D.education}>
          <ul className="space-y-2">
            {report.education.map((e, i) => (
              <li key={i}>
                <p className="font-semibold text-gray-900">{[e.degree, e.field].filter(Boolean).join(' · ')}</p>
                <p className="text-gray-600">{[e.institution, e.end_year].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(report.skills ?? []).length > 0 && (
        <Section title={D.skills}>
          <ul className="flex flex-wrap gap-2">
            {report.skills.map((s, i) => (
              <li key={i} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800">{s}</li>
            ))}
          </ul>
        </Section>
      )}
      {((report.certifications ?? []).length > 0 || (report.languages ?? []).length > 0) && (
        <Section title={D.certLang}>
          {(report.certifications ?? []).length > 0 && (
            <>
              <p className="font-semibold text-gray-900">{D.certifications}</p>
              <BulletList items={report.certifications.map((c) => [c.name, c.issuer, c.year].filter(Boolean).join(' · '))} />
            </>
          )}
          {(report.languages ?? []).length > 0 && (
            <>
              <p className="mt-3 font-semibold text-gray-900">{D.languages}</p>
              <BulletList items={report.languages.map((l) => [l.language, l.level].filter(Boolean).join(' · '))} />
            </>
          )}
        </Section>
      )}
      {(contactLines.length > 0 || links.length > 0) && (
        <Section title={D.contact}>
          <ul className="space-y-1">
            {contactLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {links.map((link) => (
              <li key={link}>
                {isHttpUrl(link) ? (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-violet-700 underline dark:text-violet-300">
                    {link}
                  </a>
                ) : (
                  link
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={D.technical}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-semibold">{D.tokens}</dt>
          <dd>{`${formatNumber(item.tokens_in)} / ${formatNumber(item.tokens_out)}`}</dd>
          <dt className="font-semibold">{D.costCv}</dt>
          <dd>{`US$ ${formatUsd(item.cost_usd)}`}</dd>
        </dl>
      </Section>
    </div>
  );
}

/**
 * Candidate side panel (not a page: the table keeps its context). Progressive
 * disclosure: score, notes and summary first; the rest in <details>. Prev/next
 * walk the current (filtered/sorted) list. All CV/AI text is rendered as text.
 */
export default function CVCandidateDrawer({
  analysisId,
  itemId,
  rows,
  liveStatus,
  hasRequirements,
  canWrite,
  onClose,
  onNavigate,
  onDeleted,
  onChanged,
}) {
  const [state, setState] = useState({ itemId: null, status: 'loading', item: null });
  const [tick, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const titleRef = useRef(null);
  const cancelRef = useRef(null);
  const prevId = useRef(itemId);

  useEffect(() => {
    const controller = new AbortController();
    getCVItem(analysisId, itemId, { signal: controller.signal })
      .then(({ data }) => setState({ itemId, status: 'ready', item: data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
        setState({ itemId, status: 'error', item: null });
      });
    return () => controller.abort();
  }, [analysisId, itemId, liveStatus, tick]);

  // Moving between candidates: the new name (h2) receives the focus.
  useEffect(() => {
    if (prevId.current === itemId) return;
    prevId.current = itemId;
    titleRef.current?.focus();
  }, [itemId]);

  const stale = state.itemId !== itemId;
  const status = stale ? 'loading' : state.status;
  const item = stale ? null : state.item;
  const row = rows.find((r) => r.id === itemId) ?? item ?? {};
  const index = rows.findIndex((r) => r.id === itemId);
  const prev = index > 0 ? rows[index - 1] : null;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null;
  const failure = item ? failureOf(item) : null;
  const inProgress = item && (item.status === 'QUEUED' || item.status === 'PROCESSING');

  async function retry() {
    setActionError('');
    setBusy(true);
    try {
      await retryCVItem(analysisId, itemId);
      onChanged?.();
      setTick((t) => t + 1);
    } catch (err) {
      setActionError(hrErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setActionError('');
    try {
      await deleteCVItem(analysisId, itemId);
      setConfirm(false);
      onDeleted(itemId);
    } catch (err) {
      setActionError(hrErrorMessage(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const footer = item && (
    <>
      {item.status === 'DONE' && (
        <CVDownloadButton kind="report" analysisId={analysisId} itemId={itemId} label={D.downloadReport} variant="primary" />
      )}
      <CVDownloadButton
        kind="original"
        analysisId={analysisId}
        itemId={itemId}
        label={D.downloadOriginal}
        disabledReason={item.file_available === false ? D.originalGone : ''}
      />
      {canWrite && (
        <button type="button" onClick={() => setConfirm(true)} className={btnLinkDanger}>
          <Trash2 size={16} aria-hidden="true" /> {D.deleteCv}
        </button>
      )}
    </>
  );

  return (
    <>
      <HRDialog
        open
        variant="drawer"
        title={candidateLabel(row)}
        titleRef={titleRef}
        onClose={() => {
          if (!confirm) onClose();
        }}
        footer={footer}
      >
        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => prev && onNavigate(prev.id)}
              aria-disabled={!prev}
              className={btnSecondary}
            >
              <ChevronLeft size={16} aria-hidden="true" /> {D.previous}
            </button>
            {index >= 0 && <p className="text-sm font-semibold text-gray-800">{D.position(index + 1, rows.length)}</p>}
            <button
              type="button"
              onClick={() => next && onNavigate(next.id)}
              aria-disabled={!next}
              className={btnSecondary}
            >
              {D.next} <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          {row.headline && <p className="text-sm text-gray-700">{row.headline}</p>}

          {status === 'loading' && (
            <div role="status" className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-gray-700">
                <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> {D.loading}
              </p>
              <div className="h-16 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none" />
              <div className="h-24 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none" />
            </div>
          )}

          {status === 'error' && (
            <div role="alert" className={`${noteBase} ${NOTE.red} flex-wrap items-center justify-between`}>
              <span className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> {D.loadError}</span>
              <button type="button" onClick={() => setTick((t) => t + 1)} className={btnSecondary}>
                <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
              </button>
            </div>
          )}

          {inProgress && (
            <p role="status" className="flex items-center gap-2 text-sm text-gray-800">
              <CVStatusChip status={item.status} /> {D.inProgress}
            </p>
          )}

          {item && item.status === 'CANCELLED' && (
            <div className="flex items-center gap-3">
              <CVStatusChip status="CANCELLED" />
              {canWrite && (
                <button type="button" onClick={() => !busy && retry()} aria-disabled={busy || undefined} className={btnSecondary}>{COPY.retry}</button>
              )}
            </div>
          )}

          {failure && (
            <div role="alert" className={`${noteBase} ${NOTE.red} flex-col`}>
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={18} aria-hidden="true" /> {D.failedTitle}
              </p>
              <p>{failure.message}</p>
              {canWrite && failure.retryable && (
                <button type="button" onClick={() => !busy && retry()} aria-disabled={busy || undefined} className={btnSecondary}>
                  <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
                </button>
              )}
            </div>
          )}

          {item && item.status === 'DONE' && (
            <>
              {item.score != null && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 p-3">
                  <p className="text-xl font-extrabold text-gray-900 font-display">{COPY.results.scoreOf(Math.round(item.score))}</p>
                  <CVRecommendationBadge value={item.recommendation} />
                </div>
              )}
              <CVDisclaimer compact />
              <ReportBody item={item} hasRequirements={hasRequirements} />
            </>
          )}

          {actionError && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">{actionError}</p>}
        </div>
      </HRDialog>

      <HRDialog
        open={confirm}
        title={COPY.dialogs.deleteCvTitle}
        description={COPY.dialogs.deleteCvBody}
        onClose={() => setConfirm(false)}
        initialFocusRef={cancelRef}
        busy={busy}
        footer={
          <>
            <button ref={cancelRef} type="button" onClick={() => setConfirm(false)} disabled={busy} className={btnSecondary}>
              {COPY.cancel}
            </button>
            <button type="button" onClick={remove} disabled={busy} className={btnDanger}>
              {COPY.dialogs.deleteCvConfirm}
            </button>
          </>
        }
      />
    </>
  );
}
