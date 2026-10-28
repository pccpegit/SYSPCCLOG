import { useRef } from 'react';
import { FolderUp, UploadCloud } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import useFileDrop from '../../../hooks/useFileDrop';
import { btnSecondary } from './cvStyles';

/**
 * Big drop area. It is a `role="group"` with two REAL buttons (files / folder),
 * not a clickable div. Dragging changes the text and the border style, not only
 * the color. Folders are walked recursively on drop.
 */
export default function CVDropzone({
  onFiles,
  disabled = false,
  disabledReason = '',
  maxMb = 10,
  extensions = ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
  groupRef,
}) {
  const filesInput = useRef(null);
  const folderInput = useRef(null);
  const { dragging, dropProps } = useFileDrop({ onFiles, disabled });

  const handlePicked = (e) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (picked.length) onFiles(picked);
  };

  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      role="group"
      aria-labelledby="cv-dropzone-title"
      aria-describedby={disabled && disabledReason ? 'cv-dropzone-reason' : undefined}
      aria-disabled={disabled || undefined}
      {...dropProps}
      className={`flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 p-6 text-center focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        dragging ? 'border-solid border-violet-600 bg-violet-50 dark:bg-violet-500/10' : 'border-dashed border-[#8a8f98] bg-white'
      } ${disabled ? 'opacity-70' : ''}`}
    >
      <UploadCloud size={40} className="text-violet-700 dark:text-violet-300" aria-hidden="true" />
      <h3 id="cv-dropzone-title" className="text-lg font-extrabold text-gray-900 font-display">
        {dragging ? COPY.step2.dropActive : COPY.step2.dropTitle}
      </h3>
      <p className="text-sm text-gray-600">{COPY.step2.dropHint(maxMb)}</p>
      {disabled && disabledReason && (
        <p id="cv-dropzone-reason" className="text-sm font-medium text-amber-800 dark:text-amber-200">{disabledReason}</p>
      )}

      <input
        ref={filesInput}
        type="file"
        multiple
        accept={extensions.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="cv-files-input"
        onChange={handlePicked}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        webkitdirectory=""
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="cv-folder-input"
        onChange={handlePicked}
      />
      <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
        <button type="button" disabled={disabled} onClick={() => filesInput.current?.click()} className={btnSecondary}>
          <UploadCloud size={16} aria-hidden="true" /> {COPY.step2.pickFiles}
        </button>
        <button type="button" disabled={disabled} onClick={() => folderInput.current?.click()} className={btnSecondary}>
          <FolderUp size={16} aria-hidden="true" /> {COPY.step2.pickFolder}
        </button>
      </div>
    </div>
  );
}
