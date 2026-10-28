import { useEffect, useRef, useState } from 'react';
import { etaMinutes } from '../utils/cvFormat';
import { COPY } from '../utils/cvCopy';

const MIN_FINISHED = 3;
const MIN_ELAPSED_MS = 20_000;
const UPDATE_EVERY_MS = 10_000;
const MAX_RISE = 1.2;

/** Pure estimate: pending x observed pace. Returns seconds or null (not enough data). */
export function estimateSeconds({ pending, finishedSince, elapsedMs }) {
  if (pending <= 0 || finishedSince < MIN_FINISHED || elapsedMs < MIN_ELAPSED_MS) return null;
  return (pending * (elapsedMs / finishedSince)) / 1000;
}

export function etaText(seconds) {
  const minutes = etaMinutes(seconds);
  if (minutes == null) return COPY.results.etaCalculating;
  return minutes === 0 ? COPY.results.etaLessThanMin : COPY.results.etaMinutes(minutes);
}

/**
 * Remaining-time text for the progress panel. The observed pace already
 * includes the worker's parallelism. Updates at most every 10 s (no flicker)
 * and never rises more than 20 % between updates.
 */
export default function useEta(counts) {
  const [seconds, setSeconds] = useState(null);
  const pending = (counts?.queued ?? 0) + (counts?.processing ?? 0);
  const finished = (counts?.done ?? 0) + (counts?.failed ?? 0);
  const latest = useRef({ pending, finished });
  useEffect(() => {
    latest.current = { pending, finished };
  });
  const active = pending > 0;

  useEffect(() => {
    if (!active) return undefined;
    const start = { at: Date.now(), finished: latest.current.finished };
    let last = { at: 0, value: null };

    const update = () => {
      const now = Date.now();
      if (last.value != null && now - last.at < UPDATE_EVERY_MS) return;
      let next = estimateSeconds({
        pending: latest.current.pending,
        finishedSince: latest.current.finished - start.finished,
        elapsedMs: now - start.at,
      });
      if (next != null && last.value != null) next = Math.min(next, last.value * MAX_RISE);
      last = { at: now, value: next };
      setSeconds(next);
    };

    update();
    const id = setInterval(update, UPDATE_EVERY_MS);
    return () => {
      clearInterval(id);
      setSeconds(null);
    };
  }, [active]);

  return { seconds, text: etaText(seconds) };
}
