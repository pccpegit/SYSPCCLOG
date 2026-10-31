import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { setItemAttentionOverride } from '../../api/requestMaster';
import { describeOverrideError, rowToggleId } from '../../utils/requestMaster';
import { MAX_OVERRIDE_NOTE, OVERRIDE_LABELS } from '../../data/requestMaster';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const COPY = {
  STAND_BY: {
    title: 'Poner en stand by',
    intro: 'El ítem queda detenido en el seguimiento: no se cuenta como pendiente mientras dure el stand by.',
    confirm: 'Poner en stand by',
  },
  DESESTIMADO: {
    title: 'Desestimar ítem',
    intro: 'El ítem deja de contarse en el avance del RQ. Podrá quitar esta marca más adelante.',
    confirm: 'Desestimar',
  },
  '': {
    title: 'Quitar seguimiento manual',
    intro: 'El ítem vuelve a calcularse según lo que registra el almacén.',
    confirm: 'Quitar',
  },
};

function Body({ row, kind, onClose, onSaved }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const noteId = `${uid}-note`;
  const errId = `${uid}-error`;
  const dialogRef = useRef(null);
  const noteRef = useRef(null);
  const cancelRef = useRef(null);
  const inFlight = useRef(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [serverError, setServerError] = useState('');

  const needsNote = kind !== '';
  const copy = COPY[kind] ?? COPY[''];

  // Foco al abrir (motivo, o «Cancelar» al quitar) y devolución al cerrar.
  useEffect(() => {
    const opener = document.activeElement;
    (needsNote ? noteRef : cancelRef).current?.focus();
    return () => {
      const target = opener && opener.isConnected ? opener : document.getElementById(rowToggleId(row.id));
      target?.focus?.();
    };
  }, [needsNote, row.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !inFlight.current) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function trapTab(e) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function submit(e) {
    e.preventDefault();
    if (inFlight.current) return;
    const trimmed = note.trim();
    if (needsNote && !trimmed) {
      setFieldError('Indique el motivo para fijar el seguimiento manual.');
      noteRef.current?.focus();
      return;
    }
    setFieldError('');
    setServerError('');
    inFlight.current = true;
    setBusy(true);
    try {
      const { data } = await setItemAttentionOverride(row.request_id, row.id, {
        override: kind,
        note: needsNote ? trimmed : '',
      });
      onSaved(data);
    } catch (err) {
      setServerError(describeOverrideError(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const describedBy = [fieldError ? errId : null, `${noteId}-count`].filter(Boolean).join(' ');

  return createPortal(
    <div
      ref={dialogRef}
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !busy && onClose()} aria-hidden="true" />
      <form
        onSubmit={submit}
        noValidate
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6"
      >
        <button
          type="button"
          onClick={() => !busy && onClose()}
          className="absolute top-4 right-4 size-11 -m-2 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          aria-label="Cerrar"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <h2 id={titleId} className="text-lg font-extrabold text-gray-900 mb-1 leading-tight font-display pr-8">
          {copy.title}
        </h2>
        <p className="text-xs font-mono text-gray-500 mb-3">
          {row.rq_number} · línea {row.line_number}
        </p>
        <p className="text-sm text-gray-500 leading-relaxed mb-2">{row.description}</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-4">{copy.intro}</p>

        {needsNote && (
          <div className="mb-4">
            <label htmlFor={noteId} className="block text-sm font-semibold text-gray-700 mb-1">
              Motivo ({OVERRIDE_LABELS[kind]?.toLowerCase()}) <span aria-hidden="true" className="text-red-600">*</span>
            </label>
            <textarea
              id={noteId}
              ref={noteRef}
              value={note}
              onChange={(e) => { setNote(e.target.value); if (fieldError) setFieldError(''); }}
              maxLength={MAX_OVERRIDE_NOTE}
              rows={3}
              required
              aria-required="true"
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={describedBy}
              className={`w-full px-3 py-2.5 border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${fieldError ? 'border-red-300 dark:border-red-500/40' : 'border-gray-200'}`}
            />
            <div className="flex justify-between gap-2 mt-1">
              <p id={errId} className="text-xs text-red-600 dark:text-red-400">{fieldError}</p>
              <p id={`${noteId}-count`} className="text-xs text-gray-500 tabular-nums shrink-0">
                {note.length}/{MAX_OVERRIDE_NOTE}
              </p>
            </div>
          </div>
        )}

        <div aria-live="polite" className="mb-4">
          {serverError && (
            <p role="alert" className="text-sm rounded-xl px-3 py-2 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {serverError}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => !busy && onClose()}
            className="flex-1 min-h-11 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 font-display"
          >
            Cancelar
          </button>
          <button
            type="submit"
            aria-disabled={busy}
            className="flex-1 min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm font-display aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? 'Guardando…' : copy.confirm}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Diálogo de Stand by / Desestimar / Quitar (SYSPCC-030). `target` = `{ row, kind }` o null.
 * `onSaved(data)` recibe `{ detail, changed, item }` del servidor; el diálogo no se cierra solo
 * ante un error (409/403/400): muestra el motivo y deja reintentar o cancelar.
 */
export default function OverrideDialog({ target, onClose, onSaved }) {
  if (!target) return null;
  return (
    <Body
      key={`${target.row.id}:${target.kind}`}
      row={target.row}
      kind={target.kind}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
