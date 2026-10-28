import { useEffect, useRef } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { COPY } from '../../utils/cvCopy';
import { isSkipped, resumeStep } from '../../utils/cvResume';
import useCVAnalysis from '../../hooks/useCVAnalysis';
import useCVConfig from '../../hooks/useCVConfig';
import usePageFocus from '../../hooks/usePageFocus';
import CVModeBanner from '../../components/rrhh/cv/CVModeBanner';
import CVStepper from '../../components/rrhh/cv/CVStepper';
import CVStepPosting from '../../components/rrhh/cv/CVStepPosting';
import CVStepUpload from '../../components/rrhh/cv/CVStepUpload';
import { NOTE, btnLink, btnSecondary, h1Cls, noteBase } from '../../components/rrhh/cv/cvStyles';

const W = COPY.wizard;

/**
 * Wizard for steps 1 (convocatoria) and 2 (CVs). `/rrhh/cvs/nuevo` has no
 * analysis yet; `/rrhh/cvs/:id/preparar?paso=1|2` resumes from server state.
 * Without `?paso`: CVs uploaded -> results; requirements saved (or "sin
 * convocatoria") -> step 2; otherwise step 1.
 */
export default function HRCVWizardPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { config, isLoading: configLoading, isError: configError, reload: reloadConfig } = useCVConfig();
  const { analysis, status, error, reload, setAnalysis } = useCVAnalysis(id);
  const h1Ref = useRef(null);
  const step2Ref = useRef(null);

  const pasoParam = params.get('paso');
  const explicit = pasoParam === '1' || pasoParam === '2' ? Number(pasoParam) : null;
  const ready = isNew || status === 'ready';
  let step = 1;
  if (analysis) {
    const auto = resumeStep(analysis);
    step = explicit ?? (auto === 'results' ? 'results' : auto);
  }

  // With a proposal on arrival, the step heading (not the h1) takes the focus.
  usePageFocus(h1Ref, isNew ? W.titleNew : analysis?.name, { ready, focus: !location.state?.proposal });

  // Moving from step 1 to step 2 (not the first render): the step heading gets the focus.
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current !== step && step === 2) step2Ref.current?.focus();
    prevStep.current = step;
  }, [step]);

  const mergeAnalysis = (patch) => setAnalysis({ ...(analysis ?? {}), ...patch });

  if (!isNew && status === 'loading') {
    return (
      <div role="status" className="flex h-48 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-violet-600 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm text-gray-600">{W.loading}</p>
      </div>
    );
  }
  if (!isNew && status === 'notfound') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 text-center">
        <h1 ref={h1Ref} tabIndex={-1} className={h1Cls}>{W.notFound}</h1>
        <Link to="/rrhh/cvs" className={btnSecondary}>{W.backToList}</Link>
      </div>
    );
  }
  if (!isNew && status === 'error') {
    return (
      <div role="alert" className={`${noteBase} ${NOTE.red} mx-auto max-w-3xl flex-wrap items-center justify-between`}>
        <span className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> {error}</span>
        <button type="button" onClick={reload} className={btnSecondary}>
          <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
        </button>
      </div>
    );
  }
  if (analysis && step === 'results') {
    return <Navigate to={`/rrhh/cvs/${analysis.id}`} replace />;
  }

  const total = analysis?.counts?.total ?? 0;
  const hasReqs = (analysis?.requirements?.length ?? 0) > 0;
  const completed = {
    1: step === 2 || hasReqs || (analysis ? isSkipped(analysis.id) : false),
    2: total > 0,
    3: false,
  };

  const goToStep2 = () => {
    reload();
    navigate(`/rrhh/cvs/${analysis.id}/preparar?paso=2`);
  };
  const onFinished = ({ analysis: created, next, proposal }) => {
    navigate(`/rrhh/cvs/${created.id}/preparar?paso=${next === 'upload' ? 2 : 1}`, {
      replace: true,
      state: proposal ? { proposal } : null,
    });
  };

  const stepsReady = config || configError;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 ref={h1Ref} tabIndex={-1} className={h1Cls}>{isNew ? W.titleNew : analysis.name}</h1>

      <CVStepper current={step} analysisId={analysis?.id} completed={completed} />

      <details className="rounded-xl border border-gray-200 bg-white px-4">
        <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-gray-800">{W.howTitle}</summary>
        <ol className="space-y-1 pb-3 text-sm text-gray-700">
          {W.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </details>

      <CVModeBanner config={config} isError={configError} onRetry={reloadConfig} />

      {!stepsReady && configLoading && (
        <p role="status" className="text-sm text-gray-600">{W.loading}</p>
      )}

      {stepsReady && step === 1 && (
        <CVStepPosting
          // A new proposal (arrived via navigation state) restarts the step with fresh data.
          key={`${analysis?.id ?? 'new'}-${location.key}`}
          analysis={analysis}
          config={config}
          initialProposal={location.state?.proposal ?? null}
          onFinished={onFinished}
          onAnalysisChanged={mergeAnalysis}
          onContinue={goToStep2}
        />
      )}
      {stepsReady && step === 2 && analysis && (
        <CVStepUpload analysis={analysis} config={config} reloadConfig={reloadConfig} headingRef={step2Ref} />
      )}

      {analysis?.counts?.total > 0 && step === 1 && (
        <p className="text-sm">
          <Link to={`/rrhh/cvs/${analysis.id}`} className={btnLink}>{COPY.step2.seeResults}</Link>
        </p>
      )}
    </div>
  );
}
