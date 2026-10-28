import { useEffect, useState } from 'react';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** true while the tab is visible (used to pause polling in background tabs). */
export default function useDocumentVisible() {
  const [visible, setVisible] = useState(isVisible);
  useEffect(() => {
    const onChange = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
