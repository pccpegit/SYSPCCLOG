import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { page, summaryRow } from '../../test/almacenFixtures';
import ResumenPage from './ResumenPage';
import * as api from '../../api/almacen';
import * as core from '../../api/core';

vi.mock('../../api/almacen');
vi.mock('../../api/core');

const ROWS = [
  summaryRow({ inventory_id: 1, product_code: 'EPP000001', initial_stock: 5, entries: 10, exits: 3, closing_stock: 12 }),
  summaryRow({ inventory_id: 2, product_code: 'EPP000002', description: 'Lentes claros', initial_stock: 0, entries: 4, exits: 4, closing_stock: 0, location: 'F3-2', location_status: 'EXACT', observation: 'Reposición pendiente' }),
];
const META = { totals: { initial: 5, entries: 14, exits: 7, closing: 12 }, undated_movements: 0 };

const lastParams = () => api.getMovementSummary.mock.lastCall[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getMovementSummary.mockResolvedValue(page(ROWS, { meta: META }));
  api.getCategories.mockResolvedValue({ data: ['EPP', 'Otros'] });
  core.getProjects.mockResolvedValue({ data: { results: [{ id: 4, code: 'OP', name: 'ON PLANT' }] } });
});

describe('ResumenPage', () => {
  it('muestra las columnas de su hoja y los valores por ítem', async () => {
    renderWithProviders(<ResumenPage />);
    const table = await screen.findByRole('table', { name: /resumen de movimiento por ítem/i });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent.toLowerCase());
    expect(headers).toEqual([
      'código', 'descripción', 'uom', 'inv. inicial', 'ingresos', 'egresos', 'stock actual', 'ubicación', 'observación', 'proyecto',
    ]);
    const row = within(table).getByRole('row', { name: /epp000002/i });
    expect(within(row).getByText('F3-2')).toBeInTheDocument();
    expect(within(row).getByText('Reposición pendiente')).toBeInTheDocument();
    expect(within(row).getByText('ON PLANT')).toBeInTheDocument();
  });

  it('cuadra: inicial + ingresos − egresos = stock actual en el pie de totales', async () => {
    renderWithProviders(<ResumenPage />);
    const table = await screen.findByRole('table');
    const footer = within(table).getAllByRole('row').at(-1);
    const cells = within(footer).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual(['5', '14', '7', '12']);
    expect(5 + 14 - 7).toBe(12);
    expect(within(footer).getByText(/todos los resultados/i)).toBeInTheDocument();
  });

  it('filtra por periodo y traduce los demás filtros', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ date_from: '2026-10-01', date_to: '2026-10-31', page: 1 }));

    await user.click(screen.getByRole('checkbox', { name: /solo con movimiento/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ only_with_movement: 'true' }));
    await user.click(screen.getByRole('checkbox', { name: /solo sin stock/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ only_zero_stock: 'true' }));
    await user.selectOptions(screen.getByLabelText('Piso'), '2do piso');
    await waitFor(() => expect(lastParams()).toMatchObject({ floor: '2' }));
    await user.selectOptions(screen.getByLabelText('Categoría'), 'EPP');
    await waitFor(() => expect(lastParams()).toMatchObject({ category: 'EPP' }));
    await user.selectOptions(await screen.findByLabelText('Proyecto'), 'OP — ON PLANT');
    await waitFor(() => expect(lastParams()).toMatchObject({ project: '4' }));
  });

  it('no consulta con un rango de fechas invertido y lo explica', async () => {
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    const calls = api.getMovementSummary.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha inicial no puede ser posterior a la final.');
    await new Promise((r) => setTimeout(r, 50));
    // solo se pudo consultar con el "Desde" solo, nunca con el rango inválido
    expect(api.getMovementSummary.mock.calls.slice(calls).every(([p]) => !(p.date_from && p.date_to))).toBe(true);
  });

  it('avisa de los movimientos sin fecha que quedan fuera del periodo', async () => {
    api.getMovementSummary.mockResolvedValue(page(ROWS, { meta: { ...META, undated_movements: 268 } }));
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(screen.queryByText(/sin fecha no se incluye/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText(/268 movimientos sin fecha no se incluyen en este periodo/i)).toBeInTheDocument();
  });

  it('muestra el vacío del periodo y el error con reintento', async () => {
    api.getMovementSummary.mockResolvedValueOnce(page([], { meta: { ...META, totals: { initial: 0, entries: 0, exits: 0, closing: 0 } } }));
    renderWithProviders(<ResumenPage />);
    expect(await screen.findByText('No hay ítems que coincidan con los filtros.')).toBeInTheDocument();

    api.getMovementSummary.mockResolvedValue(page([], { meta: META }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('No hay movimientos en el periodo seleccionado.')).toBeInTheDocument();
  });

  it('muestra el error y permite reintentar', async () => {
    const user = userEvent.setup();
    api.getMovementSummary.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<ResumenPage />);
    expect(await screen.findByText('No se pudo cargar el resumen de movimiento.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('exporta a Excel con los filtros y, si se pide, las hojas INGRESOS y EGRESOS', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.exportMovementSummary.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    await user.click(screen.getByRole('checkbox', { name: /incluir hojas ingresos y egresos/i }));
    await user.click(screen.getByRole('button', { name: /exportar a excel/i }));

    await waitFor(() => expect(api.exportMovementSummary).toHaveBeenCalledWith({ date_from: '2026-10-01', include_movements: 'true' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('cada ítem enlaza a su kardex', async () => {
    renderWithProviders(<ResumenPage />);
    expect(await screen.findByRole('link', { name: 'EPP000002' })).toHaveAttribute('href', '/almacen/inventario/2');
  });
});

describe('ResumenPage — stock distinto al de Inventario', () => {
  const DIVERGENT = [
    summaryRow({ inventory_id: 1, product_code: 'EPP000001', closing_stock: 0, current_stock: 40 }),
    summaryRow({ inventory_id: 2, product_code: 'EPP000002', closing_stock: 12, current_stock: 12 }),
    summaryRow({ inventory_id: 3, product_code: 'EPP000003', closing_stock: 3, current_stock: 9 }),
  ];

  it('avisa cuántos ítems de la página tienen un stock real distinto al calculado con movimientos', async () => {
    api.getMovementSummary.mockResolvedValue(page(DIVERGENT, { meta: META }));
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    const banner = screen.getByText(/en esta página, 2 ítems tienen un stock en inventario distinto/i);
    expect(banner).toHaveTextContent(/el stock real es el de Inventario/);
    expect(within(banner).getByRole('link', { name: 'Inventario' })).toHaveAttribute('href', '/almacen/inventario');
  });

  it('con un solo ítem distinto usa el singular', async () => {
    api.getMovementSummary.mockResolvedValue(page(DIVERGENT.slice(0, 2), { meta: META }));
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(screen.getByText(/en esta página, 1 ítem tiene un stock en inventario distinto/i)).toBeInTheDocument();
  });

  it('si todo cuadra no muestra nada', async () => {
    api.getMovementSummary.mockResolvedValue(page(DIVERGENT.slice(1, 2), { meta: META }));
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(screen.queryByText(/stock en inventario distinto/i)).not.toBeInTheDocument();
  });

  it('con un periodo no compara: el cierre de un periodo pasado no tiene por qué igualar al stock de hoy', async () => {
    api.getMovementSummary.mockResolvedValue(page(DIVERGENT, { meta: META }));
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(screen.getByText(/stock en inventario distinto/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-10' } });
    await waitFor(() => expect(screen.queryByText(/stock en inventario distinto/i)).not.toBeInTheDocument());
  });
});
