import { useCallback, useEffect, useRef, useState } from 'react';
import { getCVProgress } from '../api/hr';
import useDocumentVisible from './useDocumentVisible';

export const ACTIVE_MS = 2000;
export const SETTLED_MS = 10000;
export const SETTLED_POLLS = 6;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30000;
const LOST_AFTER_FAILURES = 3;

const EMPTY_COUNTS = { total: 0, queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0 };

const INITIAL = {
  id: null,
  loaded: false,
  fatal: null,
  connection: 'ok',
  counts: EMPTY_COUNTS,
  percent: 0,
  status: 'EMPTY',
  cost: 0,
  stalled: false,
  recommendations: { advance: 0, review: 0, no_advance: 0 },
  flagged: { injection: 0 },
  itemsById: {},
  finishedEvent: null,
};

/** min(2 s * 2^(n-1), 30 s) with +-20 % jitter; 429 honors Retry-After. */
export function backoffDelay(failures, retryAfterSec = 0, rand = Math.random) {
  if (retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 60000);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
  return Math.round(base * (1 + (rand() * 0.4 - 0.2)));
}

const isCanceled = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Single owner of the progress polling (GET progress/?since=).
 * - 2 s while there are queued/processing CVs; 10 s for 6 polls once settled, then it stops
 *   (`refresh()` — after uploading, retrying, resuming, cancelling — starts it again).
 * - Hidden tab: no new request; it polls right away when visible/online again.
 * - Errors: exponential backoff; 3 in a row => connection 'lost'; 404/403 => fatal 'notfound'.
 * - Items are merged by id; `finishedEvent` is set when a run seen in this
 *   session ends (used for the celebration; never when re-opening a finished analysis).
 */
export default function useCVProgress(analysisId, { enabled = true } = {}) {
  const visible = useDocumentVisible();
  const [data, setData] = useState(INITIAL);
  const apiRef = useRef(null);

  useEffect(() => {
    if (!analysisId || !enabled) return undefined;
    const c = {
      alive: true,
      timer: null,
      controller: null,
      inflight: false,
      again: false,
      since: null,
      failures: 0,
      settled: 0,
      sawActive: false,
      items: {},
    };

    const schedule = (ms) => {
      clearTimeout(c.timer);
      c.timer = null;
      if (!c.alive || ms == null || hidden()) return;
      c.timer = setTimeout(poll, ms);
    };

    async function poll() {
      if (!c.alive || c.inflight || hidden()) return;
      clearTimeout(c.timer);
      c.timer = null;
      c.inflight = true;
      c.controller = new AbortController();
      try {
        const { data: res } = await getCVProgress(analysisId, c.since, { signal: c.controller.signal });
        if (!c.alive) return;
        c.failures = 0;
        c.since = res.server_time ?? c.since;
        if (res.items?.length) {
          c.items = { ...c.items };
          res.items.forEach((item) => {
            c.items[item.id] = { ...c.items[item.id], ...item };
          });
        }
        const counts = { ...EMPTY_COUNTS, ...res.counts };
        const pending = counts.queued + counts.processing;
        let finished = null;
        if (pending > 0) c.sawActive = true;
        else if (c.sawActive) {
          c.sawActive = false;
          finished = { counts };
        }
        setData((prev) => ({
          id: analysisId,
          loaded: true,
          fatal: null,
          connection: 'ok',
          counts,
          percent: res.percent ?? 0,
          status: res.status ?? 'EMPTY',
          cost: res.cost_usd ?? 0,
          stalled: Boolean(res.stalled),
          recommendations: res.recommendations ?? INITIAL.recommendations,
          flagged: res.flagged ?? INITIAL.flagged,
          itemsById: c.items,
          finishedEvent: finished ?? (prev.id === analysisId ? prev.finishedEvent : null),
        }));
        let next;
        if (c.again) {
          c.again = false;
          next = 0;
        } else if (pending > 0 || res.stalled) {
          c.settled = 0;
          next = ACTIVE_MS;
        } else {
          c.settled += 1;
          next = c.settled <= SETTLED_POLLS ? SETTLED_MS : null;
        }
        schedule(next);
      } catch (err) {
        if (!c.alive || isCanceled(err)) return;
        const status = err?.response?.status;
        if (status === 404 || status === 403) {
          setData((prev) => ({ ...prev, id: analysisId, fatal: 'notfound' }));
          return;
        }
        if (err?.response?.data?.code === 'invalid_since') {
          c.since = null;
          schedule(500);
          return;
        }
        c.failures += 1;
        if (c.failures >= LOST_AFTER_FAILURES) {
          setData((prev) => ({ ...prev, id: analysisId, connection: 'lost' }));
        }
        const retryAfter = status === 429 ? Number(err?.response?.headers?.['retry-after']) || 0 : 0;
        schedule(backoffDelay(c.failures, retryAfter));
      } finally {
        c.inflight = false;
      }
    }

    apiRef.current = {
      poll,
      refresh: () => {
        c.settled = 0;
        if (c.inflight) c.again = true;
        else poll();
      },
    };
    poll();
    const onOnline = () => apiRef.current?.refresh();
    window.addEventListener('online', onOnline);

    return () => {
      c.alive = false;
      clearTimeout(c.timer);
      c.controller?.abort();
      window.removeEventListener('online', onOnline);
      apiRef.current = null;
    };
  }, [analysisId, enabled]);

  // Back to the foreground: poll right away.
  useEffect(() => {
    if (visible) apiRef.current?.poll();
  }, [visible]);

  const refresh = useCallback(() => apiRef.current?.refresh(), []);
  const clearFinished = useCallback(() => setData((prev) => ({ ...prev, finishedEvent: null })), []);

  const current = data.id === analysisId ? data : INITIAL;
  return { ...current, refresh, clearFinished };
}
