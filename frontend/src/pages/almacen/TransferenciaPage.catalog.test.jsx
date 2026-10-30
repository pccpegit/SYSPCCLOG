import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import TransferenciaPage from './TransferenciaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — la transferencia interna con el catálogo caído.

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
});

describe('TransferenciaPage — catálogo que no carga', () => {
  it('muestra el error y «Reintentar» recupera el formulario', async () => {
    const user = userEvent.setup();
    api.getInventory
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ data: [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco' })] });
    renderWithProviders(<TransferenciaPage />);

    expect(await screen.findByText('No se pudo cargar el catálogo de ítems.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /ítem 1/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(api.getInventory).toHaveBeenCalledTimes(2);
  });

  it('con el catálogo caído no se registra nada aunque se envíe el formulario', async () => {
    const user = userEvent.setup();
    api.getInventory.mockRejectedValue(new Error('boom'));
    renderWithProviders(<TransferenciaPage />);
    await screen.findByText('No se pudo cargar el catálogo de ítems.');
    await user.click(screen.getByRole('button', { name: /registrar transferencia/i }));
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });
});
