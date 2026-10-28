import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, Loader2, Lock, Plus, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  createCVAnalysis,
  extractCVPosting,
  getCVAnalysis,
  updateCVAnalysis,
  uploadCVPosting,
} from '../../../api/hr';
import { COPY } from '../../../utils/cvCopy';
import { hrErrorCode, hrErrorMessage } from '../../../utils/hrErrors';
import { extractFieldErrors } from '../../../utils/apiErrors';
import { extensionOf } from '../../../utils/cvFiles';
import { normalizeText } from '../../../utils/cvFormat';
import {
  countFilled,
  newCard,
  toCards,
  toRequirementsText,
  validateRequirements,
} from '../../../utils/cvRequirements';
import { clearSkipped, markSkipped } from '../../../utils/cvResume';
import CVConvocatoriaInput from './CVConvocatoriaInput';
import CVRequirementCards from './CVRequirementCards';
import { NOTE, btnLink, btnPrimary, btnSecondary, card, errorTextCls, h2Cls, inputCls, noteBase } from './cvStyles';

const C = COPY.wizard;
const AUTOSAVE_MS = 1500;
const DEFAULT_EXTS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png'];
const SLOW_READING_MS = 30000;

/** The promise of a duration is never left broken: after ~30 s the hint changes. */
function ReadingHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_READING_MS);
    return () => clearTimeout(timer);
  }, []);
  return <p className="text-sm text-gray-600">{slow ? C.readingSlow : C.readingHint}</p>;
}

/**
 * Step 1 — Convocatoria. Sub-states (one thing at a time):
 * entry -> reading -> review | failed | locked.
 * The AI/heuristic only PROPOSES requirements; the user reviews them and they
 * are saved with PATCH requirements_text (autosave + explicit confirmation).
 */
export default function CVStepPosting({
  analysis,
  config,
  initialProposal = null,
  onFinished,
  onAnalysisChanged,
  onContinue,
}) {
  const limits = config?.posting ?? {};
  const maxReq = limits.max_requirements ?? 15;
  const analysisIdProp = analysis?.id ?? null;

  // ── form state ──
  const [name, setName] = useState(analysis?.name ?? '');
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null);
  const [storedName, setStoredName] = useState(analysis?.posting?.original_name ?? '');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  // ── flow state ──
  const startReview = Boolean(initialProposal) || (analysis?.requirements?.length ?? 0) > 0;
  const [phase, setPhase] = useState(startReview ? 'review' : 'entry');
  const [failure, setFailure] = useState('');
  const [cards, setCards] = useState(() => {
    if (initialProposal) return toCards(initialProposal.requirements ?? []);
    return toCards(analysis?.requirements ?? []);
  });
  const [source, setSource] = useState(initialProposal?.source ?? null);
  const [warnings, setWarnings] = useState(initialProposal?.warnings ?? []);
  // Notices about what the user TYPED (PATCH response): kept apart from the proposal's.
  const [saveWarnings, setSaveWarnings] = useState([]);
  // A 409 while editing: kept in this component only (the server decides on reload).
  const [lockedNow, setLockedNow] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedNote, setRefreshedNote] = useState('');
  const [positionTitle, setPositionTitle] = useState(initialProposal?.position_title ?? '');
  const [emptyNotice, setEmptyNotice] = useState(Boolean(initialProposal) && (initialProposal.requirements ?? []).length === 0);
  const [lastRemoved, setLastRemoved] = useState(null);
  const [focusNew, setFocusNew] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [confirming, setConfirming] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [announce, setAnnounce] = useState(
    initialProposal && (initialProposal.requirements ?? []).length ? COPY.wizard.proposed(initialProposal.requirements.length) : '',
  );

  // ── refs ──
  const createdRef = useRef(null); // analysis created in this step but not yet routed
  const abortRef = useRef(null);
  const cardsRef = useRef(cards);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const saveNowRef = useRef(null);
  const headingRef = useRef(null);
  const nameRef = useRef(null);
  const fileButtonRef = useRef(null);
  const textareaRef = useRef(null);
  const firstRender = useRef(true);
  const aliveRef = useRef(true);

  const analysisId = analysisIdProp ?? createdRef.current?.id ?? null;
  const locked = Boolean(analysis?.requirements_locked) || Boolean(lockedNow);
  const lockedAnalysis = analysis ?? createdRef.current ?? null;
  // Permanent (CVs already analyzed) vs temporary (CVs still being read).
  const lockedPermanent = (lockedAnalysis?.counts?.done ?? 0) > 0;

  // Focus the step heading when the sub-state changes (and on arrival with a proposal).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (initialProposal) headingRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
    // initialProposal only matters on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Leaving with unsaved edits: save them (nothing is lost) and stop timers.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
      if (dirtyRef.current && analysisIdProp) {
        updateCVAnalysis(analysisIdProp, { requirements_text: toRequirementsText(cardsRef.current) }).catch(() => {});
      }
    };
  }, [analysisIdProp]);

  // Asks the server whether the lock is still there (CVs in progress finish by themselves).
  async function refreshLock({ silent = false } = {}) {
    const id = analysisIdProp ?? createdRef.current?.id ?? null;
    if (!id || (!silent && refreshing)) return;
    if (!silent) {
      setRefreshing(true);
      setRefreshedNote('');
    }
    try {
      const { data } = await getCVAnalysis(id);
      if (!aliveRef.current) return;
      // A brand-new analysis is not routed yet: updating the page would remount the step.
      if (analysisIdProp) onAnalysisChanged?.(data);
      else createdRef.current = { ...createdRef.current, ...data };
      if (!silent) {
        setLockedNow(null);
        setRefreshedNote(C.refreshed);
      }
    } catch {
      // keeps the current view; the button stays available to try again
    } finally {
      if (!silent && aliveRef.current) setRefreshing(false);
    }
  }

  // ── autosave ──
  async function saveNow() {
    clearTimeout(timerRef.current);
    const id = analysisIdProp;
    if (!id) return false;
    const list = cardsRef.current;
    if (validateRequirements(list)) {
      setSaveState('error');
      return false;
    }
    setSaveState('saving');
    try {
      const { data } = await updateCVAnalysis(id, { requirements_text: toRequirementsText(list) });
      dirtyRef.current = false;
      if (aliveRef.current) {
        setSaveState('saved');
        setSaveWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
        onAnalysisChanged?.(data);
      }
      return true;
    } catch (err) {
      if (aliveRef.current) {
        if (hrErrorCode(err) === 'requirements_locked') {
          setLockedNow({ detail: hrErrorMessage(err) });
          refreshLock({ silent: true });
        }
        setSaveState('error');
        setReviewError(hrErrorMessage(err, C.saveError));
      }
      return false;
    }
  }
  useEffect(() => {
    saveNowRef.current = saveNow;
  });

  function touch() {
    dirtyRef.current = true;
    setSaveState('idle');
    setReviewError('');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveNowRef.current?.(), AUTOSAVE_MS);
  }

  function updateCards(next) {
    cardsRef.current = next;
    setCards(next);
    touch();
  }

  const cardActions = {
    onEdit: (key, patch) => updateCards(cards.map((c) => (c.key === key ? { ...c, ...patch } : c))),
    onAdd: () => {
      setEmptyNotice(false);
      updateCards([...cards, newCard()]);
    },
    onRemove: (key) => {
      const index = cards.findIndex((c) => c.key === key);
      setLastRemoved({ card: cards[index], index });
      updateCards(cards.filter((c) => c.key !== key));
    },
    onUndo: () => {
      if (!lastRemoved) return;
      const next = [...cards];
      next.splice(Math.min(lastRemoved.index, next.length), 0, lastRemoved.card);
      setLastRemoved(null);
      updateCards(next);
    },
    onCommit: () => {
      if (dirtyRef.current) saveNow();
    },
    onRetrySave: () => saveNow(),
  };

  // ── entry ──
  function pickFile(picked) {
    setErrors((e) => ({ ...e, file: undefined }));
    if (!picked) {
      setFile(null);
      return;
    }
    const allowed = (limits.extensions ?? DEFAULT_EXTS).map((x) => x.toLowerCase());
    const maxBytes = limits.max_file_bytes ?? 5 * 1024 * 1024;
    if (!allowed.includes(extensionOf(picked.name))) {
      setErrors((e) => ({ ...e, file: 'Formato no admitido. Usa PDF, Word o imagen.' }));
      return;
    }
    if (picked.size > maxBytes) {
      setErrors((e) => ({ ...e, file: `La convocatoria pesa más de ${limits.max_file_mb ?? 5} MB.` }));
      return;
    }
    setFile(picked);
  }

  function validate() {
    const errs = {};
    const trimmed = name.trim();
    if (trimmed.length < 3) errs.name = C.nameError;
    else if (trimmed.length > 150) errs.name = C.nameTooLong;
    if (mode === 'file' && !file && !storedName) errs.file = C.fileError;
    const maxChars = limits.max_text_chars ?? 12000;
    if (mode === 'text') {
      if (!text.trim()) errs.text = C.textError;
      else if (text.length > maxChars) errs.text = C.textTooLong(maxChars);
    }
    return errs;
  }

  function focusFirstInvalid(errs) {
    if (errs.name) nameRef.current?.focus();
    else if (errs.file) fileButtonRef.current?.focus();
    else if (errs.text) textareaRef.current?.focus();
  }

  async function ensureAnalysis() {
    let current = createdRef.current ?? analysis;
    const trimmed = name.trim();
    if (!current) {
      const { data } = await createCVAnalysis({ name: trimmed });
      createdRef.current = data;
      return data;
    }
    if (trimmed !== current.name) {
      const { data } = await updateCVAnalysis(current.id, { name: trimmed });
      current = { ...current, ...data };
      if (createdRef.current) createdRef.current = current;
      else onAnalysisChanged?.(current);
    }
    return current;
  }

  function showProposal(current, proposal) {
    if (!analysis) {
      // New analysis: the page navigates to /preparar carrying the proposal.
      onFinished({ analysis: current, next: 'review', proposal });
      return;
    }
    const next = toCards(proposal.requirements ?? []);
    cardsRef.current = next;
    setCards(next);
    setSource(proposal.source ?? null);
    setWarnings(proposal.warnings ?? []);
    setPositionTitle(proposal.position_title ?? '');
    setEmptyNotice((proposal.requirements ?? []).length === 0);
    setLastRemoved(null);
    setSaveState('idle');
    setReviewError('');
    const n = (proposal.requirements ?? []).length;
    setAnnounce(n ? COPY.wizard.proposed(n) : '');
    setPhase('review');
  }

  async function readPosting() {
    const errs = validate();
    setErrors(errs);
    setSubmitError('');
    if (Object.keys(errs).length) {
      focusFirstInvalid(errs);
      return;
    }
    setPhase('reading');
    const controller = new AbortController();
    abortRef.current = controller;
    let current = null;
    try {
      current = await ensureAnalysis();
      if (mode === 'none') {
        markSkipped(current.id);
        if (analysis) onContinue();
        else onFinished({ analysis: current, next: 'upload' });
        return;
      }
      if (mode === 'file' && file) {
        try {
          const { data } = await uploadCVPosting(current.id, file, { signal: controller.signal });
          if (analysis) onAnalysisChanged?.(data);
          else createdRef.current = { ...current, ...data };
          current = { ...current, ...data };
          setStoredName(file.name);
          setFile(null);
        } catch (err) {
          if (controller.signal.aborted) throw err;
          if (hrErrorCode(err) === 'requirements_locked') throw err;
          // Upload problems are about the file: back to the entry, next to the field.
          setErrors({ file: hrErrorMessage(err) });
          setPhase('entry');
          return;
        }
      }
      const { data: proposal } = await extractCVPosting(current.id, {
        text: mode === 'text' ? text.trim() : undefined,
        signal: controller.signal,
      });
      if (!aliveRef.current) return;
      showProposal(current, proposal);
    } catch (err) {
      if (!aliveRef.current) return;
      if (controller.signal.aborted || err?.code === 'ERR_CANCELED') {
        setPhase('entry');
        return;
      }
      if (hrErrorCode(err) === 'requirements_locked') {
        setLockedNow({ detail: hrErrorMessage(err) });
        refreshLock({ silent: true });
        setPhase('entry');
        return;
      }
      if (!current) {
        // Creation failed: stay in the form, field errors next to their field.
        const fields = extractFieldErrors(err);
        if (fields.name) setErrors({ name: String(fields.name) });
        else setSubmitError(hrErrorMessage(err));
        setPhase('entry');
        return;
      }
      setFailure(hrErrorMessage(err, 'No pudimos leer la convocatoria ahora. Inténtalo de nuevo.'));
      setPhase('failed');
    }
  }

  function writeByHand() {
    const current = createdRef.current ?? analysis;
    showProposal(current, {
      requirements: [{ text: '', weight: 1 }],
      source: null,
      warnings: [],
      position_title: null,
    });
  }

  async function confirmRequirements() {
    if (confirming) return;
    setConfirming(true);
    setReviewError('');
    const ok = await saveNow();
    setConfirming(false);
    if (!ok) return;
    if (countFilled(cardsRef.current) === 0) markSkipped(analysisId);
    else clearSkipped(analysisId);
    setLastRemoved(null);
    onContinue();
  }

  async function useSuggestedName() {
    try {
      const { data } = await updateCVAnalysis(analysisId, { name: positionTitle });
      setName(positionTitle);
      setPositionTitle('');
      onAnalysisChanged?.(data);
    } catch (err) {
      setReviewError(hrErrorMessage(err));
    }
  }

  async function saveNameOnBlur() {
    const trimmed = name.trim();
    if (!analysis || trimmed.length < 3 || trimmed === analysis.name) return;
    try {
      const { data } = await updateCVAnalysis(analysis.id, { name: trimmed });
      onAnalysisChanged?.(data);
    } catch {
      // the name is sent again when the user continues
    }
  }

  // ───────────────────────── render ─────────────────────────

  if (locked) {
    const lockedMessage = lockedNow?.detail || (lockedPermanent ? C.locked : C.lockedInFlight);
    const resultsId = lockedAnalysis?.id;
    return (
      <section aria-labelledby="step1-title" className={card}>
        <h2 id="step1-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{C.reviewTitle}</h2>
        <div role="note" className={`${noteBase} ${NOTE.amber} mt-3`}>
          <Lock size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{lockedMessage}</p>
        </div>
        <p role="status" className="mt-2 text-sm text-gray-700">{refreshedNote}</p>
        <div className="mt-4">
          <CVRequirementCards value={toCards(lockedAnalysis?.requirements ?? [])} readOnly />
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          {lockedPermanent ? (
            <>
              {resultsId && <Link to={`/rrhh/cvs/${resultsId}`} className={btnPrimary}>{C.backToResults}</Link>}
              <Link to="/rrhh/cvs/nuevo" className={btnLink}>{C.createNew}</Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => refreshLock()}
                aria-disabled={refreshing || undefined}
                aria-busy={refreshing || undefined}
                className={btnPrimary}
              >
                {refreshing && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
                {!refreshing && <RefreshCw size={18} aria-hidden="true" />} {C.refresh}
              </button>
              {resultsId && <Link to={`/rrhh/cvs/${resultsId}`} className={btnLink}>{C.backToResults}</Link>}
            </>
          )}
        </div>
      </section>
    );
  }

  const filled = countFilled(cards);

  return (
    <section aria-labelledby="step1-title" className={card}>
      <p role="status" className="sr-only">{announce}</p>

      {phase === 'entry' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            readPosting();
          }}
          className="space-y-5"
        >
          <h2 id="step1-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{C.step1Title}</h2>

          <div>
            <label htmlFor="cv-name" className="mb-1.5 block text-base font-semibold text-gray-900">{C.nameLabel}</label>
            <input
              id="cv-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              onBlur={saveNameOnBlur}
              aria-invalid={errors.name ? 'true' : undefined}
              aria-describedby={`cv-name-help${errors.name ? ' cv-name-error' : ''}`}
              autoComplete="off"
              className={inputCls}
            />
            <p id="cv-name-help" className="mt-1 text-sm text-gray-600">{C.nameHelp}</p>
            {errors.name && (
              <p id="cv-name-error" className={errorTextCls}>
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {errors.name}
              </p>
            )}
          </div>

          <CVConvocatoriaInput
            mode={mode}
            onModeChange={(m) => {
              setMode(m);
              setErrors({});
            }}
            file={file}
            onFile={pickFile}
            storedName={storedName}
            text={text}
            onText={(v) => {
              setText(v);
              setErrors((x) => ({ ...x, text: undefined }));
            }}
            errors={errors}
            limits={limits}
            fileButtonRef={fileButtonRef}
            textareaRef={textareaRef}
          />

          {submitError && (
            <div role="alert" className={`${noteBase} ${NOTE.red}`}>
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{submitError}</p>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}>
              {mode === 'none' ? C.skip : C.read} <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}

      {phase === 'reading' && (
        <div role="status" className="flex flex-col items-center gap-4 py-8 text-center">
          <Loader2 size={36} className="text-violet-700 motion-safe:animate-spin dark:text-violet-300" aria-hidden="true" />
          <h2 id="step1-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{C.reading}</h2>
          <ReadingHint />
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
            <div className="h-full w-1/3 rounded-full bg-violet-600 motion-safe:animate-pulse" />
          </div>
          <button type="button" onClick={() => abortRef.current?.abort()} className={btnSecondary}>{COPY.cancel}</button>
        </div>
      )}

      {phase === 'failed' && (
        <div className="space-y-4">
          <h2 id="step1-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{C.step1Title}</h2>
          <div role="alert" className={`${noteBase} ${NOTE.red}`}>
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>{failure}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={readPosting} className={btnPrimary}>{C.tryAgain}</button>
            <button type="button" onClick={writeByHand} className={btnSecondary}>{C.writeByHand}</button>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="space-y-4">
          <h2 id="step1-title" ref={headingRef} tabIndex={-1} className={h2Cls}>{C.reviewTitle}</h2>

          {(source === 'ai' || source === 'fake') && !emptyNotice && (
            <p role="note" className="text-sm text-gray-700">{C.sourceAi}</p>
          )}
          {source === 'text' && !emptyNotice && <p role="note" className="text-sm text-gray-700">{C.sourceText}</p>}
          {warnings
            .filter((w) => w.code !== 'simulated')
            .map((w) => (
              <p key={w.code} role="note" className={`${noteBase} ${NOTE.amber}`}>
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{w.detail}</span>
              </p>
            ))}

          {saveWarnings.map((w) => (
            <p key={`typed-${w.code}`} role="note" className={`${noteBase} ${NOTE.amber}`}>
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{w.detail}</span>
            </p>
          ))}

          {positionTitle && normalizeText(positionTitle) !== normalizeText(name) && (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-gray-700">
              <span>{C.suggestedName}</span>
              <button type="button" onClick={useSuggestedName} className={btnLink}>{C.nameFrom(positionTitle)}</button>
            </p>
          )}

          {emptyNotice && cards.length === 0 ? (
            <div className="space-y-4">
              <p className="text-base font-medium text-gray-900">{C.noneFound}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setFocusNew(true);
                    cardActions.onAdd();
                  }}
                  className={btnPrimary}
                >
                  <Plus size={18} aria-hidden="true" /> {C.addByHand}
                </button>
                <button type="button" onClick={() => setPhase('entry')} className={btnSecondary}>{C.anotherPosting}</button>
              </div>
            </div>
          ) : (
            <>
              <CVRequirementCards
                value={cards}
                max={maxReq}
                saveState={saveState}
                lastRemoved={lastRemoved}
                initialFocus={focusNew}
                {...cardActions}
              />
              {filled === 0 && <p className="text-sm text-gray-700">{C.noRequirementsNote}</p>}
              {reviewError && (
                <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">{reviewError}</p>
              )}
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setPhase('entry')} className={btnSecondary}>{C.anotherPosting}</button>
                <button
                  type="button"
                  onClick={confirmRequirements}
                  aria-disabled={confirming || undefined}
                  aria-busy={confirming || undefined}
                  className={btnPrimary}
                >
                  {confirming && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
                  {filled === 0 ? C.continueWithout : C.useRequirements}
                  {!confirming && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
