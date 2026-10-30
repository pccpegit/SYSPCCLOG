import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import HRDialog from '../rrhh/HRDialog';
import { createInventoryItem, getLocationLayout, patchInventoryItem } from '../../api/almacen';
import { useToast } from '../../context/useToast';
import useFocusFirstInvalid from '../../hooks/useFocusFirstInvalid';
import { extractErrorMessage, extractFieldErrors } from '../../utils/apiErrors';
import { FLOOR_OPTIONS, ITEM_TYPES } from '../../data/almacenConstants';
import { ASSIGN_LOCATION_PERMISSION_TEXT } from '../../data/almacenRoles';
import { floorLabel } from '../../utils/almacen';
import LocationPicker from './LocationPicker';
import { Banner, Field } from './ui';
import { btnPrimary, btnSecondary, inputCls } from './uiStyles';

const REQUIRED_MESSAGE = 'Este campo es obligatorio.';

const blankForm = {
  product_code: '', description: '', item_type: 'EPP', unit: '', category: 'EPP',
  brand: '', model_name: '', size: '', min_stock: '0', floor: '', location: '',
  order_number: '', purchase_order_ref: '', packing_list: '', observation: '',
};

function formFromItem(item) {
  if (!item) return blankForm;
  return {
    product_code: item.product_code ?? '',
    description: item.description ?? '',
    item_type: item.item_type ?? 'MATERIAL',
    unit: item.unit ?? '',
    category: item.category ?? '',
    brand: item.brand ?? '',
    model_name: item.model_name ?? '',
    size: item.size ?? '',
    min_stock: String(item.min_stock ?? 0),
    floor: item.floor ? String(item.floor) : '',
    location: item.location_status === 'EXACT' ? (item.location ?? '') : '',
    order_number: item.order_number ?? '',
    purchase_order_ref: item.purchase_order_ref ?? '',
    packing_list: item.packing_list ?? '',
    observation: item.observation ?? '',
  };
}

/**
 * Alta y edición de un ítem del catálogo (SYSPCC-025). La ubicación exacta solo
 * acepta el formato oficial (selectores contra el layout del backend); vacía
 * significa "pendiente de ubicar". En edición el código no se puede cambiar.
 *
 * `canAssignLocation` (Almacén Central y Jefe Logístico): sin ese permiso el bloque
 * «Almacenamiento» es de solo lectura y el piso, la ubicación y el proyecto no se
 * envían, porque el servidor responde 403 si cambian. Es solo UX; el servidor valida.
 */
export default function ItemFormModal({ item = null, categories = [], canAssignLocation = true, onClose, onSaved }) {
  const { showToast } = useToast();
  const editing = Boolean(item);
  const [form, setForm] = useState(() => formFromItem(item));
  const [locationTouched, setLocationTouched] = useState(false);
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState('');
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();

  useEffect(() => {
    // Read-only storage needs no layout: skip the request (and its error banner).
    if (!canAssignLocation) return undefined;
    let cancelled = false;
    getLocationLayout()
      .then((res) => { if (!cancelled) { setLayout(res.data); setLayoutError(''); } })
      .catch(() => {
        if (!cancelled) setLayoutError('No se pudo cargar el layout del almacén. No podrá elegir la ubicación exacta hasta que cargue.');
      });
    return () => { cancelled = true; };
  }, [layoutAttempt, canAssignLocation]);

  const retryLayout = () => {
    setLayoutError('');
    setLayoutAttempt((n) => n + 1);
  };

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // Cambiar de piso invalida una ubicación elegida en el otro piso.
  const changeFloor = (e) => {
    const { value } = e.target;
    setForm((prev) => ({ ...prev, floor: value, location: '' }));
    if (form.location) setLocationTouched(true);
  };

  const validate = () => {
    const errs = {};
    if (!editing && !form.product_code.trim()) errs.product_code = REQUIRED_MESSAGE;
    if (!form.description.trim()) errs.description = REQUIRED_MESSAGE;
    if (!form.unit.trim()) errs.unit = REQUIRED_MESSAGE;
    if (!form.category.trim()) errs.category = REQUIRED_MESSAGE;
    const min = Number(form.min_stock);
    if (form.min_stock === '' || !Number.isFinite(min) || min < 0) errs.min_stock = 'Ingrese un número mayor o igual a 0.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    const errs = validate();
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) {
      const count = Object.keys(errs).length;
      setFormError(`Revise ${count} ${count === 1 ? 'campo marcado' : 'campos marcados'} antes de guardar.`);
      focusFirstInvalid();
      return;
    }

    const payload = {
      description: form.description.trim(),
      item_type: form.item_type,
      unit: form.unit.trim(),
      category: form.category.trim(),
      brand: form.brand.trim(),
      model_name: form.model_name.trim(),
      size: form.size.trim(),
      min_stock: Number(form.min_stock),
      order_number: form.order_number.trim(),
      purchase_order_ref: form.purchase_order_ref.trim(),
      packing_list: form.packing_list.trim(),
      observation: form.observation.trim(),
    };
    if (!editing) payload.product_code = form.product_code.trim();
    // Floor and location are sent only by who may assign them (the server rejects any change otherwise).
    if (canAssignLocation) {
      payload.floor = form.floor ? Number(form.floor) : null;
      if (!editing || locationTouched) payload.location = form.location;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      const { data } = editing
        ? await patchInventoryItem(item.id, payload)
        : await createInventoryItem(payload);
      showToast({ type: 'success', message: editing ? 'Ítem actualizado.' : 'Ítem creado correctamente.' });
      onSaved(data);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const known = Object.keys(blankForm);
      const mapped = Object.fromEntries(Object.entries(fieldErrors).filter(([k]) => known.includes(k)));
      if (Object.keys(mapped).length) {
        setErrors(mapped);
        setFormError('Revise los campos marcados.');
        focusFirstInvalid();
      } else {
        setFormError(extractErrorMessage(err, 'No se pudo guardar el ítem. Intente nuevamente.'));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const categoryListId = 'almacen-item-categories';

  return (
    <HRDialog
      open
      variant="drawer"
      busy={saving}
      onClose={onClose}
      title={editing ? 'Editar ítem' : 'Nuevo ítem'}
      description={editing ? item.product_code : 'Complete los campos obligatorios para registrar el ítem.'}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
          <button type="submit" form="item-form" aria-disabled={saving} className={btnPrimary}>
            {saving
              ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Guardando…</>
              : (editing ? 'Guardar cambios' : 'Crear ítem')}
          </button>
        </>
      )}
    >
      <form id="item-form" ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError && <Banner tone="red" live="assertive">{formError}</Banner>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Código" required error={errors.product_code} hint={editing ? 'El código no se puede cambiar.' : undefined}>
            <input value={form.product_code} onChange={set('product_code')} disabled={editing} className={inputCls(!!errors.product_code)} placeholder="EPP000123" />
          </Field>
          <Field label="Tipo" required error={errors.item_type}>
            <select value={form.item_type} onChange={set('item_type')} className={inputCls(!!errors.item_type)}>
              {ITEM_TYPES.filter((t) => t.value).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Descripción" required error={errors.description}>
          <input value={form.description} onChange={set('description')} className={inputCls(!!errors.description)} placeholder="Nombre o descripción del ítem" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Unidad" required error={errors.unit}>
            <input value={form.unit} onChange={set('unit')} className={inputCls(!!errors.unit)} placeholder="EA, M2, LT" />
          </Field>
          <Field label="Categoría" required error={errors.category} hint="EPP u Otros.">
            <input value={form.category} onChange={set('category')} list={categoryListId} className={inputCls(!!errors.category)} />
          </Field>
          <Field label="Talla" error={errors.size}>
            <input value={form.size} onChange={set('size')} className={inputCls(!!errors.size)} placeholder="L, XL, 42…" />
          </Field>
        </div>
        <datalist id={categoryListId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Marca" error={errors.brand}>
            <input value={form.brand} onChange={set('brand')} className={inputCls(!!errors.brand)} />
          </Field>
          <Field label="Modelo" error={errors.model_name}>
            <input value={form.model_name} onChange={set('model_name')} className={inputCls(!!errors.model_name)} />
          </Field>
          <Field label="Stock mínimo" error={errors.min_stock}>
            <input type="number" min="0" step="any" value={form.min_stock} onChange={set('min_stock')} className={inputCls(!!errors.min_stock)} />
          </Field>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-xs font-semibold text-gray-600 font-display">Almacenamiento</legend>
          {canAssignLocation ? (
            <>
              <Field label="Piso o zona" error={errors.floor} hint="Sin ubicación exacta, el ítem queda «Pendiente de ubicar».">
                <select value={form.floor} onChange={changeFloor} className={inputCls(!!errors.floor)}>
                  <option value="">Sin definir</option>
                  {FLOOR_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              {layout ? (
                <LocationPicker
                  key={form.floor || 'all'}
                  layout={layout}
                  floor={form.floor || null}
                  value={form.location}
                  idPrefix="item-loc"
                  invalid={!!errors.location}
                  describedBy={errors.location ? 'item-loc-error' : undefined}
                  onChange={(code) => { setLocationTouched(true); setForm((prev) => ({ ...prev, location: code })); }}
                />
              ) : layoutError ? (
                <Banner tone="red" live="assertive">
                  <p>{layoutError}</p>
                  <button type="button" onClick={retryLayout} className={`${btnSecondary} mt-2`}>Reintentar</button>
                </Banner>
              ) : (
                <p role="status" className="text-xs text-gray-500">Cargando layout del almacén…</p>
              )}
              {errors.location && <p id="item-loc-error" className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.location}</p>}
            </>
          ) : (
            <>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-gray-600">Piso o zona</dt>
                  <dd className="text-gray-900 font-medium">{(item?.floor && floorLabel(item.floor)) || 'Sin definir'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-gray-600">Ubicación</dt>
                  <dd className="text-gray-900 font-medium font-mono">
                    {item?.location_status === 'EXACT' ? item.location : 'Pendiente de ubicar'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-gray-600">{ASSIGN_LOCATION_PERMISSION_TEXT}</p>
            </>
          )}
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="OC" error={errors.purchase_order_ref}>
            <input value={form.purchase_order_ref} onChange={set('purchase_order_ref')} className={inputCls(!!errors.purchase_order_ref)} />
          </Field>
          <Field label="Packing list" error={errors.packing_list}>
            <input value={form.packing_list} onChange={set('packing_list')} className={inputCls(!!errors.packing_list)} />
          </Field>
          <Field label="N° de orden" error={errors.order_number}>
            <input value={form.order_number} onChange={set('order_number')} className={inputCls(!!errors.order_number)} />
          </Field>
        </div>

        <Field label="Observación" error={errors.observation}>
          <textarea rows={2} value={form.observation} onChange={set('observation')} className={`${inputCls(!!errors.observation)} resize-none`} />
        </Field>
      </form>
    </HRDialog>
  );
}
