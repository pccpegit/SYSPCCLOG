import { useEffect, useRef, useState } from 'react';
import { COPY } from '../utils/cvCopy';

const MIN_GAP_MS = 15000;
const MILESTONES = [25, 50, 75];

/**
 * Text for ONE polite live region (it must live OUTSIDE anything that
 * unmounts, such as the progress panel): milestones (25/50/75 % of the CVs
 * already settled: done + failed + cancelled), the first error, at most once
 * every 15 s, and always the final summary when the run ends
 * (`finishedEvent`). Never one announcement per CV.
 */
export default function useProgressAnnouncer(counts, finishedEvent = null) {
  const [message, setMessage] = useState('');
  const memo = useRef({ at: 0, milestones: new Set(), errorSaid: false });
  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;
  const failed = counts?.failed ?? 0;
  const cancelled = counts?.cancelled ?? 0;

  useEffect(() => {
    if (!total) return undefined;
    const announce = () => {
      const m = memo.current;
      const now = Date.now();
      if (m.at && now - m.at < MIN_GAP_MS) return;
      const pct = ((done + failed + cancelled) / total) * 100;
      const reached = MILESTONES.filter((x) => pct >= x && !m.milestones.has(x));
      if (reached.length) {
        reached.forEach((x) => m.milestones.add(x));
        m.at = now;
        setMessage(COPY.results.announceMilestone(done, total));
      } else if (failed > 0 && !m.errorSaid) {
        m.errorSaid = true;
        m.at = now;
        setMessage(COPY.results.announceFirstError);
      }
    };
    const timer = setTimeout(announce, 0);
    return () => clearTimeout(timer);
  }, [total, done, failed, cancelled]);

  // The end of a run is always announced (it is not subject to the 15 s gap).
  // It is declared after the milestone effect so it wins when both fire together.
  useEffect(() => {
    if (!finishedEvent) return undefined;
    const timer = setTimeout(() => {
      const c = finishedEvent.counts ?? {};
      memo.current.at = Date.now();
      MILESTONES.forEach((x) => memo.current.milestones.add(x));
      setMessage(COPY.results.announceDone(c.done ?? 0, c.failed ?? 0));
    }, 0);
    return () => clearTimeout(timer);
  }, [finishedEvent]);

  return message;
}
