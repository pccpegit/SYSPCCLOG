import { useEffect, useRef } from 'react';
import { Check, ClipboardPaste, FileText, Ban, UploadCloud, X, AlertCircle } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { formatBytes, formatNumber } from '../../../utils/cvFormat';
import useFileDrop from '../../../hooks/useFileDrop';
import { btnSecondary, btnLink, inputCls, errorTextCls } from './cvStyles';

const C = COPY.wizard;

const MODES = [
  { value: 'file', label: C.modeFile, hint: C.modeFileHint, icon: UploadCloud },
  { value: 'text', label: C.modeText, hint: C.modeTextHint, icon: ClipboardPaste },
  { value: 'none', label: C.modeNone, hint: C.modeNoneHint, icon: Ban },
];

/**
 * "¿Tienes la convocatoria?": radio cards (upload / paste / none) and the
 * matching input. Validation is shown by the parent through `errors`; the
 * parent also receives the refs to focus the first invalid control.
 * Choosing a file swaps "Elegir archivo" for "Cambiar archivo": the focus
 * follows to the new button and a persistent role="status" says which file
 * was chosen. A rejected file shows its error with role="alert".
 */
export default function CVConvocatoriaInput({
  mode,
  onModeChange,
  file,
  onFile,
  storedName = '',
  text,
  onText,
  errors = {},
  disabled = false,
  limits = {},
  fileButtonRef,
  textareaRef,
}) {
  const inputRef = useRef(null);
  const ownButtonRef = useRef(null);
  const buttonRef = fileButtonRef ?? ownButtonRef;
  const prevFile = useRef(file);
  const accept = (limits.extensions ?? ['.pdf', '.docx', '.jpg', '.jpeg', '.png']).join(',');
  const maxMb = limits.max_file_mb ?? 5;
  const maxChars = limits.max_text_chars ?? 12000;
  const { dragging, dropProps } = useFileDrop({
    disabled: disabled || mode !== 'file',
    onFiles: (files) => onFile(files[0]),
  });

  // The button that had the focus is replaced when a file is chosen/removed.
  useEffect(() => {
    if (prevFile.current === file) return;
    prevFile.current = file;
    buttonRef.current?.focus();
  }, [file, buttonRef]);

  return (
    <div className="space-y-4">
      <p role="status" className="sr-only">{file ? C.fileChosen(file.name) : ''}</p>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-base font-semibold text-gray-900">{C.hasPosting}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MODES.map(({ value, label, hint, icon }) => {
            const Icon = icon;
            const selected = mode === value;
            return (
              <label key={value} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name="cv-posting-mode"
                  value={value}
                  checked={selected}
                  onChange={() => onModeChange(value)}
                  className="peer sr-only"
                />
                <span className="flex min-h-[76px] items-start gap-3 rounded-xl border-2 border-[#8a8f98] bg-white p-3 peer-checked:border-violet-600 peer-checked:bg-violet-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500 dark:peer-checked:bg-violet-500/10">
                  <Icon size={22} className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-gray-900">{label}</span>
                    <span className="block text-sm text-gray-600">{hint}</span>
                  </span>
                  {selected && <Check size={18} className="shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === 'file' && (
        <div>
          <div
            {...dropProps}
            className={`rounded-xl border-2 p-4 ${dragging ? 'border-solid border-violet-600 bg-violet-50 dark:bg-violet-500/10' : 'border-dashed border-[#8a8f98]'}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="posting-file-input"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) onFile(picked);
                e.target.value = '';
              }}
            />
            {dragging && <p className="mb-2 text-sm font-semibold text-violet-800 dark:text-violet-200">{COPY.step2.dropActive}</p>}
            {file || storedName ? (
              <div className="flex flex-wrap items-center gap-3">
                <FileText size={20} className="shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-gray-900" title={file?.name ?? storedName}>
                    {file?.name ?? storedName}
                  </p>
                  <p className="text-sm text-gray-600">{file ? formatBytes(file.size) : C.storedFile}</p>
                </div>
                <button type="button" ref={buttonRef} onClick={() => inputRef.current?.click()} className={btnSecondary}>
                  {C.changeFile}
                </button>
                {file && (
                  <button type="button" onClick={() => onFile(null)} className={btnLink}>
                    <X size={14} aria-hidden="true" /> {COPY.remove}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  ref={buttonRef}
                  onClick={() => inputRef.current?.click()}
                  aria-describedby="posting-file-help"
                  className={btnSecondary}
                >
                  <UploadCloud size={16} aria-hidden="true" /> {C.chooseFile}
                </button>
                <p id="posting-file-help" className="text-sm text-gray-600">
                  {`${C.modeFileHint} · hasta ${maxMb} MB`}
                </p>
              </div>
            )}
          </div>
          {errors.file && (
            <p id="posting-file-error" role="alert" className={errorTextCls}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {errors.file}
            </p>
          )}
        </div>
      )}

      {mode === 'text' && (
        <div>
          <label htmlFor="posting-text" className="mb-1.5 block text-base font-semibold text-gray-900">
            {C.textLabel}
          </label>
          <textarea
            id="posting-text"
            ref={textareaRef}
            rows={8}
            value={text}
            onChange={(e) => onText(e.target.value)}
            aria-invalid={errors.text ? 'true' : undefined}
            aria-describedby={`posting-text-counter${errors.text ? ' posting-text-error' : ''}`}
            className={`${inputCls} resize-y`}
          />
          <p id="posting-text-counter" className={`mt-1 text-right text-sm ${text.length > maxChars ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-600'}`}>
            {C.textCounter(formatNumber(text.length), formatNumber(maxChars))}
          </p>
          {errors.text && (
            <p id="posting-text-error" className={errorTextCls}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {errors.text}
            </p>
          )}
        </div>
      )}

      {mode === 'none' && <p className="text-sm text-gray-700">{COPY.wizard.noRequirementsNote}</p>}
    </div>
  );
}
