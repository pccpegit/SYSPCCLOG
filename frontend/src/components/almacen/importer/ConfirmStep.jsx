import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { buildProjectMap } from '../../../utils/almacenImport';
import { formatQty } from '../../../utils/almacen';
import { Banner, Card, FocusHeading } from '../ui';
import { btnPrimary, btnSecondary } from '../uiStyles';

/**
 * Paso 3: confirmar. Las casillas dependen de lo que exige el servidor
 * (`requires`): aceptar las advertencias y/o aceptar que se omitan filas con errores.
 */
export default function ConfirmStep({
  imp, projectMap, destinationLinks, confirming, errorMessage, stale, onBack, onConfirm, onRestart,
}) {
  const requires = imp.requires ?? {};
  const summary = imp.summary ?? {};
  const warnings = summary.counts?.warning ?? 0;
  const skipped = summary.skipped_rows ?? 0;
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const [acceptSkipped, setAcceptSkipped] = useState(false);

  const resolvedProjects = buildProjectMap(requires.project_labels, imp.projects, projectMap);
  const linked = Object.keys(destinationLinks).length;
  const missing = [
    !imp.can_confirm && 'El libro tiene problemas bloqueantes.',
    resolvedProjects === null && 'Falta elegir el proyecto del libro (paso 2).',
    requires.accept_warnings && !acceptWarnings && 'Acepte que se importarán filas con advertencias.',
    requires.accept_skipped_rows && !acceptSkipped && 'Acepte que se omitirán filas con errores.',
  ].filter(Boolean);
  const canImport = missing.length === 0 && !stale;

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-7 space-y-5">
        <div>
          <FocusHeading className="text-base font-bold text-gray-900 font-display">Paso 3 · Confirmar</FocusHeading>
          <p className="text-sm text-gray-600 mt-1">
            Se importarán {formatQty(summary.entries?.to_import ?? 0)} ingresos y {formatQty(summary.exits?.to_import ?? 0)} egresos
            {' '}({formatQty(summary.catalog?.new ?? 0)} ítems nuevos). La carga es atómica: si algo falla, no se guarda nada.
            {linked > 0 && <> {linked} {linked === 1 ? 'destino se vinculará' : 'destinos se vincularán'} a Personal.</>}
          </p>
        </div>

        {requires.accept_warnings && (
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={acceptWarnings} onChange={(e) => setAcceptWarnings(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-gray-800">
              Entiendo que se importarán filas con advertencias ({formatQty(warnings)} {warnings === 1 ? 'advertencia' : 'advertencias'}) y quedarán marcadas.
            </span>
          </label>
        )}
        {requires.accept_skipped_rows && (
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={acceptSkipped} onChange={(e) => setAcceptSkipped(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-gray-800">
              Entiendo que se omitirán {formatQty(skipped)} {skipped === 1 ? 'fila con errores' : 'filas con errores'}.
            </span>
          </label>
        )}

        {errorMessage && <Banner tone="red" live="assertive">{errorMessage}</Banner>}
        {stale && (
          <button type="button" onClick={onRestart} className={btnPrimary}>Volver a subir el archivo</button>
        )}
        {!canImport && !stale && missing.length > 0 && (
          <ul className="text-xs text-gray-600 list-disc pl-5 space-y-0.5" aria-label="Pendientes para importar">
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
      </Card>

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button type="button" onClick={onBack} disabled={confirming} className={btnSecondary}>Volver a la revisión</button>
        <button
          type="button"
          onClick={() => canImport && onConfirm({ acceptWarnings, acceptSkipped, projectMap: resolvedProjects })}
          aria-disabled={!canImport || confirming}
          className={`${btnPrimary} sm:ml-auto`}
        >
          {confirming ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Importando…</> : 'Importar'}
        </button>
      </div>
    </div>
  );
}
