import { useEffect, useRef, useState } from 'react';

/**
 * Text for a persistent `role="status"` region that tells a screen-reader user
 * what a filter/search left on screen ("Mostrando 3 de 40 candidatos.").
 * It only speaks when `filterKey` (the current filters) changes, after a
 * short pause so typing in a search box announces once, not per keystroke;
 * live data changing under the same filters stays silent. `message` is read at
 * announce time, so it reflects the latest counts.
 */
export default function useFilterAnnouncer(filterKey, message, delay = 500) {
  const [text, setText] = useState('');
  const latest = useRef(message);
  const prevKey = useRef(filterKey);

  // Declared before the timer effect so it always sees the freshest message.
  useEffect(() => {
    latest.current = message;
  });

  useEffect(() => {
    if (prevKey.current === filterKey) return undefined;
    prevKey.current = filterKey;
    const timer = setTimeout(() => setText(latest.current), delay);
    return () => clearTimeout(timer);
  }, [filterKey, delay]);

  return text;
}
