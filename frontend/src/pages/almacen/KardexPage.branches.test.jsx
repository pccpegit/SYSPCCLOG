import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, makeItem } from '../../test/almacenFixtures';
import KardexPage from './KardexPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — kardex: saldo negativo sin fecha, «Limpiar fechas» y cierre del editor sin guardar.

const ITEM = makeItem({ id: 5, product_code: 'EPP000005', description: 'Casco blanco T: L', unit: 'EA', total_stock: 6 });

const mov = (overrides) => ({
  id: 1, movement_number: 'ENTRY-2026-0001', movement_type: 'ENTRY', movement_date: '2026-10-05', quantity: 10,
  delta: 10, balance_after: 10, voucher_number: '', supplier_name: 'Proveedor de prueba', destination_detail: '',
  destination_personal_name: null, internal_transfer: '', notes: '', ...overrides,
});

const view = () => renderWithProviders(
  <Routes><Route path="/almacen/inventario/:id" element={<KardexPage />} /></Routes>,
  { route: '/almacen/inventario/5' },
);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getKardex.mockResolvedValue({ data: { item: ITEM, opening_stock: 0, closing_stock: 10, movements: [mov()] } });
  api.getCategories.mockResolvedValue({ data: ['EPP'] });
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
});

describe('KardexPage — saldo negativo', () => {
  it('si el movimiento que deja el saldo negativo no tiene fecha lo dice sin inventar una', async () => {
    api.getKardex.mockResolvedValue({
      data: {
        item: ITEM, opening_stock: 0, closing_stock: -2,
        movements: [
          mov({ delta: 3, balance_after: 3 }),
          mov({ id: 2, movement_type: 'EXIT', movement_date: null, delta: -5, balance_after: -2 }),
        ],
      },
    });
    view();
    expect(await screen.findByText('El saldo es negativo en un movimiento sin fecha: revise las fechas de los movimientos.')).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });

  it('con saldos siempre positivos no hay alerta', async () => {
    view();
    await screen.findByRole('table', { name: /historial de movimientos/i });
    expect(screen.queryByText(/el saldo es negativo/i)).not.toBeInTheDocument();
  });

  it('un saldo exactamente en cero no es negativo', async () => {
    api.getKardex.mockResolvedValue({
      data: { item: ITEM, opening_stock: 0, closing_stock: 0, movements: [mov({ delta: 3, balance_after: 3 }), mov({ id: 2, movement_type: 'EXIT', delta: -3, balance_after: 0 })] },
    });
    view();
    await screen.findByRole('table', { name: /historial de movimientos/i });
    expect(screen.queryByText(/el saldo es negativo/i)).not.toBeInTheDocument();
  });
});

describe('KardexPage — periodo y edición', () => {
  it('«Limpiar fechas» solo aparece con un periodo y vuelve a pedir el historial completo', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /limpiar fechas/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.getKardex).toHaveBeenLastCalledWith('5', { date_from: '2026-10-01' }));
    await user.click(await screen.findByRole('button', { name: /limpiar fechas/i }));

    await waitFor(() => expect(api.getKardex).toHaveBeenLastCalledWith('5', {}));
    expect(screen.getByLabelText('Desde')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /limpiar fechas/i })).not.toBeInTheDocument();
  });

  it('«Cancelar» en el editor cierra el diálogo sin guardar ni recargar el kardex', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole('table');
    const loads = api.getKardex.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /editar ítem/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^observación/i), 'cambio descartado');
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.patchInventoryItem).not.toHaveBeenCalled();
    expect(api.getKardex.mock.calls.length).toBe(loads);
  });
});

describe('KardexPage — rótulos y permiso de ubicación', () => {
  it('el número de orden del catálogo se llama «N° de orden»', async () => {
    api.getKardex.mockResolvedValue({
      data: { item: { ...ITEM, order_number: 'ORD-9' }, opening_stock: 0, closing_stock: 10, movements: [mov()] },
    });
    view();
    await screen.findByRole('table');
    expect(screen.getByText('N° de orden')).toBeInTheDocument();
    expect(screen.getByText('ORD-9')).toBeInTheDocument();
    expect(screen.queryByText(/order number/i)).not.toBeInTheDocument();
  });

  it.each([['SITE_WAREHOUSE'], ['LOGISTICS_COORDINATOR'], ['LOGISTICS_SUPERVISOR']])(
    '%s edita el ítem con el almacenamiento en solo lectura (el servidor rechazaría un cambio de piso)',
    async (role) => {
      const user = userEvent.setup();
      useAuth.mockReturnValue({ userRoles: [role] });
      view();
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: /editar ítem/i }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByLabelText(/piso o zona/i)).not.toBeInTheDocument();
      expect(within(dialog).getByText(/solo almacén central y jefe logístico/i)).toBeInTheDocument();
      expect(api.getLocationLayout).not.toHaveBeenCalled();
    },
  );

  it('Almacén Central y Jefe Logístico sí pueden elegir el piso', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_CHIEF'] });
    view();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /editar ítem/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/piso o zona/i)).toBeEnabled();
  });
});
