import { useCallback, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { downloadResponse } from '../utils/download';

/**
 * SYSPCC-025 — descarga de un archivo del backend con estado "en curso" y aviso
 * de error. `run(() => api.exportX(params), 'nombre.xlsx')`. Ignora clics
 * repetidos mientras la descarga sigue en curso.
 */
export default function useFileDownload() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async (request, fallbackName, errorMessage = 'No se pudo descargar el archivo. Intente nuevamente.') => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      await downloadResponse(request(), fallbackName);
      return true;
    } catch {
      showToast({ type: 'error', message: errorMessage });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [showToast]);

  return { busy, run };
}
