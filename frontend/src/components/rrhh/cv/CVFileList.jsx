import { AlertTriangle, CheckCircle2, Clock, Copy, File, FileImage, FileText, Loader2, WifiOff, XCircle } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { formatBytes } from '../../../utils/cvFormat';
import { extensionOf } from '../../../utils/cvFiles';
import { btnLink } from './cvStyles';

const MAX_ROWS = 200;
const isProblem = (e) => e.state === 'rejected' || e.state === 'failed';

const STATE_ICON = {
  pending: { icon: Clock, cls: 'text-gray-600' },
  uploading: { icon: Loader2, cls: 'text-violet-700 motion-safe:animate-spin dark:text-violet-300' },
  uploaded: { icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-300' },
  duplicate: { icon: Copy, cls: 'text-gray-600' },
  rejected: { icon: XCircle, cls: 'text-red-700 dark:text-red-300' },
  failed: { icon: WifiOff, cls: 'text-red-700 dark:text-red-300' },
};

function TypeIcon({ name }) {
  const ext = extensionOf(name);
  const Icon = ext === '.pdf' ? FileText : ['.jpg', '.jpeg', '.png'].includes(ext) ? FileImage : File;
  return <Icon size={18} className="shrink-0 text-gray-600" aria-hidden="true" />;
}

function Row({ entry, onRemove, onRetryUpload, disabled, showState }) {
  const cfg = STATE_ICON[entry.state] ?? STATE_ICON.pending;
  const StateIcon = cfg.icon;
  const label = COPY.step2.states[entry.state];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <TypeIcon name={entry.file.name} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900" title={entry.file.name}>
        {entry.file.name}
      </span>
      <span className="text-xs text-gray-600">{formatBytes(entry.file.size)}</span>
      {(showState || isProblem(entry)) && (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-800">
          <StateIcon size={14} className={cfg.cls} aria-hidden="true" />
          {label}
        </span>
      )}
      {entry.detail && <span className="basis-full pl-7 text-sm text-red-700 dark:text-red-300">{entry.detail}</span>}
      <span className="ml-auto flex items-center">
        {entry.state === 'failed' && onRetryUpload && (
          <button
            type="button"
            onClick={onRetryUpload}
            aria-label={COPY.step2.retryFile(entry.file.name)}
            className={btnLink}
          >
            {COPY.retry}
          </button>
        )}
        {!disabled && entry.state !== 'uploaded' && entry.state !== 'duplicate' && (
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            aria-label={COPY.step2.removeFile(entry.file.name)}
            className={btnLink}
          >
            {COPY.remove}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Summary + problems always visible; the good files collapsed in a <details>
 * (progressive disclosure: 40 rows never push the primary button away).
 */
export default function CVFileList({ entries, onRemove, onClear, onRetryUpload, disabled = false }) {
  if (entries.length === 0) return null;
  const problems = entries.filter(isProblem);
  const good = entries.filter((e) => !isProblem(e));
  const shown = good.slice(0, MAX_ROWS);

  return (
    <section aria-label="Archivos elegidos" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold text-gray-900 font-display">
          {COPY.step2.ready(good.length)}
          {problems.length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-sm font-semibold text-red-700 dark:text-red-300">
              <AlertTriangle size={14} aria-hidden="true" /> {COPY.step2.withProblems(problems.length)}
            </span>
          )}
        </h3>
        {entries.length > 1 && !disabled && (
          <button type="button" onClick={onClear} className={btnLink}>{COPY.step2.clear}</button>
        )}
      </div>

      {problems.length > 0 && (
        <ul className="divide-y divide-red-100 rounded-xl border border-red-300 bg-red-50 px-3 dark:border-red-500/30 dark:bg-red-500/10">
          {problems.map((e) => (
            <Row key={e.id} entry={e} onRemove={onRemove} onRetryUpload={onRetryUpload} disabled={disabled} showState />
          ))}
        </ul>
      )}

      {good.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white px-3">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-gray-800">
            {COPY.step2.seeAll(good.length)}
          </summary>
          <ul className="divide-y divide-gray-100 pb-2">
            {shown.map((e) => (
              <Row key={e.id} entry={e} onRemove={onRemove} disabled={disabled} showState={e.state !== 'pending'} />
            ))}
          </ul>
          {good.length > MAX_ROWS && (
            <p className="pb-3 text-sm text-gray-600">{`… y ${good.length - MAX_ROWS} más`}</p>
          )}
        </details>
      )}
    </section>
  );
}
