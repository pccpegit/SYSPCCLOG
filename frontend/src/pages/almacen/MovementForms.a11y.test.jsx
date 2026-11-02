import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem, makeItem } from '../../test/almacenFixtures';
import EntradaPage from './EntradaPage';
import SalidaPage from './SalidaPage';
import TransferenciaPage from './TransferenciaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · react-frontend ronda 1 — correcciones de accesibilidad y UX de los formularios de
// Ingreso, Entrega/Egreso y Transferencia: foco al primer error, resumen de errores, error de
// guardado persistente, atajo de teclado, foco al quitar una fila, «Limpiar formulario» con
// confirmación, selección que no depende solo del color y grupos con nombre por ítem.

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 8 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', unit: 'PAR', total_stock: 20 }),
];

const GROUP = { id: 9, group_number: 'SAL-2026-G0004', movements: [{ id: 90 }] };

const combo = (n) => screen.getByRole('combobox', { name: new RegExp(`ítem ${n}`, 'i') });

async function pickItem(user, n, name) {
  await user.click(combo(n));
  await user.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.lookupPersonal.mockResolvedValue({ data: [] });
  api.registerEntryBatch.mockResolvedValue({ data: { id: 5, group_number: 'ENT-2026-G0001', movements: [{ id: 50 }] } });
  api.registerExitBatch.mockResolvedValue({ data: GROUP });
  api.registerEppDelivery.mockResolvedValue({ data: GROUP });
});

describe('Ingreso — errores de validación', () => {
  it('lleva el foco al primer campo inválido y resume cuántos hay', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));

    // Falta el ítem y la cantidad: dos campos, y el foco va al primero (el ítem).
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise 2 campos marcados en rojo antes de registrar.');
    await waitFor(() => expect(combo(1)).toHaveFocus());
    expect(combo(1)).toHaveAttribute('aria-invalid', 'true');
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('con la fecha vacía el primero es la fecha', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    const date = screen.getByLabelText(/fecha del ingreso/i);
    fireEvent.change(date, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(date).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent('Revise 3 campos marcados');
  });

  it('el mensaje de error de un campo se lee con tamaño legible (no 11 px)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    const message = await screen.findByText('Seleccione un ítem.');
    expect(message.className).toContain('text-xs');
    expect(message.className).not.toContain('text-[11px]');
    expect(combo(1)).toHaveAccessibleDescription('Seleccione un ítem.');
  });
});

describe('Ingreso — error al guardar', () => {
  it('deja un mensaje fijo junto a los botones además del aviso pasajero, y lo quita al reintentar', async () => {
    const user = userEvent.setup();
    api.registerEntryBatch.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Error interno del servidor.' } } });
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '2');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));

    const fixed = await screen.findByText('No se registró el ingreso.');
    expect(fixed.closest('[role="status"]')).toHaveTextContent('Error interno del servidor.');
    // El aviso pasajero (toast) sigue existiendo, pero el mensaje fijo no depende de él.
    expect(screen.getAllByText('Error interno del servidor.').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Ingreso registrado' })).toBeInTheDocument();
    expect(screen.queryByText('No se registró el ingreso.')).not.toBeInTheDocument();
  });
});

describe('Ingreso — filas de ítems', () => {
  it('cada fila es un grupo con el número de ítem para lectores de pantalla', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    const first = screen.getByRole('group', { name: 'Ítem 1' });
    const second = screen.getByRole('group', { name: 'Ítem 2' });
    expect(within(first).getByLabelText(/cantidad ingresada/i)).toBeInTheDocument();
    expect(within(second).getByLabelText(/cantidad ingresada/i)).toBeInTheDocument();
  });

  it('Enter en «Cantidad» registra (envía el formulario) y NO agrega una fila vacía', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3{Enter}');
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch.mock.calls[0][0].items).toHaveLength(1);
  });

  it('Ctrl+Enter agrega otro ítem solo si el actual está completo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    // Fila incompleta (sin ítem ni cantidad): no agrega.
    await user.click(screen.getByLabelText(/cantidad ingresada/i));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.queryByRole('group', { name: 'Ítem 2' })).not.toBeInTheDocument();

    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('group', { name: 'Ítem 2' })).toBeInTheDocument();
    await waitFor(() => expect(combo(2)).toHaveFocus());
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('al quitar una fila el foco pasa a la fila vecina', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    await user.click(screen.getByRole('button', { name: 'Quitar ítem 2' }));
    await waitFor(() => expect(combo(1)).toHaveFocus());
  });

  it('al quitar la primera fila el foco pasa a la que queda', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    await user.click(screen.getByRole('button', { name: 'Quitar ítem 1' }));
    // Queda una sola fila (ya sin botón «Quitar») y el foco no se pierde en el body.
    await waitFor(() => expect(combo(1)).toHaveFocus());
  });
});

describe('Ingreso — «Limpiar formulario»', () => {
  it('sin datos limpia de inmediato, sin diálogo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con datos pide confirmación y «Seguir editando» conserva todo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');

    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    const dialog = await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' });
    // El foco inicial es la opción segura, no «Cerrar».
    expect(within(dialog).getByRole('button', { name: 'Seguir editando' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/cantidad ingresada/i)).toHaveValue('3');
  });

  it('confirmar limpia el formulario', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');

    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar formulario' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/cantidad ingresada/i)).toHaveValue('');
    expect(combo(1)).toHaveValue('');
  });

  it('ya no se llama «Cancelar» (no cancela nada: borra)', async () => {
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(screen.queryByRole('button', { name: /^cancelar$/i })).not.toBeInTheDocument();
  });
});

describe('Entrega / Egreso', () => {
  it('lleva el foco al primer campo inválido: el trabajador antes que el ítem', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /^registrar entrega$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Revise 3 campos marcados en rojo antes de registrar.');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveFocus());
  });

  it('con stock insuficiente, pulsar «Registrar» lleva el foco a la cantidad en lugar de no hacer nada', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '99');
    await user.click(screen.getByRole('button', { name: /^registrar entrega$/i }));
    await waitFor(() => expect(screen.getByLabelText(/^cantidad/i)).toHaveFocus());
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('el error de red al guardar queda fijo junto a los botones', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockRejectedValueOnce(new Error('Network Error'));
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('radio', { name: /proyecto \/ obra/i }));
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    expect(await screen.findByText('No se registró el egreso.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Egreso registrado' })).not.toBeInTheDocument();
  });

  it('el tipo de egreso elegido lleva una marca visible (✓), no solo color', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    const checked = screen.getByRole('radio', { name: /entrega a trabajador/i });
    expect(checked).toBeChecked();
    expect(checked.closest('label').querySelector('svg')).not.toBeNull();
    const other = screen.getByRole('radio', { name: /proyecto \/ obra/i });
    expect(other.closest('label').querySelector('svg')).toBeNull();

    await user.click(other);
    expect(other.closest('label').querySelector('svg')).not.toBeNull();
    expect(checked.closest('label').querySelector('svg')).toBeNull();
  });

  it('el botón principal usa el color de la marca, no el rojo de las acciones destructivas', async () => {
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    const primary = screen.getByRole('button', { name: /^registrar entrega$/i });
    expect(primary.className).toContain('bg-emerald-700');
    expect(primary.className).not.toContain('rose');
  });

  it('«Limpiar formulario» con datos pide confirmación antes de borrar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.type(screen.getByLabelText(/^observación/i), 'Entrega urgente');
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    const dialog = await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' });
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar formulario' }));
    expect(screen.getByLabelText(/^observación/i)).toHaveValue('');
  });

  it('Ctrl+Enter agrega ítem y Enter a secas envía el formulario', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('radio', { name: /proyecto \/ obra/i }));
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('group', { name: 'Ítem 2' })).toBeInTheDocument();
    expect(api.registerExitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Quitar ítem 2' }));
    await waitFor(() => expect(combo(1)).toHaveFocus());
    await user.click(screen.getByLabelText(/^cantidad/i));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
  });

  it('el trabajador lleva una ayuda visible con el mínimo de letras', async () => {
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveAccessibleDescription(/al menos 3 letras/i);
  });
});

describe('Transferencia interna', () => {
  it('lleva el foco al primer campo inválido y resume los errores', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    // Origen, destino, ítem y cantidad.
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise 4 campos marcados en rojo antes de registrar.');
    await waitFor(() => expect(screen.getByLabelText(/piso de origen/i)).toHaveFocus());
  });

  it('el error de guardado queda fijo y «Limpiar formulario» pide confirmar con datos', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Stock insuficiente para EPP000001.' } } });
    renderWithProviders(<TransferenciaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(await screen.findByText('No se registró la transferencia.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    expect(await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' })).toBeInTheDocument();
  });

  it('cada fila es un grupo con nombre y al quitar una el foco no se pierde', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    expect(screen.getByRole('group', { name: 'Ítem 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar ítem 2' }));
    await waitFor(() => expect(combo(1)).toHaveFocus());
  });
});
