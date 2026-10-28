import { useCallback, useEffect, useState } from 'react';
import { getCVAnalysis } from '../api/hr';
import { hrErrorMessage } from '../utils/hrErrors';

/**
 * Analysis detail (name, requirements, posting, counts). The posting is read
 * synchronously by the backend (POST posting/extract/), so there is nothing
 * to poll here: callers use `reload()` after changing something.
 */
export default function useCVAnalysis(id) {
  const [state, setState] = useState({ id: null, status: 'loading', analysis: null, error: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    getCVAnalysis(id, { signal: controller.signal })
      .then(({ data }) => setState({ id, status: 'ready', analysis: data, error: '' }))
      .catch((err) => {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
        const code = err?.response?.status;
        setState({
          id,
          status: code === 404 || code === 403 ? 'notfound' : 'error',
          analysis: null,
          error: hrErrorMessage(err, 'No pudimos cargar el análisis.'),
        });
      });
    return () => controller.abort();
  }, [id, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setAnalysis = useCallback(
    (analysis) => setState((prev) => ({ ...prev, id: prev.id, status: 'ready', analysis, error: '' })),
    [],
  );

  // A different id means a stale result: show "loading" until it arrives.
  const stale = Boolean(id) && state.id !== id;
  return {
    analysis: stale ? null : state.analysis,
    status: !id ? 'idle' : stale ? 'loading' : state.status,
    error: state.error,
    reload,
    setAnalysis,
  };
}
