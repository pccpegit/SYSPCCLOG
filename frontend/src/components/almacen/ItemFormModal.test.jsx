import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, exactItem, makeItem } from '../../test/almacenFixtures';
import ItemFormModal from './ItemFormModal';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 1 — alta y edición de un ítem del catálogo.

function setup(props = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<ItemFormModal categories={['EPP', 'Otros']} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved, user: userEvent.setup() };
}

const field = (name) => screen.getByLabelText(name, { exact: false });
const save = () => screen.getByRole('button', { name: /crear ítem|guardar cambios/i });

async function fillNew(user, { code = 'EPP000900', description = 'Casco nuevo', unit = 'EA' } = {}) {
  await user.type(field('Código'), code);
  await user.type(field('Descripción'), description);
  await user.type(field('Unidad'), unit);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
  api.createInventoryItem.mockResolvedValue({ data: { id: 900 } });
  api.patchInventoryItem.mockResolvedValue({ data: { id: 5 } });
});

describe('ItemFormModal — alta', () => {
  it('valida los obligatorios en español y no llama al servidor', async () => {
    const { user } = setup();
    await user.click(save());
    expect(await screen.findAllByText('Este campo es obligatorio.')).toHaveLength(3);   // código, descripción, unidad
    expect(api.createInventoryItem).not.toHaveBeenCalled();
  });

  it('la categoría arranca en EPP y el stock mínimo en 0', () => {
    setup();
    expect(field('Categoría')).toHaveValue('EPP');
    expect(field('Stock mínimo')).toHaveValue(0);
  });

  it.each(['-1', ''])('un stock mínimo «%s» se rechaza', async (value) => {
    const { user } = setup();
    await fillNew(user);
    const min = field('Stock mínimo');
    await user.clear(min);
    if (value) await user.type(min, value);
    await user.click(save());
    expect(await screen.findByText('Ingrese un número mayor o igual a 0.')).toBeInTheDocument();
    expect(api.createInventoryItem).not.toHaveBeenCalled();
  });

  it('un código o descripción de solo espacios cuenta como vacío', async () => {
    const { user } = setup();
    await fillNew(user, { code: '   ', description: '   ', unit: ' ' });
    await user.click(save());
    expect(await screen.findAllByText('Este campo es obligatorio.')).toHaveLength(3);
  });

  it('crea el ítem con los textos recortados, sin ubicación y sin piso', async () => {
    const { user, onSaved } = setup();
    await fillNew(user, { code: '  EPP000900 ', description: ' Casco nuevo T: L ', unit: ' EA ' });
    await user.type(screen.getByLabelText('OC'), ' 1.02 ');
    await user.click(save());
    await waitFor(() => expect(api.createInventoryItem).toHaveBeenCalledTimes(1));
    expect(api.createInventoryItem).toHaveBeenCalledWith(expect.objectContaining({
      product_code: 'EPP000900', description: 'Casco nuevo T: L', unit: 'EA', category: 'EPP',
      item_type: 'EPP', min_stock: 0, floor: null, location: '', purchase_order_ref: '1.02',
    }));
    expect(onSaved).toHaveBeenCalledWith({ id: 900 });
    expect(await screen.findByText('Ítem creado correctamente.')).toBeInTheDocument();
  });

  it('con una ubicación elegida la envía y el piso queda sin definir (lo deriva el servidor)', async () => {
    const { user } = setup();
    await fillNew(user);
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Pabellón'), 'F');
    await user.selectOptions(within(dialog).getByLabelText('Sección'), '3');
    await user.selectOptions(within(dialog).getByLabelText('Nivel'), '2');
    await user.click(save());
    await waitFor(() => expect(api.createInventoryItem).toHaveBeenCalled());
    expect(api.createInventoryItem.mock.calls[0][0]).toMatchObject({ location: 'F3-2', floor: null });
  });

  it('elegir un piso restringe los pabellones a ese piso', async () => {
    const { user } = setup();
    await user.selectOptions(field('Piso o zona'), '1');
    const pav = await screen.findByLabelText('Pabellón');
    expect(within(pav).getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(within(pav).queryByRole('option', { name: 'F' })).not.toBeInTheDocument();
  });

  it('cambiar de piso descarta la ubicación ya elegida en el otro', async () => {
    const { user } = setup();
    await fillNew(user);
    await user.selectOptions(field('Piso o zona'), '2');
    await user.selectOptions(await screen.findByLabelText('Pabellón'), 'F');
    await user.selectOptions(screen.getByLabelText('Sección'), '1');
    await user.selectOptions(screen.getByLabelText('Nivel'), '1');
    await user.selectOptions(field('Piso o zona'), '1');
    await user.click(save());
    await waitFor(() => expect(api.createInventoryItem).toHaveBeenCalled());
    expect(api.createInventoryItem.mock.calls[0][0]).toMatchObject({ location: '', floor: 1 });
  });

  it('no envía dos veces si se pulsa de nuevo mientras guarda', async () => {
    let release;
    api.createInventoryItem.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { user, onSaved } = setup();
    await fillNew(user);
    await user.click(save());
    await user.click(await screen.findByRole('button', { name: /guardando/i }));
    expect(api.createInventoryItem).toHaveBeenCalledTimes(1);
    release({ data: { id: 1 } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('muestra el error del servidor junto al campo (código duplicado)', async () => {
    api.createInventoryItem.mockRejectedValue({
      response: { status: 400, data: { error: true, status_code: 400, detail: { product_code: ['Ya existe un ítem con ese código.'] } } },
    });
    const { user, onSaved } = setup();
    await fillNew(user);
    await user.click(save());
    expect(await screen.findByText('Ya existe un ítem con ese código.')).toBeInTheDocument();
    expect(screen.getByText('Revise los campos marcados.')).toBeInTheDocument();
    expect(field('Código')).toHaveAttribute('aria-invalid', 'true');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('el error de una ubicación fuera del layout aparece bajo el selector', async () => {
    api.createInventoryItem.mockRejectedValue({
      response: { status: 400, data: { detail: { location: ['La ubicación Z9-9 no existe en el layout del almacén.'] } } },
    });
    const { user } = setup();
    await fillNew(user);
    await user.click(save());
    expect(await screen.findByText(/no existe en el layout/i)).toBeInTheDocument();
  });

  it('un error sin campo conocido se muestra como aviso general', async () => {
    api.createInventoryItem.mockRejectedValue({ response: { status: 403, data: { detail: 'Sin permiso.' } } });
    const { user } = setup();
    await fillNew(user);
    await user.click(save());
    expect(await screen.findByText('Sin permiso.')).toBeInTheDocument();
  });

  it('ante un fallo de red usa el mensaje de respaldo', async () => {
    api.createInventoryItem.mockRejectedValue(new Error('Network Error'));
    const { user } = setup();
    await fillNew(user);
    await user.click(save());
    expect(await screen.findByText('No se pudo guardar el ítem. Intente nuevamente.')).toBeInTheDocument();
  });

  it('cancelar cierra sin guardar', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.createInventoryItem).not.toHaveBeenCalled();
  });

  // DEFECTO QA-13: si el layout no carga, el formulario se queda para siempre en «Cargando layout del
  // almacén…» (el catch está vacío): el usuario no sabe que no podrá elegir ubicación ni puede reintentar.
  it('si el layout no carga, lo dice en lugar de quedarse «Cargando…» para siempre', async () => {
    api.getLocationLayout.mockRejectedValue(new Error('boom'));
    setup();
    await waitFor(() => expect(api.getLocationLayout).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/cargando layout del almacén/i)).not.toBeInTheDocument());
  });
});

describe('ItemFormModal — edición', () => {
  const ITEM = exactItem({ id: 5, product_code: 'EPP000005', description: 'Casco blanco', location: 'F3-2', floor: 2 });

  it('el código no se puede cambiar y se muestra como descripción del diálogo', () => {
    setup({ item: ITEM });
    expect(field('Código')).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Editar ítem' })).toBeInTheDocument();
    expect(screen.getByText('El código no se puede cambiar.')).toBeInTheDocument();
  });

  it('precarga los datos del ítem, incluida la ubicación exacta', async () => {
    setup({ item: ITEM });
    expect(field('Descripción')).toHaveValue('Casco blanco');
    expect(await screen.findByLabelText('Pabellón')).toHaveValue('F');
    expect(screen.getByLabelText('Sección')).toHaveValue('3');
  });

  it('sin tocar la ubicación no la envía ni envía el código', async () => {
    const { user, onSaved } = setup({ item: ITEM });
    await user.clear(field('Descripción'));
    await user.type(field('Descripción'), 'Casco blanco v2');
    await user.click(save());
    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalledTimes(1));
    const [id, payload] = api.patchInventoryItem.mock.calls[0];
    expect(id).toBe(5);
    expect(payload).not.toHaveProperty('location');
    expect(payload).not.toHaveProperty('product_code');
    expect(payload.description).toBe('Casco blanco v2');
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Ítem actualizado.')).toBeInTheDocument();
  });

  it('una ubicación antigua en texto libre no se reenvía (el servidor la rechazaría)', async () => {
    const legacy = makeItem({ id: 6, location: 'Estante rojo', location_status: 'FLOOR_ONLY', floor: 2 });
    const { user } = setup({ item: legacy });
    expect(await screen.findByLabelText('Pabellón')).toHaveValue('');
    await user.click(save());
    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalled());
    expect(api.patchInventoryItem.mock.calls[0][1]).not.toHaveProperty('location');
  });

  it('al elegir otra ubicación sí la envía', async () => {
    const { user } = setup({ item: ITEM });
    await user.selectOptions(await screen.findByLabelText('Pabellón'), 'G');
    await user.click(save());
    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalled());
    expect(api.patchInventoryItem.mock.calls[0][1]).toHaveProperty('location');
  });

  it('un ítem sin categoría obliga a indicarla', async () => {
    const { user } = setup({ item: makeItem({ id: 7, category: '' }) });
    await user.click(save());
    expect(await screen.findByText('Este campo es obligatorio.')).toBeInTheDocument();
    expect(api.patchInventoryItem).not.toHaveBeenCalled();
  });

  it('el tipo de ítem tiene todas las opciones menos «Todos los tipos»', () => {
    setup({ item: ITEM });
    const type = field('Tipo');
    expect(within(type).queryByRole('option', { name: /todos los tipos/i })).not.toBeInTheDocument();
    expect(within(type).getAllByRole('option')).toHaveLength(5);
  });
});

// SYSPCC-025 · react-frontend ronda 1 — layout fallido con reintento, resumen y foco al primer error.
describe('ItemFormModal — accesibilidad', () => {
  it('si el layout no carga muestra un aviso con «Reintentar» y, al reintentar, aparece el selector', async () => {
    api.getLocationLayout.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: LAYOUT });
    const { user } = setup();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no se pudo cargar el layout del almacén/i);
    expect(screen.queryByText(/cargando layout del almacén/i)).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Pabellón')).toBeInTheDocument();
    expect(api.getLocationLayout).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/no se pudo cargar el layout/i)).not.toBeInTheDocument();
  });

  it('mientras carga el layout lo anuncia como estado', () => {
    api.getLocationLayout.mockReturnValue(new Promise(() => {}));
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando layout del almacén…');
  });

  it('con errores resume cuántos campos hay y enfoca el primero', async () => {
    const { user } = setup();
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise 3 campos marcados antes de guardar.');
    await waitFor(() => expect(field('Código')).toHaveFocus());
    expect(field('Código')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Código')).toHaveAccessibleDescription('Este campo es obligatorio.');
  });
});

describe('ItemFormModal — sin permiso para asignar ubicación (QA-24)', () => {
  const ITEM = exactItem({ id: 5, product_code: 'EPP000005', description: 'Casco blanco', location: 'F3-2', floor: 2 });

  it('muestra el piso y la ubicación en solo lectura, con el texto del permiso, sin selectores', async () => {
    setup({ item: ITEM, canAssignLocation: false });
    const storage = screen.getByRole('group', { name: 'Almacenamiento' });
    expect(within(storage).queryByLabelText(/piso o zona/i)).not.toBeInTheDocument();
    expect(within(storage).queryByLabelText('Pabellón')).not.toBeInTheDocument();
    expect(within(storage).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(storage).getByText('F3-2')).toBeInTheDocument();
    expect(within(storage).getByText('2do piso')).toBeInTheDocument();
    expect(within(storage).getByText(/solo almacén central y jefe logístico/i)).toBeInTheDocument();
  });

  it('un ítem nuevo o sin ubicación exacta dice «Pendiente de ubicar» y «Sin definir»', () => {
    setup({ canAssignLocation: false });
    const storage = screen.getByRole('group', { name: 'Almacenamiento' });
    expect(within(storage).getByText('Pendiente de ubicar')).toBeInTheDocument();
    expect(within(storage).getByText('Sin definir')).toBeInTheDocument();
  });

  it('no pide el layout del almacén (no hay nada que elegir)', async () => {
    setup({ item: ITEM, canAssignLocation: false });
    await screen.findByRole('heading', { name: 'Editar ítem' });
    expect(api.getLocationLayout).not.toHaveBeenCalled();
  });

  it('al crear no envía piso, ubicación ni proyecto (el servidor respondería 403)', async () => {
    const { user } = setup({ canAssignLocation: false });
    await fillNew(user);
    await user.click(save());
    await waitFor(() => expect(api.createInventoryItem).toHaveBeenCalledTimes(1));
    const payload = api.createInventoryItem.mock.calls[0][0];
    expect(payload).toMatchObject({ product_code: 'EPP000900', description: 'Casco nuevo', unit: 'EA' });
    expect(payload).not.toHaveProperty('floor');
    expect(payload).not.toHaveProperty('location');
    expect(payload).not.toHaveProperty('project');
  });

  it('al editar otros campos tampoco los envía, y el resto sí se guarda', async () => {
    const { user, onSaved } = setup({ item: ITEM, canAssignLocation: false });
    await user.clear(field('Descripción'));
    await user.type(field('Descripción'), 'Casco blanco v2');
    await user.click(save());
    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalledTimes(1));
    const payload = api.patchInventoryItem.mock.calls[0][1];
    expect(payload.description).toBe('Casco blanco v2');
    expect(payload).not.toHaveProperty('floor');
    expect(payload).not.toHaveProperty('location');
    expect(payload).not.toHaveProperty('project');
    expect(onSaved).toHaveBeenCalled();
  });

  it('con permiso (valor por defecto) sigue enviando el piso y pidiendo el layout', async () => {
    const { user } = setup({ item: ITEM });
    await screen.findByLabelText('Pabellón');
    await user.click(save());
    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalled());
    expect(api.patchInventoryItem.mock.calls[0][1]).toHaveProperty('floor', 2);
  });
});

describe('ItemFormModal — rótulos en español', () => {
  it('el número de orden se llama «N° de orden» y «Packing list» se conserva', () => {
    setup();
    expect(field('N° de orden')).toBeInTheDocument();
    expect(field('Packing list')).toBeInTheDocument();
    expect(screen.queryByLabelText(/order number/i)).not.toBeInTheDocument();
  });
});
