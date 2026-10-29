import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import MovimientosPage from './MovimientosPage';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 2 — filtros avanzados de Movimientos y regreso a la página 1.

const row = (id) => ({
  id, movement_number: `SAL-2026-G0001-${String(id).padStart(2, '0')}`, movement_type: 'EXIT', inventory_code: 'EPP000001',
  inventory_description: `Casco blanco ${id}`, inventory_unit: 'EA', quantity: 1, warehouse: 'CENTRAL',
  movement_date: '2026-10-05', voucher_number: '', destination_detail: 'DESTINO PRUEBA', supplier_name: '',
});

const lastParams = () => api.getMovements.mock.lastCall[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getMovements.mockResolvedValue({ data: { count: 80, results: [row(1), row(2)] } });
});

async function openAdvanced(user) {
  await screen.findByRole('table');
  await user.click(screen.getByRole('button', { name: /filtros avanzados/i }));
}

describe('MovimientosPage — filtros avanzados', () => {
  it('proveedor, cantidad mínima y cantidad máxima viajan como parámetros del servidor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await openAdvanced(user);

    await user.type(screen.getByLabelText('Proveedor'), 'Ferretería');
    await waitFor(() => expect(lastParams()).toMatchObject({ supplier: 'Ferretería' }));
    await user.type(screen.getByLabelText('Cantidad mínima'), '2');
    await waitFor(() => expect(lastParams()).toMatchObject({ qty_min: '2' }));
    await user.type(screen.getByLabelText('Cantidad máxima'), '9');
    await waitFor(() => expect(lastParams()).toMatchObject({ qty_min: '2', qty_max: '9', supplier: 'Ferretería' }));
  });

  it('un filtro vacío no se envía', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await openAdvanced(user);
    await user.type(screen.getByLabelText('Proveedor'), 'X');
    await waitFor(() => expect(lastParams()).toMatchObject({ supplier: 'X' }));
    await user.clear(screen.getByLabelText('Proveedor'));
    await waitFor(() => expect(lastParams()).not.toHaveProperty('supplier'));
  });

  it('el texto de búsqueda viaja como «search»', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox', { name: /buscar movimientos/i }), 'EPP0000');
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'EPP0000' }));
  });

  it('los espacios en el vale y el destino no cuentan como filtro', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await openAdvanced(user);
    await user.type(screen.getByLabelText('N° de vale'), '   ');
    await user.type(screen.getByLabelText('Trabajador / destino'), '  ');
    await waitFor(() => expect(api.getMovements.mock.calls.length).toBeGreaterThan(1));
    expect(lastParams()).not.toHaveProperty('voucher_number');
    expect(lastParams()).not.toHaveProperty('destination');
  });
});

describe('MovimientosPage — paginación', () => {
  it('cualquier filtro vuelve a la página 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));
    expect(await screen.findByText('Página 2 de 4')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /buscar movimientos/i }), 'a');
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, search: 'a' }));
    expect(await screen.findByText('Página 1 de 4')).toBeInTheDocument();
  });

  it('«Anterior» está desactivado en la primera página y «Siguiente» en la última', async () => {
    const user = userEvent.setup();
    api.getMovements.mockResolvedValue({ data: { count: 30, results: [row(1)] } });
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /anterior/i }));
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
  });
});
