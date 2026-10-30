import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import { localISODate } from '../../utils/almacen';
import TransferenciaPage from './TransferenciaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ITEMS = [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 })];

async function ready() {
  await screen.findByRole('combobox', { name: /ítem 1/i });
}

async function fillLine(user, quantity) {
  await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
  await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
  await user.type(screen.getByLabelText(/^cantidad/i), quantity);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.registerExitBatch.mockResolvedValue({ data: { id: 3, group_number: 'SAL-2026-G0009' } });
});

describe('TransferenciaPage', () => {
  it('exige ambos pisos y que sean distintos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await fillLine(user, '1');

    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(await screen.findByText('Indique el piso de origen.')).toBeInTheDocument();
    expect(screen.getByText('Indique el piso de destino.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '2do piso');
    expect(screen.getByText('El piso de destino debe ser distinto del de origen.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('registra una salida TRANSFER_OUT al otro piso y recuerda reasignar la ubicación', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
    await fillLine(user, '2');
    expect(screen.getByText('Transferir 1 ítem del 2do piso al 1er piso.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));

    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch).toHaveBeenCalledWith({
      items: [{ inventory: 1, quantity: 2 }],
      warehouse: 'CENTRAL',
      movement_date: localISODate(),
      destination_type: 'TRANSFER_OUT',
      destination_detail: 'ALM - PRIMER PISO',
      internal_transfer: '2do piso → 1er piso',
    });
    expect(await screen.findByRole('heading', { name: 'Transferencia registrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventario' })).toHaveAttribute('href', '/almacen/inventario');
  });

  it('no deja transferir más que el stock disponible', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
    await fillLine(user, '9');
    expect(await screen.findByText('Stock insuficiente para EPP000001. Disponible: 4, solicitado: 9.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockRejectedValue({ response: { status: 400, data: { detail: 'Stock insuficiente para EPP000001. Disponible: 0, solicitado: 2' } } });
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
    await fillLine(user, '2');
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/stock insuficiente/i);
  });
});
