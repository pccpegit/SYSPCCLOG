import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem } from '../../test/almacenFixtures';
import EntradaPage from './EntradaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

// SYSPCC-026 — las compras de un RQ ingresan solas al almacén cuando se reciben en el sistema, así
// que cargarlas a mano duplicaría el material. El formulario lo avisa cuando el origen es «Compra»,
// pero NUNCA lo bloquea (también sirve para stock que no pasa por un RQ).
vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const NOTICE = 'Las compras de un RQ ingresan solas al recibirlas en el sistema; use este formulario solo para stock sin RQ.';
const ITEMS = [exactItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 })];

const noticeRegion = () => screen.queryByText(NOTICE)?.closest('[aria-live="polite"]');

async function ready() {
  const view = renderWithProviders(<EntradaPage />);
  await screen.findByRole('combobox', { name: /ítem 1/i });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.registerEntryBatch.mockResolvedValue({ data: { id: 5, group_number: 'ENT-2026-G0001', movements: [{ id: 50 }] } });
});

describe('EntradaPage — aviso de las compras de un RQ', () => {
  it('con el origen «Compra» (el de partida) muestra el aviso, informativo y visible', async () => {
    await ready();

    expect(screen.getByLabelText(/^Origen/)).toHaveValue('PURCHASE');
    expect(screen.getByText(NOTICE)).toBeVisible();
  });

  it('con cualquier otro origen no aparece', async () => {
    const user = userEvent.setup();
    await ready();

    for (const value of ['RETURN', 'TRANSFER_IN', 'INITIAL_LOAD', 'ADJUSTMENT']) {
      await user.selectOptions(screen.getByLabelText(/^Origen/), value);
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    }
    await user.selectOptions(screen.getByLabelText(/^Origen/), 'PURCHASE');
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it('una transferencia interna no es una compra: el aviso desaparece y vuelve al desmarcarla', async () => {
    const user = userEvent.setup();
    await ready();

    await user.click(screen.getByRole('checkbox', { name: /transferencia interna/i }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /transferencia interna/i }));
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it('está en una región viva siempre montada, para que el cambio de origen se anuncie', async () => {
    const user = userEvent.setup();
    await ready();

    const region = noticeRegion();
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).not.toHaveAttribute('role');           // a role="status" would clash with the other live notices

    await user.selectOptions(screen.getByLabelText(/^Origen/), 'ADJUSTMENT');
    expect(region).toBeInTheDocument();                   // the same node stays: only its content changes
    expect(region).toBeEmptyDOMElement();

    await user.selectOptions(screen.getByLabelText(/^Origen/), 'PURCHASE');
    expect(region).toHaveTextContent(NOTICE);
  });

  it('es solo un aviso: se puede registrar una compra igual y el origen enviado es PURCHASE', async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /ítem 1/i }));
    await user.click(await screen.findByRole('option', { name: /casco blanco/i }));
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '5');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));

    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch.mock.calls[0][0]).toMatchObject({ source_type: 'PURCHASE' });
    expect(await screen.findByRole('heading', { name: /ingreso registrado/i })).toBeInTheDocument();
  });

  it('no usa el tono de alerta: no es un error ni una advertencia de campo', async () => {
    await ready();

    const banner = screen.getByText(NOTICE).closest('div.flex');
    expect(banner.className).toContain('bg-blue-50');
    expect(banner.className).not.toMatch(/red|amber/);
  });

  it('el aviso convive con el de «sin guía de remisión» sin pisarlo', async () => {
    await ready();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/Sin guía de remisión: se registrará/)).toBeInTheDocument();
  });
});
