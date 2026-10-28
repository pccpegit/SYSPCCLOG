import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  activateTemplate,
  downloadTemplate,
  getDocumentTypes,
  getTemplates,
  saveBlob,
  uploadTemplate,
} from '../../api/hr';
import { useToast } from '../../context/ToastContext';
import { hrErrorMessage } from '../../utils/hrErrors';

const DOCUMENT_TYPE = 'CONTRACT';
const PAGE_SIZE = 20;
const MAX_BYTES = 5 * 1024 * 1024;

const inputCls =
  'w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:bg-white disabled:opacity-60';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function VariableList({ title, items, tone }) {
  if (!items?.length) return null;
  const toneCls = tone === 'danger'
    ? 'text-red-700 dark:text-red-300'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-gray-600';
  return (
    <div>
      <p className={`text-xs font-semibold ${toneCls}`}>{title} ({items.length})</p>
      <p className="text-xs font-mono text-gray-600 break-words mt-0.5">
        {items.map((v) => `{{ ${v} }}`).join('  ')}
      </p>
    </div>
  );
}

function TemplateRow({ tpl, canActivate, busyId, onActivate, onDownload }) {
  const blocked = tpl.unknown_variables?.length > 0;
  const hintId = `hr-tpl-hint-${tpl.id}`;
  return (
    <li className="p-4 sm:p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {tpl.name} <span className="font-normal text-gray-500">· versión {tpl.version}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Serie «{tpl.slug}» · {tpl.original_filename} · subida el {formatDate(tpl.created_at)}
            {tpl.uploaded_by_name ? ` por ${tpl.uploaded_by_name}` : ''}
          </p>
          <p className="mt-1.5">
            {tpl.is_active ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ring-1 bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                <CheckCircle2 size={12} aria-hidden="true" /> Activa
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ring-1 bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-500/30">
                Inactiva
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onDownload(tpl)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            <FileDown size={14} aria-hidden="true" /> Descargar .docx
          </button>
          {!tpl.is_active && canActivate && (
            <button
              type="button"
              onClick={() => onActivate(tpl)}
              disabled={blocked || busyId === tpl.id}
              aria-describedby={blocked ? hintId : undefined}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              {busyId === tpl.id && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              Activar esta versión
            </button>
          )}
        </div>
      </div>

      {blocked && (
        <p id={hintId} className="text-xs text-red-700 dark:text-red-300">
          No se puede activar: la plantilla usa variables que el sistema no reconoce. Corrígelas en Word y sube una nueva versión.
        </p>
      )}

      <div className="space-y-2">
        <VariableList title="Variables desconocidas" items={tpl.unknown_variables} tone="danger" />
        <VariableList title="Variables obligatorias que la plantilla no usa" items={tpl.missing_required_variables} tone="warn" />
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-gray-600 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
            Variables detectadas ({tpl.detected_variables?.length ?? 0})
          </summary>
          <p className="font-mono text-gray-600 break-words mt-1">
            {(tpl.detected_variables ?? []).map((v) => `{{ ${v} }}`).join('  ') || 'Ninguna'}
          </p>
        </details>
        {tpl.notes && <p className="text-xs text-gray-500">Notas: {tpl.notes}</p>}
      </div>
    </li>
  );
}

export default function HRTemplatesPage() {
  const { showToast } = useToast();

  const [state, setState] = useState({ status: 'loading', rows: [], count: 0, error: '' });
  const [page, setPage] = useState(1);
  const [variables, setVariables] = useState([]);
  const [defaultSlug, setDefaultSlug] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [listError, setListError] = useState('');
  const fileRef = useRef(null);
  const nameRef = useRef(null);
  const bannerRef = useRef(null);

  const fetchRows = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const { data } = await getTemplates({ document_type: DOCUMENT_TYPE, page });
      setState({ status: 'ready', rows: data.results ?? [], count: data.count ?? 0, error: '' });
    } catch (err) {
      setState({ status: 'error', rows: [], count: 0, error: hrErrorMessage(err, 'No se pudieron cargar las plantillas.') });
    }
  }, [page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    getDocumentTypes()
      .then(({ data }) => {
        const spec = (data ?? []).find((t) => t.key === DOCUMENT_TYPE);
        setVariables(spec?.variables ?? []);
        setDefaultSlug(spec?.default_slug ?? '');
      })
      .catch(() => {});
  }, []);

  const groupedVariables = useMemo(() => {
    const groups = {};
    variables.forEach((v) => {
      (groups[v.group] ??= []).push(v);
    });
    return Object.entries(groups);
  }, [variables]);

  function validate() {
    const errs = {};
    if (!name.trim()) errs.name = 'Escribe un nombre para la plantilla.';
    if (!file) errs.file = 'Selecciona un archivo .docx.';
    else if (!file.name.toLowerCase().endsWith('.docx')) errs.file = 'El archivo debe ser un documento Word (.docx).';
    else if (file.size > MAX_BYTES) errs.file = 'El archivo supera el tamaño máximo permitido (5 MB).';
    return errs;
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (uploading) return;
    setUploadError('');
    const errs = validate();
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) {
      const target = errs.name ? nameRef.current : fileRef.current;
      target?.focus();
      return;
    }
    setUploading(true);
    try {
      const { data } = await uploadTemplate({
        document_type: DOCUMENT_TYPE,
        name: name.trim(),
        slug: slug.trim() || undefined,
        notes: notes.trim() || undefined,
        file,
      });
      const warn = data.unknown_variables?.length > 0;
      showToast({
        type: warn ? 'info' : 'success',
        message: warn
          ? `Versión ${data.version} subida, pero tiene variables desconocidas: no se podrá activar.`
          : `Versión ${data.version} subida. Revisa las variables y actívala.`,
      });
      setName(''); setSlug(''); setNotes(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      if (page === 1) await fetchRows(); else setPage(1);
    } catch (err) {
      setUploadError(hrErrorMessage(err, 'No se pudo subir la plantilla.'));
      setTimeout(() => bannerRef.current?.focus(), 0);
    } finally {
      setUploading(false);
    }
  }

  async function handleActivate(tpl) {
    if (busyId) return;
    setBusyId(tpl.id);
    setListError('');
    try {
      await activateTemplate(tpl.id);
      showToast({ type: 'success', message: `Versión ${tpl.version} activada.` });
      await fetchRows();
    } catch (err) {
      setListError(hrErrorMessage(err, 'No se pudo activar la plantilla.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(tpl) {
    setListError('');
    try {
      const { blob, filename } = await downloadTemplate(tpl.id);
      saveBlob(blob, filename);
    } catch (err) {
      setListError(hrErrorMessage(err, 'No se pudo descargar la plantilla.'));
    }
  }

  const totalPages = Math.max(1, Math.ceil(state.count / PAGE_SIZE));

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 font-display">Plantillas de documentos</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Plantillas Word aprobadas por la empresa. Cada subida crea una nueva versión; solo una versión por serie está activa.
        </p>
      </div>

      <section aria-labelledby="hr-upload-title" className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <h2 id="hr-upload-title" className="text-sm font-semibold text-gray-700 font-display mb-3">Subir nueva versión</h2>
        <div ref={bannerRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none">
          {uploadError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 mb-3">
              {uploadError}
            </p>
          )}
        </div>
        <form onSubmit={handleUpload} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="hr-tpl-name" className="block text-xs font-semibold text-gray-600 mb-1">
              Nombre <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (obligatorio)</span>
            </label>
            <input
              id="hr-tpl-name" ref={nameRef} type="text" value={name}
              onChange={(e) => setName(e.target.value)} disabled={uploading}
              aria-required="true" aria-invalid={formErrors.name ? 'true' : undefined}
              aria-describedby={formErrors.name ? 'hr-tpl-name-error' : undefined}
              className={inputCls}
            />
            {formErrors.name && <p id="hr-tpl-name-error" className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">{formErrors.name}</p>}
          </div>
          <div>
            <label htmlFor="hr-tpl-slug" className="block text-xs font-semibold text-gray-600 mb-1">Serie (opcional)</label>
            <input
              id="hr-tpl-slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value)}
              disabled={uploading} placeholder={defaultSlug} aria-describedby="hr-tpl-slug-help" className={inputCls}
            />
            <p id="hr-tpl-slug-help" className="text-[11px] text-gray-400 mt-1">
              Déjala vacía para añadir una versión a la serie estándar{defaultSlug ? ` («${defaultSlug}»)` : ''}.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="hr-tpl-file" className="block text-xs font-semibold text-gray-600 mb-1">
              Archivo Word (.docx, máx. 5 MB) <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (obligatorio)</span>
            </label>
            <input
              id="hr-tpl-file" ref={fileRef} type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={uploading}
              aria-required="true" aria-invalid={formErrors.file ? 'true' : undefined}
              aria-describedby={formErrors.file ? 'hr-tpl-file-error' : undefined}
              className="block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-violet-50 file:text-violet-700 dark:file:bg-violet-500/15 dark:file:text-violet-300 hover:file:bg-violet-100"
            />
            {formErrors.file && <p id="hr-tpl-file-error" className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">{formErrors.file}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="hr-tpl-notes" className="block text-xs font-semibold text-gray-600 mb-1">Notas (opcional)</label>
            <textarea id="hr-tpl-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={uploading} className={inputCls} />
          </div>
          <div className="sm:col-span-2 flex sm:justify-end">
            <button
              type="submit" disabled={uploading}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              {uploading ? 'Subiendo…' : 'Subir plantilla'}
            </button>
          </div>
        </form>

        {groupedVariables.length > 0 && (
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-semibold text-gray-700 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
              Guía de variables para el Word
            </summary>
            <p className="text-xs text-gray-500 mt-2">
              Escribe cada variable de una sola vez en Word, con el formato <span className="font-mono">{'{{ nombre_variable }}'}</span> (sin cambiar de formato a mitad).
            </p>
            <div className="mt-3 space-y-3">
              {groupedVariables.map(([group, vars]) => (
                <div key={group}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{group}</p>
                  <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                    {vars.map((v) => (
                      <li key={v.name} className="text-xs text-gray-600">
                        <span className="font-mono text-gray-800">{`{{ ${v.name} }}`}</span> — {v.label}{v.required ? ' (obligatoria)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="hr-tpl-list-title" className="bg-white rounded-2xl border border-gray-100">
        <h2 id="hr-tpl-list-title" className="px-5 sm:px-6 pt-5 text-sm font-semibold text-gray-700 font-display">Versiones</h2>

        <div aria-live="assertive" className="px-5 sm:px-6">
          {listError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 mt-3">
              {listError}
            </p>
          )}
        </div>

        {state.status === 'loading' && (
          <div className="flex items-center justify-center h-32" role="status" aria-live="polite">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-violet-600" />
              <p className="text-sm text-gray-400">Cargando plantillas…</p>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div role="alert" className="m-5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{state.error}</span>
            <button type="button" onClick={fetchRows} className="inline-flex items-center gap-1.5 font-semibold underline">
              <RefreshCw size={14} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {state.status === 'ready' && state.rows.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">Aún no hay plantillas. Sube la primera con el formulario de arriba.</p>
        )}

        {state.status === 'ready' && state.rows.length > 0 && (
          <>
            <ul className="divide-y divide-gray-100 mt-2">
              {state.rows.map((tpl) => (
                <TemplateRow
                  key={tpl.id} tpl={tpl} canActivate busyId={busyId}
                  onActivate={handleActivate} onDownload={handleDownload}
                />
              ))}
            </ul>
            {totalPages > 1 && (
              <nav aria-label="Paginación de plantillas" className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500" aria-live="polite">Página {page} de {totalPages}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                    <ChevronLeft size={14} aria-hidden="true" /> Anterior
                  </button>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                    Siguiente <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
