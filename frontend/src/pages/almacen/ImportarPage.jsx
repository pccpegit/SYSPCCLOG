import { useRef, useState } from 'react';
import { Check, FileUp, Loader2 } from 'lucide-react';
import { cancelImport, confirmImport } from '../../api/almacenImport';
import { useToast } from '../../context/useToast';
import HRDialog from '../../components/rrhh/HRDialog';
import ConfirmStep from '../../components/almacen/importer/ConfirmStep';
import ImportResult from '../../components/almacen/importer/ImportResult';
import ReviewStep from '../../components/almacen/importer/ReviewStep';
import UploadStep from '../../components/almacen/importer/UploadStep';
import { PageHeader } from '../../components/almacen/ui';
import { btnDanger, btnSecondary } from '../../components/almacen/uiStyles';
import { importErrorMessage, isStaleImportError } from '../../utils/almacenImport';

const STEPS = ['Subir archivo', 'Revisar', 'Confirmar'];

function Stepper({ current }) {
  return (
    <ol aria-label="Pasos de la importación" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const state = number < current ? 'done' : number === current ? 'current' : 'todo';
        // Hecho = círculo lleno con ✓; actual = número con anillo; pendiente = gris. No depende solo del color.
        const circleCls = {
          done: 'bg-emerald-700 text-white',
          current: 'bg-emerald-700 text-white ring-4 ring-emerald-200 dark:ring-emerald-500/40',
          todo: 'bg-gray-100 text-gray-500',
        }[state];
        return (
          <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-2">
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${circleCls}`}
              aria-hidden="true"
            >
              {state === 'done' ? <Check size={14} strokeWidth={3} /> : number}
            </span>
            <span className={`text-sm ${state === 'current' ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
              {label}
              {state === 'done' && <span className="sr-only"> (completado)</span>}
              {state === 'current' && <span className="sr-only"> (paso actual)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Importar el libro de inventario en tres pasos: subir y analizar (no guarda),
 * revisar problemas y confirmar (atómico e idempotente). Solo Almacén Central y
 * Jefe Logístico; el servidor lo valida igual.
 */
export default function ImportarPage() {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [imp, setImp] = useState(null);
  const [projectMap, setProjectMap] = useState({});
  const [links, setLinks] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Tras volver al paso 1 (no en la carga inicial) el título del paso recibe el foco.
  const [returned, setReturned] = useState(false);
  const inFlight = useRef(false);

  const resetAll = () => {
    setReturned(true);
    setImp(null);
    setProjectMap({});
    setLinks({});
    setConfirmError('');
    setStale(false);
    setDone(null);
    setStep(1);
  };

  const onPreviewed = (detail) => {
    setImp(detail);
    setProjectMap({});
    setLinks({});
    setConfirmError('');
    setStale(false);
    setStep(2);
  };

  const restart = async () => {
    // Descarta la previsualización pendiente (best effort) y vuelve a empezar.
    if (imp && !stale) {
      try { await cancelImport(imp.id); } catch { /* vence sola */ }
    }
    resetAll();
  };

  const confirmCancel = async () => {
    if (inFlight.current || !imp) return;
    inFlight.current = true;
    setCancelling(true);
    try {
      await cancelImport(imp.id);
      showToast({ type: 'info', message: 'Importación cancelada. No se guardó ningún dato.' });
      setCancelOpen(false);
      resetAll();
    } catch (err) {
      showToast({ type: 'error', message: importErrorMessage(err, 'No se pudo cancelar la importación. Intente nuevamente.') });
    } finally {
      inFlight.current = false;
      setCancelling(false);
    }
  };

  const onConfirm = async ({ acceptWarnings, acceptSkipped, projectMap: resolvedProjects }) => {
    if (inFlight.current || !imp) return;
    inFlight.current = true;
    setConfirming(true);
    setConfirmError('');
    try {
      const res = await confirmImport(imp.id, {
        expectedPlanDigest: imp.plan_digest,
        projectMap: resolvedProjects ?? {},
        destinationMap: Object.fromEntries(Object.entries(links).map(([key, link]) => [key, link.id])),
        acceptWarnings,
        acceptSkippedRows: acceptSkipped,
      });
      const replay = res.headers?.['idempotent-replay'] === 'true';
      showToast({ type: 'success', message: replay ? 'La importación ya estaba confirmada.' : 'Importación completada.' });
      // Se descartan los destinos (nombres) de la memoria: ya no hacen falta.
      setDone({ result: res.data?.result ?? {}, replay });
      setImp(null);
      setLinks({});
    } catch (err) {
      setConfirmError(importErrorMessage(err, 'No se pudo completar la importación. Intente nuevamente.'));
      if (isStaleImportError(err)) setStale(true);
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Importar Excel"
        subtitle="Cargue el libro «INVENTARIO PCC - ALM»: catálogo, ingresos y egresos, con revisión previa."
        icon={FileUp}
      />

      {!done && <Stepper current={step} />}

      {done && <ImportResult result={done.result} replay={done.replay} onAnother={resetAll} />}

      {!done && step === 1 && <UploadStep onPreviewed={onPreviewed} focusHeading={returned} />}

      {!done && step === 2 && imp && (
        <ReviewStep
          imp={imp}
          projectMap={projectMap}
          onProjectChange={(label, value) => setProjectMap((prev) => ({ ...prev, [label]: value }))}
          destinationLinks={links}
          onLink={(key, link) => setLinks((prev) => ({ ...prev, [key]: link }))}
          onUnlink={(key) => setLinks((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          })}
          onContinue={() => setStep(3)}
          onCancel={() => setCancelOpen(true)}
          onRestart={restart}
        />
      )}

      {!done && step === 3 && imp && (
        <ConfirmStep
          imp={imp}
          projectMap={projectMap}
          destinationLinks={links}
          confirming={confirming}
          errorMessage={confirmError}
          stale={stale}
          onBack={() => setStep(2)}
          onConfirm={onConfirm}
          onRestart={resetAll}
        />
      )}

      <HRDialog
        open={cancelOpen}
        busy={cancelling}
        onClose={() => setCancelOpen(false)}
        title="¿Cancelar la importación?"
        description="Se descartará el análisis del libro. No se guardó ningún dato en el inventario."
        footer={(
          <>
            <button type="button" onClick={() => setCancelOpen(false)} disabled={cancelling} className={btnSecondary}>Seguir revisando</button>
            <button type="button" onClick={confirmCancel} aria-disabled={cancelling} className={btnDanger}>
              {cancelling ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Cancelando…</> : 'Cancelar importación'}
            </button>
          </>
        )}
      />
    </div>
  );
}
