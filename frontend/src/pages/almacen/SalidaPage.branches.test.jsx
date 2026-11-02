import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — ramas de error de la pantalla de Egreso / Entrega de EPP.

const ITEMS = [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 5 })];
const WORKER = { id: 7, full_name: 'Apellido Prueba Siete', position: 'Operario', project_code: 'OP' };

const combo = (n = 1) => screen.getByRole('combobox', { name: new RegExp(`ítem ${n}`, 'i') });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.lookupPersonal.mockResolvedValue({ data: [WORKER] });
});

describe('SalidaPage — catálogo que no carga', () => {
  it('muestra el error, no ofrece registrar y «Reintentar» vuelve a pedir el catálogo', async () => {
    const user = userEvent.setup();
    api.getInventory.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<SalidaPage />);

    expect(await screen.findByText('No se pudo cargar el catálogo de ítems.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /ítem 1/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^registrar entrega$/i })).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(api.getInventory).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No se pudo cargar el catálogo de ítems.')).not.toBeInTheDocument();
  });

  it('con el catálogo caído, enviar el formulario no llama al servidor', async () => {
    const user = userEvent.setup();
    api.getInventory.mockRejectedValue(new Error('boom'));
    renderWithProviders(<SalidaPage />);
    await screen.findByText('No se pudo cargar el catálogo de ítems.');
    await user.click(screen.getByRole('button', { name: /^registrar entrega$/i }));
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });
});

describe('SalidaPage — aviso de «última entrega»', () => {
  it('si la consulta falla no aparece el aviso y la entrega se puede registrar igual', async () => {
    const user = userEvent.setup();
    api.getMovements.mockRejectedValue(new Error('boom'));
    api.registerEppDelivery.mockResolvedValue({ data: { id: 9, group_number: 'SAL-2026-G0001', internal_guide_number: 'GR-2026-000001', movements: [{ id: 90 }] } });
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });

    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await user.click(combo(1));
    await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
    await user.type(screen.getByLabelText(/^cantidad/i), '1');

    await waitFor(() => expect(api.getMovements).toHaveBeenCalled());
    expect(screen.queryByText(/última entrega/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^registrar entrega$/i }));
    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
  });

  it('una entrega anterior sin fecha se anuncia como «sin fecha», no como una fecha inválida', async () => {
    const user = userEvent.setup();
    api.getMovements.mockResolvedValue({
      data: { results: [{ id: 3, movement_date: null, quantity: 1, inventory_unit: 'EA' }] },
    });
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await user.click(combo(1));
    await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
    expect(await screen.findByText(/última entrega de este ítem al trabajador: sin fecha \(1 EA\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });
});

describe('SalidaPage — «Limpiar formulario»', () => {
  it('«Seguir editando» cierra la confirmación y conserva lo cargado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.type(screen.getByLabelText(/^observación/i), 'Entrega urgente');

    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    const dialog = await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' });
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^observación/i)).toHaveValue('Entrega urgente');
  });

  it('Escape también conserva lo cargado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.type(screen.getByLabelText(/^observación/i), 'Entrega urgente');
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^observación/i)).toHaveValue('Entrega urgente');
  });

  it('sin datos cargados no hay nada que confirmar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
