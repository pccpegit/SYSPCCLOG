import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import MovimientosPage from './MovimientosPage';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

const mov = (overrides) => ({
  id: 1, movement_number: 'EXIT-2026-0001', movement_type: 'EXIT', inventory_code: 'EPP000001',
  inventory_description: 'Casco blanco', inventory_unit: 'EA', quantity: 2, warehouse: 'CENTRAL',
  movement_date: '2026-10-05', voucher_number: '', destination_detail: 'APELLIDO PRUEBA UNO',
  destination_personal_name: null, supplier_name: '', internal_transfer: '', ...overrides,
});

const ROWS = [
  mov({ id: 1 }),
  mov({ id: 2, movement_number: 'EXIT-2026-0002', voucher_number: '0456', movement_date: null }),
  mov({ id: 3, movement_number: 'ENTRY-2026-0003', movement_type: 'ENTRY', supplier_name: 'Proveedor de prueba', destination_detail: '' }),
];

const lastParams = () => api.getMovements.mock.lastCall[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getMovements.mockResolvedValue({ data: { count: 3, results: ROWS } });
});

describe('MovimientosPage', () => {
  it('muestra fecha del movimiento, N° de vale y destino/origen', async () => {
    renderWithProviders(<MovimientosPage />);
    const table = await screen.findByRole('table', { name: /movimientos del almacén/i });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('05/10/2026')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Sin vale')).toBeInTheDocument(); // egreso sin vale
    expect(within(rows[1]).getByText('APELLIDO PRUEBA UNO')).toBeInTheDocument();
    expect(within(rows[2]).getByText('0456')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Fecha no registrada')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Proveedor de prueba')).toBeInTheDocument();
    expect(within(rows[3]).queryByText('Sin vale')).not.toBeInTheDocument(); // un ingreso no lleva vale
  });

  it('un egreso nuevo muestra su guía automática en la columna «N° de vale / guía» y no «Sin vale» (SYSPCC-041)', async () => {
    api.getMovements.mockResolvedValue({
      data: { count: 1, results: [mov({ id: 9, movement_number: 'EXIT-2026-0009', internal_guide_number: 'GR-2026-000009' })] },
    });
    renderWithProviders(<MovimientosPage />);
    const table = await screen.findByRole('table', { name: /movimientos del almacén/i });
    expect(within(table).getByRole('columnheader', { name: 'N° de vale / guía' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('GR-2026-000009')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Sin vale')).not.toBeInTheDocument();
  });

  it('filtra por sin vale, sin fecha, vale, destino y rango de fechas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('checkbox', { name: /sin n° de vale/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ no_voucher: 'true', page: 1 }));
    await user.click(screen.getByRole('checkbox', { name: /sin fecha/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ has_date: 'false' }));

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ date_from: '2026-10-01', date_to: '2026-10-31' }));

    await user.click(screen.getByRole('button', { name: /filtros avanzados/i }));
    await user.type(screen.getByLabelText('N° de vale'), '0456');
    await waitFor(() => expect(lastParams()).toMatchObject({ voucher_number: '0456' }));
    await user.type(screen.getByLabelText('Trabajador / destino'), 'prueba');
    await waitFor(() => expect(lastParams()).toMatchObject({ destination: 'prueba' }));
  });

  it('los enlaces del Dashboard activan el filtro (?sin_vale=1)', async () => {
    renderWithProviders(<MovimientosPage />, { route: '/almacen/movimientos?sin_vale=1' });
    await screen.findByRole('table');
    expect(api.getMovements.mock.calls[0][0]).toMatchObject({ no_voucher: 'true' });
    expect(screen.getByRole('checkbox', { name: /sin n° de vale/i })).toBeChecked();
  });

  it('exporta el Excel normal o el formato de su libro con los filtros activos', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.exportMovements.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('checkbox', { name: /sin n° de vale/i }));

    await user.click(screen.getByRole('button', { name: /^exportar$/i }));
    await waitFor(() => expect(api.exportMovements).toHaveBeenLastCalledWith({ no_voucher: 'true' }));
    await user.click(screen.getByRole('button', { name: /formato de su libro/i }));
    await waitFor(() => expect(api.exportMovements).toHaveBeenLastCalledWith({ no_voucher: 'true', layout: 'excel_pcc' }));
  });

  it('estado vacío con filtros, error con reintento y rango invertido', async () => {
    const user = userEvent.setup();
    api.getMovements.mockResolvedValueOnce({ data: { count: 0, results: [] } });
    renderWithProviders(<MovimientosPage />);
    expect(await screen.findByText('No hay movimientos registrados.')).toBeInTheDocument();

    api.getMovements.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByRole('checkbox', { name: /sin fecha/i }));
    expect(await screen.findByText('No se pudieron cargar los movimientos.')).toBeInTheDocument();
    api.getMovements.mockResolvedValue({ data: { count: 0, results: [] } });
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Sin resultados para los filtros aplicados.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-05' } });
    expect((await screen.findAllByText('La fecha inicial no puede ser posterior a la final.')).length).toBeGreaterThan(0);
  });
});

// SYSPCC-025 · react-frontend ronda 1 — la talla («T: L») va al final de la descripción y distingue ítems casi
// idénticos: no se trunca. Lo que se oculta en pantallas angostas pasa a segunda línea de la celda del ítem.
describe('MovimientosPage — descripciones completas y filtros no solo por color', () => {
  const LONG = 'Guante de seguridad de cuero reforzado con puño largo antideslizante T: XL';

  it('no trunca la descripción: se ve completa con la talla', async () => {
    api.getMovements.mockResolvedValue({ data: { count: 1, results: [mov({ inventory_description: LONG })] } });
    renderWithProviders(<MovimientosPage />);
    const cell = (await screen.findByText(new RegExp(LONG))).closest('td');
    expect(cell.className).not.toMatch(/truncate|max-w-\[/);
    expect(cell).toHaveTextContent('T: XL');
    expect(cell.querySelector('[title]')).toBeNull();
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('repite el destino (y el código) como segunda línea de la celda del ítem para pantallas angostas', async () => {
    renderWithProviders(<MovimientosPage />);
    const table = await screen.findByRole('table', { name: /movimientos del almacén/i });
    const row = within(table).getAllByRole('row')[1];
    const itemCell = within(row).getByText(/casco blanco/i).closest('td');
    expect(itemCell).toHaveTextContent('Destino: APELLIDO PRUEBA UNO');
    expect(itemCell).toHaveTextContent('EPP000001');
    expect(within(itemCell).getByText(/Destino:/).className).toContain('lg:hidden');
  });

  it('para un ingreso la segunda línea habla de origen', async () => {
    renderWithProviders(<MovimientosPage />);
    const table = await screen.findByRole('table', { name: /movimientos del almacén/i });
    const row = within(table).getAllByRole('row')[3];
    expect(within(row).getByText('Origen: Proveedor de prueba')).toBeInTheDocument();
  });

  it('el filtro activo lleva un ✓ además del color y de aria-pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovimientosPage />);
    await screen.findByRole('table');
    const group = screen.getByRole('group', { name: 'Tipo de movimiento' });
    const egresos = within(group).getByRole('button', { name: 'Egresos' });
    expect(egresos).toHaveAttribute('aria-pressed', 'false');
    expect(egresos.querySelector('svg')).toBeNull();

    await user.click(egresos);
    expect(egresos).toHaveAttribute('aria-pressed', 'true');
    expect(egresos.querySelector('svg')).not.toBeNull();
    expect(egresos.className).toMatch(/ring-2/);
    expect(within(group).getByRole('button', { name: 'Todos' }).querySelector('svg')).toBeNull();

    const warehouses = screen.getByRole('group', { name: 'Almacén' });
    await user.click(within(warehouses).getByRole('button', { name: 'Central' }));
    expect(within(warehouses).getByRole('button', { name: 'Central' }).querySelector('svg')).not.toBeNull();
  });
});
