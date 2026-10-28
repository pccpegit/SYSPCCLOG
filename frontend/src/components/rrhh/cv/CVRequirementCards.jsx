import { useEffect, useRef } from 'react';
import { Plus, RotateCcw, ShieldCheck, Trash2, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { MAX_REQUIREMENT_CHARS, countFilled } from '../../../utils/cvRequirements';
import { btnSecondary, btnLink, inputCls } from './cvStyles';

const C = COPY.wizard;

/**
 * Editable requirement cards (short, one per line of the future text).
 * Controlled by the parent: onAdd / onEdit(key, patch) / onRemove(key) /
 * onUndo / onCommit (blur => save now). Removing is reversible: a persistent
 * "Deshacer" row (no timer) replaces confirmation dialogs. The row's
 * role="status" container is always mounted (an empty live region that later
 * receives text is announced reliably; one that appears with its text is not)
 * and "Deshacer" returns the focus to the restored card.
 */
export default function CVRequirementCards({
  value,
  onAdd,
  onEdit,
  onRemove,
  onCommit,
  onUndo,
  onRetrySave,
  max = 15,
  readOnly = false,
  saveState = 'idle',
  lastRemoved = null,
  initialFocus = false,
}) {
  const listRef = useRef(null);
  const addRef = useRef(null);
  const pendingFocus = useRef(initialFocus ? 'last' : null);

  // Focus management after add/remove, once the list has re-rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'add') addRef.current?.focus();
    else if (target === 'last') {
      const areas = listRef.current?.querySelectorAll('textarea');
      areas?.[areas.length - 1]?.focus();
    } else {
      listRef.current?.querySelector(`[data-card-key="${target}"] textarea`)?.focus();
    }
  }, [value]);

  const filled = countFilled(value);
  const atMax = value.length >= max;

  if (readOnly) {
    return (
      <ul aria-label={C.requirementsList} className="space-y-2">
        {value.map((card) => (
          <li key={card.key} className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-base text-gray-800">
            {card.mandatory && <ShieldCheck size={18} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />}
            <span>
              {card.text}
              {card.mandatory && <span className="ml-2 text-xs font-semibold text-violet-700 dark:text-violet-300">({C.mandatory})</span>}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const handleRemove = (index) => {
    const card = value[index];
    const next = value[index + 1] ?? null;
    pendingFocus.current = next ? next.key : 'add';
    onRemove(card.key);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-gray-700">{C.weightHelp}</p>
        <p className="text-sm font-semibold text-gray-900" data-testid="req-counter">
          {C.counter(filled, max)}
        </p>
      </div>

      <ul ref={listRef} aria-label={C.requirementsList} className="space-y-3">
        {value.map((card, index) => {
          const labelId = `req-label-${card.key}`;
          return (
            <li key={card.key} data-card-key={card.key} className="rounded-xl border border-gray-200 bg-white p-3">
              <label id={labelId} htmlFor={`req-${card.key}`} className="sr-only">
                {C.requirementLabel(index + 1)}
              </label>
              <textarea
                id={`req-${card.key}`}
                rows={2}
                value={card.text}
                maxLength={MAX_REQUIREMENT_CHARS}
                onChange={(e) => onEdit(card.key, { text: e.target.value })}
                onBlur={onCommit}
                className={`${inputCls} resize-y`}
              />
              {card.text.length > 200 && (
                <p className="mt-1 text-right text-xs text-gray-600">{C.charCounter(card.text.length, MAX_REQUIREMENT_CHARS)}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={card.mandatory}
                    aria-describedby={labelId}
                    onChange={(e) => {
                      onEdit(card.key, { mandatory: e.target.checked });
                      onCommit?.();
                    }}
                    className="h-5 w-5 rounded border-[#8a8f98] accent-violet-600"
                  />
                  {card.mandatory && <ShieldCheck size={16} className="text-violet-700 dark:text-violet-300" aria-hidden="true" />}
                  {C.mandatory}
                </label>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  aria-label={C.removeRequirement(index + 1)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  <Trash2 size={16} aria-hidden="true" /> <span className="hidden sm:inline">{COPY.remove}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        className={
          lastRemoved
            ? 'mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-800'
            : ''
        }
      >
        <p role="status">{lastRemoved ? C.removed : ''}</p>
        {lastRemoved && (
          <button
            type="button"
            onClick={() => {
              pendingFocus.current = lastRemoved.card.key;
              onUndo();
            }}
            className={btnLink}
          >
            <RotateCcw size={14} aria-hidden="true" /> {C.undo}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          ref={addRef}
          type="button"
          aria-disabled={atMax}
          onClick={() => {
            if (atMax) return;
            pendingFocus.current = 'last';
            onAdd();
          }}
          className={btnSecondary}
        >
          <Plus size={16} aria-hidden="true" /> {C.addRequirement}
        </button>
        {atMax && <span className="text-sm font-medium text-amber-800 dark:text-amber-200">{C.maxReached}</span>}
        <SaveIndicator state={saveState} onRetry={onRetrySave} />
      </div>
    </div>
  );
}

function SaveIndicator({ state, onRetry }) {
  return (
    <p aria-live="polite" className="ml-auto flex items-center gap-2 text-sm text-gray-700">
      {state === 'saving' && (
        <>
          <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> {C.saving}
        </>
      )}
      {state === 'saved' && (
        <>
          <Check size={14} className="text-emerald-700 dark:text-emerald-300" aria-hidden="true" /> {C.saved}
        </>
      )}
      {state === 'error' && (
        <>
          <AlertTriangle size={14} className="text-red-700 dark:text-red-300" aria-hidden="true" /> {C.saveError}
          {onRetry && (
            <button type="button" onClick={onRetry} className={btnLink}>
              {COPY.retry}
            </button>
          )}
        </>
      )}
    </p>
  );
}
