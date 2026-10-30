import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import EntradaPage from './EntradaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ITEM = makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: [ITEM] });
  api.registerEntryBatch.mockResolvedValue({ data: { id: 5, group_number: 'ENT-2026-G0001', movements: [{ id: 50 }] } });
});

async function warehouseSelect() {
  await screen.findByRole('combobox', { name: /ítem 1/i });
  return screen.getByLabelText(/^almacén/i);
}

describe('EntradaPage — almacén según el rol', () => {
  it('Almacén Central puede elegir cualquier almacén', async () => {
    renderWithProviders(<EntradaPage />);
    const select = await warehouseSelect();
    expect(select).toBeEnabled();
    expect(select).toHaveValue('CENTRAL');
  });

  it('un rol de logística puede elegir el almacén', async () => {
    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_CHIEF'] });
    renderWithProviders(<EntradaPage />);
    expect(await warehouseSelect()).toBeEnabled();
  });

  it('quien tiene Almacén de Obra y además Almacén Central no queda fijado', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE', 'CENTRAL_WAREHOUSE'] });
    renderWithProviders(<EntradaPage />);
    expect(await warehouseSelect()).toBeEnabled();
  });

  /**
   * DEFECTO QA-23 (el backend lo pidió a frontend en la ronda 1 de correcciones): `entry`/`batch-entry`
   * responden 403 «Su rol solo permite operar el almacén de obra.» para un SITE_WAREHOUSE que opera
   * otro almacén. Egreso y Transferencia ya fijan el almacén de obra; Ingreso deja elegir CENTRAL
   * y el usuario solo se entera después de llenar todo el formulario.
   */
  it('DEFECTO QA-23: Almacén de Obra queda fijado al almacén de obra, igual que en Egreso', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<EntradaPage />);
    const select = await warehouseSelect();
    expect(select).toHaveValue('SITE');
    expect(select).toBeDisabled();
  });

  it('DEFECTO QA-23: el ingreso de Almacén de Obra se envía al almacén de obra', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<EntradaPage />);
    await warehouseSelect();
    await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
    await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch.mock.calls[0][0].warehouse).toBe('SITE');
  });
  it('Almacén de Obra ve por qué el almacén está fijo; Almacén Central no ve esa explicación', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    const { unmount } = renderWithProviders(<EntradaPage />);
    await warehouseSelect();
    expect(screen.getByText('Su rol solo opera el almacén de obra.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^almacén/i)).toHaveAccessibleDescription('Su rol solo opera el almacén de obra.');
    unmount();

    useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
    renderWithProviders(<EntradaPage />);
    await warehouseSelect();
    expect(screen.queryByText('Su rol solo opera el almacén de obra.')).not.toBeInTheDocument();
  });

  it('tener además un rol de logística libera el almacén (el servidor lo permite en ingresos)', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE', 'LOGISTICS_COORDINATOR'] });
    renderWithProviders(<EntradaPage />);
    const select = await warehouseSelect();
    expect(select).toBeEnabled();
    expect(select).toHaveValue('CENTRAL');
  });

  it('tras registrar, «Registrar otro ingreso» vuelve a dejar fijo el almacén de obra', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<EntradaPage />);
    await warehouseSelect();
    await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
    await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await user.click(await screen.findByRole('button', { name: /registrar otro ingreso/i }));

    const select = await warehouseSelect();
    expect(select).toHaveValue('SITE');
    expect(select).toBeDisabled();
  });
});
