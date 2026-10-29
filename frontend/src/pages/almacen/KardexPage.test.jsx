import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, makeItem } from '../../test/almacenFixtures';
import KardexPage from './KardexPage';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const ITEM = makeItem({
  id: 5, product_code: 'EPP000005', description: 'Casco blanco T: L', unit: 'EA',
  purchase_order_ref: 'OC-100', packing_list: '24003-13', order_number: 'ORD-9', observation: 'Reponer en noviembre',
  total_stock: 6,
});

const mov = (overrides) => ({
  id: 1, movement_number: 'ENTRY-2026-0001', movement_type: 'ENTRY', movement_date: '2026-10-05', quantity: 10,
  delta: 10, balance_after: 10, voucher_number: '', supplier_name: 'Proveedor de prueba', destination_detail: '',
  destination_personal_name: null, internal_transfer: '', notes: '', ...overrides,
});

const OK = {
  item: ITEM,
  opening_stock: 0,
  closing_stock: 6,
  movements: [
    mov(),
    mov({ id: 2, movement_number: 'EXIT-2026-0001', movement_type: 'EXIT', movement_date: '2026-10-06', quantity: 4, delta: -4, balance_after: 6, voucher_number: '0123', supplier_name: '', destination_detail: 'APELLIDO PRUEBA UNO' }),
    mov({ id: 3, movement_number: 'EXIT-2026-0002', movement_type: 'EXIT', movement_date: '2026-10-07', quantity: 1, delta: -1, balance_after: 5, voucher_number: '', supplier_name: '', destination_detail: 'APELLIDO PRUEBA DOS', notes: 'Sin documento' }),
  ],
};

const view = () => renderWithProviders(
  <Routes><Route path="/almacen/inventario/:id" element={<KardexPage />} /></Routes>,
  { route: '/almacen/inventario/5' },
);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getKardex.mockResolvedValue({ data: OK });
  api.getCategories.mockResolvedValue({ data: ['EPP', 'Otros'] });
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
});

describe('KardexPage', () => {
  it('muestra los datos de catálogo, las tarjetas del periodo y el historial con saldo corrido', async () => {
    view();
    expect(await screen.findByRole('heading', { name: 'Casco blanco T: L' })).toBeInTheDocument();
    expect(screen.getByText('OC-100')).toBeInTheDocument();
    expect(screen.getByText('24003-13')).toBeInTheDocument();
    expect(screen.getByText('Reponer en noviembre')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de ubicar · 2do piso')).toBeInTheDocument();

    expect(screen.getByText('Inv. inicial').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Ingresos').nextElementSibling).toHaveTextContent('10');
    expect(screen.getByText('Egresos').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText('Stock actual').nextElementSibling).toHaveTextContent('6');

    const table = screen.getByRole('table', { name: /historial de movimientos/i });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('05/10/2026')).toBeInTheDocument();
    expect(within(rows[2]).getByText('0123')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Sin vale')).toBeInTheDocument();
    // saldo corrido: 10 -> 6 -> 5
    expect(within(rows[1]).getAllByRole('cell')[4]).toHaveTextContent('10');
    expect(within(rows[2]).getAllByRole('cell')[4]).toHaveTextContent('6');
    expect(within(rows[3]).getAllByRole('cell')[4]).toHaveTextContent('5');
  });

  it('avisa con la fecha cuando el saldo se vuelve negativo', async () => {
    api.getKardex.mockResolvedValue({
      data: { ...OK, movements: [mov({ delta: 2, balance_after: 2 }), mov({ id: 2, movement_type: 'EXIT', movement_date: '2026-10-06', delta: -5, balance_after: -3 })], closing_stock: -3 },
    });
    view();
    expect(await screen.findByText('El saldo es negativo el 06/10/2026: revise las fechas de los movimientos.')).toBeInTheDocument();
  });

  it('marca los movimientos sin fecha', async () => {
    api.getKardex.mockResolvedValue({ data: { ...OK, movements: [mov({ movement_date: null })] } });
    view();
    expect(await screen.findByText('Fecha no registrada')).toBeInTheDocument();
  });

  it('filtra por fecha, pide el kardex del periodo y valida el rango', async () => {
    view();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.getKardex).toHaveBeenLastCalledWith('5', { date_from: '2026-10-01' }));
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(api.getKardex).toHaveBeenLastCalledWith('5', { date_from: '2026-10-01', date_to: '2026-10-31' }));

    const calls = api.getKardex.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha inicial no puede ser posterior a la final.');
    await new Promise((r) => setTimeout(r, 30));
    expect(api.getKardex.mock.calls.length).toBe(calls);
  });

  it('sin movimientos muestra el estado vacío', async () => {
    api.getKardex.mockResolvedValue({ data: { ...OK, movements: [], closing_stock: 0 } });
    view();
    expect(await screen.findByText('Este ítem aún no tiene movimientos.')).toBeInTheDocument();
  });

  it('muestra el error y permite reintentar', async () => {
    const user = userEvent.setup();
    api.getKardex.mockRejectedValueOnce(new Error('boom'));
    view();
    expect(await screen.findByText('No se pudo cargar la información del ítem.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('heading', { name: 'Casco blanco T: L' })).toBeInTheDocument();
  });

  it('precarga el ítem en los accesos rápidos de ingreso y entrega', async () => {
    view();
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: /registrar ingreso/i })).toHaveAttribute('href', '/almacen/entrada?item=5');
    expect(screen.getByRole('link', { name: /registrar entrega/i })).toHaveAttribute('href', '/almacen/salida?item=5');
  });

  it('permite editar la observación del ítem sin tocar código ni ubicación', async () => {
    const user = userEvent.setup();
    api.patchInventoryItem.mockResolvedValue({ data: ITEM });
    view();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /editar ítem/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^código/i)).toBeDisabled();

    const obs = within(dialog).getByLabelText(/^observación/i);
    await user.clear(obs);
    await user.type(obs, 'Cambió de proveedor');
    await user.click(within(dialog).getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(api.patchInventoryItem).toHaveBeenCalledTimes(1));
    const [id, payload] = api.patchInventoryItem.mock.calls[0];
    expect(id).toBe(5);
    expect(payload).toMatchObject({ observation: 'Cambió de proveedor', purchase_order_ref: 'OC-100' });
    expect(payload).not.toHaveProperty('product_code');
    expect(payload).not.toHaveProperty('location');
    await waitFor(() => expect(api.getKardex.mock.calls.length).toBeGreaterThan(1));
  });
});

// SYSPCC-025 · react-frontend ronda 1 — el destino no desaparece en pantallas angostas y las observaciones no se truncan.
describe('KardexPage — origen/destino y observaciones visibles', () => {
  beforeEach(() => {
    api.getKardex.mockResolvedValue({ data: OK });
  });

  it('repite el destino bajo la fecha para pantallas angostas', async () => {
    view();
    const table = await screen.findByRole('table', { name: /historial de movimientos/i });
    const row = within(table).getAllByRole('row')[2];
    expect(within(row).getByText('Destino: APELLIDO PRUEBA UNO')).toBeInTheDocument();
  });

  it('la observación se muestra completa, sin truncar ni depender de un tooltip', async () => {
    view();
    const table = await screen.findByRole('table', { name: /historial de movimientos/i });
    const cell = within(table).getByText('Sin documento').closest('td');
    expect(cell.className).not.toContain('truncate');
    expect(cell.getAttribute('title')).toBeNull();
  });
});
