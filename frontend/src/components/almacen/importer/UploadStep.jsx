import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FileUp, Loader2, X } from 'lucide-react';
import { downloadImportTemplate, getImports, uploadImport } from '../../../api/almacenImport';
import useFileDownload from '../../../hooks/useFileDownload';
import useFileDrop from '../../../hooks/useFileDrop';
import { formatBytes } from '../../../utils/cvFormat';
import { formatISODate } from '../../../utils/almacen';
import { IMPORT_STATUS_LABELS, importErrorMessage, validateWorkbookFile } from '../../../utils/almacenImport';
import { Banner, Card, Chip, FocusHeading } from '../ui';
import { btnPrimary, btnSecondary } from '../uiStyles';

const STATUS_TONE = { CONFIRMED: 'emerald', PREVIEWED: 'blue', CANCELLED: 'gray', EXPIRED: 'gray', FAILED: 'red', PROCESSING: 'amber' };

/** Paso 1: elegir el libro .xlsx y analizarlo (no escribe nada en la base de datos). */
export default function UploadStep({ onPreviewed, focusHeading = false }) {
  const download = useFileDownload();
  const [file, setFile] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState({ status: 'loading', rows: [] });
  const inFlight = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getImports({ page_size: 5 });
        const rows = res?.data?.results ?? [];
        if (alive) setHistory({ status: 'ready', rows });
      } catch {
        if (alive) setHistory({ status: 'error', rows: [] });
      }
    })();
    return () => { alive = false; };
  }, []);

  const pick = (candidate) => {
    const problem = validateWorkbookFile(candidate);
    setError(problem);
    setFile(problem ? null : candidate);
  };

  const { dragging, dropProps } = useFileDrop({
    onFiles: (files) => pick(files[0]),
    disabled: uploading,
  });

  const analyze = async () => {
    if (inFlight.current) return;
    const problem = validateWorkbookFile(file);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setUploading(true);
    setError('');
    try {
      const { data } = await uploadImport(file, { updateExisting });
      onPreviewed(data);
    } catch (err) {
      setError(importErrorMessage(err, 'No se pudo analizar el archivo. Intente nuevamente.'));
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-7 space-y-5">
        <div>
          <FocusHeading autoFocus={focusHeading} className="text-base font-bold text-gray-900 font-display">Paso 1 · Subir el libro</FocusHeading>
          <p className="text-sm text-gray-600 mt-1">
            El análisis no guarda nada: primero verá un resumen con los problemas del libro y recién después decidirá si importa.
          </p>
        </div>

        <Banner tone="amber">
          <p className="font-medium">Importe el libro cuando esté completo.</p>
          <p>
            Las filas ya importadas no se actualizan. Si después cambia en el Excel una fecha, un vale, un destino o una cantidad
            de una fila ya importada, el sistema la tomaría como un movimiento nuevo. Para corregir algo ya importado,
            registre un ajuste en el sistema.
          </p>
        </Banner>

        <label
          htmlFor="import-file"
          {...dropProps}
          className={`flex flex-col items-center justify-center gap-2 text-center px-4 py-10 rounded-2xl border-2 border-dashed cursor-pointer transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-emerald-600 ${
            dragging
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
              : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50'
          }`}
        >
          <FileUp size={30} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-800">
            {dragging ? 'Suelte el libro para analizarlo' : 'Arrastre el libro de inventario (.xlsx) o haga clic para elegirlo'}
          </span>
          <span className="text-xs text-gray-500">Solo .xlsx, máximo 10 MB. No se admiten .xls ni .xlsm.</span>
          <input
            ref={inputRef}
            id="import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={uploading}
            aria-describedby={error ? 'import-file-error' : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>

        {/* Región viva siempre montada: anuncia el archivo elegido y el análisis en curso. */}
        <p role="status" aria-live="polite" className="sr-only">
          {uploading
            ? 'Analizando el archivo…'
            : (file ? `Archivo elegido: ${file.name}, ${formatBytes(file.size)}.` : '')}
        </p>

        {error && <div id="import-file-error"><Banner tone="red" live="assertive">{error}</Banner></div>}

        {file && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex items-center gap-2.5 min-w-0">
              <FileSpreadsheet size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-800 truncate">{file.name}</span>
              <span className="text-xs text-gray-500 shrink-0">{formatBytes(file.size)}</span>
            </span>
            <button
              type="button"
              onClick={() => { setFile(null); setError(''); }}
              disabled={uploading}
              className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <X size={14} aria-hidden="true" /> Quitar archivo
            </button>
          </div>
        )}

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={updateExisting}
            onChange={(e) => setUpdateExisting(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            <span className="block text-sm text-gray-800">Actualizar los datos de los ítems que ya existen</span>
            <span className="block text-xs text-gray-500">Por defecto solo se crean los ítems nuevos y no se toca el catálogo actual.</span>
          </span>
        </label>

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={analyze} aria-disabled={uploading || !file} className={btnPrimary}>
            {uploading
              ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Analizando el archivo…</>
              : 'Analizar archivo'}
          </button>
          <button
            type="button"
            onClick={() => download.run(downloadImportTemplate, 'PLANTILLA_INVENTARIO_ALMACEN.xlsx', 'No se pudo descargar la plantilla. Intente nuevamente.')}
            aria-disabled={download.busy}
            className={btnSecondary}
          >
            Descargar plantilla
          </button>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display mb-3">Importaciones recientes</h2>
        {history.status === 'loading' && <p role="status" className="text-sm text-gray-500">Cargando historial…</p>}
        {history.status === 'error' && <p className="text-sm text-gray-500">No se pudo cargar el historial.</p>}
        {history.status === 'ready' && history.rows.length === 0 && (
          <p className="text-sm text-gray-500">Todavía no se importó ningún libro.</p>
        )}
        {history.status === 'ready' && history.rows.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {history.rows.map((row) => (
              <li key={row.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-gray-700">
                  {formatISODate(String(row.created_at ?? '').slice(0, 10))} · {row.uploaded_by_name || 'Usuario'}
                </span>
                <Chip tone={STATUS_TONE[row.status] ?? 'gray'}>{IMPORT_STATUS_LABELS[row.status] ?? row.status}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
