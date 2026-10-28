import { useEffect } from 'react';

/**
 * On page (or step) change: sets document.title and moves focus to the
 * heading (tabIndex=-1) so keyboard and screen-reader users know where they
 * are. `ready` delays it until the heading exists; `focusKey` re-runs it for a
 * new step; `focus: false` only sets the title. The title uses the PROCESS name, never a candidate.
 */
export default function usePageFocus(headingRef, title, { ready = true, focusKey = '', focus = true } = {}) {
  useEffect(() => {
    if (!ready) return;
    if (title) document.title = `${title} · RR. HH. · SYSPCC`;
    if (focus) headingRef.current?.focus({ preventScroll: false });
    // Only when the page becomes ready or the step changes — not on every title edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusKey]);
}
