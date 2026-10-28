import { useEffect, useId, useState } from 'react';
import { Sparkles, Loader2, Info } from 'lucide-react';
import { getAssistantStatus, extractWithAssistant } from '../../api/hr';
import { hrErrorMessage } from '../../utils/hrErrors';

const MAX_CHARS = 2000;

/**
 * Panel "Asistente": interprets a free-text description and prefills the
 * form. The assistant ONLY extracts data; it never writes the contract.
 *
 * - Queries `assistant/status/`; if `enabled:false` (or the call fails) the
 *   panel is hidden and only a discreet "form mode" note is shown.
 * - `getKnownData()` returns what the user already typed (the backend does
 *   not overwrite it); `onResult(result)` receives the full extract response.
 */
export default function AssistantPanel({ documentType, personalId, getKnownData, onResult }) {
  const textId = useId();
  const [enabled, setEnabled] = useState(null); // null = consultando
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then(({ data }) => { if (!cancelled) setEnabled(Boolean(data?.enabled)); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  if (enabled === null) return null;

  if (!enabled) {
    return (
      <p
        role="note"
        className="flex items-center gap-2 text-xs text-gray-400"
      >
        <Info size={14} aria-hidden="true" />
        Modo formulario: el asistente no está activado en este entorno.
      </p>
    );
  }

  async function handleInterpret() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = { document_type: documentType, text: trimmed };
      if (personalId) payload.personal_id = personalId;
      const known = getKnownData?.() ?? {};
      if (Object.keys(known).length) payload.known_data = known;
      const { data } = await extractWithAssistant(payload);
      setResult(data);
      onResult?.(data);
    } catch (err) {
      setResult(null);
      setError(hrErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const filled = result ? Object.keys(result.data ?? {}).length : 0;

  return (
    <section
      aria-labelledby={`${textId}-title`}
      className="rounded-2xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/10 p-5"
    >
      <h3 id={`${textId}-title`} className="flex items-center gap-2 text-sm font-semibold text-gray-800 font-display">
        <Sparkles size={16} className="text-violet-600 dark:text-violet-300" aria-hidden="true" />
        Asistente
      </h3>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Describe el contrato y se prellenará el formulario. El asistente solo extrae datos: el texto del contrato sale siempre de la plantilla aprobada. Revisa lo que complete antes de generar el borrador.
      </p>
      <label htmlFor={textId} className="block text-xs font-semibold text-gray-600 mb-1">
        Describe el contrato…
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        rows={3}
        maxLength={MAX_CHARS}
        disabled={busy}
        placeholder="Ej.: Contrato a plazo fijo por 6 meses para Ana Pérez, asistente administrativa, S/ 2,000, ingresa el 1 de noviembre."
        className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3 mt-2">
        <span className="text-[11px] text-gray-400">{text.length}/{MAX_CHARS}</span>
        <button
          type="button"
          onClick={handleInterpret}
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {busy ? 'Interpretando…' : 'Interpretar descripción'}
        </button>
      </div>

      <div aria-live="polite" className="mt-3 space-y-2">
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        {result && (
          <div className="text-sm text-gray-700 space-y-2">
            <p className="font-medium">
              {filled === 0
                ? 'No se pudo completar ningún campo. Revisa la descripción o completa el formulario.'
                : filled === 1
                  ? 'Se completó 1 campo del formulario.'
                  : `Se completaron ${filled} campos del formulario.`}
            </p>
            {result.questions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Faltan datos:</p>
                <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                  {result.questions.map((q) => <li key={q}>{q}</li>)}
                </ul>
              </div>
            )}
            {result.warnings?.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-gray-600 space-y-0.5">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
