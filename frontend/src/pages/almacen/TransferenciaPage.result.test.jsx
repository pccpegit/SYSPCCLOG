import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import TransferenciaPage from './TransferenciaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — transferencia interna: notas, resultado y aviso con la respuesta incompleta.

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 }),
  makeItem({ id: 2, product_code: 'EPP000002', description: 'Lentes claros', unit: 'EA', total_stock: 6 }),
];

async function fill(user, { lines = 1, notes = '' } = {}) {
  await screen.findByRole('combobox', { name: /ítem 1/i });
  await user.selectOptions(screen.getByLabelText(/piso de origen/i), '2do piso');
  await user.selectOptions(screen.getByLabelText(/piso de destino/i), '1er piso');
  await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
  await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
  await user.type(screen.getAllByLabelText(/^cantidad/i)[0], '1');
  if (lines === 2) {
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    await user.click(screen.getByRole('combobox', { name: /ítem 2/i }));
    await user.click(await screen.findByRole('option', { name: /lentes claros/i }));
    await user.type(screen.getAllByLabelText(/^cantidad/i)[1], '1');
  }
  if (notes) await user.type(screen.getByLabelText(/^observación/i), notes);
  await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.registerExitBatch.mockResolvedValue({ data: { id: 3, group_number: 'SAL-2026-G0009' } });
});

describe('TransferenciaPage — envío y resultado', () => {
  it('la observación viaja como notas y la salida es TRANSFER_OUT con el piso de origen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await fill(user, { notes: 'Se llevó para el pasillo B' });
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch.mock.calls[0][0]).toMatchObject({
      destination_type: 'TRANSFER_OUT', notes: 'Se llevó para el pasillo B',
    });
  });

  it('sin observación no se envía el campo de notas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await fill(user);
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch.mock.calls[0][0]).not.toHaveProperty('notes');
  });

  it('el resultado nombra los pisos y usa el singular con un ítem', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await fill(user);
    expect(await screen.findByText(/1 ítem del 2do piso al 1er piso/i)).toBeInTheDocument();
  });

  it('con varios ítems usa el plural', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferenciaPage />);
    await fill(user, { lines: 2 });
    expect(await screen.findByText(/2 ítems del 2do piso al 1er piso/i)).toBeInTheDocument();
  });

  it('un error del servidor se muestra y no se pasa a la pantalla de resultado', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockRejectedValue({ response: { status: 400, data: { detail: 'Stock insuficiente para EPP000001.' } } });
    renderWithProviders(<TransferenciaPage />);
    await fill(user);
    expect((await screen.findAllByText('Stock insuficiente para EPP000001.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /transferencia registrada/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /registrar transferencia/i })).toBeEnabled();
  });

  it('con número de vale interno el aviso lo incluye', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockResolvedValue({ data: { id: 3, group_number: 'SAL-2026-G0009', movements: [{ id: 30 }] } });
    renderWithProviders(<TransferenciaPage />);
    await fill(user);
    expect(await screen.findByText('Transferencia registrada. Vale interno SAL-2026-G0009')).toBeInTheDocument();
  });

  /** DEFECTO QA-34 (menor): mismo patrón que Egreso; sin `group_number` el aviso queda «Transferencia registrada. Vale interno». */
  it('DEFECTO QA-34: sin número de vale el aviso no deja la etiqueta «Vale interno» colgando', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockResolvedValue({ data: {} });
    renderWithProviders(<TransferenciaPage />);
    await fill(user);
    const messages = await screen.findAllByText(/^transferencia registrada/i);
    expect(messages.some((node) => /vale interno\s*$/i.test(node.textContent))).toBe(false);
  });
});
