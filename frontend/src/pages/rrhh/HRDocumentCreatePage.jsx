import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FileCheck2, Loader2, RefreshCw } from 'lucide-react';
import {
  createDocument,
  getDocument,
  getDocumentTypes,
  getPersonalPrefill,
  getTemplates,
  updateDocument,
} from '../../api/hr';
import { useToast } from '../../context/ToastContext';
import { extractFieldErrors } from '../../utils/apiErrors';
import { hrErrorMessage } from '../../utils/hrErrors';
import ContractForm from '../../components/rrhh/ContractForm';
import WorkerPicker from '../../components/rrhh/WorkerPicker';
import AssistantPanel from '../../components/rrhh/AssistantPanel';
import {
  buildPayload,
  fieldDomId,
  initialValues,
  isEmpty,
  mergeWithoutOverwrite,
  validateContract,
  valuesFromData,
} from '../../components/rrhh/contractFormUtils';

const DOCUMENT_TYPE = 'CONTRACT';

/** Maps the applied keys to their origin: `{ key: origin }`. */
function tag(keys, origin) {
  return Object.fromEntries(keys.map((k) => [k, origin]));
}

/**
 * New contract (and draft editing when there is an `:id`).
 * Order: template -> data source (Personal / assistant) -> form.
 */
export default function HRDocumentCreatePage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [fields, setFields] = useState([]);
  const [constraints, setConstraints] = useState({});
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  // Edit mode: the template the draft currently uses (it may no longer be active).
  const [draftTemplate, setDraftTemplate] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [questions, setQuestions] = useState({});
  const [sources, setSources] = useState({});
  const [worker, setWorker] = useState(null);
  const [usedAssistant, setUsedAssistant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [prefillBusy, setPrefillBusy] = useState(false);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const bannerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    setLoad({ status: 'loading', error: '' });
    try {
      const [typesRes, tplRes, docRes] = await Promise.all([
        getDocumentTypes(),
        getTemplates({ document_type: DOCUMENT_TYPE, is_active: true }),
        isEdit ? getDocument(id) : Promise.resolve(null),
      ]);
      const spec = (typesRes.data ?? []).find((t) => t.key === DOCUMENT_TYPE);
      if (!spec) throw new Error('missing-spec');
      const active = tplRes.data.results ?? [];
      setFields(spec.fields);
      const cons = spec.constraints ?? {};
      setConstraints(cons);
      setTemplates(active);
      if (docRes) {
        const doc = docRes.data;
        if (doc.status !== 'DRAFT') {
          setLoad({ status: 'error', error: 'Solo se pueden editar documentos en borrador.' });
          return;
        }
        setValues(valuesFromData(spec.fields, doc.data, cons));
        setTemplateId(String(doc.template?.id ?? ''));
        setDraftTemplate(doc.template ?? null);
      } else {
        setValues(initialValues(spec.fields, cons));
        setTemplateId(active[0] ? String(active[0].id) : '');
      }
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: hrErrorMessage(err, 'No se pudo cargar el formulario.') });
    }
  }, [id, isEdit]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleChange = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Whatever the user edits is no longer "suggested".
    setSources((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  async function handleSelectWorker(w) {
    setWorker(w);
    setPrefillBusy(true);
    setFormError('');
    try {
      const { data } = await getPersonalPrefill(w.id, DOCUMENT_TYPE);
      const incoming = data.data ?? {};
      const current = valuesRef.current;
      const applied = Object.keys(incoming).filter((k) => isEmpty(current[k]));
      setValues(mergeWithoutOverwrite(current, incoming));
      setSources((prev) => ({ ...prev, ...tag(applied, 'personal') }));
      setQuestions((prev) => ({
        ...prev,
        ...Object.fromEntries((data.missing ?? []).map((m) => [m.field, m.question || m.label])),
      }));
    } catch (err) {
      setWorker(null);
      setFormError(hrErrorMessage(err, 'No se pudieron cargar los datos del trabajador.'));
    } finally {
      setPrefillBusy(false);
    }
  }

  function handleAssistantResult(result) {
    const incoming = result.data ?? {};
    const current = valuesRef.current;
    const applied = Object.keys(incoming).filter((k) => isEmpty(current[k]));
    setValues(mergeWithoutOverwrite(current, incoming));
    setSources((prev) => ({ ...prev, ...tag(applied, 'assistant') }));
    setQuestions(
      Object.fromEntries((result.missing ?? []).map((m) => [m.field, m.question || m.label])),
    );
    if (applied.length > 0) setUsedAssistant(true);
  }

  function focusFirstError(errMap) {
    const first = fields.find((f) => errMap[f.key]);
    if (!first) {
      bannerRef.current?.focus();
      return;
    }
    setTimeout(() => document.getElementById(fieldDomId(first.key))?.focus(), 0);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setFormError('');

    if (!templateId) {
      setFormError('No hay una plantilla activa. Sube y activa una plantilla antes de generar el borrador.');
      setTimeout(() => bannerRef.current?.focus(), 0);
      return;
    }

    const clientErrors = validateContract(fields, values, constraints);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(`Revisa el formulario: ${Object.keys(clientErrors).length} ${Object.keys(clientErrors).length === 1 ? 'campo requiere' : 'campos requieren'} atención.`);
      focusFirstError(clientErrors);
      return;
    }

    setSubmitting(true);
    try {
      const data = buildPayload(fields, values);
      let doc;
      if (isEdit) {
        ({ data: doc } = await updateDocument(id, { data, template_id: Number(templateId) }));
      } else {
        const payload = {
          document_type: DOCUMENT_TYPE,
          template_id: Number(templateId),
          source: usedAssistant ? 'ASSISTANT' : 'MANUAL',
          data,
        };
        if (worker?.id) payload.personal_id = worker.id;
        ({ data: doc } = await createDocument(payload));
      }
      showToast({ type: 'success', message: isEdit ? 'Borrador actualizado.' : 'Borrador generado. Revísalo antes de emitir.' });
      navigate(`/rrhh/documentos/${doc.id}`);
    } catch (err) {
      const fieldErrors = err?.response?.status === 400 ? extractFieldErrors(err) : {};
      const known = Object.fromEntries(Object.entries(fieldErrors).filter(([k]) => fields.some((f) => f.key === k)));
      if (Object.keys(known).length > 0) {
        setErrors(known);
        setFormError('El servidor encontró datos que corregir. Revisa los campos marcados.');
        focusFirstError(known);
      } else {
        setFormError(hrErrorMessage(err, 'No se pudo generar el borrador.'));
        setTimeout(() => bannerRef.current?.focus(), 0);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Options = active templates, plus the draft's own template when it is no
  // longer active, so what is shown is exactly what is sent.
  const templateOptions = useMemo(() => {
    const options = templates.map((t) => ({ id: String(t.id), label: `${t.name} (v${t.version})`, slug: t.slug, version: t.version, stale: false }));
    if (draftTemplate && !options.some((o) => o.id === String(draftTemplate.id))) {
      options.unshift({
        id: String(draftTemplate.id),
        label: `${draftTemplate.name} (v${draftTemplate.version}) — versión anterior, ya no activa`,
        slug: null,
        version: draftTemplate.version,
        stale: true,
      });
    }
    return options;
  }, [templates, draftTemplate]);
  const activeTemplate = templateOptions.find((o) => o.id === templateId);

  if (load.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-violet-600" />
          <p className="text-sm text-gray-400">Cargando formulario…</p>
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div role="alert" className="max-w-2xl mx-auto bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{load.error}</span>
        <button type="button" onClick={fetchAll} className="inline-flex items-center gap-1.5 font-semibold underline">
          <RefreshCw size={14} aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/rrhh/documentos" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 mb-3 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
        <ArrowLeft size={14} aria-hidden="true" /> Volver a documentos
      </Link>
      <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 font-display">
        {isEdit ? 'Editar borrador de contrato' : 'Nuevo contrato de trabajo'}
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Se genera un borrador a partir de la plantilla aprobada. Podrás revisarlo y descargarlo antes de emitirlo.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div
          ref={bannerRef}
          tabIndex={-1}
          aria-live="assertive"
          className="focus:outline-none"
        >
          {formError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3">
              {formError}
            </p>
          )}
        </div>

        <section aria-labelledby="hr-tpl-title" className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <h2 id="hr-tpl-title" className="text-sm font-semibold text-gray-700 font-display mb-3">Plantilla</h2>
          {templateOptions.length === 0 ? (
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3">
              No hay una plantilla activa para contratos.{' '}
              <Link to="/rrhh/plantillas" className="font-semibold underline">Ir a Plantillas</Link> para subir y activar una.
            </p>
          ) : (
            <>
              <label htmlFor="hr-template" className="block text-xs font-semibold text-gray-600 mb-1">
                Plantilla activa
              </label>
              <select
                id="hr-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={submitting}
                className="w-full sm:w-96 px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50/50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {templateOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {activeTemplate?.stale ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                  La plantilla de este borrador ya no está activa. Puedes conservarla o elegir una plantilla activa de la lista.
                </p>
              ) : activeTemplate && (
                <p className="text-[11px] text-gray-400 mt-1">Se usará la versión {activeTemplate.version} de la serie «{activeTemplate.slug}».</p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="hr-source-title" className="space-y-4">
          <h2 id="hr-source-title" className="sr-only">Origen de los datos</h2>
          {!isEdit && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
              <WorkerPicker
                selected={worker}
                onSelect={handleSelectWorker}
                onClear={() => setWorker(null)}
                disabled={submitting || prefillBusy}
              />
              {prefillBusy && (
                <p role="status" className="flex items-center gap-2 text-xs text-gray-500 mt-2">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Cargando datos del trabajador…
                </p>
              )}
            </div>
          )}
          <AssistantPanel
            documentType={DOCUMENT_TYPE}
            personalId={worker?.id}
            getKnownData={() => buildPayload(fields, valuesRef.current)}
            onResult={handleAssistantResult}
          />
        </section>

        <ContractForm
          fields={fields}
          values={values}
          onChange={handleChange}
          errors={errors}
          questions={questions}
          sources={sources}
          disabled={submitting}
        />

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Link
            to="/rrhh/documentos"
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 text-center hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={submitting || templateOptions.length === 0}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileCheck2 size={16} aria-hidden="true" />}
            {submitting ? 'Generando…' : isEdit ? 'Guardar borrador' : 'Generar borrador'}
          </button>
        </div>
      </form>
    </div>
  );
}
