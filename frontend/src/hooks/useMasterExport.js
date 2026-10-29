import { useCallback, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { exportRequestMaster } from '../api/requestMaster';
import { filenameFromDisposition, saveBlob } from '../utils/download';
import { describeExportError } from '../utils/requestMaster';

const FALLBACK_NAME = 'master_rq.xlsx';

export const TRUNCATED_MESSAGE =
  'El Excel se generó incompleto: superó el máximo de filas que admite una descarga. '
  + 'Aplique filtros (proyecto, fechas, estado) para obtener el Master completo.';

/**
 * SYSPCC-030 — descarga del Master en Excel con los filtros activos. Usa el cliente Axios (cookies,
 * CSRF y refresh del token), guarda el archivo con el nombre de `Content-Disposition`, avisa si el
 * servidor lo truncó (`X-Export-Truncated: true`) y traduce 429/403/400. Ignora clics repetidos
 * mientras una descarga sigue en curso. `message` alimenta una región viva para lectores de pantalla.
 */
export default function useMasterExport() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);

  const run = useCallback(async (params) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setMessage('Preparando el Excel del Master…');
    try {
      const response = await exportRequestMaster(params);
      const name = filenameFromDisposition(response.headers?.['content-disposition'], FALLBACK_NAME);
      saveBlob(response.data, name);
      const truncated = String(response.headers?.['x-export-truncated']).toLowerCase() === 'true';
      if (truncated) {
        setMessage(TRUNCATED_MESSAGE);
        showToast({ type: 'info', message: TRUNCATED_MESSAGE, duration: 12000 });
      } else {
        setMessage(`Se descargó ${name}.`);
        showToast({ type: 'success', message: 'Master descargado.' });
      }
      return true;
    } catch (err) {
      const text = await describeExportError(err);
      setMessage(text);
      showToast({ type: 'error', message: text, duration: 8000 });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [showToast]);

  return { busy, message, run };
}
