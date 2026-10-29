import { useCallback, useEffect, useState } from 'react';

/**
 * SYSPCC-030 — consulta paginada del Master de RQ con estados de carga/error derivados.
 *
 * `fetcher(params)` devuelve una promesa Axios; `params` se compara por contenido, así que se puede
 * pasar un objeto nuevo en cada render. Mientras llega la respuesta de otros parámetros del MISMO
 * endpoint se conserva el último resultado (`data`) y `loading` es true: la pantalla lo atenúa en vez de vaciarlo.
 * `enabled: false` no consulta. `reload()` repite la consulta; `patchRows(fn)` reemplaza filas en
 * sitio (p. ej. con el ítem que devuelve el endpoint de Stand by).
 */
export default function useMasterQuery(fetcher, params, { enabled = true } = {}) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState({ key: null, source: null, data: null, error: null });

  const paramsKey = JSON.stringify(params ?? {});
  const key = `${reloadToken}:${paramsKey}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetcher(JSON.parse(paramsKey))
      .then((response) => {
        if (!cancelled) setState({ key, source: fetcher, data: response.data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ key, source: fetcher, data: null, error });
      });
    return () => { cancelled = true; };
  }, [fetcher, paramsKey, key, enabled]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const patchRows = useCallback((updater) => {
    setState((prev) => {
      if (!prev.data?.results) return prev;
      return { ...prev, data: { ...prev.data, results: prev.data.results.map(updater) } };
    });
  }, []);

  // Un resultado de otro endpoint (cambio de pestaña) tiene otra forma: nunca se muestra como «anterior».
  const sameSource = state.source === fetcher;
  const settled = sameSource && state.key === key;
  return {
    data: sameSource ? state.data : null,
    error: enabled && settled ? state.error : null,
    loading: enabled && !settled,
    reload,
    patchRows,
  };
}
