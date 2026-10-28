import { useCallback, useEffect, useState } from 'react';
import { getCVConfig } from '../api/hr';

/** GET cv-analyses/config/ — limits, provider (fake = modo de prueba) and whether analysis is enabled. */
export default function useCVConfig() {
  const [state, setState] = useState({ status: 'loading', config: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCVConfig()
      .then(({ data }) => {
        if (!cancelled) setState({ status: 'ready', config: data });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ status: 'error', config: prev.config }));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    config: state.config,
    isLoading: state.status === 'loading' && !state.config,
    isError: state.status === 'error',
    reload,
  };
}
