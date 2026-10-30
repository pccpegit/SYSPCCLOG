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

// SYSPCC-025 · QA ronda 2 — la casilla «Es transferencia interna» del Ingreso, marcada y desmarcada.

const ITEMS = [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 })];

async function fillLine(user) {
  await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
  await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
  await user.type(screen.getByLabelText(/cantidad ingresada/i), '3');
}

const checkbox = () => screen.getByRole('checkbox', { name: /es transferencia interna/i });
const originFloor = () => screen.queryByLabelText(/piso de origen/i);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.registerEntryBatch.mockResolvedValue({ data: { id: 5, group_number: 'ENT-2026-G0001', movements: [{ id: 50 }] } });
});

describe('EntradaPage — transferencia interna', () => {
  it('al marcarla pide el piso de origen y el origen del ingreso pasa a ser una transferencia', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(originFloor()).not.toBeInTheDocument();

    await user.click(checkbox());
    expect(originFloor()).toBeInTheDocument();
    expect(screen.getByLabelText(/^origen/i)).toBeDisabled();
  });

  it('sin piso de origen no se registra y se explica por qué', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillLine(user);
    await user.click(checkbox());
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('Indique el piso de origen.')).toBeInTheDocument();
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('con piso de origen el ingreso se envía como TRANSFER_IN desde ese piso', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillLine(user);
    await user.click(checkbox());
    await user.selectOptions(originFloor(), '1er piso');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch.mock.calls[0][0]).toMatchObject({
      source_type: 'TRANSFER_IN', internal_transfer: 'Desde 1er piso',
    });
  });

  it('al desmarcarla se olvida el piso elegido y el ingreso vuelve a ser una compra normal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillLine(user);
    await user.click(checkbox());
    await user.selectOptions(originFloor(), '2do piso');
    await user.click(checkbox());
    expect(originFloor()).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^origen/i)).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    const body = api.registerEntryBatch.mock.calls[0][0];
    expect(body.source_type).toBe('PURCHASE');
    expect(body).not.toHaveProperty('internal_transfer');
  });

  it('volver a marcarla después de desmarcarla no recuerda el piso anterior', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(checkbox());
    await user.selectOptions(originFloor(), '2do piso');
    await user.click(checkbox());
    await user.click(checkbox());
    expect(originFloor()).toHaveValue('');
  });

  it('marcar la transferencia cuenta como datos cargados: «Limpiar formulario» pide confirmación', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(checkbox());
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    expect(await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' })).toBeInTheDocument();
  });
});

describe('EntradaPage — aviso de ingreso registrado', () => {
  /** DEFECTO QA-34 (menor): sin `group_number` el aviso no debe quedar «Ingreso registrado. Vale interno» con la frase cortada. */
  it('DEFECTO QA-34: sin número de vale el aviso no deja la etiqueta «Vale interno» colgando', async () => {
    const user = userEvent.setup();
    api.registerEntryBatch.mockResolvedValue({ data: {} });
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillLine(user);
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    const messages = await screen.findAllByText(/^ingreso registrado/i);
    expect(messages.some((node) => /vale interno\s*$/i.test(node.textContent))).toBe(false);
    expect(messages.some((node) => /n° de movimiento/i.test(node.textContent))).toBe(false);
    expect(screen.queryByText(/vale interno/i)).not.toBeInTheDocument();             // ni en la tarjeta de resultado
  });

  it('con número, el aviso y la tarjeta de resultado lo llaman «Vale interno» (igual que Egreso y Transferencia)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillLine(user);
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('Ingreso registrado. Vale interno ENT-2026-G0001')).toBeInTheDocument();
    expect(screen.getByText('ENT-2026-G0001')).toBeInTheDocument();
    expect(screen.getByText(/1 ítem registrado\./)).toHaveTextContent('Vale interno ENT-2026-G0001');
    expect(screen.queryByText(/n° de movimiento/i)).not.toBeInTheDocument();
  });
});
