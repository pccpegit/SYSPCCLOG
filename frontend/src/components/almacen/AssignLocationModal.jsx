import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, MapPin } from 'lucide-react';
import HRDialog from '../rrhh/HRDialog';
import { assignLocations, getLocationLayout } from '../../api/almacen';
import { useToast } from '../../context/useToast';
import { extractErrorMessage } from '../../utils/apiErrors';
import { checkLocationCode, isLocationPrefix } from '../../utils/almacen';
import LocationPicker from './LocationPicker';
import { Banner, Field } from './ui';
import { btnPrimary, btnSecondary, inputCls } from './uiStyles';

const MAX_LISTED = 5;

/**
 * Fase 3 (Almacenamiento): asigna la ubicación exacta a uno o varios ítems.
 * Todo o nada: si el servidor rechaza alguna, no se aplica ninguna y se
 * muestran los errores por ítem.
 *
 * Pensado para ubicar muchos ítems seguidos: el código se puede escribir
 * (`F3-2`, validado contra el layout) o elegir con los tres selectores; Enter
 * confirma; y con `queue` (otros ítems pendientes) «Asignar y siguiente» es la
 * acción principal (Enter incluido) y deja el diálogo abierto en el próximo ítem.
 * El foco inicial va al campo del código.
 */
export default function AssignLocationModal({ open, items, queue = [], onClose, onDone, onAssigned }) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState(items);
  const [assignedIds, setAssignedIds] = useState(() => new Set());
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState('');
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [location, setLocation] = useState('');
  const [codeText, setCodeText] = useState('');
  const [codeError, setCodeError] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [formError, setFormError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const inFlight = useRef(false);
  const codeRef = useRef(null);

  useEffect(() => {
    if (!open || layout) return undefined;
    let cancelled = false;
    getLocationLayout()
      .then((res) => { if (!cancelled) setLayout(res.data); })
      .catch(() => { if (!cancelled) setLayoutError('No se pudo cargar el layout del almacén.'); });
    return () => { cancelled = true; };
  }, [open, layout, layoutAttempt]);

  if (!open) return null;

  const floors = [...new Set(current.map((i) => i.floor).filter(Boolean))];
  const commonFloor = current.length > 0 && floors.length === 1 && current.every((i) => i.floor) ? floors[0] : null;

  // Siguiente ítem pendiente (solo al ubicar de a uno): los demás de la lista que aún no se ubicaron.
  const upcoming = current.length === 1
    ? queue.filter((q) => q.id !== current[0].id && !assignedIds.has(q.id))
    : [];
  const next = upcoming[0] ?? null;

  const retryLayout = () => {
    setLayoutError('');
    setLayoutAttempt((n) => n + 1);
  };

  const onCodeChange = (e) => {
    const text = e.target.value.toUpperCase();
    setCodeText(text);
    setFormError('');
    const check = checkLocationCode(text, layout, commonFloor);
    // «F», «F3» or «F3-» are valid beginnings: flagging them (and announcing the error) while the
    // person is still typing is wrong. The full check runs on submit; here only codes that are
    // already complete (but unknown to the layout) or can no longer become valid are reported.
    setCodeError(isLocationPrefix(text) ? '' : check.error);
    setLocation(check.code);
    // Los selectores siguen al código escrito (se reinician con su `key`).
    if (check.code) setPickerKey((k) => k + 1);
  };

  const onPick = (code) => {
    setLocation(code);
    setCodeText(code);
    setCodeError('');
    setFormError('');
  };

  const submit = async (advance = false) => {
    if (inFlight.current || !layout) return;
    // Full validation here (an unfinished prefix such as «F3» is not an assignable location).
    const check = checkLocationCode(codeText, layout, commonFloor);
    if (check.error) {
      setCodeError(check.error);
      setFormError('Corrija el código de ubicación.');
      codeRef.current?.focus();
      return;
    }
    if (!location) {
      setFormError('Escriba el código o elija pabellón, sección y nivel.');
      codeRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setFormError('');
    setErrors([]);
    try {
      await assignLocations(current.map((i) => ({ inventory: i.id, location })));
      showToast({
        type: 'success',
        message: current.length === 1
          ? `Ubicación ${location} asignada.`
          : `Ubicación ${location} asignada a ${current.length} ítems.`,
      });
      if (advance && next) {
        setAssignedIds((prev) => new Set([...prev, ...current.map((i) => i.id)]));
        onAssigned?.();
        setCurrent([next]);
        setAnnouncement(`Ítem siguiente: ${next.product_code}, ${next.description}.`);
        setLocation('');
        setCodeText('');
        setCodeError('');
        setPickerKey((k) => k + 1);
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        onDone();
      }
    } catch (err) {
      const rows = err?.response?.data?.errors;
      if (Array.isArray(rows) && rows.length) {
        setErrors(rows);
        setFormError('No se aplicó ningún cambio. Corrija los ítems indicados.');
      } else {
        setFormError(extractErrorMessage(err, 'No se pudo asignar la ubicación. Intente nuevamente.'));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <HRDialog
      open
      onClose={onClose}
      busy={saving}
      initialFocusRef={codeRef}
      title={current.length === 1 ? 'Asignar ubicación' : `Asignar ubicación a ${current.length} ítems`}
      description="Elija dónde queda almacenado. El formato es Pabellón + Sección – Nivel."
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
          {next ? (
            <>
              <button type="button" onClick={() => submit(false)} aria-disabled={saving || !layout} className={btnSecondary}>
                Asignar y cerrar
              </button>
              <button type="submit" form="assign-loc-form" aria-disabled={saving || !layout} className={btnPrimary}>
                {saving
                  ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Guardando…</>
                  : <>Asignar y siguiente <ArrowRight size={15} aria-hidden="true" /></>}
              </button>
            </>
          ) : (
            <button type="submit" form="assign-loc-form" aria-disabled={saving || !layout} className={btnPrimary}>
              {saving ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Guardando…</> : <><MapPin size={15} aria-hidden="true" /> Asignar</>}
            </button>
          )}
        </>
      )}
    >
      <form
        id="assign-loc-form"
        noValidate
        onSubmit={(e) => { e.preventDefault(); submit(Boolean(next)); }}
        className="space-y-4"
      >
        {/* Always mounted so a screen reader announces the item that comes next. */}
        <p aria-live="polite" className="sr-only">{announcement}</p>
        <ul className="text-xs text-gray-600 space-y-0.5" aria-label="Ítems seleccionados">
          {current.slice(0, MAX_LISTED).map((i) => (
            <li key={i.id}><span className="font-mono text-gray-500">{i.product_code}</span> {i.description}</li>
          ))}
          {current.length > MAX_LISTED && <li>y {current.length - MAX_LISTED} más…</li>}
        </ul>
        {current.length === 1 && upcoming.length > 0 && (
          <p className="text-xs text-gray-500">
            {upcoming.length === 1 ? 'Queda' : 'Quedan'} {upcoming.length} {upcoming.length === 1 ? 'ítem pendiente' : 'ítems pendientes'} después de este en la lista.
          </p>
        )}

        {layoutError && (
          <Banner tone="red" live="assertive">
            <p>{layoutError}</p>
            <button type="button" onClick={retryLayout} className={`${btnSecondary} mt-2`}>Reintentar</button>
          </Banner>
        )}
        {!layout && !layoutError && (
          <p role="status" className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Cargando layout…
          </p>
        )}

        <Field
          label="Código de ubicación"
          id="assign-loc-code"
          error={codeError}
          hint="Escríbalo (por ejemplo F3-2) o elíjalo con los selectores."
        >
          <input
            ref={codeRef}
            value={codeText}
            onChange={onCodeChange}
            autoComplete="off"
            maxLength={6}
            className={`${inputCls(!!codeError)} font-mono uppercase`}
            placeholder="F3-2"
          />
        </Field>

        {layout && (
          <LocationPicker
            key={pickerKey}
            layout={layout}
            floor={commonFloor}
            value={location}
            onChange={onPick}
            idPrefix="assign-loc"
          />
        )}

        {formError && <Banner tone="red" live="assertive">{formError}</Banner>}
        {errors.length > 0 && (
          <ul className="text-xs text-red-700 dark:text-red-300 space-y-1" aria-label="Errores por ítem">
            {errors.map((e, idx) => (
              <li key={`${e.index}-${idx}`}>
                <span className="font-mono">{current[e.index]?.product_code ?? `Ítem ${e.index + 1}`}</span>
                {': '}{e.error}
              </li>
            ))}
          </ul>
        )}
      </form>
    </HRDialog>
  );
}
