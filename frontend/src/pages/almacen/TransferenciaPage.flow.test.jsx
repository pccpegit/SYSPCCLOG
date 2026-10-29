import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import TransferenciaPage from './TransferenciaPage';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const ITEMS = [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 })];

async function ready() {
  await screen.findByRole('combobox', { name: /ítem 1/i });
}

async function fillLine(user, quantity = '1') {
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

describe('TransferenciaPage — limpiar el formulario', () => {
  it('sin datos limpia de una vez, sin pedir confirmación', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Limpiar formulario' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con datos pide confirmación y «Seguir editando» conserva lo escrito', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await fillLine(user, '2');
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');

    await user.click(screen.getByRole('button', { name: 'Limpiar formulario' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^cantidad/i)).toHaveValue('2');
    expect(screen.getByLabelText(/piso de origen/i)).toHaveValue('2');
  });

  it('confirmar borra las líneas y los pisos elegidos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await fillLine(user, '2');
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');

    await user.click(screen.getByRole('button', { name: 'Limpiar formulario' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar formulario' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^cantidad/i)).toHaveValue('');
    expect(screen.getByLabelText(/piso de origen/i)).toHaveValue('');
  });

  it('Escape cierra el diálogo como «Seguir editando» y no borra nada', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await ready();
    await fillLine(user, '2');
    await user.click(screen.getByRole('button', { name: 'Limpiar formulario' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^cantidad/i)).toHaveValue('2');
  });
});

describe('TransferenciaPage — después de registrar', () => {
  async function register(user) {
    await ready();
    await fillLine(user, '1');
    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
    await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    await screen.findByRole('heading', { name: /transferencia registrada/i });
  }

  it('«Registrar otra transferencia» vuelve a un formulario vacío listo para usar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await register(user);
    expect(screen.getByText('SAL-2026-G0009')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /registrar otra transferencia/i }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/piso de origen/i)).toHaveValue('');
    expect(screen.queryByRole('heading', { name: /transferencia registrada/i })).not.toBeInTheDocument();
  });

  it('manda la salida con el destino interno y el texto del traslado entre pisos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await register(user);
    const body = api.registerExitBatch.mock.calls[0][0];
    expect(body).toMatchObject({ destination_type: 'TRANSFER_OUT', warehouse: 'CENTRAL' });
    expect(body.destination_detail).toMatch(/^ALM - /);
    expect(body.internal_transfer).toMatch(/2do piso.*1er piso/);
  });

  it('un rol sin permiso de mostrador no ve la pantalla de transferencia como operable', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<TransferenciaPage />);
    await ready();
    // Almacén de Obra solo opera su almacén: el formulario lo deja fijado, igual que Egreso
    expect(screen.getByLabelText(/^almacén/i)).toHaveValue('SITE');
  });
});
