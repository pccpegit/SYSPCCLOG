import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query. Where matchMedia does not exist (tests, old
 * browsers) it returns `defaultValue`, so only ONE variant renders.
 */
export default function useMediaQuery(query, defaultValue = true) {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : defaultValue;
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return matches;
}
